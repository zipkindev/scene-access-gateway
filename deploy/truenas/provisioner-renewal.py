#!/usr/bin/env python3
"""NAS-local renewal of one scoped Authentik provisioner; no secret-bearing logs."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

DUE_SECONDS = 8 * 60 * 60
RESULT = 'PROVISIONER_RENEWAL_RESULT:'

# This program runs only in the existing Authentik container. Its input/output
# pipes stay on the NAS. Only the host process sees the newly issued key.
MODEL = r'''
import hmac,json,sys,uuid
from django.db import transaction
from django.utils.timezone import now
from authentik.core.models import User,Group,Token,TokenIntents,default_token_duration
from authentik.rbac.models import Role
from guardian.models import RoleModelPermission,RoleObjectPermission
p=json.load(sys.stdin); c=p['scope']
with transaction.atomic():
 u=User.objects.select_for_update().get(username=c['user'])
 g=Group.objects.get(name=c['service_group']); r=Role.objects.get(name=c['role'])
 target=Group.objects.get(name=c['target_group'])
 assert u.is_active and not u.is_superuser and not g.is_superuser and not target.is_superuser
 assert list(u.groups.values_list('name',flat=True))==[c['service_group']]
 assert not u.roles.exists() and list(g.roles.values_list('name',flat=True))==[c['role']]
 assert sorted(RoleModelPermission.objects.filter(role=r).values_list('permission__codename',flat=True))==sorted(c['global_permissions'])
 actual=sorted(RoleObjectPermission.objects.filter(role=r).values_list('permission__codename','content_type__app_label','content_type__model','object_pk'))
 assert actual==sorted((name,'authentik_core','group',str(target.pk)) for name in c['group_permissions'])
 owned=Token.objects.including_expired().filter(user=u,intent=TokenIntents.INTENT_API,identifier__startswith=c['prefix'])
 allowed=Token.objects.including_expired().filter(user=u,intent=TokenIntents.INTENT_API,identifier__in=c['initial_tokens'])
 action=p['action']; result={}
 if action=='inspect':
  matches=[t for t in list(owned)+list(allowed) if hmac.compare_digest(t.key,p['key'])]
  assert len(matches)<=1
  t=matches[0] if matches else None
  result={'matches':bool(t),'identifier':t.identifier if t else None,'expires':t.expires.isoformat() if t and t.expires else None,'expiring':t.expiring if t else None}
 elif action=='issue':
  expiry=default_token_duration();assert (expiry-now()).total_seconds()>p['minimum_lifetime']
  t=Token.objects.create(user=u,intent=TokenIntents.INTENT_API,identifier=c['prefix']+uuid.uuid4().hex,expiring=True,expires=expiry,description='Scoped automatic provisioner renewal')
  result={'identifier':t.identifier,'expires':t.expires.isoformat(),'key':t.key}
 elif action=='retire':
  assert owned.filter(identifier=p['active']).exists()
  # Never touch another identity, role, directory-reader token or unknown token.
  owned.exclude(identifier=p['active']).delete();allowed.exclude(identifier=p['active']).delete()
 elif action=='discard':
  assert p['identifier'].startswith(c['prefix'])
  owned.filter(identifier=p['identifier']).delete()
 else:raise ValueError('unsupported action')
 print('PROVISIONER_RENEWAL_RESULT:'+json.dumps(result))
'''
VERIFY = """require('/app/management').createManagement().status().then(v=>process.exit(v.status==='ok'&&v.group===process.argv[1]?0:1)).catch(()=>process.exit(1))"""


class RenewalError(Exception):
    pass


def run(command, payload=None):
    result = subprocess.run(command, input=payload, capture_output=True,
                            text=True, timeout=90, check=False)
    if result.returncode:
        # Docker/Django output can contain input values. Never relay either pipe.
        raise RenewalError('operation_failed')
    return result.stdout


def container(project, service):
    value = run(['docker', 'ps', '-q', '--no-trunc', '--filter',
                 'label=com.docker.compose.project=' + project, '--filter',
                 'label=com.docker.compose.service=' + service]).strip()
    if not re.fullmatch(r'[a-f0-9]{64}', value):
        raise RenewalError('container_identity_ambiguous')
    facts = json.loads(run(['docker', 'inspect', value, '--format', '{{json .State}}']))
    if facts['Status'] != 'running' or facts.get('Health', {}).get('Status') != 'healthy':
        raise RenewalError('container_unhealthy')
    return value


class Backend:
    def __init__(self, config):
        self.config = config
        self.server = container(config['authentik_project'], config['authentik_service'])
        self.portal = container(config['portal_project'], config['portal_service'])

    def call(self, action, **values):
        payload = json.dumps({'action': action, 'scope': self.config['scope'], **values})
        output = run(['docker', 'exec', '-i', self.server, 'ak', 'shell', '-c', MODEL], payload)
        lines = [line[len(RESULT):] for line in output.splitlines() if line.startswith(RESULT)]
        if len(lines) != 1:
            raise RenewalError('model_response_invalid')
        return json.loads(lines[0])

    def verify(self):
        run(['docker', 'exec', self.portal, 'node', '-e', VERIFY,
             self.config['scope']['target_group']])


def atomic_json(path, value):
    fd, name = tempfile.mkstemp(prefix='.status-', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle); handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


class SecretFile:
    def __init__(self, path, directory, gid):
        self.path, self.directory, self.gid = Path(path), Path(directory), gid

    def read(self):
        info = self.path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != self.gid or stat.S_IMODE(info.st_mode) != 0o640:
            raise RenewalError('secret_file_permissions')
        return self.path.read_text().strip()

    def install(self, value):
        if not isinstance(value, str) or not 32 <= len(value) <= 4096 or '\n' in value or '\r' in value:
            raise RenewalError('credential_format')
        # Preserve the inode: the running portal has this file bind-mounted.
        fd = os.open(self.path, os.O_WRONLY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if info.st_uid != 0 or info.st_gid != self.gid or stat.S_IMODE(info.st_mode) != 0o640:
                raise RenewalError('secret_file_permissions')
            data = (value + '\n').encode()
            if os.pwrite(fd, data, 0) != len(data):
                raise RenewalError('credential_write_incomplete')
            os.ftruncate(fd, len(data)); os.fsync(fd)
        finally: os.close(fd)

    def backup(self, value):
        path = self.directory / 'previous-token'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(value + '\n'); handle.flush(); os.fsync(handle.fileno())


def renew(backend, secret, now, check=False, force=False):
    old = secret.read()
    current = backend.call('inspect', key=old)
    expiry = datetime.fromisoformat(current['expires']) if current.get('expires') else None
    due = not current.get('matches') or current.get('expiring') is not True or not expiry or (expiry - now).total_seconds() <= DUE_SECONDS
    healthy = False
    try:
        backend.verify(); healthy = True
    except RenewalError:
        pass
    if check:
        if not healthy or not current.get('matches') or current.get('expiring') is not True:
            raise RenewalError('current_credential_unverified')
        return {'status': 'checked', 'due': due, 'expires': current['expires']}
    if not due and healthy and not force:
        # Also finishes cleanup if an earlier process stopped after verification.
        if current['identifier'].startswith(backend.config['scope']['prefix']):
            backend.call('retire', active=current['identifier'])
        return {'status': 'unchanged', 'expires': current['expires']}
    secret.backup(old)
    candidate = backend.call('issue', minimum_lifetime=DUE_SECONDS + 3600)
    try:
        secret.install(candidate['key'])
        backend.verify()
    except Exception:
        try:
            secret.install(old)
        except Exception:
            # Keep the candidate alive when restoring the file did not succeed.
            raise RenewalError('restore_failed') from None
        backend.call('discard', identifier=candidate['identifier'])
        raise RenewalError('replacement_rejected_prior_restored') from None
    try:
        backend.call('retire', active=candidate['identifier'])
    except Exception:
        # The new credential works. Do not restore a potentially retired token.
        raise RenewalError('active_verified_cleanup_pending') from None
    return {'status': 'renewed', 'expires': candidate['expires']}


def load_config(path):
    for target in (path, path.parent, Path(__file__).resolve()):
        info = target.lstat()
        if target.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
            raise RenewalError('maintenance_permissions')
    config = json.loads(path.read_text())
    scope = config['scope']
    if not re.fullmatch(r'[a-z0-9-]{8,100}-', scope['prefix']):
        raise RenewalError('token_prefix_invalid')
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RenewalError('root_required')
    directory = Path(__file__).resolve().parent
    config = load_config(directory / 'config.json')
    fd = os.open(directory / 'renewal.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status': 'already_running'})); return
        secret = SecretFile(config['secret_file'], directory, config['secret_gid'])
        try:
            result = renew(Backend(config), secret, datetime.now(timezone.utc), args.check, args.force)
        except Exception as error:
            reason = str(error) if isinstance(error, RenewalError) else 'unexpected_failure'
            atomic_json(directory / 'status.json', {'status': 'failed', 'reason': reason,
                'checkedAt': datetime.now(timezone.utc).isoformat()})
            raise
        atomic_json(directory / 'status.json', {**result, 'checkedAt': datetime.now(timezone.utc).isoformat()})
        print(json.dumps(result))
    finally: os.close(fd)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        # Neither exception text nor captured command output is safe to print.
        code = str(error) if isinstance(error, RenewalError) else 'unexpected_failure'
        print(json.dumps({'status': 'failed', 'reason': code}), file=sys.stderr)
        sys.exit(1)

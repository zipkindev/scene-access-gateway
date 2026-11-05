"""Failure and recovery checks for the administrative renewal lifecycle."""
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('renewal', Path(__file__).with_name('provisioner-renewal.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
NOW = datetime(2030, 1, 1, tzinfo=timezone.utc)


class Secret:
    def __init__(self): self.value = 'old'; self.saved = None; self.failures = 0
    def read(self): return self.value
    def backup(self, value): self.saved = value
    def install(self, value):
        self.value = value
        if self.failures:
            self.failures -= 1
            raise OSError('private exception text must not escape')


class Backend:
    config = {'scope': {'prefix': 'renewal-owned-'}}
    def __init__(self, secret, hours=24):
        self.secret = secret; self.calls = []; self.reject_new = False; self.fail_action = None
        self.current = {'matches': True, 'identifier': 'renewal-owned-current',
                        'expiring': True, 'expires': (NOW + timedelta(hours=hours)).isoformat()}
    def call(self, action, **data):
        self.calls.append((action, data))
        if action == self.fail_action: raise m.RenewalError('operation_failed')
        if action == 'inspect': return self.current
        if action == 'issue': return {'key': 'new', 'identifier': 'renewal-owned-next',
                                      'expires': (NOW + timedelta(hours=24)).isoformat()}
        return {}
    def verify(self):
        self.calls.append(('verify', {}))
        if self.secret.value == 'new' and self.reject_new: raise m.RenewalError('operation_failed')


class RenewalTests(unittest.TestCase):
    def setup_pair(self, hours=24):
        secret = Secret(); return secret, Backend(secret, hours)

    def test_healthy_credential_is_not_rotated_early(self):
        secret, backend = self.setup_pair()
        self.assertEqual(m.renew(backend, secret, NOW)['status'], 'unchanged')
        self.assertEqual(secret.value, 'old')
        self.assertNotIn('issue', [a for a, _ in backend.calls])

    def test_due_credential_verifies_new_before_retiring_old(self):
        secret, backend = self.setup_pair(hours=8)
        result = m.renew(backend, secret, NOW)
        self.assertEqual(result['status'], 'renewed')
        self.assertNotIn('key', result)
        self.assertEqual(secret.saved, 'old')
        self.assertEqual(secret.value, 'new')
        actions = [a for a, _ in backend.calls]
        self.assertEqual(actions, ['inspect', 'verify', 'issue', 'verify', 'retire'])
        self.assertEqual(backend.calls[-1][1]['active'], 'renewal-owned-next')

    def test_mismatched_key_is_repaired_even_with_future_expiry(self):
        secret, backend = self.setup_pair()
        backend.current['matches'] = False
        self.assertEqual(m.renew(backend, secret, NOW)['status'], 'renewed')

    def test_rejected_replacement_restores_prior_and_discards_only_candidate(self):
        secret, backend = self.setup_pair(hours=1); backend.reject_new = True
        with self.assertRaisesRegex(m.RenewalError, 'replacement_rejected_prior_restored'):
            m.renew(backend, secret, NOW)
        self.assertEqual(secret.value, 'old')
        self.assertEqual(backend.calls[-1], ('discard', {'identifier': 'renewal-owned-next'}))
        self.assertNotIn('retire', [a for a, _ in backend.calls])

    def test_partial_write_recovers_and_failed_restore_keeps_candidate(self):
        for failures, expected in [(1, 'replacement_rejected_prior_restored'), (2, 'restore_failed')]:
            secret, backend = self.setup_pair(hours=1); secret.failures = failures
            with self.assertRaisesRegex(m.RenewalError, expected): m.renew(backend, secret, NOW)
            if failures == 2: self.assertNotIn('discard', [a for a, _ in backend.calls])

    def test_failed_cleanup_keeps_the_verified_new_credential(self):
        secret, backend = self.setup_pair(hours=1); backend.fail_action = 'retire'
        with self.assertRaisesRegex(m.RenewalError, 'active_verified_cleanup_pending'):
            m.renew(backend, secret, NOW)
        self.assertEqual(secret.value, 'new')
        self.assertNotIn('discard', [a for a, _ in backend.calls])

    def test_issue_failure_preserves_current_file(self):
        secret, backend = self.setup_pair(hours=1); backend.fail_action = 'issue'
        with self.assertRaises(m.RenewalError): m.renew(backend, secret, NOW)
        self.assertEqual(secret.value, 'old')

    def test_check_mode_never_issues_or_retires(self):
        secret, backend = self.setup_pair(hours=1)
        self.assertTrue(m.renew(backend, secret, NOW, check=True)['due'])
        self.assertEqual([a for a, _ in backend.calls], ['inspect', 'verify'])

    def test_force_exercises_renewal_without_changing_expiry_policy(self):
        secret, backend = self.setup_pair()
        self.assertEqual(m.renew(backend, secret, NOW, force=True)['status'], 'renewed')
        self.assertEqual(backend.calls[2], ('issue', {'minimum_lifetime': m.DUE_SECONDS + 3600}))

    def test_secret_write_preserves_bind_mount_inode_and_backup_is_private(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'token'; p.write_text('old-value' * 8); p.chmod(0o640)
            secret = m.SecretFile(p, directory, p.stat().st_gid)
            inode = p.stat().st_ino
            # Exercise real writes as the unprivileged test owner, simulating the
            # root ownership assertion only; production still requires root.
            real_fstat = m.os.fstat
            def root_stat(fd):
                info = list(real_fstat(fd)); info[4] = 0
                return m.os.stat_result(info)
            with patch.object(m.os, 'fstat', side_effect=root_stat): secret.install('new-value' * 8)
            self.assertEqual(inode, p.stat().st_ino)
            self.assertEqual(p.read_text(), 'new-value' * 8 + '\n')
            secret.backup('old-value' * 8)
            self.assertEqual((Path(directory) / 'previous-token').stat().st_mode & 0o777, 0o600)


if __name__ == '__main__': unittest.main()

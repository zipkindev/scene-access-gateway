'use strict';

const fs = require('node:fs');
const { normalizedEmail, normalizedUsername } = require('./allowlist');

const PROVISIONER = 'svc-torrentharbor-provisioner';
const REQUIRED_PERMISSIONS = [
  'authentik_core.add_user', 'authentik_core.add_user_to_group',
  'authentik_core.change_user', 'authentik_core.reset_user_password',
  'authentik_core.view_group', 'authentik_core.view_user',
];
const ROLLBACK_WINDOW_MS = 15 * 60 * 1000;

function results(body) { return Array.isArray(body) ? body : Array.isArray(body?.results) ? body.results : []; }
function validatePassword(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 1024 && /[A-Z]/.test(value) && /[^A-Za-z0-9]/.test(value); }

function createManagement(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const tokenPath = options.tokenPath ?? process.env.AUTHENTIK_MANAGEMENT_TOKEN_PATH ?? '';
  const base = (options.baseUrl ?? process.env.AUTHENTIK_API_BASE_URL ?? '').replace(/\/$/, '');
  const groupName = options.groupName ?? process.env.AUTHENTIK_REQUIRED_GROUP ?? 'app:torrentharbor';
  const now = options.now || (() => Date.now());

  function credential() {
    const value = options.token ?? (tokenPath && fs.readFileSync(tokenPath, 'utf8').trim());
    if (!value) throw new Error('Management unavailable');
    return value;
  }
  async function request(apiPath, method = 'GET', body) {
    if (!base) throw new Error('Management unavailable');
    return fetchImpl(`${base}${apiPath}`, {
      method,
      headers: { Authorization: `Bearer ${credential()}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
  }
  async function call(apiPath, method = 'GET', body) {
    const response = await request(apiPath, method, body);
    if (!response.ok) throw new Error('Management unavailable');
    return response.status === 204 ? {} : response.json();
  }
  async function targetGroup() {
    const matches = results(await call(`/api/v3/core/groups/?name=${encodeURIComponent(groupName)}`)).filter((item) => item.name === groupName && typeof item.pk === 'string' && item.pk);
    if (matches.length !== 1 || matches[0].is_superuser === true) throw new Error('Management unavailable');
    return matches[0];
  }
  async function exactUsers(field, value) {
    return results(await call(`/api/v3/core/users/?${field}=${encodeURIComponent(value)}`)).filter((item) => (field === 'email' ? normalizedEmail(item.email) : normalizedUsername(item.username)) === value);
  }
  function groups(user) { return Array.isArray(user?.groups) ? user.groups.map((item) => typeof item === 'string' ? item : item?.pk).filter(Boolean) : []; }
  function isManaged(user) { return user?.attributes?.torrentharbor_managed === true && user?.attributes?.torrentharbor_provisioner === PROVISIONER; }

  async function status() {
    const [group,,self] = await Promise.all([targetGroup(), call('/api/v3/core/users/?page_size=1'), call('/api/v3/core/users/me/')]);
    if (self?.user?.username !== PROVISIONER || self.user.is_superuser !== false) throw new Error('Management unavailable');
    return { status: 'ok', group: groupName };
  }
  async function provision(data) {
    const username = normalizedUsername(data?.username); const email = normalizedEmail(data?.email); const password = data?.password;
    if (!username || !email || !validatePassword(password)) throw new Error('Invalid account');
    const [byUsername, byEmail, group] = await Promise.all([exactUsers('username', username), exactUsers('email', email), targetGroup()]);
    if (byUsername.length || byEmail.length) throw new Error('Account conflict');
    const createdAt = new Date(now()).toISOString();
    const user = await call('/api/v3/core/users/', 'POST', {
      username, name: username, email, is_active: false, groups: [], path: 'users', type: 'internal',
      attributes: { torrentharbor_managed: true, torrentharbor_provisioner: PROVISIONER, torrentharbor_created_at: createdAt },
    });
    if (!Number.isInteger(user?.pk)) throw new Error('Management unavailable');
    const userPath = `/api/v3/core/users/${user.pk}/`;
    try {
      await call(`${userPath}set_password/`, 'POST', { password });
      await call(`/api/v3/core/groups/${encodeURIComponent(group.pk)}/add_user/`, 'POST', { pk: user.pk });
      const verified = await call(userPath);
      if (!isManaged(verified) || groups(verified).length !== 1 || groups(verified)[0] !== group.pk || normalizedUsername(verified.username) !== username || normalizedEmail(verified.email) !== email) throw new Error('Management unavailable');
      await call(userPath, 'PATCH', { is_active: true });
    } catch (error) {
      try { await call(userPath, 'PATCH', { is_active: false }); } catch (_) { /* best-effort compensation */ }
      throw error;
    }
    return { subject: String(user.pk), username, email };
  }
  async function userBySubject(subject) {
    if (!/^[0-9]{1,20}$/.test(String(subject || ''))) throw new Error('Invalid account');
    const user = await call(`/api/v3/core/users/${encodeURIComponent(subject)}/`);
    if (!isManaged(user)) throw new Error('Invalid account');
    return user;
  }
  async function rollback(subject) {
    const user = await userBySubject(subject); const createdAt = Date.parse(user.attributes.torrentharbor_created_at || ''); const age = now() - createdAt;
    if (!Number.isFinite(createdAt) || age < 0 || age > ROLLBACK_WINDOW_MS) throw new Error('Invalid account');
    await call(`/api/v3/core/users/${encodeURIComponent(user.pk)}/`, 'PATCH', { is_active: false });
    return {};
  }
  return { provision, rollback, status };
}

const management = createManagement();
module.exports = { ...management, createManagement, validatePassword, PROVISIONER, REQUIRED_PERMISSIONS, ROLLBACK_WINDOW_MS };

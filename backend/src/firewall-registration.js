'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizedEmail, normalizedUsername } = require('./allowlist');

const GROUP = 'app:firewall';
const TTL = 24 * 60 * 60 * 1000;
const managers = new Map();
function rows(body) { return Array.isArray(body?.results) ? body.results : []; }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function createFirewallRegistration(directory, options = {}) {
  const file = path.join(directory, 'scene-management', 'firewall-registrations.json');
  const base = (options.baseUrl ?? process.env.AUTHENTIK_API_BASE_URL ?? '').replace(/\/$/, '');
  const tokenPath = options.tokenPath ?? process.env.AUTHENTIK_FIREWALL_MANAGEMENT_TOKEN_PATH ?? '';
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => Date.now());
  const sendProof = options.sendProof;
  const origin = options.origin || process.env.PUBLIC_ORIGIN || 'http://localhost:8080';
  const ownerUsername = options.ownerUsername || process.env.PORTAL_OWNER_USERNAME || 'owner';
  let lock = Promise.resolve();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) write({ version: 1, requests: [] });

  function write(state) {
    const temporary = file + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  function read() {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state?.version !== 1 || !Array.isArray(state.requests)) throw new Error('Registration unavailable');
    return state;
  }
  function exclusive(work) {
    const result = lock.then(work);
    lock = result.catch(() => {});
    return result;
  }
  function credential() {
    const value = options.token ?? (tokenPath && fs.readFileSync(tokenPath, 'utf8').trim());
    if (!value || !base) throw new Error('Registration unavailable');
    return value;
  }
  async function call(route, method = 'GET', body) {
    const response = await fetchImpl(base + route, {
      method, headers: { Authorization: 'Bearer ' + credential(), Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Registration unavailable');
    return response.status === 204 ? {} : response.json();
  }
  async function group() {
    const found = rows(await call('/api/v3/core/groups/?name=' + encodeURIComponent(GROUP)))
      .filter((item) => item.name === GROUP && typeof item.pk === 'string' && !item.is_superuser);
    if (found.length !== 1) throw new Error('Registration unavailable');
    return found[0];
  }
  async function users(field, value) {
    return rows(await call('/api/v3/core/users/?' + field + '=' + encodeURIComponent(value)))
      .filter((item) => (field === 'username' ? normalizedUsername(item.username) : normalizedEmail(item.email)) === value);
  }
  function groupIds(user) {
    return Array.isArray(user?.groups) ? user.groups.map((item) => typeof item === 'string' ? item : item?.pk).filter(Boolean) : [];
  }
  async function prepare(input) {
    return exclusive(async () => {
      const username = normalizedUsername(input?.username);
      const email = normalizedEmail(input?.email);
      if (!username || !email || Object.keys(input || {}).some((key) => !['username', 'email'].includes(key))) throw new Error('Invalid registration');
      const state = read();
      if (state.requests.some((item) => item.status === 'pending' && item.expiresAt > now()
        && (item.username === username || item.email === email))) throw new Error('Registration already pending');
      const [byName, byEmail, target] = await Promise.all([users('username', username), users('email', email), group()]);
      if (byName.length > 1 || byEmail.length > 1 || Boolean(byName.length) !== Boolean(byEmail.length)
        || (byName.length && byName[0].pk !== byEmail[0].pk)) throw new Error('Account conflict');
      let user = byName[0];
      let created = false;
      const id = crypto.randomUUID();
      if (user) {
        if (!user.is_active || user.type !== 'internal' || normalizedEmail(user.email) !== email
          || normalizedUsername(user.username) !== username || user.is_superuser || groupIds(user).includes(target.pk)) throw new Error('Account conflict');
      } else {
        user = await call('/api/v3/core/users/', 'POST', { username, name: username, email,
          is_active: false, groups: [], path: 'users', type: 'internal',
          attributes: { firewall_registration_id: id, firewall_managed: true } });
        created = true;
        if (!Number.isInteger(user?.pk)) throw new Error('Registration unavailable');
      }
      const token = crypto.randomBytes(32).toString('base64url');
      const entry = { id, hash: digest(token), username, email, subject: String(user.pk), created,
        status: 'pending', expiresAt: now() + TTL };
      state.requests.push(entry);
      write(state);
      try {
        if (typeof sendProof !== 'function') throw new Error('Registration unavailable');
        await sendProof(email, origin + '/register-firewall/' + token);
      } catch (_) {
        entry.status = 'mail-failed';
        write(state);
        throw new Error('Registration mail unavailable');
      }
      return { id, username, email, status: 'pending', expiresAt: new Date(entry.expiresAt).toISOString() };
    });
  }
  function preview(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) return false;
    return read().requests.some((entry) => entry.hash === digest(token) && entry.status === 'pending' && entry.expiresAt > now());
  }
  async function confirm(token) {
    return exclusive(async () => {
      if (!preview(token)) throw new Error('Invalid registration');
      const state = read();
      const entry = state.requests.find((item) => item.hash === digest(token));
      const target = await group();
      const user = await call('/api/v3/core/users/' + encodeURIComponent(entry.subject) + '/');
      if (String(user.pk) !== entry.subject || normalizedUsername(user.username) !== entry.username
        || normalizedEmail(user.email) !== entry.email || user.type !== 'internal' || user.is_superuser
        || (entry.created && (user.is_active || user.attributes?.firewall_registration_id !== entry.id || groupIds(user).length))) {
        throw new Error('Registration identity changed');
      }
      if (!entry.created && !user.is_active) throw new Error('Registration identity changed');
      if (groupIds(user).includes(target.pk)) throw new Error('Registration identity changed');
      try {
        await call('/api/v3/core/groups/' + encodeURIComponent(target.pk) + '/add_user/', 'POST', { pk: user.pk });
        if (entry.created) await call('/api/v3/core/users/' + encodeURIComponent(entry.subject) + '/', 'PATCH', { is_active: true });
        const verified = await call('/api/v3/core/users/' + encodeURIComponent(entry.subject) + '/');
        if (normalizedUsername(verified.username) !== entry.username || normalizedEmail(verified.email) !== entry.email
          || !verified.is_active || !groupIds(verified).includes(target.pk)) throw new Error('Registration verification failed');
      } catch (_) {
        if (entry.created) {
          try { await call('/api/v3/core/users/' + encodeURIComponent(entry.subject) + '/', 'PATCH', { is_active: false }); } catch (_) { /* fail closed where possible */ }
        }
        entry.status = 'failed';
        write(state);
        throw new Error('Registration unavailable');
      }
      entry.status = 'active';
      entry.confirmedAt = now();
      write(state);
      return { status: 'active' };
    });
  }
  function status() {
    return read().requests.map(({ id, username, email, status, expiresAt }) => ({
      id, username, email, status, expiresAt: new Date(expiresAt).toISOString(),
    }));
  }
  function authorized(identity) {
    if (!identity?.subject) return false;
    if (identity.username === ownerUsername) return true;
    return read().requests.some((entry) => entry.subject === String(identity.subject)
      && entry.status === 'active' && entry.username === identity.username && entry.email === identity.email);
  }
  return { prepare, preview, confirm, status, authorized };
}

function getFirewallRegistration(directory, options) {
  if (options) return createFirewallRegistration(directory, options);
  if (!managers.has(directory)) managers.set(directory, createFirewallRegistration(directory, {
    sendProof: async (email, link) => {
      const { createMailer, loadSmtpConfig } = require('./mail');
      const config = loadSmtpConfig();
      await createMailer(config).sendMail({ from: config.from, to: email,
        subject: 'Confirm firewall access registration',
        text: `Open this link and press Confirm to register firewall access:\n${link}\n\nThis link expires in 24 hours.` });
    },
  }));
  return managers.get(directory);
}

module.exports = { createFirewallRegistration, getFirewallRegistration };

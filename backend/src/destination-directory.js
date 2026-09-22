'use strict';

const fs = require('node:fs');
const { normalizedEmail, normalizedUsername } = require('./allowlist');

const DESTINATIONS = Object.freeze({
  torrentharbor: Object.freeze({ group: 'app:torrentharbor', name: 'TorrentHarbor',
    publicRoute: process.env.TORRENTHARBOR_PUBLIC_ROUTE || 'http://localhost:8080/torrentharbor/',
    upstream: process.env.TORRENTHARBOR_UPSTREAM || 'torrentharbor.example.invalid:443',
    tlsName: process.env.TORRENTHARBOR_TLS_NAME || 'torrentharbor.example.invalid',
    authMode: 'QR, email, then TorrentHarbor SSO', sessionMinutes: 10080,
    applicationSlug: null }),
  firewall: Object.freeze({ group: 'app:firewall', name: 'Firewall',
    publicRoute: process.env.FIREWALL_ORIGIN || 'http://localhost:8080/',
    upstream: process.env.FIREWALL_UPSTREAM || 'https://firewall.example.invalid/',
    tlsName: process.env.FIREWALL_TLS_NAME || 'firewall.example.invalid',
    authMode: 'QR, email, then normal pfSense login', sessionMinutes: 15,
    applicationSlug: 'firewall' }),
});

function createDestinationDirectory(options = {}) {
  const base = (options.baseUrl ?? process.env.AUTHENTIK_API_BASE_URL ?? '').replace(/\/$/, '');
  const tokenPath = options.tokenPath ?? process.env.AUTHENTIK_API_TOKEN_PATH ?? '';
  const fetchImpl = options.fetchImpl || fetch;
  const writerPaths = options.writerPaths || {
    firewall: process.env.AUTHENTIK_FIREWALL_MANAGEMENT_TOKEN_PATH || '',
    torrentharbor: process.env.AUTHENTIK_MANAGEMENT_TOKEN_PATH || '',
  };
  function credential() {
    const token = options.token ?? (tokenPath && fs.readFileSync(tokenPath, 'utf8').trim());
    if (!base || !token) throw new Error('Directory unavailable');
    return token;
  }
  async function read(route) {
    const response = await fetchImpl(base + route, { headers: { Authorization: 'Bearer ' + credential(), Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Directory unavailable');
    return response.json();
  }
  async function write(id, route, method, body) {
    const file = writerPaths[id];
    const token = options.writerTokens?.[id] ?? (file && fs.readFileSync(file, 'utf8').trim());
    if (!base || !token) throw new Error('Destination management unavailable');
    const response = await fetchImpl(base + route, { method,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Destination management unavailable');
    return response.status === 204 ? null : response.json();
  }
  function groupsOf(user) {
    return Array.isArray(user?.groups) ? user.groups.map((item) => typeof item === 'string' ? item : item?.pk).filter(Boolean) : [];
  }
  async function target(id) {
    const profile = DESTINATIONS[id];
    if (!profile) throw new Error('Unsupported destination');
    const result = await read('/api/v3/core/groups/?name=' + encodeURIComponent(profile.group) + '&include_users=true');
    const groups = Array.isArray(result?.results) ? result.results.filter((item) => item.name === profile.group) : [];
    if (groups.length !== 1 || typeof groups[0].pk !== 'string' || groups[0].is_superuser || !Array.isArray(groups[0].users) || !Array.isArray(groups[0].users_obj) || groups[0].users.length !== groups[0].users_obj.length) throw new Error('Directory unavailable');
    return groups[0];
  }
  async function userById(subject) {
    if (!/^[0-9]{1,20}$/.test(String(subject || ''))) throw new Error('Invalid user');
    const user = await read('/api/v3/core/users/' + encodeURIComponent(subject) + '/');
    if (String(user?.pk) !== String(subject) || !normalizedUsername(user.username) || !normalizedEmail(user.email) || user.is_superuser || user.type !== 'internal') throw new Error('User cannot be managed here');
    return user;
  }
  async function snapshot(id) {
    const profile = DESTINATIONS[id];
    if (!profile) throw new Error('Unsupported destination');
    const group = await target(id);
    const users = group.users_obj.map((item) => {
      if (!Number.isInteger(item.pk) || typeof item.username !== 'string' || typeof item.email !== 'string') throw new Error('Directory unavailable');
      return { id: String(item.pk), username: item.username, email: item.email,
        active: item.is_active === true, type: item.type || 'unknown',
        managed: id === 'firewall' ? item.attributes?.firewall_managed === true : item.attributes?.torrentharbor_managed === true };
    }).sort((a, b) => a.username.localeCompare(b.username));
    return { id, name: profile.name, group: profile.group, groupPk: group.pk,
      publicRoute: profile.publicRoute, upstream: profile.upstream, tlsName: profile.tlsName,
      authMode: profile.authMode, sessionMinutes: profile.sessionMinutes,
      applicationSlug: profile.applicationSlug, applicationStatus: profile.applicationSlug ? 'configured locally; live application read unavailable' : 'no Authentik application established',
      users, source: 'live Authentik group', checkedAt: new Date().toISOString() };
  }
  async function addExisting(id, identifier) {
    const email = normalizedEmail(identifier);
    const username = email ? null : normalizedUsername(identifier);
    if (!email && !username) throw new Error('Enter an exact username or email');
    const [group, result] = await Promise.all([target(id), read('/api/v3/core/users/?' + (email ? 'email=' : 'username=') + encodeURIComponent(email || username))]);
    const matches = Array.isArray(result?.results) ? result.results.filter((item) => email ? normalizedEmail(item.email) === email : normalizedUsername(item.username) === username) : [];
    if (matches.length !== 1) throw new Error('Exact user not found or ambiguous');
    const user = await userById(matches[0].pk);
    if (!user.is_active || groupsOf(user).includes(group.pk)) throw new Error('User already assigned or inactive');
    await write(id, '/api/v3/core/groups/' + encodeURIComponent(group.pk) + '/add_user/', 'POST', { pk: user.pk });
    const verified = await userById(user.pk);
    if (!groupsOf(verified).includes(group.pk)) throw new Error('Membership verification failed');
    return { id: String(user.pk), username: user.username, email: user.email };
  }
  async function removeMember(id, subject) {
    const [group, user] = await Promise.all([target(id), userById(subject)]);
    if (!groupsOf(user).includes(group.pk)) throw new Error('User is no longer a member');
    await write(id, '/api/v3/core/groups/' + encodeURIComponent(group.pk) + '/remove_user/', 'POST', { pk: user.pk });
    const verified = await userById(subject);
    if (groupsOf(verified).includes(group.pk)) throw new Error('Membership removal verification failed');
    return { id: String(user.pk), username: user.username, removedFrom: id };
  }
  async function deleteManagedUser(id, subject, confirmation) {
    if (id !== 'firewall') throw new Error('Account deletion is unavailable for this destination');
    const [group, user] = await Promise.all([target(id), userById(subject)]);
    if (confirmation !== user.username || user.attributes?.firewall_managed !== true
      || groupsOf(user).length !== 1 || groupsOf(user)[0] !== group.pk) throw new Error('Account deletion safety check failed');
    await write(id, '/api/v3/core/users/' + encodeURIComponent(user.pk) + '/', 'DELETE');
    return { id: String(user.pk), username: user.username, deleted: true };
  }
  return { snapshot, addExisting, removeMember, deleteManagedUser };
}

module.exports = { createDestinationDirectory, DESTINATIONS };

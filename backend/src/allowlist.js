'use strict';

// This credential is issued only the Authentik core group/user read scopes.
// It never reaches the browser; callers get a boolean only.
const fs = require('node:fs');

function results(body) { return Array.isArray(body) ? body : Array.isArray(body?.results) ? body.results : []; }
function credential() {
  const file = process.env.AUTHENTIK_API_TOKEN_PATH || '';
  if (!file) throw new Error('Allowlist service unavailable');
  const value = fs.readFileSync(file, 'utf8').trim();
  if (!value) throw new Error('Allowlist service unavailable');
  return value;
}
async function read(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${credential()}`, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Allowlist service unavailable');
  return response.json();
}
function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const result = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) && result.length <= 254 ? result : null;
}

function normalizedUsername(value) {
  if (typeof value !== 'string') return null;
  const result = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{2,63}$/.test(result) ? result : null;
}

async function findAllowedIdentity(identifier, requiredGroup) {
  const base = (process.env.AUTHENTIK_API_BASE_URL || '').replace(/\/$/, '');
  const groupName = requiredGroup || process.env.AUTHENTIK_REQUIRED_GROUP || 'app:torrentharbor';
  if (!['app:torrentharbor', 'app:firewall'].includes(groupName)) throw new Error('Allowlist service unavailable');
  if (!base) throw new Error('Allowlist service unavailable');
  const groups = results(await read(`${base}/api/v3/core/groups/?name=${encodeURIComponent(groupName)}`));
  if (groups.length !== 1 || !groups[0].pk) throw new Error('Allowlist service unavailable');
  const submittedEmail = normalizedEmail(identifier);
  const submittedUsername = submittedEmail ? null : normalizedUsername(identifier);
  if (!submittedEmail && !submittedUsername) return null;
  const field = submittedEmail ? 'email' : 'username';
  const submitted = submittedEmail || submittedUsername;
  const users = results(await read(`${base}/api/v3/core/users/?${field}=${encodeURIComponent(submitted)}`));
  // Authentik represents group references as UUIDs in v3; tolerate object
  // references for a compatible private relay without returning details.
  const matches = users.filter((user) => {
    const canonicalEmail = normalizedEmail(user.email);
    const canonicalUsername = normalizedUsername(user.username);
    const subject = user.pk === undefined || user.pk === null ? '' : String(user.pk);
    const exact = field === 'email' ? canonicalEmail === submitted : canonicalUsername === submitted;
    const allowed = Array.isArray(user.groups) && user.groups.some((group) => group === groups[0].pk || group?.pk === groups[0].pk || group?.name === groupName);
    return exact && allowed && user.is_active !== false && canonicalEmail && canonicalUsername && /^[A-Za-z0-9-]{1,64}$/.test(subject);
  });
  if (matches.length !== 1) return null;
  return { subject: String(matches[0].pk), username: normalizedUsername(matches[0].username), email: normalizedEmail(matches[0].email) };
}

module.exports = { findAllowedIdentity, normalizedEmail, normalizedUsername };

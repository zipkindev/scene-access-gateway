'use strict';

function configuredAliases(value) {
  const aliases = String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (aliases.length > 20) throw new Error('Too many public host aliases');
  for (const alias of aliases) {
    if (alias.length > 253 || !/^[a-z0-9.-]+$/.test(alias) || alias.startsWith('.') || alias.endsWith('.')
      || alias.includes('..')) throw new Error('Invalid public host alias');
  }
  return aliases;
}

function createHostPolicy(origin, aliases = '') {
  const publicUrl = new URL(origin);
  const hostnames = new Set([publicUrl.hostname.toLowerCase(), ...configuredAliases(aliases)]);
  if (publicUrl.hostname === 'localhost') hostnames.add('127.0.0.1');
  return (value) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 255 || /[\s\\/@]/.test(value)) return false;
    try {
      const candidate = new URL(`${publicUrl.protocol}//${value}`);
      return candidate.pathname === '/' && !candidate.search && !candidate.hash
        && hostnames.has(candidate.hostname.toLowerCase())
        && (!candidate.port || candidate.port === publicUrl.port);
    } catch (_) { return false; }
  };
}

module.exports = { configuredAliases, createHostPolicy };

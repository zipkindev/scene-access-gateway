'use strict';

const FIREWALL_UPSTREAM = process.env.FIREWALL_UPSTREAM || 'https://firewall.example.invalid/';
const FIREWALL_PUBLIC = process.env.FIREWALL_ORIGIN || 'http://localhost:8080/';
const FIREWALL_UPSTREAM_IP = process.env.FIREWALL_UPSTREAM_IP || '127.0.0.1';
const FIREWALL_TLS_NAME = process.env.FIREWALL_TLS_NAME || 'firewall.example.invalid';
const PORTAL_PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || 'http://localhost:8080').replace(/\/$/, '');
const PORTAL_OWNER_USERNAME = process.env.PORTAL_OWNER_USERNAME || 'owner';

function prepareFirewallDestination(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object'
    || Object.keys(input).some((key) => !['name', 'upstream'].includes(key))) throw new Error('Invalid destination plan');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid destination name');
  if (input.upstream !== FIREWALL_UPSTREAM) throw new Error('Unsupported firewall upstream');
  return Object.freeze({
    profile: 'firewall-management-v1', id: 'firewall', name,
    upstream: FIREWALL_UPSTREAM, upstreamIp: FIREWALL_UPSTREAM_IP, tlsName: FIREWALL_TLS_NAME,
    publicOrigin: FIREWALL_PUBLIC, qrEntry: PORTAL_PUBLIC_ORIGIN + '/',
    authentik: Object.freeze({ group: 'app:firewall', applicationSlug: 'firewall',
      initialMember: PORTAL_OWNER_USERNAME, provider: null, binding: 'group-only' }),
    approval: Object.freeze({ method: 'existing portal email', sessionSeconds: 900, separateFrom: 'torrentharbor',
      destinationLogin: 'existing pfSense login; no SSO' }),
    network: Object.freeze([
      'Existing WAN IPv4 and IPv6 TCP 44334 routes to access portal',
      'Public DNS resolves the configured firewall origin to the reviewed gateway',
      'The gateway certificate includes the configured firewall hostname',
      'The reviewed proxy source can reach only the configured firewall upstream',
      'The destination accepts the configured TLS hostname',
    ]),
    retainedDirectRoute: FIREWALL_UPSTREAM,
    recovery: 'protected exact configuration backups and scoped reversal',
  });
}

module.exports = { prepareFirewallDestination, FIREWALL_UPSTREAM, FIREWALL_PUBLIC };

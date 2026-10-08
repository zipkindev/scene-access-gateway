'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { SourceIntelligence, ACTIVE_ACKNOWLEDGEMENT, ACTIVE_PORTS, isPublicIp } = require('../source-intelligence');

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-intelligence-'));
  const events = [{ at: '2026-09-24T01:00:00.000Z', severity: 'warning', category: 'known_scanner',
    source: { ip: '8.8.8.8' }, http: { method: 'GET', status: 403, agentHash: 'agent-a' },
    edge: { target: 'example.test', disposition: 'waf_blocked' } }];
  const securityEvents = {
    destinationIp: '1.1.1.1',
    *matching() { yield* events; },
  };
  const geoip = { lookup: () => ({ scope: 'public', city: 'Mountain View', region: 'California', country: 'US',
    asn: 15169, organization: 'Google LLC', latitude: 37.4, longitude: -122.1 }) };
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('rdap-bootstrap')) return new Response('', { status: 302, headers: { location: 'https://rdap.arin.net/registry/ip/8.8.8.8' } });
    if (String(url).includes('rdap.arin.net')) return new Response(JSON.stringify({ handle: 'NET-8-8-8-0-1', name: 'GOGL',
      startAddress: '8.8.8.0', endAddress: '8.8.8.255', country: 'US', entities: [{ handle: 'GOGL', roles: ['registrant'],
        vcardArray: ['vcard', [['fn', {}, 'text', 'Google LLC']]] }] }), { status: 200, headers: { 'content-type': 'application/rdap+json' } });
    return new Response(JSON.stringify({ data: { prefix: '8.8.8.0/24', asns: [15169], announced: true, holder: 'GOOGLE' } }), { status: 200 });
  };
  const resolver = { reverse: async () => ['dns.google'], resolve4: async () => ['8.8.8.8'], resolve6: async () => [] };
  return { directory, calls, intelligence: new SourceIntelligence(directory, securityEvents, geoip, {
    fetch, resolver, activeEnabled: options.activeEnabled,
    scanConnect: async (_ip, port) => ({ port, transport: 'tcp', open: port === 443, latencyMs: 1, code: null }),
    observe: async (_ip, port) => ({ protocol: 'tls', port, certificate: { subject: 'dns.google' } }),
  }) };
}

test('accepts public addresses and rejects non-routable, mapped-private, and documentation targets', () => {
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('2606:4700:4700::1111'), true);
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.0.2.1', '2001:db8::1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
});

test('collects and persists source-attributed passive evidence', async (t) => {
  const { directory, calls, intelligence } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = await intelligence.investigate('8.8.8.8', { actor: 'owner' });
  assert.equal(result.investigation.targetIp, '8.8.8.8');
  assert.equal(result.investigation.passive.rdap.name, 'GOGL');
  assert.deepEqual(result.investigation.passive.ptr.forwardConfirmed, ['dns.google']);
  assert.equal(result.investigation.passive.events.total, 1);
  assert.equal(result.investigation.active, null);
  assert.equal(result.activeEnabled, false);
  assert.equal(calls.length, 3);
  const files = fs.readdirSync(path.join(directory, 'scene-management', 'source-intelligence'));
  assert.equal(files.length, 1);
  assert.equal(fs.statSync(path.join(directory, 'scene-management', 'source-intelligence', files[0])).mode & 0o777, 0o600);
});

test('active reconnaissance is explicit, fixed, exact-target, and cooldown limited', async (t) => {
  const { directory, intelligence } = fixture({ activeEnabled: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(() => intelligence.investigate('8.8.8.8', { active: true, actor: 'owner' }), /acknowledgement/);
  const result = await intelligence.investigate('8.8.8.8', { active: true, actor: 'owner', acknowledgement: ACTIVE_ACKNOWLEDGEMENT });
  assert.deepEqual(result.investigation.active.ports.map((item) => item.port), ACTIVE_PORTS);
  assert.deepEqual(result.investigation.active.ports.filter((item) => item.open).map((item) => item.port), [443]);
  assert.equal(result.investigation.active.audit.exploitTraffic, false);
  await assert.rejects(() => intelligence.investigate('8.8.8.8', { active: true, actor: 'owner',
    acknowledgement: ACTIVE_ACKNOWLEDGEMENT }), /once per IP every 24 hours/);
  await assert.rejects(() => intelligence.investigate('1.1.1.1'), /protected destination/);
});

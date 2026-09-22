'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { GeoIpLookup, privateAddress } = require('../geoip');
const { SecurityEvents, classifyRequest, safePath, sourceIp } = require('../security-events');
const { createSceneAdmin } = require('../scene-admin');

async function invoke(handler, url, headers = {}) {
  let status;
  let responseHeaders;
  let body;
  const request = { method: 'GET', url, headers };
  const response = {
    writeHead(value, values) { status = value; responseHeaders = values; },
    end(value) { body = value; },
  };
  await handler(request, response);
  return { status, headers: responseHeaders, body };
}

function temporary(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-security-'));
  try { return callback(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

const noGeo = {
  lookup(ip) { return { scope: privateAddress(ip) ? 'private' : ip === 'unknown' ? 'unknown' : 'public', country: null }; },
  status() { return { mode: 'local-mmdb', city: { configured: false, loaded: false, updatedAt: null }, asn: { configured: false, loaded: false, updatedAt: null } }; },
};

test('request classification reports categories without retaining the payload', () => {
  const request = { method: 'GET', headers: {}, url: '/search?q=UNION%20SELECT%20password' };
  const url = new URL(request.url, 'https://portal.example');
  assert.deepEqual(classifyRequest(request, url), [{ category: 'sql_injection_probe', severity: 'critical' }]);
  assert.equal(safePath('/login/' + 'a'.repeat(43)), '/login/:token');
  assert.equal(sourceIp({ headers: { 'x-portal-source-ip': 'not-an-ip' } }), 'unknown');
});

test('security events persist bounded structured metadata and hash identities', () => temporary((directory) => {
  const events = new SecurityEvents(directory, noGeo, { retentionDays: 7 });
  const request = { method: 'POST', url: '/login/' + 'b'.repeat(43), headers: {
    'x-portal-source-ip': '203.0.113.8', 'user-agent': 'Example browser',
  } };
  const written = events.record('qr_login_attempt', { request, pathname: request.url,
    ip: sourceIp(request), identity: 'Person@Example.com', outcome: 'not_eligible', status: 200 });
  assert.equal(written.http.path, '/login/:token');
  assert.equal(written.source.ip, '203.0.113.8');
  assert.match(written.integrity, /^[A-Za-z0-9_-]{43}$/);
  assert.match(written.identityHash, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(JSON.stringify(written), /Person@Example\.com/i);
  const listed = events.list({ limit: 10 });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].integrityValid, true);
  assert.equal('integrity' in listed[0], false);
  assert.equal(events.summary().failedLogin, 1);
}));

test('GeoIP lookup fails closed when local databases are absent', () => {
  const lookup = new GeoIpLookup('/missing/city.mmdb', '/missing/asn.mmdb');
  assert.equal(lookup.status().city.loaded, false);
  assert.deepEqual(lookup.lookup('192.168.1.20'), { scope: 'private' });
  assert.equal(lookup.lookup('203.0.113.8').scope, 'public');
});

test('authenticated Scene Management exposes summary and redacted events', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-security-admin-'));
  const events = new SecurityEvents(directory, noGeo, { retentionDays: 7 });
  events.record('access_request', { ip: '203.0.113.9', identity: 'private@example.com', outcome: 'accepted' });
  const handler = createSceneAdmin(directory, events);
  try {
    const denied = await invoke(handler, '/api/security/events');
    assert.equal(denied.status, 404);
    const response = await invoke(handler, '/api/security/events?limit=10', { 'x-scene-admin': 'owner' });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.events.length, 1);
    assert.doesNotMatch(JSON.stringify(body), /private@example\.com/);
    const summary = JSON.parse((await invoke(handler, '/api/security/summary', { 'x-scene-admin': 'owner' })).body);
    assert.equal(summary.accessRequests, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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

test('probe events retain response status and a request correlation ID', () => temporary((directory) => {
  const events = new SecurityEvents(directory, noGeo, { retentionDays: 7 });
  const request = { method: 'GET', url: '/.env?value=UNION%20SELECT%20password',
    securityRequestId: '12345678-1234-4abc-8def-1234567890ab',
    headers: { 'x-portal-source-ip': '203.0.113.10' } };
  events.recordRequestFindings(request, new URL(request.url, 'https://portal.example'), 404);
  const written = events.list({ limit: 10 });
  assert.equal(written.length, 2);
  assert.ok(written.every((event) => event.http.status === 404));
  assert.ok(written.every((event) => event.requestId === request.securityRequestId));
  assert.ok(written.every((event) => !JSON.stringify(event).includes('password')));
}));

test('public Nginx logs correlation metadata and applies bounded source limits', () => {
  const config = fs.readFileSync(path.join(__dirname, '../../../frontend/nginx/nginx.conf'), 'utf8');
  assert.match(config, /log_format scene_access escape=json/);
  assert.doesNotMatch(config, /\$request_uri/);
  assert.match(config, /"route":"\$scene_log_route"/);
  assert.match(config, /\/\$1\/:token/);
  assert.match(config, /"backend_request_id":"\$upstream_http_x_request_id"/);
  assert.match(config, /limit_req_zone \$binary_remote_addr zone=portal_requests:/);
  assert.match(config, /limit_req_status 429/);
  assert.match(config, /limit_conn_status 429/);
  assert.match(config, /limit_req zone=portal_requests burst=40 nodelay/);
  assert.match(config, /limit_conn portal_connections 20/);
  assert.match(config, /location \^~ \/internal\/torrentharbor-management\//);
  assert.match(config, /proxy_set_header X-Management-Source-IP ""/);
  assert.match(config, /client_header_timeout 10s/);
  assert.match(config, /gzip on/);
  assert.match(config, /Strict-Transport-Security "max-age=86400" always/);
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /peerIp\(req\) !== MANAGEMENT_SOURCE_IP/);
  assert.doesNotMatch(server, /req\.headers\[['"]x-management-source-ip['"]\]/);
});

test('asynchronous event writes notify subscribers only after durable append', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-security-async-'));
  try {
    const events = new SecurityEvents(directory, noGeo, { asyncWrites: true });
    let notified = false;
    events.subscribe(() => {
      const files = fs.readdirSync(path.join(directory, 'security-events')).filter((file) => file.endsWith('.jsonl'));
      assert.equal(files.length, 1);
      assert.match(fs.readFileSync(path.join(directory, 'security-events', files[0]), 'utf8'), /portal_visit/);
      notified = true;
    });
    events.record('portal_visit', { ip: '203.0.113.10', outcome: 'challenge_created' });
    await events.flush();
    assert.equal(notified, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Scene Management provides composable security filter controls', () => {
  const client = fs.readFileSync(path.join(__dirname, '../scene-admin-client.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../scene-admin.html'), 'utf8');
  for (const marker of ['security-filter-option', 'security-filter-chip', 'Add event type',
    'Add alert type', 'Add detected country', 'Add IP or CIDR range', 'Clear filters']) {
    assert.match(client + html, new RegExp(marker));
  }
  assert.match(client, /parameters\.append\(kind, value\)/);
  assert.match(client, /Filter by this IP/);
  assert.match(client, /Filter by this country/);
  assert.match(client, /accuracyRadiusKm/);
  assert.match(client, /administrator activity/);
  assert.match(client, /Scene Management/);
  assert.match(client, /GeoIP databases updated/);
});

test('security events persist bounded structured metadata and hash identities', () => temporary((directory) => {
  const events = new SecurityEvents(directory, noGeo, { retentionDays: 7 });
  const request = { method: 'POST', url: '/login/' + 'b'.repeat(43), headers: {
    'x-portal-source-ip': '203.0.113.8', 'user-agent': 'Example browser',
  }, securityRequestId: '12345678-1234-4abc-8def-1234567890ab' };
  const written = events.record('qr_login_attempt', { request, pathname: request.url,
    ip: sourceIp(request), identity: 'Person@Example.com', outcome: 'not_eligible', status: 200,
    requestId: request.securityRequestId });
  assert.equal(written.http.path, '/login/:token');
  assert.equal(written.source.ip, '203.0.113.8');
  assert.match(written.integrity, /^[A-Za-z0-9_-]{43}$/);
  assert.match(written.identityHash, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(written.requestId, request.securityRequestId);
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

test('security event filters compose across severity, category, country, exact IP, and CIDR', () => temporary((directory) => {
  const events = new SecurityEvents(directory, noGeo);
  events.record('suspicious_request', { ip: '45.118.10.5', severity: 'warning',
    category: 'automated_scanner_probe', outcome: 'observed' });
  events.record('suspicious_request', { ip: '203.0.113.8', severity: 'critical',
    category: 'sql_injection_probe', outcome: 'observed' });
  events.record('portal_visit', { ip: '192.168.1.20', severity: 'info', outcome: 'challenge_created' });
  events.geoip = { ...noGeo, lookup(ip) { return ip === '45.118.10.5'
    ? { scope: 'public', country: 'LT', city: 'Vilnius' }
    : ip === '203.0.113.8' ? { scope: 'public', country: 'US' } : { scope: 'private' }; } };
  assert.equal(events.list({ severity: ['warning', 'critical'] }).length, 2);
  assert.equal(events.list({ category: ['automated_scanner_probe'], country: ['LT'] }).length, 1);
  assert.equal(events.list({ source: ['45.118.10.0/24'] })[0].source.city, 'Vilnius');
  assert.equal(events.list({ source: ['203.0.113.8'] }).length, 1);
  assert.throws(() => events.list({ source: ['45.118.10.0/99'] }), /Invalid source filter/);
  assert.throws(() => events.list({ country: ['Lithuania'] }), /Invalid country filter/);
  const summary = events.summary();
  assert.deepEqual(summary.filterOptions.countries, [{ country: 'LT', count: 1 }, { country: 'US', count: 1 }]);
  assert.ok(summary.filterOptions.categories.includes('automated_scanner_probe'));
  assert.deepEqual(events.filterOptions({ severity: ['warning'] }), {
    types: ['suspicious_request'], categories: ['automated_scanner_probe'],
  });
  assert.deepEqual(events.filterOptions({ type: ['portal_visit'] }), {
    types: ['portal_visit', 'suspicious_request'], categories: [],
  });
}));

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
    assert.deepEqual(body.filterOptions, { types: ['access_request'], categories: [] });
    assert.doesNotMatch(JSON.stringify(body), /private@example\.com/);
    const summary = JSON.parse((await invoke(handler, '/api/security/summary', { 'x-scene-admin': 'owner' })).body);
    assert.equal(summary.accessRequests, 1);
    const maxmind = JSON.parse((await invoke(handler, '/api/security/maxmind', { 'x-scene-admin': 'owner' })).body);
    assert.equal(maxmind.mode, 'scene-management');
    assert.equal(maxmind.configured, false);
    assert.equal(maxmind.accountHint, null);
    const filtered = await invoke(handler, '/api/security/events?severity=info&severity=warning&source=203.0.113.0%2F24', { 'x-scene-admin': 'owner' });
    assert.equal(filtered.status, 200);
    assert.equal(JSON.parse(filtered.body).events.length, 1);
    const invalid = await invoke(handler, '/api/security/events?source=203.0.113.0%2F99', { 'x-scene-admin': 'owner' });
    assert.equal(invalid.status, 400);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

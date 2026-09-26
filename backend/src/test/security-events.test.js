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
  assert.deepEqual(classifyRequest({ method: 'GET', headers: {} }, new URL('https://portal.example/.ssh/authorized_keys')),
    [{ category: 'sensitive_file_enumeration', severity: 'critical' }]);
  assert.deepEqual(classifyRequest({ method: 'GET', headers: {} }, new URL('https://portal.example/_profiler/phpinfo')),
    [{ category: 'framework_admin_probe', severity: 'warning' }]);
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
  assert.match(client, /edge policy rejected · origin not reached/);
  assert.match(client, /use the correlated edge access log for the final response status/);
  assert.match(client, /Final edge and application outcome unverified/);
  assert.match(client, /WAF audit HTTP/);
  assert.match(client, /Edge HTTP/);
  assert.match(client, /securityMap/);
  assert.match(client, /SecurityGlobe\.create/);
  assert.match(client, /Threat connection globe/);
  assert.match(client, /Top cities/);
  assert.match(client, /different IPs/);
  assert.match(client, /destination →/);
  assert.match(client, /toggleMapSource/);
  assert.match(client, /toggleMapCity/);
  assert.match(client, /All retained events/);
  assert.match(client, /securityWindow/);
  assert.match(client, /Source intelligence/);
  assert.match(client, /Investigate source/);
  assert.match(client, /Run ethical reconnaissance/);
  assert.match(client, /function renderIntelValue/);
  assert.match(client, /intelLabel\(item\.value\) \+ ' · ' \+ item\.count\.toLocaleString\(\)/);
  assert.match(html, /source-intelligence-value/);
  assert.match(client, /function confirmSourceRecon/);
  assert.match(client, /source-intelligence-endpoint/);
  assert.match(client, /data-security-filter-kind/);
  assert.match(client, /filterKind: 'method'/);
  assert.match(client, /filterKind: 'status'/);
  assert.match(client, /filterKind: 'disposition'/);
  assert.doesNotMatch(client, /const accepted = window\.confirm\('This will contact only/);
  assert.match(html, /Confirm ethical reconnaissance/);
  assert.match(html, /Run bounded reconnaissance/);
  assert.match(client, /I understand this contacts the remote host/);
  assert.match(client, /Export sanitized JSON/);
  assert.match(client, /Export filtered CSV/);
  assert.match(client, /api\/security\/events\.csv/);
  assert.match(html, /security-globe\.js\?v=99/);
  assert.match(html, /Enable public click debugger/);
  assert.match(client, /scene\.diagnostics = \{ clickDebugger: elements\.clickDebugger\.checked \}/);
  assert.match(html, /admin\.js\?v=111/);
  const globe = fs.readFileSync(path.join(__dirname, '../security-globe.js'), 'utf8');
  assert.match(globe, /cameraSequence/);
  assert.match(globe, /routeDuration/);
  assert.match(globe, /world-land-50m\.json/);
  assert.match(globe, /nasa-blue-marble-day\.webp/);
  assert.match(globe, /nasa-black-marble-night\.webp/);
});

test('stored WAF protocol findings are re-ranked for presentation without rewriting the ledger', () => temporary((directory) => {
  const events = new SecurityEvents(directory, noGeo);
  const written = events.record('waf_finding', { ip: '203.0.113.8', severity: 'critical',
    category: 'framework_admin_probe', outcome: 'observed_passed',
    http: { method: 'GET', path: '/', status: 200 }, edge: {
      target: '75.178.84.162', disposition: 'observed_passed', ruleIds: ['920350'], mode: 'DetectionOnly',
    } });
  assert.equal(written.severity, 'critical');
  const stored = fs.readFileSync(path.join(directory, 'security-events', written.at.slice(0, 10) + '.jsonl'), 'utf8');
  const listed = events.list({ type: 'waf_finding' });
  assert.equal(listed[0].integrityValid, true);
  assert.equal(listed[0].severity, 'warning');
  assert.equal(listed[0].category, 'protocol_anomaly');
  assert.equal(listed[0].http.status, 444);
  assert.equal(listed[0].http.statusSource, 'edge_policy');
  assert.equal(listed[0].edge.disposition, 'edge_rejected');
  assert.equal(listed[0].edge.originReached, false);
  assert.equal(listed[0].edge.ruleSummary, 'Numeric IP used as the HTTP Host header');
  assert.equal(fs.readFileSync(path.join(directory, 'security-events', written.at.slice(0, 10) + '.jsonl'), 'utf8'), stored);
}));

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

test('security map aggregates located sources and uses the configured public destination', () => temporary((directory) => {
  const locatedGeo = {
    lookup(ip) {
      if (ip === '45.118.10.5') return { scope: 'public', country: 'LT', city: 'Vilnius',
        latitude: 54.6872, longitude: 25.2797, organization: 'Example source' };
      if (ip === '198.51.100.42') return { scope: 'public', country: 'US', city: 'New York',
        latitude: 40.7128, longitude: -74.006, organization: 'Example ISP' };
      return { scope: 'private' };
    },
    status: noGeo.status,
  };
  const events = new SecurityEvents(directory, locatedGeo, { destinationIp: '198.51.100.42' });
  events.record('waf_finding', { ip: '45.118.10.5', severity: 'warning', category: 'protocol_anomaly',
    edge: { target: '198.51.100.42', disposition: 'waf_blocked' } });
  events.record('suspicious_request', { ip: '45.118.10.5', severity: 'critical', category: 'sql_injection_probe' });
  const map = events.map();
  assert.equal(map.total, 2);
  assert.equal(map.located, 2);
  assert.equal(map.sources.length, 1);
  assert.deepEqual({ ip: map.sources[0].ip, count: map.sources[0].count, waf: map.sources[0].waf },
    { ip: '45.118.10.5', count: 2, waf: 1 });
  assert.equal(map.destination.ip, '198.51.100.42');
  assert.equal(map.destinationConfigured, true);
}));

test('retained-window summaries and maps aggregate beyond the 250-card display limit', () => temporary((directory) => {
  const events = new SecurityEvents(directory, noGeo);
  const newest = Date.now();
  events.matching = function* matching(options = {}) {
    const before = options.before ? Date.parse(options.before) : Infinity;
    for (let index = 0; index < 320; index += 1) {
      const at = new Date(newest - index * 1000).toISOString();
      if (Date.parse(at) >= before) continue;
      yield {
      at, type: 'portal_visit', severity: 'info',
      outcome: 'challenge_created', source: { scope: 'public', ip: '203.0.113.8' }, integrityValid: true,
    };
    }
  };
  assert.equal(events.list({ limit: 250, since: 'all' }).length, 250);
  assert.equal(events.summary({ since: 'all' }).total, 320);
  assert.equal(events.map({ since: 'all' }).total, 320);
  const first = events.page({ limit: 250, since: 'all' });
  assert.equal(first.events.length, 250);
  assert.equal(first.hasMore, true);
  const second = events.page({ limit: 250, since: 'all', before: first.nextBefore });
  assert.equal(second.events.length, 70);
  assert.equal(second.hasMore, false);
}));

test('security event filters compose across evidence, geography, exact IP, and CIDR', () => temporary((directory) => {
  const events = new SecurityEvents(directory, noGeo);
  events.record('suspicious_request', { ip: '45.118.10.5', severity: 'warning',
    category: 'automated_scanner_probe', outcome: 'observed',
    request: { method: 'GET', url: '/', headers: {} }, pathname: '/', status: 404 });
  events.record('suspicious_request', { ip: '203.0.113.8', severity: 'critical',
    category: 'sql_injection_probe', outcome: 'origin_rejected',
    request: { method: 'POST', url: '/login', headers: {} }, pathname: '/login', status: 429 });
  events.record('portal_visit', { ip: '192.168.1.20', severity: 'info', outcome: 'challenge_created' });
  events.geoip = { ...noGeo, lookup(ip) { return ip === '45.118.10.5'
    ? { scope: 'public', country: 'LT', city: 'Vilnius' }
    : ip === '203.0.113.8' ? { scope: 'public', country: 'US' } : { scope: 'private' }; } };
  assert.equal(events.list({ severity: ['warning', 'critical'] }).length, 2);
  assert.equal(events.list({ category: ['automated_scanner_probe'], country: ['LT'] }).length, 1);
  assert.equal(events.list({ city: ['Vilnius'] }).length, 1);
  assert.equal(events.list({ method: ['GET'], status: ['404'], disposition: ['observed'] }).length, 1);
  assert.equal(events.list({ method: ['POST'], status: ['429'], disposition: ['origin_rejected'] }).length, 1);
  assert.equal(events.list({ source: ['45.118.10.0/24'] })[0].source.city, 'Vilnius');
  assert.equal(events.list({ source: ['203.0.113.8'] }).length, 1);
  assert.throws(() => events.list({ source: ['45.118.10.0/99'] }), /Invalid source filter/);
  assert.throws(() => events.list({ country: ['Lithuania'] }), /Invalid country filter/);
  assert.throws(() => events.list({ city: [''] }), /Invalid city/);
  assert.throws(() => events.list({ method: ['GET /'] }), /Invalid method/);
  assert.throws(() => events.list({ status: ['999'] }), /Invalid status/);
  assert.throws(() => events.list({ disposition: ['bad value'] }), /Invalid disposition/);
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
    const retainedSummary = await invoke(handler, '/api/security/summary?since=all', { 'x-scene-admin': 'owner' });
    assert.equal(retainedSummary.status, 200);
    assert.equal(JSON.parse(retainedSummary.body).windowHours, null);
    const map = await invoke(handler, '/api/security/map', { 'x-scene-admin': 'owner' });
    assert.equal(map.status, 200);
    assert.equal(JSON.parse(map.body).total, 1);
    const retainedMap = await invoke(handler, '/api/security/map?since=all', { 'x-scene-admin': 'owner' });
    assert.equal(retainedMap.status, 200);
    assert.equal(JSON.parse(retainedMap.body).windowHours, null);
    const globeClient = await invoke(handler, '/security-globe.js', { 'x-scene-admin': 'owner' });
    assert.equal(globeClient.status, 200);
    assert.match(String(globeClient.body), /SecurityGlobe/);
    const worldLand = await invoke(handler, '/world-land-50m.json', { 'x-scene-admin': 'owner' });
    assert.equal(worldLand.status, 200);
    assert.equal(JSON.parse(worldLand.body).type, 'Topology');
    assert.equal(worldLand.headers['Cache-Control'], 'private, max-age=31536000, immutable');
    assert.equal(Number(worldLand.headers['Content-Length']), worldLand.body.length);
    assert.match(worldLand.headers.ETag, /^"[A-Za-z0-9_-]{43}"$/);
    const cityLights = await invoke(handler, '/nasa-city-lights.json', { 'x-scene-admin': 'owner' });
    assert.equal(cityLights.status, 200);
    assert.ok(JSON.parse(cityLights.body).points.length > 2000);
    const dayTexture = await invoke(handler, '/nasa-blue-marble-day.webp', { 'x-scene-admin': 'owner' });
    assert.equal(dayTexture.status, 200);
    assert.ok(dayTexture.body.length > 500000);
    assert.equal(dayTexture.headers['Cache-Control'], 'private, max-age=31536000, immutable');
    assert.equal(Number(dayTexture.headers['Content-Length']), dayTexture.body.length);
    const nightTexture = await invoke(handler, '/nasa-black-marble-night.webp', { 'x-scene-admin': 'owner' });
    assert.equal(nightTexture.status, 200);
    assert.ok(nightTexture.body.length > 150000);
    assert.equal(nightTexture.headers['Cache-Control'], 'private, max-age=31536000, immutable');
    assert.equal(Number(nightTexture.headers['Content-Length']), nightTexture.body.length);
    const maxmind = JSON.parse((await invoke(handler, '/api/security/maxmind', { 'x-scene-admin': 'owner' })).body);
    assert.equal(maxmind.mode, 'scene-management');
    assert.equal(maxmind.configured, false);
    assert.equal(maxmind.accountHint, null);
    const filtered = await invoke(handler, '/api/security/events?severity=info&severity=warning&source=203.0.113.0%2F24&disposition=accepted', { 'x-scene-admin': 'owner' });
    assert.equal(filtered.status, 200);
    assert.equal(JSON.parse(filtered.body).events.length, 1);
    const csv = await invoke(handler, '/api/security/events.csv?type=access_request&since=all', { 'x-scene-admin': 'owner' });
    assert.equal(csv.status, 200);
    assert.equal(csv.headers['Content-Type'], 'text/csv; charset=utf-8');
    assert.match(csv.headers['Content-Disposition'], /^attachment; filename="scene-access-security-events-/);
    assert.equal(csv.headers['X-Event-Count'], '1');
    assert.match(csv.body, /"audit_http_status"/);
    assert.match(csv.body, /"origin_reached"/);
    assert.match(csv.body, /"access_request"/);
    assert.doesNotMatch(csv.body, /private@example\.com/);
    const invalidCsv = await invoke(handler, '/api/security/events.csv?limit=1', { 'x-scene-admin': 'owner' });
    assert.equal(invalidCsv.status, 400);
    const invalid = await invoke(handler, '/api/security/events?source=203.0.113.0%2F99', { 'x-scene-admin': 'owner' });
    assert.equal(invalid.status, 400);
    const invalidCursor = await invoke(handler, '/api/security/events?before=not-a-date', { 'x-scene-admin': 'owner' });
    assert.equal(invalidCursor.status, 400);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

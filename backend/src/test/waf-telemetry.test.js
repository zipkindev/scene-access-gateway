'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WafCollector, accessOutcome, correlateAudit, normalizeAudit, safeTransactionId } = require('../waf-collector');

test('standalone collector keeps its polling timer referenced', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'waf-collector.js'), 'utf8');
  assert.match(source, /collector\.start\(\{ unref: false \}\)/);
  assert.match(source, /options\.unref !== false/);
});

test('numeric-host edge outcome inference matches the WAF default-server policy', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'deploy', 'waf', 'default.conf.template'), 'utf8');
  assert.match(source, /listen \$\{WAF_LISTEN_PORT\} ssl default_server;/);
  assert.match(source, /location \/ \{ return 444; \}/);
});

test('WAF writes a minimal query-free edge correlation stream', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'deploy', 'waf', 'logging.conf.template'), 'utf8');
  assert.match(source, /log_format waf_correlation/);
  assert.match(source, /"request_id":"\$request_id"/);
  assert.match(source, /"uri":"\$uri"/);
  assert.match(source, /"upstream_status":"\$upstream_status"/);
  assert.match(source, /access_log \$\{WAF_CORRELATION_LOG\} waf_correlation/);
});

test('ModSecurity transaction IDs are retained or converted to stable ledger-safe IDs', () => {
  assert.equal(safeTransactionId('edge_request-01'), 'edge_request-01');
  const converted = safeTransactionId('transaction.with:modsecurity/characters');
  assert.match(converted, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(converted, safeTransactionId('transaction.with:modsecurity/characters'));
  assert.notEqual(converted, 'transaction.with:modsecurity/characters');
});
const { WafIngestor, validate } = require('../waf-ingestor');
const { SecurityEvents } = require('../security-events');

const noGeo = {
  lookup() { return { scope: 'public', country: 'US', asn: 64500, organization: 'Example network' }; },
  status() { return { mode: 'local-mmdb', city: { loaded: false }, asn: { loaded: false } }; },
};

function audit(overrides = {}) {
  return { transaction: {
    client_ip: '203.0.113.42', unique_id: 'edge_request_01', time_stamp: '2026-09-23T14:00:00.000Z',
    is_interrupted: false,
    request: { hostname: 'access.example.invalid', method: 'GET', uri: '/.env?token=do-not-retain' },
    response: { http_code: 404 },
    messages: [
      { message: 'Restricted File Access Attempt', details: { ruleId: '930130', severity: '2', tags: ['attack-lfi'] } },
      { message: 'Inbound Anomaly Score Exceeded (Total Score: 5)', details: { ruleId: '949110', severity: '0', tags: [] } },
    ], ...overrides,
  } };
}

test('WAF audits normalize into one sanitized high-confidence finding', () => {
  const value = normalizeAudit(audit());
  assert.equal(value.category, 'sensitive_file_enumeration');
  assert.equal(value.severity, 'critical');
  assert.equal(value.http.path, '/.env');
  assert.equal(value.http.status, 404);
  assert.equal(value.http.statusSource, 'modsecurity_audit');
  assert.equal(value.edge.disposition, 'outcome_unknown');
  assert.equal(value.edge.statusVerified, false);
  assert.equal(value.edge.originReached, null);
  assert.equal(value.edge.correlationStatus, 'pending');
  assert.deepEqual(value.edge.ruleIds, ['930130']);
  assert.equal(value.edge.ruleSummary, 'Restricted or sensitive file requested');
  assert.equal(value.edge.anomalyScore, 5);
  assert.doesNotMatch(JSON.stringify(value), /do-not-retain/);
});

test('CRS protocol rules retain their own severity and are not promoted by an HTTP 200', () => {
  const numericHost = normalizeAudit(audit({
    request: { hostname: '75.178.84.162', method: 'GET', uri: '/' },
    response: { http_code: 200 },
    messages: [{ message: 'Host header is a numeric IP address', details: {
      ruleId: '920350', severity: '4', tags: ['platform-multi'],
    } }],
  }));
  assert.equal(numericHost.category, 'protocol_anomaly');
  assert.equal(numericHost.severity, 'warning');
  assert.equal(numericHost.http.status, 444);
  assert.equal(numericHost.http.statusSource, 'edge_policy');
  assert.equal(numericHost.http.auditStatus, 200);
  assert.equal(numericHost.edge.disposition, 'edge_rejected');
  assert.equal(numericHost.edge.statusVerified, true);
  assert.equal(numericHost.edge.originReached, false);
  assert.equal(numericHost.edge.ruleSummary, 'Numeric IP used as the HTTP Host header');
  assert.doesNotThrow(() => validate(numericHost));

  const restrictedHeader = normalizeAudit(audit({
    request: { hostname: '75.178.84.162', method: 'POST', uri: '/wp-json/batch/v1' },
    response: { http_code: 200 },
    messages: [{ message: 'HTTP header is restricted by policy', details: {
      ruleId: '920451', severity: '2', tags: ['platform-multi', 'language-multi'],
    } }],
  }));
  assert.equal(restrictedHeader.category, 'protocol_anomaly');
  assert.equal(restrictedHeader.severity, 'critical');
  assert.equal(restrictedHeader.edge.ruleSummary, 'HTTP header restricted by policy');

  const missingAgent = normalizeAudit(audit({
    request: { hostname: 'access.example.invalid', method: 'GET', uri: '/' },
    response: { http_code: 200 },
    messages: [{ message: 'Missing User Agent Header', details: {
      ruleId: '920320', severity: '5', tags: ['attack-protocol'],
    } }],
  }));
  assert.equal(missingAgent.category, 'protocol_anomaly');
  assert.equal(missingAgent.severity, 'info');
  assert.equal(missingAgent.edge.ruleSummary, 'Request missing User-Agent header');
});

test('a ModSecurity interruption is a verified final edge outcome', () => {
  const value = normalizeAudit(audit({ is_interrupted: true, response: { http_code: 403 } }));
  assert.equal(value.edge.disposition, 'waf_blocked');
  assert.equal(value.edge.statusVerified, true);
  assert.equal(value.edge.originReached, false);
  assert.doesNotThrow(() => validate(value));
});

test('edge access correlation supplies one verified final outcome while preserving audit status', () => {
  const edge = accessOutcome({ time: '2026-09-23T14:00:00Z', request_id: 'edge_request_01',
    remote_addr: '203.0.113.42', host: 'access.example.invalid', method: 'GET',
    uri: '/.env', status: 404, upstream_status: '404' });
  const value = correlateAudit(normalizeAudit(audit({ response: { http_code: 200 } })), edge);
  assert.equal(value.http.status, 404);
  assert.equal(value.http.statusSource, 'edge_access');
  assert.equal(value.http.auditStatus, 200);
  assert.equal(value.http.upstreamStatus, 404);
  assert.equal(value.edge.statusVerified, true);
  assert.equal(value.edge.originReached, true);
  assert.equal(value.edge.correlationStatus, 'verified');
  assert.equal(value.edge.disposition, 'origin_rejected');
  assert.equal(value.outcome, 'origin_rejected');
  assert.doesNotThrow(() => validate(value));
});

test('remote-access product paths are classified as service enumeration', () => {
  for (const [uri, summary] of [
    ['/RDWeb/Pages/en-US/login.aspx', 'Microsoft Remote Desktop Web service enumeration'],
    ['/api/sonicos/tfa', 'SonicWall SSL-VPN service enumeration'],
    ['/owa/auth/logon.aspx', 'Microsoft Exchange/OWA service enumeration'],
    ['/dana-na/nc/nc_gina_ver.txt', 'Ivanti/Pulse Secure VPN service enumeration'],
    ['/wsman', 'Windows remote-management service enumeration'],
  ]) {
    const value = normalizeAudit(audit({
      request: { hostname: '75.178.84.162', method: 'GET', uri },
      response: { http_code: 200 },
      messages: [{ message: 'Host header is a numeric IP address', details: {
        ruleId: '920350', severity: '4', tags: ['platform-multi'],
      } }],
    }));
    assert.equal(value.category, 'service_enumeration');
    assert.equal(value.severity, 'warning');
    assert.equal(value.edge.behaviorSummary, summary);
    assert.equal(value.edge.disposition, 'edge_rejected');
    assert.equal(value.edge.originReached, false);
  }
});

test('sensitive and framework paths override generic protocol classification', () => {
  for (const [uri, category, severity] of [
    ['/credentials.ini', 'sensitive_file_enumeration', 'critical'],
    ['/backup.sql', 'backup_file_probe', 'warning'],
    ['/actuator/env', 'framework_admin_probe', 'warning'],
  ]) {
    const value = normalizeAudit(audit({
      request: { hostname: '75.178.84.162', method: 'GET', uri },
      response: { http_code: 200 },
      messages: [{ message: 'Host header is a numeric IP address', details: {
        ruleId: '920350', severity: '4', tags: ['platform-multi'],
      } }],
    }));
    assert.equal(value.category, category);
    assert.equal(value.severity, severity);
    assert.ok(value.edge.behaviorSummary);
  }
});

test('ingestion rejects telemetry that claims an unverified transaction has a verified status', () => {
  const value = normalizeAudit(audit());
  value.edge.statusVerified = true;
  assert.throws(() => validate(value), /Invalid WAF telemetry event/);
});

test('collector and ingestor persist, deduplicate, and expose WAF status', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-waf-'));
  try {
    const auditRoot = path.join(directory, 'audit');
    const telemetry = path.join(directory, 'telemetry');
    const data = path.join(directory, 'data');
    fs.mkdirSync(auditRoot);
    fs.writeFileSync(path.join(auditRoot, 'event.json'), JSON.stringify(audit()));
    const output = path.join(telemetry, 'events.jsonl');
    const collector = new WafCollector(auditRoot, output, path.join(telemetry, 'collector-state.json'), { graceMs: 0 });
    assert.equal(collector.scan(), 1);
    assert.equal(collector.scan(), 0);
    const normalized = JSON.parse(fs.readFileSync(output, 'utf8').trim());
    assert.equal(normalized.edge.historical, true);
    assert.equal(normalized.edge.correlationStatus, 'unavailable');
    const security = new SecurityEvents(data, noGeo);
    const ingestor = new WafIngestor(output, security, data);
    security.wafStatus = () => ingestor.status();
    assert.equal(ingestor.poll(), 1);
    assert.equal(ingestor.poll(), 0);
    const events = security.list({ type: 'waf_finding' });
    assert.equal(events.length, 1);
    assert.equal(events[0].edge.target, 'access.example.invalid');
    assert.equal(events[0].edge.transactionId, 'edge_request_01');
    assert.equal(events[0].edge.historical, true);
    assert.equal(events[0].edge.mode, 'DetectionOnly');
    assert.equal(events[0].http.statusSource, 'modsecurity_audit');
    assert.equal(events[0].edge.statusVerified, false);
    assert.equal(events[0].edge.disposition, 'outcome_unknown');
    assert.equal(events[0].edge.originReached, null);
    assert.equal(security.list({ stream: 'application' }).length, 0);
    assert.equal(security.list({ stream: 'waf' }).length, 1);
    // Keep this historical ingestion fixture independent of the wall clock;
    // the product default intentionally shows only the most recent 24 hours.
    assert.deepEqual(security.summary({ since: '2026-09-23T00:00:00.000Z' }).waf, {
      total: 1, passed: 0, rejected: 0, rateLimited: 0, blocked: 0, edgeRejected: 0, unknown: 1,
      ingestion: { ...ingestor.status() },
    });
    assert.equal(new WafIngestor(null, security, data, { mode: 'On' }).status().mode, 'On');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('collector joins late access evidence and the ledger exposes one corrected finding', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-waf-late-edge-'));
  try {
    const auditRoot = path.join(directory, 'audit');
    const telemetry = path.join(directory, 'telemetry');
    const data = path.join(directory, 'data');
    fs.mkdirSync(auditRoot);
    fs.writeFileSync(path.join(auditRoot, 'event.json'), JSON.stringify(audit({ response: { http_code: 200 } })));
    const accessLog = path.join(auditRoot, 'waf-access.jsonl');
    fs.writeFileSync(accessLog, '');
    const output = path.join(telemetry, 'events.jsonl');
    const collector = new WafCollector(auditRoot, output, path.join(telemetry, 'collector-state.json'),
      { accessLog, graceMs: 0 });
    assert.equal(collector.scan(), 1);
    fs.appendFileSync(accessLog, JSON.stringify({ time: '2026-09-23T14:00:00Z',
      request_id: 'edge_request_01', remote_addr: '203.0.113.42', host: 'access.example.invalid',
      method: 'GET', uri: '/.env', status: 404, upstream_status: '404' }) + '\n');
    assert.equal(collector.scan(), 1);
    const normalized = fs.readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(normalized.map((event) => event.source), ['waf', 'waf_outcome']);
    const security = new SecurityEvents(data, noGeo);
    const ingestor = new WafIngestor(output, security, data);
    assert.equal(ingestor.poll(), 2);
    const visible = security.list({ stream: 'waf', since: 'all' });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].http.status, 404);
    assert.equal(visible[0].http.auditStatus, 200);
    assert.equal(visible[0].http.statusSource, 'edge_access');
    assert.equal(visible[0].edge.originReached, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('collector backfills retained exact-ID outcomes after prior correlation was missed', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-waf-backfill-'));
  try {
    const auditRoot = path.join(directory, 'audit');
    const telemetry = path.join(directory, 'telemetry');
    fs.mkdirSync(auditRoot);
    fs.mkdirSync(telemetry);
    fs.writeFileSync(path.join(auditRoot, 'event.json'), JSON.stringify(audit({ response: { http_code: 200 } })));
    const accessLog = path.join(auditRoot, 'waf-access.jsonl');
    fs.writeFileSync(accessLog, '');
    const output = path.join(telemetry, 'events.jsonl');
    const stateFile = path.join(telemetry, 'collector-state.json');
    const first = new WafCollector(auditRoot, output, stateFile, { accessLog, graceMs: 0 });
    assert.equal(first.scan(), 1);
    fs.appendFileSync(accessLog, JSON.stringify({ time: '2026-09-23T14:00:00Z',
      request_id: 'edge_request_01', remote_addr: '203.0.113.42', host: 'access.example.invalid',
      method: 'GET', uri: '/.env', status: 404, upstream_status: '404' }) + '\n');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state.accessOffset = fs.statSync(accessLog).size;
    delete state.backfillVersion;
    fs.writeFileSync(stateFile, JSON.stringify(state));
    const restarted = new WafCollector(auditRoot, output, stateFile, { accessLog, graceMs: 0 });
    assert.equal(restarted.scan(), 1);
    const retained = fs.readFileSync(output, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(retained.map((event) => event.source), ['waf', 'waf_outcome']);
    assert.equal(retained[1].http.status, 404);
    assert.equal(retained[1].edge.correlationStatus, 'verified');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('late edge outcomes fold into the original signed finding instead of creating a second visible event', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-waf-outcome-'));
  try {
    const events = new SecurityEvents(directory, noGeo);
    events.record('waf_finding', { at: new Date().toISOString(), ip: '203.0.113.42', severity: 'critical',
      category: 'sensitive_file_enumeration', outcome: 'outcome_unknown',
      http: { method: 'GET', path: '/.env', status: 200, statusSource: 'modsecurity_audit' },
      edge: { target: 'access.example.invalid', disposition: 'outcome_unknown', ruleIds: ['930130'],
        statusVerified: false, originReached: null, transactionId: 'edge_request_01' } });
    events.record('waf_outcome', { at: new Date().toISOString(), ip: '203.0.113.42', severity: 'info',
      outcome: 'origin_rejected', http: { method: 'GET', path: '/.env', status: 404,
        statusSource: 'edge_access', upstreamStatus: 404 }, edge: { target: 'access.example.invalid',
        disposition: 'origin_rejected', statusVerified: true, originReached: true,
        transactionId: 'edge_request_01' } });
    const visible = events.list({ since: 'all' });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].type, 'waf_finding');
    assert.equal(visible[0].http.status, 404);
    assert.equal(visible[0].http.auditStatus, 200);
    assert.equal(visible[0].http.statusSource, 'edge_access');
    assert.equal(visible[0].edge.originReached, true);
    assert.equal(visible[0].edge.disposition, 'origin_rejected');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WafCollector, normalizeAudit, safeTransactionId } = require('../waf-collector');

test('standalone collector keeps its polling timer referenced', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'waf-collector.js'), 'utf8');
  assert.match(source, /collector\.start\(\{ unref: false \}\)/);
  assert.match(source, /options\.unref !== false/);
});

test('ModSecurity transaction IDs are retained or converted to stable ledger-safe IDs', () => {
  assert.equal(safeTransactionId('edge_request-01'), 'edge_request-01');
  const converted = safeTransactionId('transaction.with:modsecurity/characters');
  assert.match(converted, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(converted, safeTransactionId('transaction.with:modsecurity/characters'));
  assert.notEqual(converted, 'transaction.with:modsecurity/characters');
});
const { WafIngestor } = require('../waf-ingestor');
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
  assert.equal(value.edge.disposition, 'origin_rejected');
  assert.deepEqual(value.edge.ruleIds, ['930130']);
  assert.equal(value.edge.anomalyScore, 5);
  assert.doesNotMatch(JSON.stringify(value), /do-not-retain/);
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
    const collector = new WafCollector(auditRoot, output, path.join(telemetry, 'collector-state.json'));
    assert.equal(collector.scan(), 1);
    assert.equal(collector.scan(), 0);
    const normalized = JSON.parse(fs.readFileSync(output, 'utf8').trim());
    assert.equal(normalized.edge.historical, true);
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
    assert.equal(security.list({ stream: 'application' }).length, 0);
    assert.equal(security.list({ stream: 'waf' }).length, 1);
    assert.deepEqual(security.summary().waf, {
      total: 1, passed: 0, rejected: 1, rateLimited: 0, blocked: 0,
      ingestion: { ...ingestor.status() },
    });
    assert.equal(new WafIngestor(null, security, data, { mode: 'On' }).status().mode, 'On');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

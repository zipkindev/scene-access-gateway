'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { DEFAULT_POLICY, TelegramAlerts, validatePolicy } = require('../telegram-alerts');
const { SecurityEvents } = require('../security-events');
const { createSceneAdmin } = require('../scene-admin');

const noGeo = {
  lookup(ip) { return { scope: ip.startsWith('192.168.') ? 'private' : 'public', country: 'US', asn: 64500, organization: 'Example network' }; },
  status() { return { mode: 'local-mmdb', city: { configured: false, loaded: false }, asn: { configured: false, loaded: false } }; },
};

function temporary(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-telegram-'));
  return Promise.resolve(callback(directory)).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

function credentials(directory) {
  const tokenPath = path.join(directory, 'token');
  const chatPath = path.join(directory, 'chat');
  fs.writeFileSync(tokenPath, '123456:' + 'a'.repeat(35), { mode: 0o600 });
  fs.writeFileSync(chatPath, '-1001234567890', { mode: 0o600 });
  return { tokenPath, chatPath };
}

function event(overrides = {}) {
  return {
    at: '2026-09-23T03:00:00.000Z', type: 'suspicious_request', severity: 'critical',
    category: 'sql_injection_probe', outcome: 'observed',
    source: { ip: '203.0.113.42', scope: 'public', country: 'US', asn: 64500, organization: 'Example network' },
    ...overrides,
  };
}

test('policy validation is strict and defaults remain disabled', () => {
  assert.equal(validatePolicy(DEFAULT_POLICY).enabled, false);
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, token: 'secret' }), /Invalid Telegram policy/);
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, quietHours: { start: '25:00', end: '07:00' } }), /Invalid Telegram policy/);
});

test('version 1 scanner policies migrate to the corresponding WAF categories', () => {
  const legacy = validatePolicy({ ...DEFAULT_POLICY, version: 1,
    categories: ['automated_scanner_probe', 'unexpected_http_method'] });
  assert.equal(legacy.version, 2);
  assert.ok(legacy.categories.includes('sensitive_file_enumeration'));
  assert.ok(legacy.categories.includes('backup_file_probe'));
  assert.ok(legacy.categories.includes('framework_admin_probe'));
  assert.ok(legacy.categories.includes('known_scanner'));
  assert.ok(legacy.categories.includes('protocol_anomaly'));
});

test('matching events aggregate, redact, cool down, and deliver asynchronously', async () => temporary(async (directory) => {
  const requests = [];
  const alerts = new TelegramAlerts(directory, { ...credentials(directory), retryDelays: [0],
    now: () => new Date('2026-09-23T03:00:00.000Z'),
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, status: 200 }; } });
  alerts.updatePolicy({ ...DEFAULT_POLICY, enabled: true, countThreshold: 2, cooldownSeconds: 300 });
  assert.equal(alerts.enqueue(event()), false);
  assert.equal(alerts.enqueue(event()), true);
  await alerts.draining;
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.telegram\.org\/bot123456:/);
  assert.match(requests[0].body.text, /Observed since last alert: 2 · total: 2/);
  assert.match(requests[0].body.text, /203\.0\.113\.…/);
  assert.doesNotMatch(requests[0].body.text, /203\.0\.113\.42/);
  assert.equal(alerts.enqueue(event()), false);
  await alerts.test();
  assert.equal(requests.length, 2);
  assert.match(requests[1].body.text, /Scene Access test alert/);
  await assert.rejects(() => alerts.test(), /rate limited/);
  const state = alerts.state();
  assert.equal(state.active, true);
  assert.equal(state.incidents.active, 1);
  assert.equal(JSON.stringify(state).includes('123456:'), false);
  assert.equal(JSON.stringify(state).includes('-1001234567890'), false);
}));

test('persistent incidents re-alert after the configured interval and separate targets', async () => temporary(async (directory) => {
  const requests = [];
  let now = new Date('2026-09-23T03:00:00.000Z');
  const alerts = new TelegramAlerts(directory, { ...credentials(directory), retryDelays: [0], now: () => now,
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200 }; } });
  alerts.updatePolicy({ ...DEFAULT_POLICY, enabled: true, countThreshold: 1,
    cooldownSeconds: 300, persistentReminderSeconds: 900, incidentQuietSeconds: 1800 });
  const finding = event({ category: 'sensitive_file_enumeration', edge: {
    target: 'access.example.invalid', disposition: 'origin_rejected' } });
  assert.equal(alerts.enqueue(finding), true);
  await alerts.draining;
  now = new Date('2026-09-23T03:05:00.000Z');
  assert.equal(alerts.enqueue(finding), false);
  now = new Date('2026-09-23T03:15:00.000Z');
  assert.equal(alerts.enqueue({ ...finding, edge: { ...finding.edge, disposition: 'origin_rate_limited' } }), true);
  await alerts.draining;
  assert.equal(requests.length, 2);
  assert.match(requests[1].text, /total: 3/);
  assert.match(requests[1].text, /origin rejected 2/);
  assert.match(requests[1].text, /origin rate-limited 1/);
  assert.equal(alerts.enqueue({ ...finding, edge: { ...finding.edge, target: 'arcade.example.invalid' } }), true);
  await alerts.draining;
  assert.equal(requests.length, 3);
}));

test('WAF Telegram alerts explain observation mode, request result, and safe rule details', async () => temporary(async (directory) => {
  const requests = [];
  const alerts = new TelegramAlerts(directory, { ...credentials(directory), retryDelays: [0],
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200 }; } });
  alerts.updatePolicy({ ...DEFAULT_POLICY, enabled: true, minimumSeverity: 'warning', countThreshold: 1,
    categories: [...DEFAULT_POLICY.categories, 'protocol_anomaly'] });
  assert.equal(alerts.enqueue(event({ type: 'waf_finding', severity: 'warning', category: 'protocol_anomaly',
    outcome: 'observed_passed', http: { method: 'GET', path: '/', status: 200 }, edge: {
      target: '75.178.84.162', disposition: 'observed_passed', mode: 'DetectionOnly',
      ruleIds: ['920350'], ruleSummary: 'Numeric IP used as the HTTP Host header',
    } })), true);
  await alerts.draining;
  assert.equal(requests.length, 1);
  assert.match(requests[0].text, /Request: GET \/ → HTTP 200/);
  assert.match(requests[0].text, /Matched: CRS 920350 · Numeric IP used as the HTTP Host header/);
  assert.match(requests[0].text, /WAF action: Observed only \(DetectionOnly\); request was not blocked/);
  assert.match(requests[0].text, /status alone does not prove access or exploitation/);
  assert.doesNotMatch(requests[0].text, /Outcome: observed_passed|Results: observed passed/);
}));

test('historical WAF imports populate monitoring without generating Telegram alerts', async () => temporary(async (directory) => {
  const requests = [];
  const alerts = new TelegramAlerts(directory, { ...credentials(directory), retryDelays: [0],
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200 }; } });
  alerts.updatePolicy({ ...DEFAULT_POLICY, enabled: true, countThreshold: 1 });
  const imported = event({ category: 'sensitive_file_enumeration', edge: {
    target: 'access.example.invalid', disposition: 'origin_rejected', historical: true } });
  assert.equal(alerts.enqueue(imported), false);
  assert.equal(requests.length, 0);
  assert.equal(alerts.state().incidents.active, 0);
}));

test('the initial event threshold must be met inside the aggregation window', async () => temporary(async (directory) => {
  let now = new Date('2026-09-23T03:00:00.000Z');
  const requests = [];
  const alerts = new TelegramAlerts(directory, { ...credentials(directory), retryDelays: [0], now: () => now,
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200 }; } });
  alerts.updatePolicy({ ...DEFAULT_POLICY, enabled: true, countThreshold: 2, aggregationWindowSeconds: 60 });
  assert.equal(alerts.enqueue(event()), false);
  now = new Date('2026-09-23T03:02:00.000Z');
  assert.equal(alerts.enqueue(event()), false);
  now = new Date('2026-09-23T03:02:30.000Z');
  assert.equal(alerts.enqueue(event()), true);
  await alerts.draining;
  assert.equal(requests.length, 1);
  assert.match(requests[0].text, /total: 3/);
}));

test('delivery failure never escapes the ledger path and preserves a bounded pending alert', async () => temporary(async (directory) => {
  const alerts = new TelegramAlerts(directory, { ...credentials(directory), retryDelays: [0, 0, 0],
    fetch: async () => ({ ok: false, status: 503 }) });
  alerts.updatePolicy({ ...DEFAULT_POLICY, enabled: true });
  const events = new SecurityEvents(directory, noGeo);
  events.subscribe((value) => alerts.enqueue(value));
  assert.doesNotThrow(() => events.record('suspicious_request', { ip: '203.0.113.42', severity: 'critical',
    category: 'sql_injection_probe', outcome: 'observed' }));
  await alerts.draining;
  assert.equal(alerts.state().pending, 1);
  assert.equal(alerts.state().delivery.lastFailureCode, 'http_503');
  assert.equal(events.list().length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'scene-management', 'telegram-alert-queue.json')));
  assert.equal(saved.length, 1);
  assert.doesNotMatch(JSON.stringify(saved), /203\.0\.113\.42/);
  const recovered = new TelegramAlerts(directory, { ...credentials(directory), retryDelays: [0],
    fetch: async () => ({ ok: true, status: 200 }) });
  await recovered.draining;
  assert.equal(recovered.state().pending, 0);
}));

test('quiet hours and global ceilings suppress noise while allowing critical override', async () => temporary(async (directory) => {
  const requests = [];
  const alerts = new TelegramAlerts(directory, { ...credentials(directory), retryDelays: [0],
    now: () => new Date('2026-09-23T23:30:00.000Z'),
    fetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, status: 200 }; } });
  alerts.updatePolicy({ ...DEFAULT_POLICY, enabled: true, cooldownSeconds: 0, globalLimitPerHour: 1,
    quietHours: { start: '22:00', end: '07:00' }, criticalOverride: false });
  assert.equal(alerts.enqueue(event()), false);
  alerts.updatePolicy({ ...alerts.policy, criticalOverride: true });
  assert.equal(alerts.enqueue(event()), true);
  await alerts.draining;
  assert.equal(requests.length, 1);
  assert.equal(alerts.enqueue(event({ source: { ip: '198.51.100.8', scope: 'public', country: 'US' } })), false);
  assert.equal(alerts.enqueue(event({ source: { ip: '198.51.100.8', scope: 'public', country: 'US' } })), false);
  assert.equal(alerts.state().incidents.suppressedByHourlyLimit, 1);
}));

test('missing credentials expose configuration state but disable delivery', async () => temporary(async (directory) => {
  const alerts = new TelegramAlerts(directory, { tokenPath: path.join(directory, 'missing-token'), chatPath: path.join(directory, 'missing-chat') });
  alerts.updatePolicy({ ...DEFAULT_POLICY, enabled: true });
  assert.equal(alerts.state().configured, false);
  assert.equal(alerts.state().active, false);
  assert.equal(alerts.enqueue(event()), false);
  await assert.rejects(() => alerts.test(), /not configured/);
}));

test('Scene Management can verify a bot, discover a chat, and persist write-only credentials', async () => temporary(async (directory) => {
  const token = '123456:' + 'b'.repeat(35);
  const requests = [];
  const alerts = new TelegramAlerts(directory, { retryDelays: [0], fetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    const method = url.split('/').at(-1);
    const values = {
      getMe: { id: 123456, is_bot: true, first_name: 'Scene Access', username: 'SceneAccessAlertsBot' },
      getUpdates: [{ update_id: 1, message: { chat: { id: 987654321, type: 'private', first_name: 'Operator' } } }],
      getChat: { id: 987654321, type: 'private', first_name: 'Operator' },
      sendMessage: { message_id: 1 },
    };
    return { ok: true, status: 200, async json() { return { ok: true, result: values[method] }; } };
  } });
  const tokenState = await alerts.configureToken(token);
  assert.equal(tokenState.configured, false);
  assert.equal(tokenState.setup.bot.username, 'SceneAccessAlertsBot');
  assert.equal(JSON.stringify(tokenState).includes(token), false);
  assert.equal(fs.statSync(path.join(directory, 'scene-management', 'telegram-bot-token')).mode & 0o777, 0o600);
  const discovered = await alerts.discoverChats();
  assert.deepEqual(discovered.chats, [{ id: '987654321', title: 'Operator', type: 'private' }]);
  const connected = await alerts.configureChat(discovered.chats[0].id);
  assert.equal(connected.configured, true);
  assert.deepEqual(connected.setup.chat, { title: 'Operator', type: 'private' });
  assert.equal(JSON.stringify(connected).includes('987654321'), false);
  const restarted = new TelegramAlerts(directory, { retryDelays: [0], fetch: alerts.fetch });
  assert.equal(restarted.state().configured, true);
  assert.deepEqual(restarted.state().setup.chat, { title: 'Operator', type: 'private' });
  await restarted.test();
  assert.equal(requests.at(-1).body.chat_id, '987654321');
  restarted.updatePolicy({ ...DEFAULT_POLICY, enabled: true });
  const replaced = await restarted.configureToken(token);
  assert.equal(replaced.configured, false);
  assert.equal(replaced.policy.enabled, false);
  assert.equal(fs.existsSync(path.join(directory, 'scene-management', 'telegram-chat-id')), false);
  const disconnected = restarted.disconnect();
  assert.equal(disconnected.configured, false);
  assert.equal(disconnected.setup.bot, null);
}));

async function invokeJson(handler, method, url, body, headers = {}) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method;
  request.url = url;
  request.headers = headers;
  let status;
  let responseHeaders;
  let responseBody;
  const response = { writeHead(value, values) { status = value; responseHeaders = values; }, end(value) { responseBody = value; } };
  await handler(request, response);
  return { status, headers: responseHeaders, body: responseBody ? JSON.parse(responseBody) : null };
}

test('Scene Management exposes policy controls without exposing credentials', async () => temporary(async (directory) => {
  const security = new SecurityEvents(directory, noGeo);
  let policy = structuredClone(DEFAULT_POLICY);
  let tests = 0;
  const telegram = {
    state: () => ({ configured: true, active: policy.enabled, policy, pending: 0,
      delivery: { lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, lastTestAt: null } }),
    updatePolicy(value) { policy = validatePolicy(value); return this.state(); },
    async test() { tests += 1; return this.state(); },
    async configureToken() { return this.state(); },
    async discoverChats() { return { chats: [{ id: '123', title: 'Operator', type: 'private' }] }; },
    async configureChat() { return this.state(); },
    disconnect() { return this.state(); },
  };
  const handler = createSceneAdmin(directory, security, telegram);
  const headers = { 'x-scene-admin': 'owner', origin: 'http://localhost:8081',
    cookie: 'scene_csrf=' + 'a'.repeat(43), 'x-scene-csrf': 'a'.repeat(43) };
  const read = await invokeJson(handler, 'GET', '/api/security/telegram', undefined, { 'x-scene-admin': 'owner' });
  assert.equal(read.status, 200);
  assert.equal(read.body.configured, true);
  assert.equal(JSON.stringify(read.body).includes('token'), false);
  const updated = await invokeJson(handler, 'PUT', '/api/security/telegram', { ...DEFAULT_POLICY, enabled: true }, headers);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.active, true);
  const sent = await invokeJson(handler, 'POST', '/api/security/telegram/test', undefined, headers);
  assert.equal(sent.status, 200);
  assert.equal(tests, 1);
  const verified = await invokeJson(handler, 'POST', '/api/security/telegram/setup/token', { token: '123456:' + 'x'.repeat(35) }, headers);
  assert.equal(verified.status, 200);
  const chats = await invokeJson(handler, 'POST', '/api/security/telegram/setup/chats', undefined, headers);
  assert.equal(chats.status, 200);
  assert.equal(chats.body.chats[0].title, 'Operator');
  const connected = await invokeJson(handler, 'POST', '/api/security/telegram/setup/chat', { chatId: '123' }, headers);
  assert.equal(connected.status, 200);
  const disconnected = await invokeJson(handler, 'DELETE', '/api/security/telegram/setup', undefined, headers);
  assert.equal(disconnected.status, 200);
  assert.equal(security.list({ type: 'admin_action' }).length, 5);
}));

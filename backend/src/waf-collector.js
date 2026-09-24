'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { findingCategory, findingSeverity, messageCategory, ruleSummary } = require('./waf-rules');

const CORRELATION_RULES = new Set(['949110', '980130']);

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function safePath(uri) {
  let pathname = '/';
  try { pathname = new URL(String(uri || '/'), 'https://waf.invalid').pathname; } catch (_) { pathname = '/'; }
  return pathname.slice(0, 512).replace(/\b[A-Za-z0-9_-]{32,}\b/g, ':token').replace(/[\r\n]/g, '');
}

function safeTransactionId(value) {
  const raw = String(value || '').slice(0, 512);
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{1,128}$/.test(raw)) return raw;
  return crypto.createHash('sha256').update(raw).digest('base64url').slice(0, 43);
}

function normalizeAudit(value, observedAt = new Date(), historical = false) {
  const transaction = value?.transaction;
  if (!transaction || typeof transaction !== 'object') return null;
  const messages = Array.isArray(transaction.messages) ? transaction.messages : [];
  const actionable = messages.filter((message) => !CORRELATION_RULES.has(String(message?.details?.ruleId || '')));
  if (!actionable.length) return null;
  const category = findingCategory(actionable);
  const request = transaction.request && typeof transaction.request === 'object' ? transaction.request : {};
  const response = transaction.response && typeof transaction.response === 'object' ? transaction.response : {};
  const status = Number.isInteger(response.http_code) ? response.http_code : null;
  const interrupted = transaction.is_interrupted === true;
  const disposition = interrupted ? 'waf_blocked'
    : status === 429 ? 'origin_rate_limited'
      : status >= 400 && status < 500 ? 'origin_rejected'
        : status >= 200 && status < 400 ? 'observed_passed' : 'outcome_unknown';
  const severity = findingSeverity(actionable, category);
  const scores = messages.map((message) => /Total Score:\s*(\d+)/i.exec(String(message?.message || '')))
    .filter(Boolean).map((match) => Number(match[1])).filter(Number.isInteger);
  const sourceIp = net.isIP(transaction.client_ip) ? transaction.client_ip : 'unknown';
  const target = /^[A-Za-z0-9.-]{1,253}$/.test(request.hostname || '') ? request.hostname.toLowerCase() : null;
  const at = Number.isFinite(Date.parse(transaction.time_stamp || ''))
    ? new Date(transaction.time_stamp).toISOString() : observedAt.toISOString();
  const ruleIds = [...new Set(actionable.map((message) => String(message?.details?.ruleId || ''))
    .filter((rule) => /^\d{1,10}$/.test(rule)))];
  const uniqueId = safeTransactionId(transaction.unique_id);
  return {
    version: 1, source: 'waf', transactionId: uniqueId, at,
    severity, category, outcome: disposition, sourceIp,
    http: { method: String(request.method || '').slice(0, 12), path: safePath(request.uri), status,
      statusSource: 'modsecurity_audit' },
    edge: { target, disposition, ruleIds, ruleSummary: ruleSummary(ruleIds), anomalyScore: scores.length ? Math.max(...scores) : null,
      interrupted, statusVerified: interrupted, transactionId: uniqueId, historical: historical === true },
  };
}

function filesBelow(root, maximum = 100000) {
  const files = [];
  const pending = [root];
  while (pending.length && files.length < maximum) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name !== 'index.log') files.push(absolute);
      if (files.length >= maximum) break;
    }
  }
  return files.sort();
}

class WafCollector {
  constructor(auditRoot, outputFile, stateFile, options = {}) {
    this.auditRoot = auditRoot;
    this.outputFile = outputFile;
    this.stateFile = stateFile;
    this.now = options.now || (() => new Date());
    this.intervalMs = options.intervalMs || 2000;
    this.maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes
      : Math.min(1024 * 1024 * 1024, Math.max(1024 * 1024,
        Number.parseInt(process.env.WAF_EVENT_MAX_BYTES || String(64 * 1024 * 1024), 10) || 64 * 1024 * 1024));
    this.timer = null;
    try { this.state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) { this.state = {}; }
    this.processed = new Set(Array.isArray(this.state.processed) ? this.state.processed.slice(-50000) : []);
    this.initializing = this.state.initialized !== true;
  }

  scan() {
    let emitted = 0;
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true, mode: 0o700 });
    try {
      for (const file of filesBelow(this.auditRoot)) {
        const relative = path.relative(this.auditRoot, file);
        if (this.processed.has(relative)) continue;
        let value;
        try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { continue; }
        const event = normalizeAudit(value, this.now(), this.initializing);
        if (!event) { this.processed.add(relative); continue; }
        const line = JSON.stringify(event) + '\n';
        const currentBytes = fs.existsSync(this.outputFile) ? fs.statSync(this.outputFile).size : 0;
        if (currentBytes + Buffer.byteLength(line) > this.maxBytes) throw Object.assign(new Error('WAF event output limit reached'), { code: 'OUTPUT_LIMIT' });
        fs.appendFileSync(this.outputFile, line, { mode: 0o600 });
        this.processed.add(relative);
        emitted += 1;
        this.state.lastEventAt = event.at;
      }
      while (this.processed.size > 50000) this.processed.delete(this.processed.values().next().value);
      this.initializing = false;
      this.state = { version: 1, initialized: true, processed: [...this.processed], lastScanAt: this.now().toISOString(),
        lastEventAt: this.state.lastEventAt || null, lastError: null };
    } catch (error) {
      this.state = { version: 1, initialized: !this.initializing, processed: [...this.processed], lastScanAt: this.now().toISOString(),
        lastEventAt: this.state.lastEventAt || null, lastError: error.code || error.name || 'Error' };
    }
    atomicJson(this.stateFile, this.state);
    return emitted;
  }

  start(options = {}) {
    if (this.timer) return;
    this.scan();
    this.timer = setInterval(() => this.scan(), this.intervalMs);
    if (options.unref !== false) this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

if (require.main === module) {
  const root = process.env.WAF_AUDIT_ROOT || '/var/log/modsecurity/audit';
  const output = process.env.WAF_EVENT_OUTPUT || '/var/lib/waf-telemetry/events.jsonl';
  const state = process.env.WAF_COLLECTOR_STATE || '/var/lib/waf-telemetry/collector-state.json';
  const collector = new WafCollector(root, output, state);
  collector.start({ unref: false });
  console.log(JSON.stringify({ event: 'waf_collector_started', auditRoot: root }));
  const shutdown = () => { collector.stop(); process.exit(0); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = { WafCollector, messageCategory, normalizeAudit, safePath, safeTransactionId };

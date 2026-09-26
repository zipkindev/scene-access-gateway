'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { defaultHostRejection, findingCategory, findingSeverity, messageCategory, ruleSummary,
  pathFinding, serviceEnumeration } = require('./waf-rules');

const CORRELATION_RULES = new Set(['949110', '980130']);
const ACCESS_LOG_NAME = 'waf-access.jsonl';
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

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

function accessOutcome(value) {
  if (!value || typeof value !== 'object' || !REQUEST_ID.test(String(value.request_id || ''))
    || !net.isIP(String(value.remote_addr || '')) || !Number.isInteger(value.status)
    || value.status < 100 || value.status > 599) return null;
  const upstreamMatch = /(?:^|,\s*)([1-5][0-9]{2})(?:$|,)/.exec(String(value.upstream_status || ''));
  const upstreamStatus = upstreamMatch ? Number(upstreamMatch[1]) : null;
  const at = Number.isFinite(Date.parse(value.time || ''))
    ? new Date(value.time).toISOString() : new Date().toISOString();
  return {
    transactionId: String(value.request_id), at, sourceIp: String(value.remote_addr),
    http: { method: String(value.method || '').slice(0, 12), path: safePath(value.uri),
      status: value.status, statusSource: 'edge_access', upstreamStatus },
    edge: { target: /^[A-Za-z0-9.-]{1,253}$/.test(value.host || '')
      ? String(value.host).toLowerCase() : null,
      statusVerified: true, originReached: upstreamStatus !== null },
  };
}

function finalDisposition(status, originReached, interrupted = false) {
  if (interrupted) return 'waf_blocked';
  if (!originReached) return 'edge_rejected';
  if (status === 429) return 'origin_rate_limited';
  if (status >= 500) return 'origin_error';
  if (status >= 400) return 'origin_rejected';
  return 'observed_passed';
}

function correlateAudit(event, access) {
  if (!event || !access || event.transactionId !== access.transactionId) return event;
  const auditStatus = event.http.statusSource === 'modsecurity_audit' && Number.isInteger(event.http.status)
    ? event.http.status : event.http.auditStatus;
  const interrupted = event.edge.interrupted === true;
  const disposition = finalDisposition(access.http.status,
    interrupted ? false : access.edge.originReached, interrupted);
  event.http = { ...event.http, status: access.http.status, statusSource: 'edge_access',
    auditStatus: Number.isInteger(auditStatus) ? auditStatus : null,
    upstreamStatus: access.http.upstreamStatus };
  event.edge = { ...event.edge, disposition, statusVerified: true,
    originReached: interrupted ? false : access.edge.originReached };
  event.outcome = disposition;
  event.requestId = access.transactionId;
  return event;
}

function outcomeEvent(access) {
  const disposition = finalDisposition(access.http.status, access.edge.originReached);
  return { version: 1, source: 'waf_outcome', transactionId: access.transactionId,
    requestId: access.transactionId, at: access.at, sourceIp: access.sourceIp,
    http: { ...access.http }, edge: { ...access.edge, disposition,
      transactionId: access.transactionId }, outcome: disposition };
}

function normalizeAudit(value, observedAt = new Date(), historical = false) {
  const transaction = value?.transaction;
  if (!transaction || typeof transaction !== 'object') return null;
  const messages = Array.isArray(transaction.messages) ? transaction.messages : [];
  const actionable = messages.filter((message) => !CORRELATION_RULES.has(String(message?.details?.ruleId || '')));
  if (!actionable.length) return null;
  const request = transaction.request && typeof transaction.request === 'object' ? transaction.request : {};
  const response = transaction.response && typeof transaction.response === 'object' ? transaction.response : {};
  const auditStatus = Number.isInteger(response.http_code) ? response.http_code : null;
  const interrupted = transaction.is_interrupted === true;
  const scores = messages.map((message) => /Total Score:\s*(\d+)/i.exec(String(message?.message || '')))
    .filter(Boolean).map((match) => Number(match[1])).filter(Number.isInteger);
  const sourceIp = net.isIP(transaction.client_ip) ? transaction.client_ip : 'unknown';
  const target = /^[A-Za-z0-9.-]{1,253}$/.test(request.hostname || '') ? request.hostname.toLowerCase() : null;
  const pathname = safePath(request.uri);
  const at = Number.isFinite(Date.parse(transaction.time_stamp || ''))
    ? new Date(transaction.time_stamp).toISOString() : observedAt.toISOString();
  const ruleIds = [...new Set(actionable.map((message) => String(message?.details?.ruleId || ''))
    .filter((rule) => /^\d{1,10}$/.test(rule)))];
  const edgeRejected = defaultHostRejection(target, ruleIds);
  const behaviorSummary = serviceEnumeration(pathname, target, ruleIds);
  const pathMatch = pathFinding(pathname);
  const category = behaviorSummary ? 'service_enumeration'
    : pathMatch?.category || findingCategory(actionable);
  const severity = behaviorSummary ? 'warning'
    : pathMatch?.severity || findingSeverity(actionable, category);
  const disposition = interrupted ? 'waf_blocked' : edgeRejected ? 'edge_rejected' : 'outcome_unknown';
  const status = edgeRejected ? 444 : auditStatus;
  const uniqueId = safeTransactionId(transaction.unique_id);
  return {
    version: 1, source: 'waf', transactionId: uniqueId, at,
    severity, category, outcome: disposition, sourceIp,
    http: { method: String(request.method || '').slice(0, 12), path: pathname, status,
      statusSource: edgeRejected ? 'edge_policy' : 'modsecurity_audit',
      auditStatus: edgeRejected ? auditStatus : null },
    edge: { target, disposition, ruleIds, ruleSummary: ruleSummary(ruleIds),
      behaviorSummary: behaviorSummary || pathMatch?.summary || null,
      anomalyScore: scores.length ? Math.max(...scores) : null,
      interrupted, statusVerified: interrupted || edgeRejected,
      originReached: interrupted || edgeRejected ? false : null, transactionId: uniqueId,
      historical: historical === true },
  };
}

function filesBelow(root, maximum = 100000, excluded = new Set()) {
  const files = [];
  const pending = [root];
  while (pending.length && files.length < maximum) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name !== 'index.log' && !excluded.has(absolute)) files.push(absolute);
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
    this.accessLog = options.accessLog || process.env.WAF_ACCESS_LOG || path.join(auditRoot, ACCESS_LOG_NAME);
    this.graceMs = Number.isInteger(options.graceMs) ? options.graceMs : 10000;
    this.maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes
      : Math.min(1024 * 1024 * 1024, Math.max(1024 * 1024,
        Number.parseInt(process.env.WAF_EVENT_MAX_BYTES || String(64 * 1024 * 1024), 10) || 64 * 1024 * 1024));
    this.timer = null;
    try { this.state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_) { this.state = {}; }
    this.processed = new Set(Array.isArray(this.state.processed) ? this.state.processed.slice(-50000) : []);
    this.pending = new Map(Array.isArray(this.state.pending)
      ? this.state.pending.filter((item) => item?.event?.transactionId).map((item) => [item.event.transactionId, item]) : []);
    this.access = new Map(Array.isArray(this.state.access)
      ? this.state.access.filter((item) => item?.transactionId).map((item) => [item.transactionId, item]) : []);
    this.emitted = new Set(Array.isArray(this.state.emitted) ? this.state.emitted.slice(-20000) : []);
    this.corrected = new Set(Array.isArray(this.state.corrected) ? this.state.corrected.slice(-20000) : []);
    this.accessOffset = Number.isInteger(this.state.accessOffset) && this.state.accessOffset >= 0
      ? this.state.accessOffset : 0;
    this.initializing = this.state.initialized !== true;
    if (!this.emitted.size && this.processed.size) this._recoverEmittedIds();
  }

  _recoverEmittedIds() {
    for (const relative of this.processed) {
      const file = path.join(this.auditRoot, relative);
      if (file === this.accessLog) continue;
      try {
        const event = normalizeAudit(JSON.parse(fs.readFileSync(file, 'utf8')), this.now(), true);
        if (event?.transactionId) this.emitted.add(event.transactionId);
      } catch (_) { /* retained state can outlive rotated audits */ }
      if (this.emitted.size >= 20000) break;
    }
  }

  _append(event) {
    const line = JSON.stringify(event) + '\n';
    const currentBytes = fs.existsSync(this.outputFile) ? fs.statSync(this.outputFile).size : 0;
    if (currentBytes + Buffer.byteLength(line) > this.maxBytes) {
      throw Object.assign(new Error('WAF event output limit reached'), { code: 'OUTPUT_LIMIT' });
    }
    fs.appendFileSync(this.outputFile, line, { mode: 0o600 });
    this.state.lastEventAt = event.at;
  }

  _readAccess() {
    if (!fs.existsSync(this.accessLog)) return 0;
    const stat = fs.statSync(this.accessLog);
    if (!stat.isFile()) throw new Error('WAF correlation log is not a file');
    if (stat.size < this.accessOffset) this.accessOffset = 0;
    if (stat.size === this.accessOffset) return 0;
    const descriptor = fs.openSync(this.accessLog, 'r');
    const length = Math.min(16 * 1024 * 1024, stat.size - this.accessOffset);
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, this.accessOffset);
    fs.closeSync(descriptor);
    const text = buffer.toString('utf8');
    const complete = text.endsWith('\n');
    const lines = text.split('\n');
    if (!complete) lines.pop();
    const consumed = complete ? Buffer.byteLength(text)
      : Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1));
    let emitted = 0;
    for (const line of lines.filter(Boolean)) {
      let access;
      try { access = accessOutcome(JSON.parse(line)); } catch (_) { access = null; }
      if (!access) continue;
      this.access.set(access.transactionId, access);
      const pending = this.pending.get(access.transactionId);
      if (pending) {
        this._append(correlateAudit(pending.event, access));
        this.pending.delete(access.transactionId);
        this.emitted.add(access.transactionId);
        emitted += 1;
      } else if (this.emitted.has(access.transactionId) && !this.corrected.has(access.transactionId)) {
        this._append(outcomeEvent(access));
        this.corrected.add(access.transactionId);
        emitted += 1;
      }
    }
    this.accessOffset += consumed;
    return emitted;
  }

  scan() {
    let emitted = 0;
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true, mode: 0o700 });
    try {
      emitted += this._readAccess();
      for (const file of filesBelow(this.auditRoot, 100000, new Set([this.accessLog]))) {
        const relative = path.relative(this.auditRoot, file);
        if (this.processed.has(relative)) continue;
        let value;
        try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { continue; }
        const event = normalizeAudit(value, this.now(), this.initializing);
        if (!event) { this.processed.add(relative); continue; }
        this.processed.add(relative);
        const access = event.transactionId ? this.access.get(event.transactionId) : null;
        if (access) {
          this._append(correlateAudit(event, access));
          this.emitted.add(event.transactionId);
          emitted += 1;
        } else if (event.transactionId) this.pending.set(event.transactionId,
          { firstSeenAt: this.now().toISOString(), event });
        else { this._append(event); emitted += 1; }
      }
      const cutoff = this.now().getTime() - this.graceMs;
      for (const [id, pending] of this.pending) {
        if (Date.parse(pending.firstSeenAt) > cutoff) continue;
        this._append(pending.event);
        this.pending.delete(id);
        this.emitted.add(id);
        emitted += 1;
      }
      while (this.processed.size > 50000) this.processed.delete(this.processed.values().next().value);
      while (this.pending.size > 5000) {
        const id = this.pending.keys().next().value;
        this._append(this.pending.get(id).event);
        this.pending.delete(id);
        this.emitted.add(id);
        emitted += 1;
      }
      while (this.access.size > 20000) this.access.delete(this.access.keys().next().value);
      while (this.emitted.size > 20000) this.emitted.delete(this.emitted.values().next().value);
      while (this.corrected.size > 20000) this.corrected.delete(this.corrected.values().next().value);
      this.initializing = false;
      this.state = { version: 2, initialized: true, processed: [...this.processed],
        pending: [...this.pending.values()].slice(-5000), access: [...this.access.values()].slice(-20000),
        emitted: [...this.emitted], corrected: [...this.corrected], accessOffset: this.accessOffset,
        lastScanAt: this.now().toISOString(),
        lastEventAt: this.state.lastEventAt || null, lastError: null };
    } catch (error) {
      this.state = { ...this.state, version: 2, initialized: !this.initializing,
        processed: [...this.processed], pending: [...this.pending.values()].slice(-5000),
        access: [...this.access.values()].slice(-20000), emitted: [...this.emitted],
        corrected: [...this.corrected], accessOffset: this.accessOffset, lastScanAt: this.now().toISOString(),
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
  const collector = new WafCollector(root, output, state, { accessLog: process.env.WAF_ACCESS_LOG });
  collector.start({ unref: false });
  console.log(JSON.stringify({ event: 'waf_collector_started', auditRoot: root }));
  const shutdown = () => { collector.stop(); process.exit(0); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = { WafCollector, accessOutcome, correlateAudit, finalDisposition,
  messageCategory, normalizeAudit, outcomeEvent, safePath, safeTransactionId };

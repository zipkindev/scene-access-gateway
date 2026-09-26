'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const CATEGORIES = new Set([
  'sql_injection_probe', 'command_injection_probe', 'cross_site_scripting_probe', 'path_traversal_probe',
  'automated_scanner_probe', 'sensitive_file_enumeration', 'backup_file_probe',
  'framework_admin_probe', 'known_scanner', 'service_enumeration', 'application_error_exposure',
  'unexpected_http_method', 'protocol_anomaly',
]);
const DISPOSITIONS = new Set([
  'observed_passed', 'origin_rejected', 'origin_rate_limited', 'waf_blocked',
  'edge_rejected', 'origin_error', 'outcome_unknown',
]);

function expectedDisposition(value) {
  if (value.edge.interrupted === true) return 'waf_blocked';
  if (value.edge.originReached === false) return 'edge_rejected';
  if (value.http.status === 429) return 'origin_rate_limited';
  if (value.http.status >= 500) return 'origin_error';
  if (value.http.status >= 400) return 'origin_rejected';
  return 'observed_passed';
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function validate(value) {
  const outcomeOnly = value?.source === 'waf_outcome';
  if (!value || value.version !== 1 || !['waf', 'waf_outcome'].includes(value.source)
    || !outcomeOnly && (!['info', 'warning', 'critical'].includes(value.severity)
      || !CATEGORIES.has(value.category)) || !DISPOSITIONS.has(value.outcome)
    || !value.http || typeof value.http !== 'object' || !value.edge || typeof value.edge !== 'object'
    || value.http.statusSource !== undefined && !['modsecurity_audit', 'edge_policy', 'edge_access'].includes(value.http.statusSource)
    || value.http.auditStatus !== undefined && value.http.auditStatus !== null && !Number.isInteger(value.http.auditStatus)
    || value.http.upstreamStatus !== undefined && value.http.upstreamStatus !== null
      && !Number.isInteger(value.http.upstreamStatus)
    || value.edge.statusVerified !== undefined && typeof value.edge.statusVerified !== 'boolean'
    || value.edge.correlationStatus !== undefined
      && !['pending', 'verified', 'unavailable'].includes(value.edge.correlationStatus)
    || value.edge.originReached !== undefined && value.edge.originReached !== null
      && typeof value.edge.originReached !== 'boolean'
    || typeof value.edge.originReached === 'boolean' && value.edge.statusVerified !== true
    || value.outcome !== value.edge.disposition
    || value.edge.statusVerified === true
      && !(value.edge.interrupted === true && value.edge.disposition === 'waf_blocked'
        && value.edge.originReached === false)
      && !(value.edge.interrupted !== true && value.http.statusSource === 'edge_policy'
        && value.http.status === 444 && value.edge.originReached === false
        && value.edge.disposition === 'edge_rejected' && net.isIP(value.edge.target || '')
        && value.edge.ruleIds?.map(String).includes('920350'))
      && !(value.http.statusSource === 'edge_access' && Number.isInteger(value.http.status)
        && value.edge.disposition === expectedDisposition(value))
    || !Number.isFinite(Date.parse(value.at || '')) || Date.parse(value.at) > Date.now() + 5 * 60 * 1000
    || typeof value.sourceIp !== 'string' || value.sourceIp.length > 64
    || value.transactionId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(value.transactionId || '')
    || outcomeOnly && (value.http.statusSource !== 'edge_access' || value.edge.statusVerified !== true
      || typeof value.edge.originReached !== 'boolean')) {
    throw new Error('Invalid WAF telemetry event');
  }
  return value;
}

class WafIngestor {
  constructor(inputFile, securityEvents, dataDirectory, options = {}) {
    this.inputFile = inputFile;
    this.securityEvents = securityEvents;
    this.stateFile = path.join(dataDirectory, 'scene-management', 'waf-ingest-status.json');
    this.intervalMs = options.intervalMs || 2000;
    this.mode = ['DetectionOnly', 'On'].includes(options.mode) ? options.mode : 'DetectionOnly';
    this.timer = null;
    try { this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch (_) { this.state = {}; }
    this.offset = Number.isInteger(this.state.offset) && this.state.offset >= 0 ? this.state.offset : 0;
    this.ids = new Set(Array.isArray(this.state.ids) ? this.state.ids.slice(-20000) : []);
  }

  status() {
    return { configured: Boolean(this.inputFile), mode: this.mode, inputAvailable: Boolean(this.inputFile && fs.existsSync(this.inputFile)),
      lastPollAt: this.state.lastPollAt || null, lastEventAt: this.state.lastEventAt || null,
      lastError: this.state.lastError || null, ingested: this.state.ingested || 0,
      rejected: this.state.rejected || 0 };
  }

  poll() {
    if (!this.inputFile) return 0;
    let ingested = 0;
    let rejected = this.state.rejected || 0;
    try {
      const stat = fs.statSync(this.inputFile);
      if (!stat.isFile()) throw new Error('WAF telemetry input is not a file');
      if (stat.size < this.offset) this.offset = 0;
      if (stat.size > this.offset) {
        const descriptor = fs.openSync(this.inputFile, 'r');
        const length = Math.min(4 * 1024 * 1024, stat.size - this.offset);
        const buffer = Buffer.alloc(length);
        fs.readSync(descriptor, buffer, 0, length, this.offset);
        fs.closeSync(descriptor);
        const text = buffer.toString('utf8');
        const complete = text.endsWith('\n');
        const lines = text.split('\n');
        if (!complete) lines.pop();
        const consumed = complete ? Buffer.byteLength(text) : Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1));
        for (const line of lines.filter(Boolean)) {
          try {
            const event = validate(JSON.parse(line));
            const correlation = event.transactionId || crypto.createHash('sha256').update(JSON.stringify([
              event.at, event.sourceIp, event.http.method, event.http.path, event.category,
            ])).digest('base64url').slice(0, 32);
            const identity = event.source === 'waf_outcome' ? `outcome:${correlation}`
              : `${correlation}:${event.category}`;
            if (this.ids.has(identity)) continue;
            const recorded = event.source === 'waf_outcome'
              ? this.securityEvents.record('waf_outcome', { at: event.at, ip: event.sourceIp,
                severity: 'info', outcome: event.outcome, requestId: event.requestId,
                http: event.http, edge: event.edge })
              : this.securityEvents.record('waf_finding', { at: event.at, ip: event.sourceIp,
                severity: event.severity, category: event.category, outcome: event.outcome,
                requestId: event.requestId || event.transactionId,
                http: event.http, edge: { ...event.edge, mode: this.mode } });
            if (!recorded) { rejected += 1; continue; }
            this.ids.add(identity);
            ingested += 1;
            this.state.lastEventAt = event.at;
          } catch (_) { rejected += 1; }
        }
        this.offset += consumed;
      }
      while (this.ids.size > 20000) this.ids.delete(this.ids.values().next().value);
      this.state = { version: 1, offset: this.offset, ids: [...this.ids],
        lastPollAt: new Date().toISOString(), lastEventAt: this.state.lastEventAt || null,
        lastError: null, ingested: (this.state.ingested || 0) + ingested, rejected };
    } catch (error) {
      this.state = { ...this.state, version: 1, offset: this.offset, ids: [...this.ids],
        lastPollAt: new Date().toISOString(), lastError: error.code || error.name || 'Error', rejected };
    }
    atomicJson(this.stateFile, this.state);
    return ingested;
  }

  start() {
    if (!this.inputFile || this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { WafIngestor, validate };

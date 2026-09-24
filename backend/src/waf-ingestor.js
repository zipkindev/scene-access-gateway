'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = new Set([
  'sql_injection_probe', 'command_injection_probe', 'path_traversal_probe',
  'automated_scanner_probe', 'sensitive_file_enumeration', 'backup_file_probe',
  'framework_admin_probe', 'known_scanner', 'protocol_anomaly',
]);
const DISPOSITIONS = new Set([
  'observed_passed', 'origin_rejected', 'origin_rate_limited', 'waf_blocked',
  'edge_rejected', 'outcome_unknown',
]);

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function validate(value) {
  if (!value || value.version !== 1 || value.source !== 'waf'
    || !['info', 'warning', 'critical'].includes(value.severity)
    || !CATEGORIES.has(value.category) || !DISPOSITIONS.has(value.outcome)
    || !value.http || typeof value.http !== 'object' || !value.edge || typeof value.edge !== 'object'
    || !Number.isFinite(Date.parse(value.at || '')) || Date.parse(value.at) > Date.now() + 5 * 60 * 1000
    || typeof value.sourceIp !== 'string' || value.sourceIp.length > 64
    || value.transactionId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(value.transactionId || '')) {
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
            const identity = `${correlation}:${event.category}`;
            if (this.ids.has(identity)) continue;
            const recorded = this.securityEvents.record('waf_finding', { at: event.at, ip: event.sourceIp,
              severity: event.severity, category: event.category, outcome: event.outcome,
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

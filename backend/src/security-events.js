'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const LEVELS = new Set(['info', 'warning', 'critical']);
const TYPES = new Set([
  'portal_visit', 'qr_login_page_opened', 'qr_login_attempt', 'qr_email_delivery',
  'qr_verified', 'portal_session_created', 'access_request', 'rate_limited',
  'request_rejected', 'suspicious_request', 'waf_finding', 'admin_action',
]);
const CATEGORIES = new Set([
  'sql_injection_probe', 'command_injection_probe', 'path_traversal_probe',
  'automated_scanner_probe', 'unexpected_http_method', 'invalid_content_length',
  'sensitive_file_enumeration', 'backup_file_probe', 'framework_admin_probe',
  'known_scanner', 'protocol_anomaly', 'rate_limiting', 'integrity_failure',
]);
const TOKEN = /\b[A-Za-z0-9_-]{43}\b/g;
const SQL = /(?:\bunion\s+(?:all\s+)?select\b|\binformation_schema\b|\b(?:sleep|benchmark)\s*\(|\bwaitfor\s+delay\b|(?:'|%27)\s*(?:or|and)\s+['"%\d])/i;
const TRAVERSAL = /(?:\.\.\/|\.\.\\|%2e%2e(?:%2f|%5c)|\/etc\/passwd|\/proc\/self)/i;
const COMMAND = /(?:\$\(|`[^`]{0,120}`|(?:;|%3b|\||%7c)\s*(?:cat|curl|wget|sh|bash|nc|python|perl)\b)/i;
const SENSITIVE = /(?:^|\/)(?:\.env(?:[._~-][^/]*)?|\.git(?:-credentials|-askpass\.sh|-secret|config|ignore|modules)?|\.ssh|\.aws|\.kube\/config|\.docker\/(?:config|secrets)\.json|\.config\/(?:gcloud|anthropic)|\.terraform\/terraform\.tfstate|wp-config\.php|settings\.ini|\.boto|\.esmtprc|\.msmtprc|\.amplifyrc|\.claude\/settings\.json)(?:\/|$)/i;
const BACKUP = /(?:^|\/)[^/]{1,180}(?:\.bak|\.backup|\.old|\.orig|\.save|\.swp|~)(?:\/|$)/i;
const FRAMEWORK = /(?:^|\/)(?:wp-admin|wp-login\.php|phpmyadmin|server-status|actuator|vendor\/phpunit|_profiler\/phpinfo(?:\.php)?)(?:\/|$)/i;
const REQUEST_ID = /^[0-9a-f-]{36}$/;

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function safePath(pathname) {
  return String(pathname || '/').slice(0, 512).replace(TOKEN, ':token').replace(/[\r\n]/g, '');
}

function sourceIp(request) {
  const value = request.headers['x-portal-source-ip'];
  return typeof value === 'string' && net.isIP(value) ? value : 'unknown';
}

function classifyRequest(request, url) {
  const sample = safeDecode(`${url.pathname}${url.search}`.slice(0, 2048));
  const findings = [];
  if (SQL.test(sample)) findings.push({ category: 'sql_injection_probe', severity: 'critical' });
  if (TRAVERSAL.test(sample)) findings.push({ category: 'path_traversal_probe', severity: 'critical' });
  if (COMMAND.test(sample)) findings.push({ category: 'command_injection_probe', severity: 'critical' });
  if (SENSITIVE.test(url.pathname)) findings.push({ category: 'sensitive_file_enumeration', severity: 'critical' });
  else if (BACKUP.test(url.pathname)) findings.push({ category: 'backup_file_probe', severity: 'warning' });
  else if (FRAMEWORK.test(url.pathname)) findings.push({ category: 'framework_admin_probe', severity: 'warning' });
  if (!['GET', 'HEAD', 'POST'].includes(request.method || '')) findings.push({ category: 'unexpected_http_method', severity: 'warning' });
  if (String(request.headers['content-length'] || '').length > 12) findings.push({ category: 'invalid_content_length', severity: 'warning' });
  return findings;
}

function selected(value, allowed, label) {
  const values = (Array.isArray(value) ? value : value ? [value] : []).map(String);
  if (values.length > 16 || values.some((item) => !allowed.has(item))) throw new Error(`Invalid ${label} filter`);
  return new Set(values);
}

function sourceBlockList(value) {
  const values = (Array.isArray(value) ? value : value ? [value] : []).map(String);
  if (values.length > 16) throw new Error('Invalid source filter');
  const block = new net.BlockList();
  for (const item of values) {
    if (net.isIP(item)) {
      block.addAddress(item, net.isIP(item) === 4 ? 'ipv4' : 'ipv6');
      continue;
    }
    const match = /^(.+)\/(\d{1,3})$/.exec(item);
    const version = match ? net.isIP(match[1]) : 0;
    const prefix = match ? Number(match[2]) : -1;
    if (!version || prefix < 0 || prefix > (version === 4 ? 32 : 128)) throw new Error('Invalid source filter');
    block.addSubnet(match[1], prefix, version === 4 ? 'ipv4' : 'ipv6');
  }
  return { block, count: values.length };
}

function effectiveCategory(event) {
  if (event.integrityValid === false) return 'integrity_failure';
  if (CATEGORIES.has(event.category)) return event.category;
  if (event.type === 'rate_limited') return 'rate_limiting';
  return null;
}

class SecurityEvents {
  constructor(directory, geoip, options = {}) {
    this.directory = path.join(directory, 'security-events');
    this.keyFile = path.join(this.directory, '.integrity-key');
    this.geoip = geoip;
    this.retentionDays = Number.isInteger(options.retentionDays) ? options.retentionDays
      : Math.min(365, Math.max(1, Number.parseInt(process.env.SECURITY_EVENT_RETENTION_DAYS || '30', 10) || 30));
    this.maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes
      : Math.min(1024 * 1024 * 1024, Math.max(1024 * 1024,
        Number.parseInt(process.env.SECURITY_EVENT_MAX_BYTES || String(64 * 1024 * 1024), 10) || 64 * 1024 * 1024));
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.keyFile)) fs.writeFileSync(this.keyFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = fs.readFileSync(this.keyFile);
    if (this.key.length !== 32) throw new Error('Invalid security-event integrity key');
    this.lastCleanup = 0;
    this.totalBytes = 0;
    this.storageLimited = false;
    this.buckets = new Map();
    this.listeners = new Set();
    this.suppressed = 0;
    this.asyncWrites = options.asyncWrites === true;
    this.pendingBytes = 0;
    this.writeQueue = [];
    this.writing = false;
    this.flushWaiters = [];
    this.cleanup();
  }

  _files() {
    return fs.readdirSync(this.directory).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  }

  cleanup(now = Date.now()) {
    if (now - this.lastCleanup < 60 * 60 * 1000) return;
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const name of this._files()) {
      const date = Date.parse(name.slice(0, 10) + 'T00:00:00.000Z');
      if (Number.isFinite(date) && date < cutoff) fs.unlinkSync(path.join(this.directory, name));
    }
    const remaining = this._files();
    this.totalBytes = remaining.reduce((total, name) => total + fs.statSync(path.join(this.directory, name)).size, 0);
    while (this.totalBytes > this.maxBytes * 0.9 && remaining.length > 1) {
      const oldest = remaining.shift();
      this.totalBytes -= fs.statSync(path.join(this.directory, oldest)).size;
      fs.unlinkSync(path.join(this.directory, oldest));
    }
    this.storageLimited = this.totalBytes >= this.maxBytes;
    this.lastCleanup = now;
  }

  _hash(value) { return crypto.createHmac('sha256', this.key).update(String(value)).digest('base64url'); }

  _committed(event, bytes) {
    this.totalBytes += bytes;
    console.log(JSON.stringify({ event: 'security_event', id: event.id, type: event.type,
      severity: event.severity, outcome: event.outcome, category: event.category }));
    this.cleanup();
    for (const listener of this.listeners) {
      try { listener({ ...event, integrityValid: true }); } catch (_) { /* alert delivery is isolated */ }
    }
  }

  _resolveFlushes() {
    if (this.writing || this.writeQueue.length) return;
    for (const resolve of this.flushWaiters.splice(0)) resolve();
  }

  _drainWrites() {
    if (this.writing || !this.writeQueue.length) return this._resolveFlushes();
    this.writing = true;
    const item = this.writeQueue.shift();
    fs.appendFile(item.file, item.line, { mode: 0o600 }, (error) => {
      this.pendingBytes -= item.bytes;
      this.writing = false;
      if (error) {
        this.suppressed += 1;
        console.error(JSON.stringify({ event: 'security_event_write_failed', type: item.event.type,
          error: error.code || error.name || 'Error' }));
      } else this._committed(item.event, item.bytes);
      this._drainWrites();
    });
  }

  flush() {
    if (!this.asyncWrites || (!this.writing && !this.writeQueue.length)) return Promise.resolve();
    return new Promise((resolve) => this.flushWaiters.push(resolve));
  }

  _admit(ip, severity, now = Date.now(), sourceMaximum = null) {
    const window = Math.floor(now / 60000);
    for (const [key, value] of this.buckets) if (value.window < window) this.buckets.delete(key);
    const update = (key, maximum) => {
      const current = this.buckets.get(key);
      const value = current?.window === window ? current : { window, count: 0 };
      if (value.count >= maximum) return false;
      value.count += 1;
      this.buckets.set(key, value);
      return true;
    };
    return update('global', 3000) && update(`${ip}\0${severity}`,
      sourceMaximum || (severity === 'info' ? 60 : 120));
  }

  record(type, data = {}) {
    if (!TYPES.has(type)) throw new Error('Invalid security event type');
    const severity = LEVELS.has(data.severity) ? data.severity : 'info';
    const ip = typeof data.ip === 'string' && net.isIP(data.ip) ? data.ip : 'unknown';
    if (!this._admit(ip, severity, Date.now(), type === 'waf_finding' ? 1000 : null)) {
      this.suppressed += 1;
      return null;
    }
    const suppliedAt = type === 'waf_finding' && Number.isFinite(Date.parse(data.at || '')) ? Date.parse(data.at) : NaN;
    const at = Number.isFinite(suppliedAt) && suppliedAt <= Date.now() + 5 * 60 * 1000
      ? new Date(suppliedAt).toISOString() : new Date().toISOString();
    const suppliedHttp = type === 'waf_finding' && data.http && typeof data.http === 'object' ? data.http : null;
    const event = {
      version: 1, id: crypto.randomUUID(), at, type, severity,
      outcome: typeof data.outcome === 'string' ? data.outcome.slice(0, 80) : null,
      reason: typeof data.reason === 'string' ? data.reason.slice(0, 120) : null,
      destination: ['torrentharbor', 'firewall', 'unknown'].includes(data.destination) ? data.destination : null,
      source: { ip, ...this.geoip.lookup(ip) },
      http: data.request ? {
        method: String(data.request.method || '').slice(0, 12),
        path: safePath(data.pathname || data.request.url),
        status: Number.isInteger(data.status) ? data.status : null,
        agentHash: this._hash(String(data.request.headers['user-agent'] || '').slice(0, 512)),
      } : suppliedHttp ? {
        method: String(suppliedHttp.method || '').slice(0, 12),
        path: safePath(String(suppliedHttp.path || '/').split('?')[0]),
        status: Number.isInteger(suppliedHttp.status) ? suppliedHttp.status : null,
        agentHash: null,
      } : null,
      identityHash: data.identity ? this._hash(String(data.identity).trim().toLowerCase()) : null,
      requestId: REQUEST_ID.test(data.requestId || '') ? data.requestId : null,
      category: typeof data.category === 'string' ? data.category.slice(0, 80) : null,
      edge: data.edge && typeof data.edge === 'object' ? {
        target: /^[A-Za-z0-9.-]{1,253}$/.test(data.edge.target || '') ? data.edge.target.toLowerCase() : null,
        disposition: ['observed_passed', 'origin_rejected', 'origin_rate_limited', 'waf_blocked',
          'edge_rejected', 'outcome_unknown'].includes(data.edge.disposition) ? data.edge.disposition : 'outcome_unknown',
        ruleIds: Array.isArray(data.edge.ruleIds) ? [...new Set(data.edge.ruleIds.filter((value) => /^\d{1,10}$/.test(String(value))).map(String))].slice(0, 32) : [],
        anomalyScore: Number.isInteger(data.edge.anomalyScore) && data.edge.anomalyScore >= 0 && data.edge.anomalyScore <= 1000
          ? data.edge.anomalyScore : null,
        interrupted: data.edge.interrupted === true,
        transactionId: /^[A-Za-z0-9_-]{1,128}$/.test(data.edge.transactionId || '')
          ? data.edge.transactionId : null,
        historical: data.edge.historical === true,
      } : null,
    };
    const canonical = JSON.stringify(event);
    event.integrity = this._hash(canonical);
    const line = JSON.stringify(event) + '\n';
    const bytes = Buffer.byteLength(line);
    if (this.totalBytes + this.pendingBytes + bytes > this.maxBytes) {
      this.storageLimited = true;
      this.suppressed += 1;
      return null;
    }
    const file = path.join(this.directory, at.slice(0, 10) + '.jsonl');
    if (this.asyncWrites) {
      this.pendingBytes += bytes;
      this.writeQueue.push({ file, line, bytes, event });
      this._drainWrites();
    } else {
      fs.appendFileSync(file, line, { mode: 0o600 });
      this._committed(event, bytes);
    }
    return event;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('Invalid security event listener');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recordRequestFindings(request, url, status = null) {
    const ip = sourceIp(request);
    return classifyRequest(request, url).map((finding) => this.record('suspicious_request', {
      ...finding, request, pathname: url.pathname, ip, outcome: 'observed',
      status: Number.isInteger(status) ? status : null,
      requestId: REQUEST_ID.test(request.securityRequestId || '') ? request.securityRequestId : null,
    }));
  }

  list(options = {}) {
    const limit = Math.min(250, Math.max(1, Number.parseInt(options.limit || '100', 10) || 100));
    const severities = selected(options.severity, LEVELS, 'severity');
    const streams = selected(options.stream, new Set(['application', 'waf']), 'stream');
    const types = selected(options.type, TYPES, 'event type');
    const categories = selected(options.category, CATEGORIES, 'category');
    const countries = selected(options.country, new Set((Array.isArray(options.country) ? options.country
      : options.country ? [options.country] : []).filter((item) => /^[A-Z]{2}$/.test(item))), 'country');
    const sources = sourceBlockList(options.source);
    const since = Number.isFinite(Date.parse(options.since || '')) ? Date.parse(options.since) : 0;
    const events = [];
    for (const name of this._files().reverse()) {
      const lines = fs.readFileSync(path.join(this.directory, name), 'utf8').trim().split('\n').filter(Boolean).reverse();
      for (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch (_) { continue; }
        if (Date.parse(event.at) < since) continue;
        const integrity = event.integrity;
        const canonical = { ...event };
        delete canonical.integrity;
        const supplied = Buffer.from(typeof integrity === 'string' ? integrity : '');
        const expected = Buffer.from(this._hash(JSON.stringify(canonical)));
        event.integrityValid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
        delete event.integrity;
        if (event.source?.scope === 'public' && !event.source.country) {
          const enriched = this.geoip.lookup(event.source.ip);
          event.source = { ...event.source, ...Object.fromEntries(Object.entries(enriched)
            .filter(([, value]) => value !== null && value !== undefined)) };
        }
        const category = effectiveCategory(event);
        const sourceVersion = net.isIP(event.source?.ip);
        const stream = event.type === 'waf_finding' ? 'waf' : 'application';
        if ((severities.size && !severities.has(event.severity))
          || (streams.size && !streams.has(stream))
          || (types.size && !types.has(event.type))
          || (categories.size && !categories.has(category))
          || (countries.size && !countries.has(event.source?.country))
          || (sources.count && (!sourceVersion || !sources.block.check(event.source.ip,
            sourceVersion === 4 ? 'ipv4' : 'ipv6')))) continue;
        events.push(event);
        if (events.length >= limit) return events;
      }
    }
    return events;
  }

  filterOptions(options = {}) {
    const matchingTypes = this.list({ ...options, type: [], limit: 250 });
    const matchingCategories = this.list({ ...options, category: [], limit: 250 });
    return {
      types: [...new Set(matchingTypes.map((event) => event.type))].sort(),
      categories: [...new Set(matchingCategories.map(effectiveCategory).filter(Boolean))].sort(),
    };
  }

  summary(now = Date.now()) {
    const events = this.list({ limit: 250, since: new Date(now - 24 * 60 * 60 * 1000).toISOString() });
    const count = (predicate) => events.filter(predicate).length;
    const countries = new Map();
    for (const event of events) if (event.source?.country) countries.set(event.source.country, (countries.get(event.source.country) || 0) + 1);
    return {
      windowHours: 24, total: events.length,
      warnings: count((event) => event.severity === 'warning'),
      critical: count((event) => event.severity === 'critical' || event.integrityValid === false),
      integrityFailures: count((event) => event.integrityValid === false),
      successfulQr: count((event) => event.type === 'portal_session_created' && event.outcome === 'success'),
      failedLogin: count((event) => event.type === 'qr_login_attempt' && event.outcome !== 'accepted'),
      accessRequests: count((event) => event.type === 'access_request'),
      waf: {
        total: count((event) => event.type === 'waf_finding'),
        passed: count((event) => event.edge?.disposition === 'observed_passed'),
        rejected: count((event) => ['origin_rejected', 'edge_rejected'].includes(event.edge?.disposition)),
        rateLimited: count((event) => event.edge?.disposition === 'origin_rate_limited'),
        blocked: count((event) => event.edge?.disposition === 'waf_blocked'),
        ingestion: typeof this.wafStatus === 'function' ? this.wafStatus() : { configured: false },
      },
      uniquePublicIps: new Set(events.filter((event) => event.source?.scope === 'public').map((event) => event.source.ip)).size,
      countries: [...countries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8).map(([country, value]) => ({ country, count: value })),
      filterOptions: {
        severities: [...LEVELS], types: [...TYPES], categories: [...CATEGORIES],
        countries: [...countries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([country, count]) => ({ country, count })),
      },
      geoip: this.geoip.status(), retentionDays: this.retentionDays,
      storage: { bytes: this.totalBytes, maximumBytes: this.maxBytes, limited: this.storageLimited,
        suppressedSinceStart: this.suppressed },
    };
  }
}

module.exports = { CATEGORIES, LEVELS, TYPES, SecurityEvents, classifyRequest, effectiveCategory, safePath, sourceIp };

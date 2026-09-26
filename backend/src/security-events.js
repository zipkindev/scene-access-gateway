'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { applyWafOutcome, presentWafEvent } = require('./waf-rules');

const LEVELS = new Set(['info', 'warning', 'critical']);
const TYPES = new Set([
  'portal_visit', 'qr_challenge_created', 'qr_login_page_opened', 'qr_login_attempt', 'qr_email_delivery',
  'qr_verified', 'portal_session_created', 'access_request', 'rate_limited',
  'request_rejected', 'suspicious_request', 'waf_finding', 'waf_outcome', 'admin_action',
]);
const CATEGORIES = new Set([
  'sql_injection_probe', 'command_injection_probe', 'cross_site_scripting_probe', 'path_traversal_probe',
  'automated_scanner_probe', 'unexpected_http_method', 'invalid_content_length',
  'sensitive_file_enumeration', 'backup_file_probe', 'framework_admin_probe',
  'known_scanner', 'service_enumeration', 'application_error_exposure', 'protocol_anomaly',
  'rate_limiting', 'integrity_failure',
]);
const TOKEN = /\b[A-Za-z0-9_-]{43}\b/g;
const SQL = /(?:\bunion\s+(?:all\s+)?select\b|\binformation_schema\b|\b(?:sleep|benchmark)\s*\(|\bwaitfor\s+delay\b|(?:'|%27)\s*(?:or|and)\s+['"%\d])/i;
const TRAVERSAL = /(?:\.\.\/|\.\.\\|%2e%2e(?:%2f|%5c)|\/etc\/passwd|\/proc\/self)/i;
const COMMAND = /(?:\$\(|`[^`]{0,120}`|(?:;|%3b|\||%7c)\s*(?:cat|curl|wget|sh|bash|nc|python|perl)\b)/i;
const SENSITIVE = /(?:^|\/)(?:\.env(?:[._~-][^/]*)?|\.git(?:-credentials|-askpass\.sh|-secret|config|ignore|modules)?|\.ssh|\.aws|\.kube\/config|\.docker\/(?:config|secrets)\.json|\.config\/(?:gcloud|anthropic)|\.terraform\/terraform\.tfstate|wp-config\.php|settings\.ini|\.boto|\.esmtprc|\.msmtprc|\.amplifyrc|\.claude\/settings\.json)(?:\/|$)/i;
const BACKUP = /(?:^|\/)[^/]{1,180}(?:\.bak|\.backup|\.old|\.orig|\.save|\.swp|~)(?:\/|$)/i;
const FRAMEWORK = /(?:^|\/)(?:wp-admin|wp-login\.php|phpmyadmin|server-status|actuator|vendor\/phpunit|_profiler\/phpinfo(?:\.php)?)(?:\/|$)/i;
const REQUEST_ID = /^[0-9a-f-]{36}$/;
const EDGE_REQUEST_ID = /^(?:[0-9a-f]{32}|[0-9a-f-]{36})$/i;

function selectedText(value, label, expression, maximumLength) {
  const requested = Array.isArray(value) ? value : value ? [value] : [];
  if (requested.length > 16 || requested.some((item) => typeof item !== 'string' || !expression.test(item)
    || item.length > maximumLength)) throw new Error(`Invalid ${label}`);
  return new Set(requested);
}

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
    this.outcomesDirectory = path.join(this.directory, 'waf-outcomes');
    this.keyFile = path.join(this.directory, '.integrity-key');
    this.geoip = geoip;
    this.retentionDays = Number.isInteger(options.retentionDays) ? options.retentionDays
      : Math.min(365, Math.max(1, Number.parseInt(process.env.SECURITY_EVENT_RETENTION_DAYS || '30', 10) || 30));
    this.maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes
      : Math.min(1024 * 1024 * 1024, Math.max(1024 * 1024,
        Number.parseInt(process.env.SECURITY_EVENT_MAX_BYTES || String(64 * 1024 * 1024), 10) || 64 * 1024 * 1024));
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.outcomesDirectory, { recursive: true, mode: 0o700 });
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
    this.destinationIp = typeof options.destinationIp === 'string' && net.isIP(options.destinationIp)
      ? options.destinationIp : (net.isIP(process.env.SECURITY_MAP_DESTINATION_IP || '')
        ? process.env.SECURITY_MAP_DESTINATION_IP : null);
    this.pendingBytes = 0;
    this.writeQueue = [];
    this.writing = false;
    this.flushWaiters = [];
    this.outcomeCache = null;
    this.cleanup();
  }

  _files() {
    return fs.readdirSync(this.directory).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  }

  _outcomeFiles() {
    return fs.readdirSync(this.outcomesDirectory)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  }

  cleanup(now = Date.now()) {
    if (now - this.lastCleanup < 60 * 60 * 1000) return;
    this.outcomeCache = null;
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const [directory, names] of [[this.directory, this._files()],
      [this.outcomesDirectory, this._outcomeFiles()]]) for (const name of names) {
      const date = Date.parse(name.slice(0, 10) + 'T00:00:00.000Z');
      if (Number.isFinite(date) && date < cutoff) fs.unlinkSync(path.join(directory, name));
    }
    const remaining = [
      ...this._files().map((name) => ({ name, file: path.join(this.directory, name) })),
      ...this._outcomeFiles().map((name) => ({ name, file: path.join(this.outcomesDirectory, name) })),
    ].sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
    this.totalBytes = remaining.reduce((total, item) => total + fs.statSync(item.file).size, 0);
    while (this.totalBytes > this.maxBytes * 0.9 && remaining.length > 2) {
      const oldest = remaining.shift();
      this.totalBytes -= fs.statSync(oldest.file).size;
      fs.unlinkSync(oldest.file);
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
    if (event.type === 'waf_outcome') {
      if (this.outcomeCache && event.edge?.transactionId) {
        const correction = { ...event, integrityValid: true };
        delete correction.integrity;
        this.outcomeCache.set(event.edge.transactionId, correction);
      }
      return;
    }
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
    const suppliedAt = ['waf_finding', 'waf_outcome'].includes(type)
      && Number.isFinite(Date.parse(data.at || '')) ? Date.parse(data.at) : NaN;
    const at = Number.isFinite(suppliedAt) && suppliedAt <= Date.now() + 5 * 60 * 1000
      ? new Date(suppliedAt).toISOString() : new Date().toISOString();
    const suppliedHttp = ['waf_finding', 'waf_outcome'].includes(type)
      && data.http && typeof data.http === 'object' ? data.http : null;
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
        statusSource: ['modsecurity_audit', 'edge_policy', 'edge_access'].includes(suppliedHttp.statusSource)
          ? suppliedHttp.statusSource : null,
        auditStatus: Number.isInteger(suppliedHttp.auditStatus) ? suppliedHttp.auditStatus : null,
        upstreamStatus: Number.isInteger(suppliedHttp.upstreamStatus) ? suppliedHttp.upstreamStatus : null,
        agentHash: null,
      } : null,
      identityHash: data.identity ? this._hash(String(data.identity).trim().toLowerCase()) : null,
      requestId: (type === 'waf_finding' || type === 'waf_outcome' ? EDGE_REQUEST_ID : REQUEST_ID)
        .test(data.requestId || '') ? data.requestId : null,
      category: typeof data.category === 'string' ? data.category.slice(0, 80) : null,
      edge: data.edge && typeof data.edge === 'object' ? {
        target: /^[A-Za-z0-9.-]{1,253}$/.test(data.edge.target || '') ? data.edge.target.toLowerCase() : null,
        disposition: ['observed_passed', 'origin_rejected', 'origin_rate_limited', 'waf_blocked',
          'edge_rejected', 'origin_error', 'outcome_unknown'].includes(data.edge.disposition)
          ? data.edge.disposition : 'outcome_unknown',
        ruleIds: Array.isArray(data.edge.ruleIds) ? [...new Set(data.edge.ruleIds.filter((value) => /^\d{1,10}$/.test(String(value))).map(String))].slice(0, 32) : [],
        ruleSummary: typeof data.edge.ruleSummary === 'string'
          ? data.edge.ruleSummary.slice(0, 240).replace(/[\r\n]/g, '') : null,
        behaviorSummary: typeof data.edge.behaviorSummary === 'string'
          ? data.edge.behaviorSummary.slice(0, 240).replace(/[\r\n]/g, '') : null,
        mode: ['DetectionOnly', 'On'].includes(data.edge.mode) ? data.edge.mode : null,
        anomalyScore: Number.isInteger(data.edge.anomalyScore) && data.edge.anomalyScore >= 0 && data.edge.anomalyScore <= 1000
          ? data.edge.anomalyScore : null,
        interrupted: data.edge.interrupted === true,
        statusVerified: data.edge.statusVerified === true,
        originReached: typeof data.edge.originReached === 'boolean' ? data.edge.originReached : null,
        transactionId: /^[A-Za-z0-9_-]{1,128}$/.test(data.edge.transactionId || '')
          ? data.edge.transactionId : null,
        historical: data.edge.historical === true,
        correlationStatus: ['pending', 'verified', 'unavailable'].includes(data.edge.correlationStatus)
          ? data.edge.correlationStatus : data.edge.statusVerified === true ? 'verified' : 'unavailable',
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
    const file = path.join(type === 'waf_outcome' ? this.outcomesDirectory : this.directory,
      at.slice(0, 10) + '.jsonl');
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

  *matching(options = {}) {
    const severities = selected(options.severity, LEVELS, 'severity');
    const streams = selected(options.stream, new Set(['application', 'waf']), 'stream');
    const types = selected(options.type, TYPES, 'event type');
    const categories = selected(options.category, CATEGORIES, 'category');
    const countries = selected(options.country, new Set((Array.isArray(options.country) ? options.country
      : options.country ? [options.country] : []).filter((item) => /^[A-Z]{2}$/.test(item))), 'country');
    const requestedCities = Array.isArray(options.city) ? options.city : options.city ? [options.city] : [];
    if (requestedCities.length > 16 || requestedCities.some((item) => typeof item !== 'string'
      || !item.trim() || item.length > 120 || /[\u0000-\u001f\u007f]/.test(item))) throw new Error('Invalid city');
    const cities = new Set(requestedCities);
    const methods = selectedText(options.method, 'method', /^[A-Za-z0-9-]+$/, 12);
    const statuses = selectedText(options.status, 'status', /^[1-5][0-9]{2}$/, 3);
    const dispositions = selectedText(options.disposition, 'disposition', /^[a-z0-9_-]+$/, 80);
    const sources = sourceBlockList(options.source);
    const requestedSince = options.since;
    if (requestedSince && requestedSince !== 'all' && !Number.isFinite(Date.parse(requestedSince))) {
      throw new Error('Invalid event time range');
    }
    const since = requestedSince === 'all' ? 0
      : Number.isFinite(Date.parse(requestedSince || '')) ? Date.parse(requestedSince) : 0;
    const requestedBefore = options.before;
    if (requestedBefore && !Number.isFinite(Date.parse(requestedBefore))) throw new Error('Invalid event cursor');
    const before = requestedBefore ? Date.parse(requestedBefore) : Infinity;
    const beforeId = options.beforeId;
    if (beforeId && (!requestedBefore || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(beforeId))) {
      throw new Error('Invalid event cursor ID');
    }
    let cursorReached = !beforeId;
    const outcomes = this._wafOutcomes();
    for (const name of this._files().reverse()) {
      const lines = fs.readFileSync(path.join(this.directory, name), 'utf8').trim().split('\n').filter(Boolean).reverse();
      for (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch (_) { continue; }
        const eventTime = Date.parse(event.at);
        if (eventTime < since) continue;
        if (beforeId && !cursorReached) {
          if (event.id === beforeId) {
            if (eventTime !== before) throw new Error('Event cursor does not match its timestamp');
            cursorReached = true;
          }
          continue;
        }
        if (!beforeId && eventTime >= before) continue;
        const integrity = event.integrity;
        const canonical = { ...event };
        delete canonical.integrity;
        const supplied = Buffer.from(typeof integrity === 'string' ? integrity : '');
        const expected = Buffer.from(this._hash(JSON.stringify(canonical)));
        event.integrityValid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
        delete event.integrity;
        if (event.type === 'waf_outcome') continue;
        if (event.type === 'waf_finding' && event.edge?.transactionId) {
          applyWafOutcome(event, outcomes.get(event.edge.transactionId));
        }
        presentWafEvent(event);
        if (event.source?.scope === 'public' && (!event.source.country
          || !Number.isFinite(event.source.latitude) || !Number.isFinite(event.source.longitude))) {
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
          || (cities.size && !cities.has(event.source?.city))
          || (methods.size && !methods.has(event.http?.method))
          || (statuses.size && !statuses.has(String(event.http?.status)))
          || (dispositions.size && !dispositions.has(event.edge?.disposition || event.outcome))
          || (sources.count && (!sourceVersion || !sources.block.check(event.source.ip,
            sourceVersion === 4 ? 'ipv4' : 'ipv6')))) continue;
        yield event;
      }
    }
  }

  _wafOutcomes() {
    if (this.outcomeCache) return this.outcomeCache;
    const outcomes = new Map();
    for (const name of this._outcomeFiles()) {
      for (const line of fs.readFileSync(path.join(this.outcomesDirectory, name), 'utf8').split('\n').filter(Boolean)) {
        let event;
        try { event = JSON.parse(line); } catch (_) { continue; }
        if (event.type !== 'waf_outcome' || !event.edge?.transactionId) continue;
        const integrity = event.integrity;
        const canonical = { ...event };
        delete canonical.integrity;
        const supplied = Buffer.from(typeof integrity === 'string' ? integrity : '');
        const expected = Buffer.from(this._hash(JSON.stringify(canonical)));
        event.integrityValid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
        delete event.integrity;
        if (event.integrityValid) outcomes.set(event.edge.transactionId, event);
      }
    }
    this.outcomeCache = outcomes;
    return this.outcomeCache;
  }

  list(options = {}) {
    const limit = Math.min(250, Math.max(1, Number.parseInt(options.limit || '100', 10) || 100));
    const events = [];
    for (const event of this.matching(options)) {
      events.push(event);
      if (events.length >= limit) break;
    }
    return events;
  }

  page(options = {}) {
    const limit = Math.min(250, Math.max(1, Number.parseInt(options.limit || '100', 10) || 100));
    const events = [];
    for (const event of this.matching(options)) {
      events.push(event);
      if (events.length > limit) break;
    }
    const hasMore = events.length > limit;
    if (hasMore) events.pop();
    return { events, hasMore,
      nextBefore: hasMore ? events.at(-1)?.at || null : null,
      nextBeforeId: hasMore ? events.at(-1)?.id || null : null };
  }

  filterOptions(options = {}) {
    const matchingTypes = this.matching({ ...options, type: [] });
    const matchingCategories = this.matching({ ...options, category: [] });
    return {
      types: [...new Set([...matchingTypes].map((event) => event.type))].sort(),
      categories: [...new Set([...matchingCategories].map(effectiveCategory).filter(Boolean))].sort(),
    };
  }

  map(options = {}, now = Date.now()) {
    if (typeof options === 'number') { now = options; options = {}; }
    const since = options.since === 'all' ? null
      : options.since || new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const sources = new Map();
    let total = 0;
    for (const event of this.matching({ since })) {
      total += 1;
      const source = event.source || {};
      if (source.scope !== 'public' || !net.isIP(source.ip)) continue;
      const latitude = source.latitude;
      const longitude = source.longitude;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const current = sources.get(source.ip) || {
        ip: source.ip, latitude, longitude, country: source.country || null,
        region: source.region || null, city: source.city || null,
        organization: source.organization || null, accuracyRadiusKm: source.accuracyRadiusKm ?? null,
        count: 0, critical: 0, warning: 0, waf: 0,
      };
      current.count += 1;
      if (event.severity === 'critical' || event.integrityValid === false) current.critical += 1;
      else if (event.severity === 'warning') current.warning += 1;
      if (event.type === 'waf_finding') current.waf += 1;
      sources.set(source.ip, current);
    }
    let destinationIp = this.destinationIp;
    if (!destinationIp) {
      const targets = new Map();
      for (const event of this.matching({ since })) {
        const target = event.edge?.target;
        if (net.isIP(target || '')) targets.set(target, (targets.get(target) || 0) + 1);
      }
      destinationIp = [...targets].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
    const location = destinationIp ? this.geoip.lookup(destinationIp) : null;
    const destination = location?.scope === 'public' && Number.isFinite(location.latitude)
      && Number.isFinite(location.longitude) ? {
        ip: destinationIp, latitude: location.latitude, longitude: location.longitude,
        country: location.country || null, region: location.region || null, city: location.city || null,
        organization: location.organization || null, accuracyRadiusKm: location.accuracyRadiusKm ?? null,
      } : null;
    return {
      windowHours: since ? Math.max(1, Math.round((now - Date.parse(since)) / 3600000)) : null,
      total, located: [...sources.values()].reduce((sum, source) => sum + source.count, 0),
      sources: [...sources.values()].sort((a, b) => b.count - a.count || a.ip.localeCompare(b.ip)),
      destination, destinationConfigured: Boolean(this.destinationIp),
    };
  }

  summary(options = {}, now = Date.now()) {
    if (typeof options === 'number') { now = options; options = {}; }
    const since = options.since === 'all' ? null
      : options.since || new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const events = [...this.matching({ since })];
    const count = (predicate) => events.filter(predicate).length;
    const countries = new Map();
    for (const event of events) if (event.source?.country) countries.set(event.source.country, (countries.get(event.source.country) || 0) + 1);
    return {
      windowHours: since ? Math.max(1, Math.round((now - Date.parse(since)) / 3600000)) : null,
      oldestAt: events.at(-1)?.at || null, newestAt: events[0]?.at || null, total: events.length,
      warnings: count((event) => event.severity === 'warning'),
      critical: count((event) => event.severity === 'critical' || event.integrityValid === false),
      integrityFailures: count((event) => event.integrityValid === false),
      successfulQr: count((event) => event.type === 'portal_session_created' && event.outcome === 'success'),
      failedLogin: count((event) => event.type === 'qr_login_attempt' && event.outcome !== 'accepted'),
      accessRequests: count((event) => event.type === 'access_request'),
      waf: {
        total: count((event) => event.type === 'waf_finding'),
        passed: count((event) => event.edge?.disposition === 'observed_passed'),
        rejected: count((event) => ['origin_rejected', 'origin_error', 'edge_rejected'].includes(event.edge?.disposition)),
        rateLimited: count((event) => event.edge?.disposition === 'origin_rate_limited'),
        blocked: count((event) => event.edge?.disposition === 'waf_blocked'),
        edgeRejected: count((event) => event.edge?.disposition === 'edge_rejected'),
        unknown: count((event) => event.edge?.disposition === 'outcome_unknown'),
        ingestion: typeof this.wafStatus === 'function' ? this.wafStatus() : { configured: false },
      },
      uniquePublicIps: new Set(events.filter((event) => event.source?.scope === 'public').map((event) => event.source.ip)).size,
      countries: [...countries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8).map(([country, value]) => ({ country, count: value })),
      filterOptions: {
        severities: [...LEVELS], types: [...TYPES].filter((type) => type !== 'waf_outcome'), categories: [...CATEGORIES],
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

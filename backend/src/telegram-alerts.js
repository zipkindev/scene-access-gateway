'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = ['info', 'warning', 'critical'];
const CATEGORIES = new Set([
  'sql_injection_probe', 'command_injection_probe', 'path_traversal_probe',
  'automated_scanner_probe', 'unexpected_http_method', 'invalid_content_length',
  'sensitive_file_enumeration', 'backup_file_probe', 'framework_admin_probe',
  'known_scanner', 'protocol_anomaly', 'rate_limiting', 'integrity_failure',
]);
const DEFAULT_POLICY = Object.freeze({
  version: 2,
  enabled: false,
  minimumSeverity: 'critical',
  categories: ['sql_injection_probe', 'command_injection_probe', 'path_traversal_probe',
    'sensitive_file_enumeration', 'backup_file_probe', 'known_scanner', 'integrity_failure'],
  countThreshold: 1,
  aggregationWindowSeconds: 60,
  cooldownSeconds: 300,
  persistentReminderSeconds: 900,
  incidentQuietSeconds: 1800,
  globalLimitPerHour: 20,
  quietHours: null,
  criticalOverride: true,
  redaction: 'masked',
});

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function atomicSecret(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(temporary, value.trim() + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return structuredClone(fallback); }
}

function secret(file, pattern) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > 512) return null;
    const value = fs.readFileSync(file, 'utf8').trim();
    return pattern.test(value) ? value : null;
  } catch (_) { return null; }
}

function clockMinutes(date) { return date.getUTCHours() * 60 + date.getUTCMinutes(); }

function quiet(policy, date) {
  if (!policy.quietHours) return false;
  const parse = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const current = clockMinutes(date);
  const start = parse(policy.quietHours.start);
  const end = parse(policy.quietHours.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function validatePolicy(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid Telegram policy');
  const allowed = new Set(Object.keys(DEFAULT_POLICY));
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Invalid Telegram policy');
  const categories = Array.isArray(value.categories) ? [...value.categories] : value.categories;
  if (value.version === 1 && Array.isArray(categories)) {
    if (categories.includes('automated_scanner_probe')) categories.push(
      'sensitive_file_enumeration', 'backup_file_probe', 'framework_admin_probe', 'known_scanner');
    if (categories.includes('unexpected_http_method') || categories.includes('invalid_content_length')) {
      categories.push('protocol_anomaly');
    }
  }
  const policy = { ...DEFAULT_POLICY, ...value, categories, version: 2 };
  if (Array.isArray(policy.categories)) policy.categories = [...new Set(policy.categories)];
  if (typeof policy.enabled !== 'boolean' || !LEVELS.includes(policy.minimumSeverity)
    || !Array.isArray(policy.categories) || policy.categories.length > CATEGORIES.size
    || policy.categories.some((item) => !CATEGORIES.has(item))
    || new Set(policy.categories).size !== policy.categories.length
    || !Number.isInteger(policy.countThreshold) || policy.countThreshold < 1 || policy.countThreshold > 100
    || !Number.isInteger(policy.aggregationWindowSeconds) || policy.aggregationWindowSeconds < 10 || policy.aggregationWindowSeconds > 3600
    || !Number.isInteger(policy.cooldownSeconds) || policy.cooldownSeconds < 0 || policy.cooldownSeconds > 86400
    || !Number.isInteger(policy.persistentReminderSeconds) || policy.persistentReminderSeconds < 60 || policy.persistentReminderSeconds > 86400
    || !Number.isInteger(policy.incidentQuietSeconds) || policy.incidentQuietSeconds < 60 || policy.incidentQuietSeconds > 604800
    || !Number.isInteger(policy.globalLimitPerHour) || policy.globalLimitPerHour < 1 || policy.globalLimitPerHour > 100
    || typeof policy.criticalOverride !== 'boolean' || !['masked', 'country-only'].includes(policy.redaction)) {
    throw new Error('Invalid Telegram policy');
  }
  if (policy.quietHours !== null) {
    if (!policy.quietHours || Object.keys(policy.quietHours).sort().join(',') !== 'end,start'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(policy.quietHours.start)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(policy.quietHours.end)
      || policy.quietHours.start === policy.quietHours.end) throw new Error('Invalid Telegram policy');
  }
  return policy;
}

function eventCategory(event) {
  if (CATEGORIES.has(event.category)) return event.category;
  if (event.type === 'rate_limited') return 'rate_limiting';
  if (event.integrityValid === false) return 'integrity_failure';
  return null;
}

function maskedSource(source, redaction) {
  const location = [source?.city, source?.region, source?.country].filter(Boolean).join(', ')
    || source?.scope || 'unknown';
  const network = [source?.asn ? `AS${source.asn}` : null, source?.organization].filter(Boolean).join(' ');
  if (redaction === 'country-only') return [source?.country || source?.scope || 'unknown', network].filter(Boolean).join(' · ');
  const ip = String(source?.ip || 'unknown');
  const masked = ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + ':…' : ip.replace(/\.\d+$/, '.…');
  return [masked, location, network].filter(Boolean).join(' · ');
}

function dispositionLabel(disposition) {
  return ({
    observed_passed: 'observed only, not blocked',
    origin_rejected: 'origin rejected',
    origin_rate_limited: 'origin rate-limited',
    waf_blocked: 'WAF blocked',
    edge_rejected: 'edge rejected',
    outcome_unknown: 'outcome unknown',
  })[disposition] || String(disposition).replaceAll('_', ' ');
}

function wafAction(event) {
  const disposition = event.edge?.disposition;
  if (disposition === 'observed_passed') return event.edge?.mode === 'DetectionOnly'
    ? 'Observed only (DetectionOnly); request was not blocked'
    : 'Observed only; request was not blocked by the WAF';
  if (disposition === 'origin_rejected') return 'Observed by WAF; origin rejected the request';
  if (disposition === 'origin_rate_limited') return 'Observed by WAF; origin rate-limited the request';
  if (disposition === 'waf_blocked') return 'Blocked by WAF before reaching the origin';
  if (disposition === 'edge_rejected') return 'Rejected at the edge';
  return 'Outcome could not be determined';
}

function wafMeaning(event) {
  const disposition = event.edge?.disposition;
  if (disposition === 'observed_passed') return event.http?.status !== null
    ? `Origin returned HTTP ${event.http.status}; this status alone does not prove access or exploitation.`
    : 'The request was not blocked; that alone does not prove access or exploitation.';
  if (disposition === 'origin_rejected') return 'The application or origin rejected the request.';
  if (disposition === 'origin_rate_limited') return 'The application or origin applied rate limiting.';
  if (disposition === 'waf_blocked') return 'The request did not reach the application origin.';
  return null;
}

class TelegramAlerts {
  constructor(directory, options = {}) {
    this.directory = path.join(directory, 'scene-management');
    this.policyFile = path.join(this.directory, 'telegram-alert-policy.json');
    this.queueFile = path.join(this.directory, 'telegram-alert-queue.json');
    this.statusFile = path.join(this.directory, 'telegram-alert-status.json');
    this.managedTokenPath = path.join(this.directory, 'telegram-bot-token');
    this.managedChatPath = path.join(this.directory, 'telegram-chat-id');
    this.metadataFile = path.join(this.directory, 'telegram-integration.json');
    this.externalTokenPath = options.tokenPath || process.env.TELEGRAM_BOT_TOKEN_PATH || null;
    this.externalChatPath = options.chatPath || process.env.TELEGRAM_CHAT_ID_PATH || null;
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || (() => new Date());
    this.retryDelays = options.retryDelays || [0, 250, 1000];
    this.policy = validatePolicy(readJson(this.policyFile, DEFAULT_POLICY));
    const savedQueue = readJson(this.queueFile, []);
    this.queue = Array.isArray(savedQueue) ? savedQueue.filter((item) => item && typeof item.text === 'string').slice(-100) : [];
    this.delivery = readJson(this.statusFile, { lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, lastTestAt: null });
    this.integration = readJson(this.metadataFile, { bot: null, chat: null });
    this.aggregates = new Map();
    this.cooldowns = new Map(Object.entries(this.delivery.cooldowns || {}).filter(([, until]) => Number.isFinite(until)));
    this.sent = Array.isArray(this.delivery.recentDeliveries)
      ? this.delivery.recentDeliveries.filter((at) => Number.isFinite(at) && this.now().getTime() - at < 3600000) : [];
    this.incidents = new Map(Object.entries(this.delivery.activeIncidents || {})
      .filter(([, value]) => value && Number.isFinite(value.lastSeenAt)));
    this.draining = null;
    if (this.queue.length && this.policy.enabled && this.configured()) this._schedule();
  }

  configured() { return Boolean(this._credentials()); }

  _token() {
    return secret(this.managedTokenPath, /^\d{5,20}:[A-Za-z0-9_-]{30,}$/)
      || (this.externalTokenPath ? secret(this.externalTokenPath, /^\d{5,20}:[A-Za-z0-9_-]{30,}$/) : null);
  }

  _chat() {
    return secret(this.managedChatPath, /^-?\d{1,20}$/)
      || (this.externalChatPath ? secret(this.externalChatPath, /^-?\d{1,20}$/) : null);
  }

  _credentials() {
    const token = this._token();
    const chat = this._chat();
    return token && chat ? { token, chat } : null;
  }

  state() {
    const activeIncidents = this._activeIncidents();
    return {
      configured: this.configured(), active: this.configured() && this.policy.enabled,
      setup: {
        mode: fs.existsSync(this.managedTokenPath) || fs.existsSync(this.managedChatPath) ? 'scene-management'
          : this.externalTokenPath || this.externalChatPath ? 'mounted-files' : 'not-configured',
        bot: this.integration.bot ? { username: this.integration.bot.username,
          name: this.integration.bot.name } : null,
        chat: this.integration.chat ? { title: this.integration.chat.title,
          type: this.integration.chat.type } : null,
      },
      policy: structuredClone(this.policy), pending: this.queue.length,
      incidents: { active: activeIncidents.length,
        suppressedByHourlyLimit: Number(this.delivery.suppressedByHourlyLimit || 0),
        items: activeIncidents.sort((left, right) => right.lastSeenAt - left.lastSeenAt).slice(0, 50)
          .map((incident) => ({ category: incident.category, target: incident.target,
            source: incident.source, firstSeenAt: new Date(incident.startedAt).toISOString(),
            lastSeenAt: new Date(incident.lastSeenAt).toISOString(), count: incident.count,
            sinceAlert: incident.sinceAlert, dispositions: { ...incident.dispositions } })),
      },
      delivery: { lastSuccessAt: this.delivery.lastSuccessAt || null,
        lastFailureAt: this.delivery.lastFailureAt || null,
        lastFailureCode: this.delivery.lastFailureCode || null,
        lastTestAt: this.delivery.lastTestAt || null },
    };
  }

  async _api(method, token, body = {}) {
    let response;
    try {
      response = await this.fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
    } catch (_) { throw new Error('Telegram API is unavailable'); }
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('Telegram API returned an invalid response'); }
    if (!response.ok || !result?.ok) throw new Error('Telegram rejected the request');
    return result.result;
  }

  async configureToken(value) {
    const token = String(value || '').trim();
    if (!/^\d{5,20}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('Invalid Telegram bot token');
    const bot = await this._api('getMe', token);
    if (!bot?.is_bot || !Number.isSafeInteger(bot.id) || !/^[A-Za-z0-9_]{5,32}$/.test(bot.username || '')) {
      throw new Error('Telegram did not return a valid bot identity');
    }
    atomicSecret(this.managedTokenPath, token);
    try { fs.unlinkSync(this.managedChatPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.integration = { bot: { id: bot.id, username: bot.username,
      name: [bot.first_name, bot.last_name].filter(Boolean).join(' ').slice(0, 128) }, chat: null };
    atomicJson(this.metadataFile, this.integration);
    if (this.policy.enabled) this.updatePolicy({ ...this.policy, enabled: false });
    this.queue = [];
    this.incidents.clear();
    this._saveQueue();
    return this.state();
  }

  async discoverChats() {
    const token = this._token();
    if (!token) throw new Error('Configure a Telegram bot token first');
    const updates = await this._api('getUpdates', token, { limit: 100, timeout: 0,
      allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
    const chats = new Map();
    for (const update of Array.isArray(updates) ? updates : []) {
      const chat = update.message?.chat || update.channel_post?.chat || update.my_chat_member?.chat;
      if (!chat || !Number.isSafeInteger(chat.id)
        || !['private', 'group', 'supergroup', 'channel'].includes(chat.type)) continue;
      const title = String(chat.title || chat.username
        || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || 'Telegram chat').slice(0, 128);
      chats.set(String(chat.id), { id: String(chat.id), title, type: chat.type });
    }
    return { chats: [...chats.values()] };
  }

  async configureChat(value) {
    const chatId = String(value || '').trim();
    if (!/^-?\d{1,20}$/.test(chatId)) throw new Error('Invalid Telegram chat ID');
    const token = this._token();
    if (!token) throw new Error('Configure a Telegram bot token first');
    const chat = await this._api('getChat', token, { chat_id: chatId });
    if (String(chat?.id) !== chatId || !['private', 'group', 'supergroup', 'channel'].includes(chat.type)) {
      throw new Error('Telegram did not return a valid destination');
    }
    atomicSecret(this.managedChatPath, chatId);
    const title = String(chat.title || chat.username
      || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || 'Telegram chat').slice(0, 128);
    this.integration = { ...this.integration, chat: { id: chatId, title, type: chat.type } };
    atomicJson(this.metadataFile, this.integration);
    return this.state();
  }

  disconnect() {
    for (const file of [this.managedTokenPath, this.managedChatPath, this.metadataFile]) {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    this.integration = { bot: null, chat: null };
    if (this.policy.enabled) this.updatePolicy({ ...this.policy, enabled: false });
    this.queue = [];
    this.incidents.clear();
    this._saveQueue();
    return this.state();
  }

  updatePolicy(value) {
    this.policy = validatePolicy(value);
    atomicJson(this.policyFile, this.policy);
    if (this.policy.enabled && this.queue.length && this.configured()) this._schedule();
    return this.state();
  }

  enqueue(event) {
    if (event.edge?.historical) return false;
    const credentials = this._credentials();
    const category = eventCategory(event);
    if (!credentials || !this.policy.enabled || !category || !this.policy.categories.includes(category)) return false;
    if (LEVELS.indexOf(event.severity) < LEVELS.indexOf(this.policy.minimumSeverity)) return false;
    const now = this.now();
    if (quiet(this.policy, now) && !(event.severity === 'critical' && this.policy.criticalOverride)) return false;
    const fingerprint = crypto.createHash('sha256').update(String(event.source?.ip || 'unknown')).digest('hex').slice(0, 12);
    const target = String(event.edge?.target || event.destination || 'portal').slice(0, 253);
    const key = `${category}:${fingerprint}:${target}`;
    const prior = this.incidents.get(key);
    const expired = !prior || now.getTime() - prior.lastSeenAt >= this.policy.incidentQuietSeconds * 1000;
    const incident = expired ? { startedAt: now.getTime(), lastSeenAt: now.getTime(), windowStartedAt: now.getTime(),
      thresholdCount: 0, count: 0,
      sinceAlert: 0, lastAlertAt: 0, highestSeverity: 'info', target, category,
      source: maskedSource(event.source, this.policy.redaction), dispositions: {} } : prior;
    if (!Number.isFinite(incident.windowStartedAt)
      || now.getTime() - incident.windowStartedAt >= this.policy.aggregationWindowSeconds * 1000) {
      incident.windowStartedAt = now.getTime();
      incident.thresholdCount = 0;
    }
    incident.thresholdCount = Number(incident.thresholdCount || 0) + 1;
    const escalated = LEVELS.indexOf(event.severity) > LEVELS.indexOf(incident.highestSeverity);
    incident.count += 1;
    incident.sinceAlert += 1;
    incident.lastSeenAt = now.getTime();
    if (LEVELS.indexOf(event.severity) > LEVELS.indexOf(incident.highestSeverity)) incident.highestSeverity = event.severity;
    const disposition = String(event.edge?.disposition || event.outcome || 'observed').slice(0, 80);
    incident.dispositions[disposition] = (incident.dispositions[disposition] || 0) + 1;
    this.incidents.set(key, incident);
    this._saveStatus();
    if (!incident.lastAlertAt && incident.thresholdCount < this.policy.countThreshold) return false;
    const repeatMs = Math.max(this.policy.cooldownSeconds, this.policy.persistentReminderSeconds) * 1000;
    if (incident.lastAlertAt && !escalated && now.getTime() - incident.lastAlertAt < repeatMs) return false;
    this.sent = this.sent.filter((at) => now.getTime() - at < 3600000);
    let pendingDeliveries = this.queue.filter((item) => !item.test).length;
    if (this.delivery.suppressedByHourlyLimit && this.sent.length + pendingDeliveries < this.policy.globalLimitPerHour) {
      this.queue.push({ id: crypto.randomUUID(), text: [
        'Scene Access security alert summary',
        `${this.delivery.suppressedByHourlyLimit} incident notification(s) were suppressed by the hourly ceiling.`,
        'All underlying security events remain available in Scene Management.',
        `Time: ${now.toISOString()}`,
      ].join('\n'), createdAt: now.toISOString(), test: false });
      this.delivery.suppressedByHourlyLimit = 0;
      pendingDeliveries += 1;
      this._saveQueue();
      this._schedule();
    }
    if (this.sent.length + pendingDeliveries >= this.policy.globalLimitPerHour) {
      this.delivery.suppressedByHourlyLimit = Number(this.delivery.suppressedByHourlyLimit || 0) + 1;
      incident.lastAlertAt = now.getTime();
      this._saveStatus();
      return false;
    }
    const source = maskedSource(event.source, this.policy.redaction);
    const dispositionSummary = Object.entries(incident.dispositions)
      .map(([name, count]) => `${dispositionLabel(name)} ${count}`).join(' · ');
    const waf = event.type === 'waf_finding' && event.edge;
    const request = waf && event.http?.path
      ? `Request: ${String(event.http.method || '').slice(0, 12)} ${String(event.http.path).slice(0, 512)}`
        + (event.http.status !== null ? ` → HTTP ${event.http.status}` : '') : null;
    const matched = waf && event.edge.ruleIds?.length
      ? `Matched: CRS ${event.edge.ruleIds.join(', ')}`
        + (event.edge.ruleSummary ? ` · ${event.edge.ruleSummary}` : '') : null;
    const text = [
      'Scene Access security alert',
      `${String(event.severity || 'warning').toUpperCase()} · ${category.replaceAll('_', ' ')}`,
      `Observed since last alert: ${incident.sinceAlert} · total: ${incident.count}`,
      `Time: ${event.at || now.toISOString()}`,
      `Source: ${source}`,
      `Target: ${target}`,
      request,
      matched,
      waf ? `WAF action: ${wafAction(event)}` : dispositionSummary ? `Results: ${dispositionSummary}` : null,
      waf ? `Incident results: ${dispositionSummary}` : null,
      waf ? `Meaning: ${wafMeaning(event)}` : event.outcome ? `Outcome: ${String(event.outcome).slice(0, 80)}` : null,
    ].filter(Boolean).join('\n').slice(0, 3500);
    this.queue.push({ id: crypto.randomUUID(), text, createdAt: now.toISOString(), test: false });
    if (this.queue.length > 100) this.queue.splice(0, this.queue.length - 100);
    this._saveQueue();
    incident.lastAlertAt = now.getTime();
    incident.sinceAlert = 0;
    this._saveStatus();
    this._schedule();
    return true;
  }

  async test() {
    if (!this.configured()) throw new Error('Telegram credentials are not configured');
    const now = this.now();
    if (this.delivery.lastTestAt && now.getTime() - Date.parse(this.delivery.lastTestAt) < 60000) throw new Error('Telegram test is rate limited');
    this.delivery.lastTestAt = now.toISOString();
    this.queue.push({ id: crypto.randomUUID(), text: `Scene Access test alert\nTime: ${now.toISOString()}\nNo security event triggered this message.`, createdAt: now.toISOString(), test: true });
    if (this.queue.length > 100) this.queue.splice(0, this.queue.length - 100);
    this._saveQueue();
    this._saveStatus();
    await this._schedule();
    return this.state();
  }

  _saveQueue() { atomicJson(this.queueFile, this.queue); }
  _activeIncidents() {
    const cutoff = this.now().getTime() - this.policy.incidentQuietSeconds * 1000;
    for (const [key, incident] of this.incidents) if (incident.lastSeenAt < cutoff) this.incidents.delete(key);
    return [...this.incidents.values()];
  }
  _saveStatus() {
    const now = this.now().getTime();
    this.sent = this.sent.filter((at) => now - at < 3600000);
    for (const [key, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(key);
    this._activeIncidents();
    atomicJson(this.statusFile, { ...this.delivery, recentDeliveries: this.sent,
      activeIncidents: Object.fromEntries(this.incidents),
      cooldowns: Object.fromEntries(this.cooldowns) });
  }

  _schedule() {
    if (!this.draining) this.draining = this._drain().finally(() => { this.draining = null; });
    return this.draining;
  }

  async _drain() {
    while (this.queue.length) {
      const item = this.queue[0];
      const delivered = await this._deliver(item.text);
      if (!delivered) return;
      this.queue.shift();
      this.sent.push(this.now().getTime());
      this._saveQueue();
      this._saveStatus();
    }
  }

  async _deliver(text) {
    const credentials = this._credentials();
    if (!credentials) return false;
    let failure = 'delivery_failed';
    for (let attempt = 0; attempt < this.retryDelays.length; attempt += 1) {
      if (this.retryDelays[attempt]) await new Promise((resolve) => setTimeout(resolve, this.retryDelays[attempt]));
      try {
        const response = await this.fetch(`https://api.telegram.org/bot${credentials.token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: credentials.chat, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          this.delivery.lastSuccessAt = this.now().toISOString();
          this.delivery.lastFailureCode = null;
          this._saveStatus();
          return true;
        }
        failure = `http_${response.status}`;
      } catch (error) { failure = error?.name === 'TimeoutError' ? 'timeout' : 'network_error'; }
    }
    this.delivery.lastFailureAt = this.now().toISOString();
    this.delivery.lastFailureCode = failure;
    this._saveStatus();
    return false;
  }
}

module.exports = { CATEGORIES, DEFAULT_POLICY, TelegramAlerts, eventCategory, maskedSource, validatePolicy };

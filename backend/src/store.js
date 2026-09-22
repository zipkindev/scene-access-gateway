'use strict';

// The portal is deliberately single-process.  A directory lock makes each
// read/modify/write transaction safe across a supervised replacement too.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function tokenHash(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function equalHash(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const REQUEST_ID = /^[A-Za-z0-9_-]{22}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DECISION_REF = /^torrentharbor-(?:user|decision):[A-Za-z0-9_.:-]{1,80}$/;
const ACTIONS = { approve: 'approved', block: 'blocked', unblock: 'unblocked', dismiss: 'dismissed' };
const DESTINATIONS = new Set(['torrentharbor', 'firewall']);
function timestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}
function publicRequest(entry, decision = false) {
  const result = { id: entry.id, email: entry.email, requestedAt: entry.requestedAt, status: entry.status };
  if (decision) { result.decision = entry.decision; result.decisionRef = entry.decisionRef; }
  return result;
}

class PortalStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'state.json');
    this.lock = path.join(directory, '.state.lock');
    this.hashKeyFile = path.join(directory, '.rate-limit-key');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.hashKeyFile)) fs.writeFileSync(this.hashKeyFile, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.hashKey = fs.readFileSync(this.hashKeyFile);
    if (this.hashKey.length !== 32) throw new Error('Invalid rate-limit key');
    if (!fs.existsSync(this.file)) this._write({ challenges: [], sessions: [], messages: [], handoffs: [], requests: [], attempts: [], blockedEmails: [], firewallBlockedEmails: [], decisionAudit: [], adminDecisionAudit: [] });
    this._transaction((state) => this._migrateRequests(state));
  }

  _keyedHash(value) {
    return crypto.createHmac('sha256', this.hashKey).update(value).digest('base64url');
  }

  _write(state) {
    const temporary = `${this.file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  _transaction(callback) {
    let locked = false;
    for (let attempt = 0; attempt < 25 && !locked; attempt += 1) {
      try { fs.mkdirSync(this.lock, { mode: 0o700 }); locked = true; } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (!locked) throw new Error('Portal state is busy');
    try {
      const state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!state || !Array.isArray(state.challenges) || !Array.isArray(state.sessions) || !Array.isArray(state.messages) || !Array.isArray(state.requests) || !Array.isArray(state.attempts)) throw new Error('Invalid portal state');
      const result = callback(state);
      this._write(state);
      return result;
    } finally { fs.rmdirSync(this.lock); }
  }

  _migrateRequests(state) {
    const seen = new Set();
    const legacy = new Set();
    let changed = false;
    if (state.blockedEmails === undefined) { state.blockedEmails = []; changed = true; }
    if (state.decisionAudit === undefined) { state.decisionAudit = []; changed = true; }
    if (state.firewallBlockedEmails === undefined) { state.firewallBlockedEmails = []; changed = true; }
    if (state.adminDecisionAudit === undefined) { state.adminDecisionAudit = []; changed = true; }
    if (state.handoffs === undefined) { state.handoffs = []; changed = true; }
    if (!Array.isArray(state.handoffs)) throw new Error('Invalid handoff ledger');
    if (!Array.isArray(state.blockedEmails) || !Array.isArray(state.firewallBlockedEmails) || !Array.isArray(state.decisionAudit) || !Array.isArray(state.adminDecisionAudit)) throw new Error('Invalid request ledger');
    for (const entry of state.requests) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !normalizedEmail(entry.email) || !timestamp(entry.requestedAt) || !['pending', 'approved', 'blocked', 'unblocked', 'dismissed'].includes(entry.status) || (entry.sourceIp !== undefined && typeof entry.sourceIp !== 'string')) throw new Error('Invalid request ledger');
      if (entry.destinationId === undefined) { entry.destinationId = 'torrentharbor'; changed = true; }
      if (!DESTINATIONS.has(entry.destinationId)) throw new Error('Invalid request destination');
      const key = `${entry.destinationId}\0${normalizedEmail(entry.email)}\0${entry.requestedAt}`;
      if (legacy.has(key)) throw new Error('Ambiguous request ledger');
      legacy.add(key);
      if (entry.id !== undefined && (!REQUEST_ID.test(entry.id) || seen.has(entry.id))) throw new Error('Invalid request ID');
      if (entry.id) seen.add(entry.id);
      if (entry.status !== 'pending' && entry.id === undefined) throw new Error('Ambiguous legacy decision');
      if (entry.decidedAt !== undefined && entry.decidedAt !== null && !timestamp(entry.decidedAt)) throw new Error('Invalid decision time');
      if (entry.decision !== undefined && entry.decision !== null && !Object.values(ACTIONS).includes(entry.decision)) throw new Error('Invalid decision');
      if (entry.decisionRef !== undefined && entry.decisionRef !== null && !DECISION_REF.test(entry.decisionRef)) throw new Error('Invalid decision reference');
      if (entry.status === 'pending' && (entry.decidedAt || entry.decision || entry.decisionRef)) throw new Error('Invalid pending request');
      if (entry.status !== 'pending' && (!entry.decidedAt || entry.decision !== entry.status)) throw new Error('Invalid decided request');
    }
    const pending = new Set();
    for (const entry of state.requests) {
      const email = normalizedEmail(entry.email);
      const pendingKey = `${entry.destinationId}\0${email}`;
      if (entry.status === 'pending' && pending.has(pendingKey)) throw new Error('Ambiguous pending requests');
      if (entry.status === 'pending') pending.add(pendingKey);
      if (entry.email !== email) { entry.email = email; changed = true; }
      if (!entry.id) { do { entry.id = crypto.randomBytes(16).toString('base64url'); } while (seen.has(entry.id)); seen.add(entry.id); changed = true; }
      for (const field of ['decidedAt', 'decision', 'decisionRef']) if (entry[field] === undefined) { entry[field] = null; changed = true; }
    }
    for (const [destinationId, list] of [['torrentharbor', state.blockedEmails], ['firewall', state.firewallBlockedEmails]]) {
      const blocks = new Set();
      for (const email of list) {
        if (normalizedEmail(email) !== email || blocks.has(email)) throw new Error('Invalid blocklist');
        blocks.add(email);
        if (!state.requests.some((entry) => entry.destinationId === destinationId && entry.email === email && entry.status === 'blocked')) throw new Error('Orphaned blocklist entry');
      }
      if (state.requests.some((entry) => entry.destinationId === destinationId && entry.status === 'pending' && blocks.has(entry.email))) throw new Error('Blocked email has pending request');
    }
    const refs = new Set();
    for (const item of state.decisionAudit) {
      if (!item || item.actor !== 'torrentharbor-bridge' || !['approve', 'block', 'unblock'].includes(item.action) || !seen.has(item.requestId) || !timestamp(item.at) || !DECISION_REF.test(item.decisionRef) || refs.has(item.decisionRef) || Object.keys(item).some((key) => !['actor', 'action', 'requestId', 'at', 'decisionRef'].includes(key))) throw new Error('Invalid decision audit');
      refs.add(item.decisionRef);
    }
    for (const item of state.adminDecisionAudit) {
      if (!item || item.actor !== 'scene-admin' || !DESTINATIONS.has(item.destinationId) || !Object.hasOwn(ACTIONS, item.action) || !seen.has(item.requestId) || !timestamp(item.at)) throw new Error('Invalid admin decision audit');
    }
    return changed;
  }

  purge(now = Date.now()) {
    return this._transaction((state) => {
      state.challenges = state.challenges.filter((entry) => Date.parse(entry.expiresAt) > now);
      state.messages = state.messages.filter((entry) => Date.parse(entry.expiresAt) > now && !entry.usedAt);
      state.sessions = state.sessions.filter((entry) => Date.parse(entry.expiresAt) > now && !entry.revokedAt);
      state.handoffs = state.handoffs.filter((entry) => Date.parse(entry.expiresAt) > now);
      // The request ledger and its decisions are durable. Only transient abuse state expires.
      state.attempts = state.attempts.filter((entry) => entry.at > now - (15 * 60 * 1000));
    });
  }

  createChallenge(browserHash, expiresAt, destinationId = 'torrentharbor') {
    if (!['torrentharbor', 'firewall'].includes(destinationId)) throw new Error('Unsupported destination');
    const token = crypto.randomBytes(32).toString('base64url');
    this._transaction((state) => state.challenges.push({ tokenHash: tokenHash(token), browserHash, destinationId, expiresAt: new Date(expiresAt).toISOString(), status: 'pending' }));
    return token;
  }

  getChallenge(token, browserHash) {
    return this._transaction((state) => state.challenges.find((entry) => equalHash(entry.tokenHash, tokenHash(token)) && (browserHash === undefined || equalHash(entry.browserHash, browserHash))) || null);
  }

  createMessage(challengeToken, identity, expiresAt) {
    const token = crypto.randomBytes(32).toString('base64url');
    this._transaction((state) => state.messages.push({ tokenHash: tokenHash(token), challengeHash: tokenHash(challengeToken), identity, expiresAt: new Date(expiresAt).toISOString() }));
    return token;
  }

  consumeMessage(token) {
    return this._transaction((state) => {
      const message = state.messages.find((entry) => equalHash(entry.tokenHash, tokenHash(token)));
      if (!message || message.usedAt || Date.parse(message.expiresAt) <= Date.now()) return null;
      message.usedAt = new Date().toISOString();
      const challenge = state.challenges.find((entry) => equalHash(entry.tokenHash, message.challengeHash));
      if (!challenge || challenge.status !== 'pending' || Date.parse(challenge.expiresAt) <= Date.now()) return null;
      challenge.status = 'approved';
      challenge.identity = message.identity;
      return challenge;
    });
  }

  approveAndCreateSession(challengeToken, expiresAt) {
    const token = crypto.randomBytes(32).toString('base64url');
    this._transaction((state) => {
      const challenge = state.challenges.find((entry) => equalHash(entry.tokenHash, tokenHash(challengeToken)));
      if (!challenge || challenge.status !== 'approved') throw new Error('Challenge not approved');
      challenge.status = 'consumed';
      if (!challenge.identity?.subject || !challenge.identity?.username || !challenge.identity?.email) throw new Error('Challenge identity missing');
      state.sessions.push({ id: crypto.randomBytes(32).toString('base64url'), tokenHash: tokenHash(token), destinationId: challenge.destinationId || 'torrentharbor', identity: challenge.identity, expiresAt: new Date(expiresAt).toISOString() });
    });
    return token;
  }

  approveAndCreateHandoff(challengeToken, expiresAt) {
    const token = crypto.randomBytes(32).toString('base64url');
    this._transaction((state) => {
      const challenge = state.challenges.find((entry) => equalHash(entry.tokenHash, tokenHash(challengeToken)));
      if (!challenge || challenge.status !== 'approved' || challenge.destinationId !== 'firewall'
        || Date.parse(challenge.expiresAt) <= Date.now() || !challenge.identity?.subject
        || !challenge.identity?.username || !challenge.identity?.email) throw new Error('Firewall challenge not approved');
      challenge.status = 'consumed';
      state.handoffs.push({ tokenHash: tokenHash(token), identity: challenge.identity,
        expiresAt: new Date(expiresAt).toISOString() });
    });
    return token;
  }

  consumeHandoff(token, sessionExpiresAt) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this._transaction((state) => {
      const index = state.handoffs.findIndex((entry) => equalHash(entry.tokenHash, tokenHash(token)));
      if (index < 0) return null;
      const [handoff] = state.handoffs.splice(index, 1);
      if (Date.parse(handoff.expiresAt) <= Date.now()) return null;
      const sessionToken = crypto.randomBytes(32).toString('base64url');
      state.sessions.push({ id: crypto.randomBytes(32).toString('base64url'),
        tokenHash: tokenHash(sessionToken), destinationId: 'firewall', identity: handoff.identity,
        expiresAt: new Date(sessionExpiresAt).toISOString() });
      return sessionToken;
    });
  }

  validSession(token) {
    return Boolean(this.session(token));
  }

  session(token, destinationId = 'torrentharbor') {
    return this._transaction((state) => state.sessions.find((entry) => equalHash(entry.tokenHash, tokenHash(token)) && (entry.destinationId || 'torrentharbor') === destinationId && !entry.revokedAt && Date.parse(entry.expiresAt) > Date.now()) || null);
  }

  revokeSession(token) {
    return this._transaction((state) => {
      const session = state.sessions.find((entry) => equalHash(entry.tokenHash, tokenHash(token)) && !entry.revokedAt);
      if (session) session.revokedAt = new Date().toISOString();
      return Boolean(session);
    });
  }

  revokeDestinationSessions(subject, destinationId) {
    if (!/^[0-9]{1,20}$/.test(String(subject || '')) || !DESTINATIONS.has(destinationId)) throw new Error('Invalid session revocation');
    return this._transaction((state) => {
      let count = 0;
      for (const session of state.sessions) if (session.identity?.subject === String(subject)
        && (session.destinationId || 'torrentharbor') === destinationId && !session.revokedAt) {
        session.revokedAt = new Date().toISOString(); count += 1;
      }
      return count;
    });
  }

  createRequest(email, sourceIp, destinationId = 'torrentharbor') {
    if (!DESTINATIONS.has(destinationId)) throw new Error('Unsupported request destination');
    return this._transaction((state) => {
      const address = normalizedEmail(email);
      const blocks = destinationId === 'firewall' ? state.firewallBlockedEmails : state.blockedEmails;
      if (!address || blocks.includes(address) || state.requests.some((entry) => entry.destinationId === destinationId && entry.email === address && entry.status === 'pending')) return null;
      let id;
      do { id = crypto.randomBytes(16).toString('base64url'); } while (state.requests.some((entry) => entry.id === id));
      const entry = { id, destinationId, email: address, requestedAt: new Date().toISOString(), sourceIp, status: 'pending', decidedAt: null, decision: null, decisionRef: null };
      state.requests.push(entry);
      return publicRequest(entry);
    });
  }

  listRequests(status = 'pending', limit = 100, cursor = null, destinationId = 'torrentharbor') {
    if (!DESTINATIONS.has(destinationId) || !['pending', 'blocked', 'approved', 'dismissed'].includes(status) || !Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)))) throw new Error('Invalid request query');
    let after = null;
    if (cursor !== null) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (Buffer.from(JSON.stringify(decoded)).toString('base64url') !== cursor || !Array.isArray(decoded) || decoded.length !== (destinationId === 'torrentharbor' ? 3 : 4) || decoded[0] !== status || !timestamp(decoded[1]) || !REQUEST_ID.test(decoded[2]) || (destinationId !== 'torrentharbor' && decoded[3] !== destinationId)) throw new Error('Invalid cursor');
        after = decoded;
      } catch (_) { throw new Error('Invalid cursor'); }
    }
    return this._transaction((state) => {
      const pendingCount = state.requests.filter((entry) => entry.destinationId === destinationId && entry.status === 'pending').length;
      let selected = state.requests.filter((entry) => entry.destinationId === destinationId && entry.status === status);
      if (status === 'blocked') {
        const current = new Set(destinationId === 'firewall' ? state.firewallBlockedEmails : state.blockedEmails);
        const representative = new Map();
        for (const entry of selected) if (current.has(entry.email) && (!representative.has(entry.email) || entry.requestedAt > representative.get(entry.email).requestedAt || (entry.requestedAt === representative.get(entry.email).requestedAt && entry.id > representative.get(entry.email).id))) representative.set(entry.email, entry);
        selected = [...representative.values()];
      }
      selected.sort((a, b) => a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      if (after) selected = selected.filter((entry) => entry.requestedAt > after[1] || (entry.requestedAt === after[1] && entry.id > after[2]));
      const page = selected.slice(0, limit);
      const last = page.at(-1);
      return { requests: page.map((entry) => publicRequest(entry)), nextCursor: selected.length > limit ? Buffer.from(JSON.stringify(destinationId === 'torrentharbor' ? [status, last.requestedAt, last.id] : [status, last.requestedAt, last.id, destinationId])).toString('base64url') : null, pendingCount, syncedAt: new Date().toISOString() };
    });
  }

  getRequest(id, destinationId) {
    if (!REQUEST_ID.test(id) || !DESTINATIONS.has(destinationId)) return null;
    return this._transaction((state) => {
      const entry = state.requests.find((item) => item.id === id && item.destinationId === destinationId);
      return entry ? publicRequest(entry) : null;
    });
  }

  decideRequest(id, action, decisionRef) {
    if (!REQUEST_ID.test(id) || !Object.hasOwn(ACTIONS, action) || typeof decisionRef !== 'string' || !DECISION_REF.test(decisionRef) || !decisionRef.startsWith(action === 'approve' ? 'torrentharbor-user:' : 'torrentharbor-decision:')) throw new Error('Invalid decision');
    return this._transaction((state) => {
      const entry = state.requests.find((item) => item.id === id);
      if (!entry || entry.destinationId !== 'torrentharbor') throw new Error('Unknown request');
      const replay = state.decisionAudit.find((item) => item.requestId === id && item.action === action && item.decisionRef === decisionRef);
      if (replay) return { ...publicRequest(entry), status: ACTIONS[action], decision: ACTIONS[action], decisionRef };
      if (state.decisionAudit.some((item) => item.decisionRef === decisionRef) || (action === 'unblock' ? entry.status !== 'blocked' || !state.blockedEmails.includes(entry.email) : entry.status !== 'pending' || state.blockedEmails.includes(entry.email))) throw new Error('Decision conflict');
      const now = new Date().toISOString();
      if (action === 'block') {
        state.blockedEmails.push(entry.email);
        for (const item of state.requests) if (item.destinationId === 'torrentharbor' && item.email === entry.email && item.status === 'pending') { item.status = 'blocked'; item.decidedAt = now; item.decision = 'blocked'; item.decisionRef = item === entry ? decisionRef : null; }
      } else {
        if (action === 'unblock') state.blockedEmails = state.blockedEmails.filter((email) => email !== entry.email);
        entry.status = ACTIONS[action]; entry.decidedAt = now; entry.decision = ACTIONS[action]; entry.decisionRef = decisionRef;
      }
      state.decisionAudit.push({ actor: 'torrentharbor-bridge', action, requestId: id, at: now, decisionRef });
      return publicRequest(entry, true);
    });
  }

  adminRequest(id, destinationId, action) {
    if (!REQUEST_ID.test(id) || !DESTINATIONS.has(destinationId) || !Object.hasOwn(ACTIONS, action)) throw new Error('Invalid request decision');
    return this._transaction((state) => {
      const entry = state.requests.find((item) => item.id === id && item.destinationId === destinationId);
      if (!entry) throw new Error('Unknown request');
      const blocks = destinationId === 'firewall' ? state.firewallBlockedEmails : state.blockedEmails;
      if (action === 'unblock' ? entry.status !== 'blocked' || !blocks.includes(entry.email) : entry.status !== 'pending' || blocks.includes(entry.email)) throw new Error('Decision conflict');
      const at = new Date().toISOString();
      if (action === 'block') {
        blocks.push(entry.email);
        for (const item of state.requests) if (item.destinationId === destinationId && item.email === entry.email && item.status === 'pending') {
          item.status = 'blocked'; item.decidedAt = at; item.decision = 'blocked'; item.decisionRef = null;
        }
      } else {
        if (action === 'unblock') {
          const index = blocks.indexOf(entry.email);
          blocks.splice(index, 1);
        }
        entry.status = ACTIONS[action]; entry.decidedAt = at; entry.decision = ACTIONS[action]; entry.decisionRef = null;
      }
      state.adminDecisionAudit.push({ actor: 'scene-admin', destinationId, action, requestId: id, at });
      return publicRequest(entry, true);
    });
  }

  allowAttempt(sourceIp, email, maxPerIp = 8, maxPerEmail = 3) {
    return this._transaction((state) => {
      const now = Date.now();
      state.attempts = state.attempts.filter((entry) => entry.at > now - (15 * 60 * 1000));
      const emailHash = this._keyedHash(email);
      const ipCount = state.attempts.filter((entry) => entry.sourceIp === sourceIp).length;
      const emailCount = state.attempts.filter((entry) => equalHash(entry.emailHash, emailHash)).length;
      if (ipCount >= maxPerIp || emailCount >= maxPerEmail) return false;
      state.attempts.push({ sourceIp, emailHash, at: now });
      return true;
    });
  }
}

module.exports = { PortalStore, tokenHash };

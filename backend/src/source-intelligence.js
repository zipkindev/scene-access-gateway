'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const ACTIVE_PORTS = Object.freeze([22, 25, 53, 80, 443, 3389, 8000, 8080, 8443]);
const ACTIVE_ACKNOWLEDGEMENT = 'I understand this contacts the remote host';
const MAX_EVIDENCE_EVENTS = 5000;
const FETCH_LIMIT = 1024 * 1024;
const PASSIVE_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function ipBytes(ip) {
  if (net.isIPv4(ip)) return ip.split('.').map(Number);
  if (!net.isIPv6(ip)) return null;
  const halves = ip.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const parse = (part) => part ? part.split(':').flatMap((word) => {
    if (word.includes('.')) {
      const bytes = word.split('.').map(Number);
      return [((bytes[0] << 8) | bytes[1]), ((bytes[2] << 8) | bytes[3])];
    }
    return [Number.parseInt(word || '0', 16)];
  }) : [];
  const left = parse(halves[0]);
  const right = parse(halves[1] || '');
  const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left;
  if (words.length !== 8 || words.some((value) => !Number.isInteger(value) || value < 0 || value > 65535)) return null;
  return words.flatMap((word) => [word >> 8, word & 255]);
}

function isPublicIp(ip) {
  const bytes = ipBytes(ip);
  if (!bytes) return false;
  if (bytes.length === 4) {
    const [a, b, c] = bytes;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  const allZero = bytes.every((value) => value === 0);
  const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1;
  const mappedV4 = bytes.slice(0, 10).every((value) => value === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const documentation = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const multicast = bytes[0] === 0xff;
  if (mappedV4) return isPublicIp(bytes.slice(12).join('.'));
  return !(allZero || loopback || documentation || uniqueLocal || linkLocal || multicast);
}

function limitedText(response, maximum = FETCH_LIMIT) {
  if (!response.ok) throw Object.assign(new Error('Intelligence provider returned ' + response.status), { code: 'UPSTREAM_STATUS' });
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) throw Object.assign(new Error('Intelligence response exceeded limit'), { code: 'UPSTREAM_SIZE' });
  return response.arrayBuffer().then((buffer) => {
    if (buffer.byteLength > maximum) throw Object.assign(new Error('Intelligence response exceeded limit'), { code: 'UPSTREAM_SIZE' });
    return Buffer.from(buffer).toString('utf8');
  });
}

function cleanText(value, maximum = 240) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum) : null;
}

function rdapEntities(entities = []) {
  return entities.slice(0, 40).map((entity) => {
    const roles = Array.isArray(entity.roles) ? entity.roles.filter((role) => typeof role === 'string').slice(0, 8) : [];
    const card = Array.isArray(entity.vcardArray?.[1]) ? entity.vcardArray[1] : [];
    const values = (name) => card.filter((row) => row?.[0] === name).map((row) => cleanText(row[3])).filter(Boolean);
    return { handle: cleanText(entity.handle, 100), roles, name: values('fn')[0] || values('org')[0] || null,
      email: values('email').filter((value) => /@/.test(value)).slice(0, 4) };
  }).filter((entity) => entity.handle || entity.name || entity.email.length);
}

function parseRdap(value, sourceUrl) {
  return {
    source: sourceUrl, handle: cleanText(value.handle, 100), name: cleanText(value.name), type: cleanText(value.type, 80),
    startAddress: net.isIP(value.startAddress || '') ? value.startAddress : null,
    endAddress: net.isIP(value.endAddress || '') ? value.endAddress : null,
    country: /^[A-Z]{2}$/.test(value.country || '') ? value.country : null,
    parentHandle: cleanText(value.parentHandle, 100),
    status: Array.isArray(value.status) ? value.status.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 12) : [],
    entities: rdapEntities(value.entities),
    events: Array.isArray(value.events) ? value.events.map((event) => ({ action: cleanText(event.eventAction, 80),
      at: Number.isFinite(Date.parse(event.eventDate || '')) ? new Date(event.eventDate).toISOString() : null }))
      .filter((event) => event.action || event.at).slice(0, 20) : [],
    notices: Array.isArray(value.notices) ? value.notices.map((notice) => cleanText(notice.title || notice.description?.join(' '), 200)).filter(Boolean).slice(0, 8) : [],
  };
}

async function fetchJson(fetcher, url, allowedHosts, timeoutMs = 5000) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) throw new Error('Intelligence provider is not allowlisted');
  const response = await fetcher(parsed, { redirect: 'error', headers: { Accept: 'application/rdap+json, application/json',
    'User-Agent': 'Scene-Access-Source-Intelligence/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
  return JSON.parse(await limitedText(response));
}

async function reverseIdentity(ip, resolver = dns) {
  let names = [];
  try { names = (await resolver.reverse(ip)).filter((name) => /^[A-Za-z0-9._-]{1,253}$/.test(name)).slice(0, 8); } catch (_) { return { names: [], forwardConfirmed: [] }; }
  const confirmed = [];
  for (const name of names) {
    try {
      const addresses = net.isIPv4(ip) ? await resolver.resolve4(name) : await resolver.resolve6(name);
      if (addresses.includes(ip)) confirmed.push(name);
    } catch (_) { /* unconfirmed PTR remains useful but low confidence */ }
  }
  return { names, forwardConfirmed: confirmed };
}

async function collectPassiveNetwork(ip, fetcher = globalThis.fetch, resolver = dns) {
  const ptr = await reverseIdentity(ip, resolver);
  let rdap = null;
  let rdapError = null;
  try {
    const url = 'https://rdap-bootstrap.arin.net/bootstrap/ip/' + encodeURIComponent(ip);
    const first = await fetcher(new URL(url), { redirect: 'manual', headers: { Accept: 'application/rdap+json, application/json',
      'User-Agent': 'Scene-Access-Source-Intelligence/1.0' }, signal: AbortSignal.timeout(5000) });
    if ([301, 302, 303, 307, 308].includes(first.status)) {
      const location = new URL(first.headers.get('location'), url);
      const allowed = new Set(['rdap.arin.net', 'rdap.db.ripe.net', 'rdap.apnic.net', 'rdap.lacnic.net', 'rdap.afrinic.net']);
      rdap = parseRdap(await fetchJson(fetcher, location.href, allowed), location.href);
    } else rdap = parseRdap(JSON.parse(await limitedText(first)), url);
  } catch (error) { rdapError = cleanText(error.code || error.message, 120); }
  let routing = null;
  let routingError = null;
  try {
    const value = await fetchJson(fetcher, 'https://stat.ripe.net/data/prefix-overview/data.json?resource=' + encodeURIComponent(ip), new Set(['stat.ripe.net']));
    routing = { source: 'https://stat.ripe.net/', prefix: cleanText(value.data?.prefix, 80),
      asns: Array.isArray(value.data?.asns) ? value.data.asns.filter(Number.isInteger).slice(0, 20) : [],
      announced: value.data?.announced === true, holder: cleanText(value.data?.holder, 240) };
  } catch (error) { routingError = cleanText(error.code || error.message, 120); }
  return { ptr, rdap, routing,
    providerErrors: { ...(rdapError ? { rdap: rdapError } : {}), ...(routingError ? { routing: routingError } : {}) } };
}

function eventEvidence(securityEvents, ip) {
  const events = [];
  for (const event of securityEvents.matching({ source: [ip], since: 'all' })) {
    events.push(event);
    if (events.length >= MAX_EVIDENCE_EVENTS) break;
  }
  const counts = (field) => Object.entries(events.reduce((result, event) => {
    const value = field(event);
    if (value) result[value] = (result[value] || 0) + 1;
    return result;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([value, count]) => ({ value, count }));
  return {
    total: events.length, truncated: events.length === MAX_EVIDENCE_EVENTS,
    firstSeenAt: events.at(-1)?.at || null, lastSeenAt: events[0]?.at || null,
    severity: counts((event) => event.severity), categories: counts((event) => event.category),
    methods: counts((event) => event.http?.method), statuses: counts((event) => Number.isInteger(event.http?.status) ? String(event.http.status) : null),
    targets: counts((event) => event.edge?.target || event.destination), dispositions: counts((event) => event.edge?.disposition || event.outcome),
    userAgentFingerprints: [...new Set(events.map((event) => event.http?.agentHash).filter(Boolean))].length,
    note: 'Request fields are observations received by this service. Client-supplied headers are untrusted and are not identity proof.',
  };
}

function classification({ geo, rdap, ptr, routing }) {
  const text = JSON.stringify({ geo, rdap, ptr, routing }).toLowerCase();
  const matches = [];
  const test = (label, confidence, patterns, explanation) => {
    const hits = patterns.filter((pattern) => text.includes(pattern));
    if (hits.length) matches.push({ label, confidence: Math.min(95, confidence + Math.min(15, (hits.length - 1) * 5)), explanation, indicators: hits });
  };
  test('cloud or hosting infrastructure', 75, ['amazon', 'aws', 'google cloud', 'microsoft', 'azure', 'digitalocean', 'ovh', 'hetzner', 'linode', 'akamai', 'vultr', 'hosting', 'datacenter'], 'Registration, routing, or reverse-DNS evidence resembles a cloud or hosting network.');
  test('recognized scanning or research infrastructure', 65, ['censys', 'shodan', 'shadowserver', 'internet measurement', 'securitytrails', 'scanner'], 'Network identity contains an indicator commonly associated with Internet measurement or scanning.');
  test('consumer or access ISP', 55, ['broadband', 'cable', 'telecom', 'wireless', 'residential', 'dynamic'], 'Network identity resembles an access provider; this does not identify the subscriber.');
  test('privacy or relay infrastructure', 55, ['vpn', 'proxy', 'tor exit', 'relay'], 'Network identity contains a privacy, proxy, or relay indicator.');
  return matches.sort((a, b) => b.confidence - a.confidence)[0]
    || { label: 'unclassified network source', confidence: 20, explanation: 'Available evidence does not support a reliable infrastructure classification.', indicators: [] };
}

function socketConnect(ip, port, timeoutMs = 900) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host: ip, port });
    let done = false;
    const finish = (open, code = null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ port, transport: 'tcp', open, latencyMs: Date.now() - started, code: cleanText(code, 40) });
    };
    socket.setTimeout(timeoutMs, () => finish(false, 'timeout'));
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(false, error.code || 'error'));
  });
}

function protocolObservation(ip, port, timeoutMs = 1500) {
  if ([443, 8443].includes(port)) return new Promise((resolve) => {
    const socket = tls.connect({ host: ip, port, servername: undefined, rejectUnauthorized: false });
    let done = false;
    const finish = (value) => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => finish({ protocol: 'tls', error: 'timeout' }));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      finish({ protocol: 'tls', authorized: socket.authorized, negotiated: cleanText(socket.getProtocol(), 30),
        alpn: cleanText(socket.alpnProtocol, 30), certificate: cert && Object.keys(cert).length ? {
          subject: cleanText(cert.subject?.CN, 200), issuer: cleanText(cert.issuer?.CN, 200),
          validFrom: cleanText(cert.valid_from, 80), validTo: cleanText(cert.valid_to, 80),
          fingerprint256: cleanText(cert.fingerprint256, 100),
        } : null });
    });
    socket.once('error', (error) => finish({ protocol: 'tls', error: cleanText(error.code || error.message, 80) }));
  });
  if ([80, 8000, 8080].includes(port)) return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port });
    let text = '';
    let done = false;
    const finish = (value) => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => finish({ protocol: 'http', error: 'timeout' }));
    socket.once('connect', () => socket.write(`HEAD / HTTP/1.1\r\nHost: ${ip}\r\nConnection: close\r\nUser-Agent: Scene-Access-Recon/1.0\r\n\r\n`));
    socket.on('data', (chunk) => {
      text += chunk.toString('latin1');
      if (text.length > 8192 || text.includes('\r\n\r\n')) {
        const lines = text.slice(0, 8192).split('\r\n');
        const allow = new Set(['server', 'date', 'content-type', 'content-length', 'allow', 'via']);
        const headers = Object.fromEntries(lines.slice(1).map((line) => line.split(/:\s*/, 2))
          .filter(([name, value]) => allow.has(String(name).toLowerCase()) && value)
          .map(([name, value]) => [name.toLowerCase(), cleanText(value, 300)]));
        finish({ protocol: 'http', status: cleanText(lines[0], 120), headers });
      }
    });
    socket.once('error', (error) => finish({ protocol: 'http', error: cleanText(error.code || error.message, 80) }));
    socket.once('end', () => finish({ protocol: 'http', error: text ? null : 'closed_without_response' }));
  });
  if ([22, 25].includes(port)) return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port });
    let done = false;
    const finish = (value) => { if (done) return; done = true; socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => finish({ protocol: port === 22 ? 'ssh' : 'smtp', error: 'timeout' }));
    socket.once('data', (chunk) => finish({ protocol: port === 22 ? 'ssh' : 'smtp', banner: cleanText(chunk.toString('utf8'), 300) }));
    socket.once('error', (error) => finish({ protocol: port === 22 ? 'ssh' : 'smtp', error: cleanText(error.code || error.message, 80) }));
  });
  return Promise.resolve(null);
}

async function activeRecon(ip, scanConnect = socketConnect, observe = protocolObservation) {
  const ports = [];
  for (const port of ACTIVE_PORTS) ports.push(await scanConnect(ip, port));
  for (const port of ports.filter((item) => item.open)) port.observation = await observe(ip, port.port);
  return ports;
}

class SourceIntelligence {
  constructor(directory, securityEvents, geoip, options = {}) {
    this.securityEvents = securityEvents;
    this.geoip = geoip;
    this.fetch = options.fetch || globalThis.fetch;
    this.resolver = options.resolver || dns;
    this.scanConnect = options.scanConnect || socketConnect;
    this.observe = options.observe || protocolObservation;
    this.activeEnabled = options.activeEnabled === true || (options.activeEnabled === undefined && process.env.SOURCE_INTELLIGENCE_ACTIVE_ENABLED === 'true');
    this.workerUrl = options.workerUrl === undefined ? process.env.SOURCE_INTELLIGENCE_WORKER_URL || null : options.workerUrl;
    if (this.workerUrl && this.workerUrl !== 'http://source-intelligence:8090') throw new Error('Invalid source-intelligence worker URL');
    this.workerTokenPath = options.workerTokenPath === undefined
      ? process.env.SOURCE_INTELLIGENCE_WORKER_TOKEN_PATH || null : options.workerTokenPath;
    if (this.workerUrl && this.workerTokenPath !== '/run/secrets/source-intelligence-token') {
      throw new Error('Invalid source-intelligence worker token path');
    }
    this.destinationIp = options.destinationIp || securityEvents.destinationIp || null;
    this.directory = path.join(directory, 'scene-management', 'source-intelligence');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.running = false;
  }

  _file(ip) { return path.join(this.directory, crypto.createHash('sha256').update(ip).digest('hex') + '.json'); }

  _read(ip) {
    try {
      const value = JSON.parse(fs.readFileSync(this._file(ip), 'utf8'));
      return value.version === 1 && value.targetIp === ip ? value : null;
    } catch (_) { return null; }
  }

  _write(value) {
    const file = this._file(value.targetIp);
    const temporary = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  validateTarget(ip) {
    if (typeof ip !== 'string' || !net.isIP(ip) || !isPublicIp(ip)) throw Object.assign(new Error('Select one public source IP'), { status: 400 });
    if (this.destinationIp && ip === this.destinationIp) throw Object.assign(new Error('The protected destination cannot be investigated'), { status: 409 });
    return ip;
  }

  async _worker(pathname, ip) {
    const token = fs.readFileSync(this.workerTokenPath, 'utf8').trim();
    if (!/^[A-Za-z0-9+/=]{40,80}$/.test(token)) throw new Error('Invalid source-intelligence worker token');
    const response = await this.fetch(this.workerUrl + pathname, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Source-Intelligence-Token': token },
      body: JSON.stringify({ ip }), signal: AbortSignal.timeout(20000) });
    const result = JSON.parse(await limitedText(response));
    return result;
  }

  status(ip) {
    this.validateTarget(ip);
    return { activeEnabled: this.activeEnabled, activeProfile: { ports: ACTIVE_PORTS, transport: 'TCP connect',
      probes: ['HTTP HEAD /', 'TLS handshake and certificate', 'SSH greeting', 'SMTP greeting'],
      prohibited: ['exploitation', 'vulnerability tests', 'authentication', 'path enumeration', 'UDP sweep', 'stealth or evasion'] },
    investigation: this._read(ip) };
  }

  async investigate(ip, { active = false, acknowledgement = '', actor = 'unknown' } = {}) {
    this.validateTarget(ip);
    if (this.running) throw Object.assign(new Error('Another source investigation is already running'), { status: 409 });
    if (active && !this.activeEnabled) throw Object.assign(new Error('Ethical reconnaissance is disabled by server policy'), { status: 409 });
    if (active && acknowledgement !== ACTIVE_ACKNOWLEDGEMENT) throw Object.assign(new Error('Active reconnaissance acknowledgement is required'), { status: 400 });
    const previous = this._read(ip);
    if (active && previous?.active?.completedAt && Date.now() - Date.parse(previous.active.completedAt) < ACTIVE_COOLDOWN_MS) {
      throw Object.assign(new Error('Active reconnaissance is limited to once per IP every 24 hours'), { status: 429 });
    }
    this.running = true;
    const startedAt = new Date().toISOString();
    try {
      const geo = this.geoip.lookup(ip);
      const events = eventEvidence(this.securityEvents, ip);
      let network;
      try {
        network = this.workerUrl ? await this._worker('/passive', ip) : await collectPassiveNetwork(ip, this.fetch, this.resolver);
      } catch (error) {
        network = { ptr: { names: [], forwardConfirmed: [] }, rdap: null, routing: null,
          providerErrors: { worker: cleanText(error.code || error.message, 120) } };
      }
      const passive = { completedAt: new Date().toISOString(), geo, ...network, events };
      const result = { version: 1, investigationId: crypto.randomUUID(), targetIp: ip, startedAt,
        completedAt: passive.completedAt, requestedBy: crypto.createHash('sha256').update(actor).digest('base64url'),
        safety: { attributionWarning: 'This identifies network infrastructure and observed behavior, not the human responsible.',
          activePolicy: active ? 'Explicitly confirmed bounded TCP reconnaissance' : 'Passive intelligence only' },
        stages: { eventEvidence: 'completed', geoip: geo?.scope === 'public' ? 'completed' : 'partial',
          networkIdentity: Object.keys(network.providerErrors || {}).length ? 'partial' : 'completed',
          activeRecon: active ? 'running' : 'not-requested' },
        passive, classification: classification({ geo, rdap: network.rdap, ptr: network.ptr, routing: network.routing }),
        active: previous?.active || null };
      if (active) {
        const scannedAt = new Date().toISOString();
        try {
          const ports = this.workerUrl ? (await this._worker('/active', ip)).ports
            : await activeRecon(ip, this.scanConnect, this.observe);
          result.active = { status: 'completed', startedAt: scannedAt, completedAt: new Date().toISOString(),
            profile: 'bounded-tcp-v1', ports, acknowledgement,
            audit: { actorHash: result.requestedBy, exactTargetOnly: true, redirectsFollowed: false,
              exploitTraffic: false, authenticationAttempted: false } };
          result.stages.activeRecon = 'completed';
        } catch (error) {
          result.active = { status: 'failed', startedAt: scannedAt, completedAt: new Date().toISOString(),
            profile: 'bounded-tcp-v1', ports: [], error: cleanText(error.code || error.message, 120), acknowledgement,
            audit: { actorHash: result.requestedBy, exactTargetOnly: true, redirectsFollowed: false,
              exploitTraffic: false, authenticationAttempted: false } };
          result.stages.activeRecon = 'failed';
        }
        result.completedAt = result.active.completedAt;
      }
      this._write(result);
      return this.status(ip);
    } finally { this.running = false; }
  }
}

module.exports = { SourceIntelligence, ACTIVE_ACKNOWLEDGEMENT, ACTIVE_PORTS, isPublicIp, classification,
  collectPassiveNetwork, activeRecon };

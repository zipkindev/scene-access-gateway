'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const QRCode = require('qrcode');
const { createMailer, loadSmtpConfig } = require('./mail');
const { logLoginOutcome, newLoginRequestId, smtpErrorClass } = require('./login-telemetry');
const { findAllowedIdentity, normalizedEmail, normalizedUsername } = require('./allowlist');
const { AssertionIssuer } = require('./assertion');
const { landingPage } = require('./landing');
const { advanceSceneClick } = require('./scene-hit');
const { PortalStore, tokenHash } = require('./store');
const management = require('./management');
const { createSceneAdmin } = require('./scene-admin');
const { loginPage, requestPage, submittedPage, confirmedPage, notFoundPage, methodPage } = require('./public-auth-pages');
const { BACKGROUNDS, SCENE_BUNDLES, SceneStore } = require('./scene-config');
const { ImageLibrary } = require('./scene-assets');
const { DestinationRegistry } = require('./scene-destinations');
const { getFirewallRegistration } = require('./firewall-registration');
const { ArcadeLeaderboard } = require('./arcade-leaderboard');
const { GeoIpLookup } = require('./geoip');
const { createHostPolicy, matchesRequestOrigin } = require('./host-policy');
const { MaxMindSetup } = require('./maxmind-setup');
const { SecurityEvents, sourceIp } = require('./security-events');
const { TelegramAlerts } = require('./telegram-alerts');
const { WafIngestor } = require('./waf-ingestor');

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const ADMIN_PORT = process.env.ADMIN_PORT ? Number.parseInt(process.env.ADMIN_PORT, 10) : null;
const ORIGIN = (process.env.PUBLIC_ORIGIN || 'http://localhost:8080').replace(/\/$/, '');
const allowedHost = createHostPolicy(ORIGIN, process.env.PUBLIC_HOST_ALIASES);
function sameOrigin(req) { return matchesRequestOrigin(req.headers.origin, ORIGIN, allowedHost); }
const FIREWALL_ORIGIN = (process.env.FIREWALL_ORIGIN || 'http://localhost:8080').replace(/\/$/, '');
const MANAGEMENT_SOURCE_IP = process.env.MANAGEMENT_SOURCE_IP || '127.0.0.1';
const CHALLENGE_TTL = 15 * 60 * 1000;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const FIREWALL_TTL = 15 * 60 * 1000;
const HANDOFF_TTL = 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATA_DIR = process.env.DATA_DIR || '/var/lib/access-portal';
const managedGeoIpDirectory = path.join(DATA_DIR, 'scene-management', 'maxmind');
const geoIp = new GeoIpLookup(process.env.GEOIP_CITY_DB_PATH || path.join(managedGeoIpDirectory, 'GeoLite2-City.mmdb'),
  process.env.GEOIP_ASN_DB_PATH || path.join(managedGeoIpDirectory, 'GeoLite2-ASN.mmdb'));
const maxMindSetup = new MaxMindSetup(DATA_DIR, geoIp,
  { managed: !process.env.GEOIP_CITY_DB_PATH && !process.env.GEOIP_ASN_DB_PATH });
const securityEvents = new SecurityEvents(DATA_DIR, geoIp, {
  asyncWrites: true, destinationIp: process.env.SECURITY_MAP_DESTINATION_IP,
});
const telegramAlerts = new TelegramAlerts(DATA_DIR);
securityEvents.subscribe((event) => telegramAlerts.enqueue(event));
const wafIngestor = new WafIngestor(process.env.WAF_EVENT_INPUT_PATH || null, securityEvents, DATA_DIR,
  { mode: process.env.WAF_MODE });
securityEvents.wafStatus = () => wafIngestor.status();
wafIngestor.start();
const store = new PortalStore(DATA_DIR);
const destinationRegistry = new DestinationRegistry(DATA_DIR);
const firewallRegistration = getFirewallRegistration(DATA_DIR);
const imageLibrary = new ImageLibrary(DATA_DIR);
const arcadeLeaderboard = new ArcadeLeaderboard(DATA_DIR);
const backgrounds = () => ({ ...BACKGROUNDS, ...imageLibrary.catalog() });
const sceneStore = new SceneStore(process.env.DATA_DIR || '/var/lib/access-portal', backgrounds);
const artwork = new Map(Object.values(BACKGROUNDS).map((item) => [
  '/assets/' + item.file, fs.readFileSync(path.join(__dirname, 'assets', item.file)),
]));
const motionScript = fs.readFileSync(path.join(__dirname, 'scene-motion-renderer.js'));
const framingScript = fs.readFileSync(path.join(__dirname, 'scene-framing.js'));
const gameScript = fs.readFileSync(path.join(__dirname, 'scene-game.js'));
const futureMotionScript = fs.readFileSync(path.join(__dirname, 'future-motion-runtime.js'));
const featureClicksScript = fs.readFileSync(path.join(__dirname, 'future-feature-clicks.js'));
const futureGameCarouselScript = fs.readFileSync(path.join(__dirname, 'future-game-carousel.js'));
const futureNatureAudioScript = fs.readFileSync(path.join(__dirname, 'future-nature-audio.js'));
const futureSampleAudioScript = fs.readFileSync(path.join(__dirname, 'future-sample-audio.js'));
function optionalFile(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
}
const futureWolfCrtScript = optionalFile(process.env.WOLF3D_CLIENT_SCRIPT
  || path.join(__dirname, 'future-wolf3d-crt.js'));
const wolfRoot = process.env.WOLF3D_ROOT || path.join(__dirname, 'wolf3d-runtime');
const wolfAssets = new Map();
function collectWolfAssets(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectWolfAssets(absolute, relative);
    else if (entry.isFile()) wolfAssets.set('/wolf3d/' + relative, fs.readFileSync(absolute));
  }
}
if (fs.existsSync(wolfRoot) && fs.statSync(wolfRoot).isDirectory()) collectWolfAssets(wolfRoot);
const wolfTypes = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon', '.wl6': 'application/octet-stream', '.sod': 'application/octet-stream',
});
const audioRoot = process.env.AUDIO_SAMPLES_DIR || path.join(__dirname, 'audio-samples');
const audioSamples = new Map((fs.existsSync(audioRoot) ? fs.readdirSync(audioRoot) : [])
  .filter((file) => file.endsWith('.mp3')).map((file) => [
    '/audio-samples/' + file, fs.readFileSync(path.join(audioRoot, file)),
  ]));
const bundleManifests = new Map(Object.entries(SCENE_BUNDLES).map(([id, bundle]) => [
  '/scene-bundles/' + id + '/motion.json', Buffer.from(JSON.stringify(bundle)),
]));
for (const file of ['clouds-upper.png', 'fog-near.png', 'rain.png', 'water-reflections.png']) {
  artwork.set('/motion/immersive-city-candidate-a/' + file,
    fs.readFileSync(path.join(__dirname, 'assets', 'motion', 'immersive-city-candidate-a', file)));
}
let mailer;
let assertionIssuer;
const firewallChecks = new Map();
const clickSessions = new Map();
const AUTH_GROUPS = Object.freeze({ torrentharbor: 'app:torrentharbor', firewall: 'app:firewall' });
function firewallActive() { return destinationRegistry.list().some((item) => item.id === 'firewall' && item.status === 'active'); }
function requestDestination(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) return null;
  const challenge = store.getChallenge(token);
  if (!challenge || challenge.status !== 'pending' || Date.parse(challenge.expiresAt) <= Date.now()) return null;
  const destinationId = challenge.destinationId || 'torrentharbor';
  return AUTH_GROUPS[destinationId] && (destinationId !== 'firewall' || firewallActive()) ? destinationId : null;
}

function cookie(req, name) { return (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function browser(req) { const old = cookie(req, 'portal_browser'); if (/^[A-Za-z0-9_-]{43}$/.test(old)) return [old, null]; const value = crypto.randomBytes(32).toString('base64url'); return [value, `portal_browser=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`]; }
function portalChallengeCookie(token) { return `portal_challenge=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`; }
function currentChallenge(req) {
  const token = cookie(req, 'portal_challenge');
  const browserId = cookie(req, 'portal_browser');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[A-Za-z0-9_-]{43}$/.test(browserId)) return [null, null];
  return [token, store.getChallenge(token, tokenHash(browserId))];
}
function clickSession(token, revisionId) {
  let session = clickSessions.get(token);
  if (!session || session.revisionId !== revisionId) {
    session = { revisionId, progress: null, unlocks: new Set() };
    clickSessions.set(token, session);
  }
  if (clickSessions.size > 2048) clickSessions.delete(clickSessions.keys().next().value);
  return session;
}
function needsSequence(scene, destinationId) {
  return scene.hotspots.some((item) => item.enabled && item.destinationId === destinationId && item.sequence);
}
function sequenceUnlocked(token, active, destinationId) {
  return !needsSequence(active.scene, destinationId)
    || (clickSessions.get(token)?.revisionId === (active.activationId || active.revisionId)
      && clickSessions.get(token)?.unlocks.has(destinationId));
}
function ip(req) { return sourceIp(req); }
function peerIp(req) {
  const value = String(req.socket?.remoteAddress || '');
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}
function email(value) { const normalized = value.trim().toLowerCase(); return EMAIL.test(normalized) && normalized.length <= 254 ? normalized : null; }
function identifier(value) { return normalizedEmail(value) || normalizedUsername(value); }
function send(res, status, headers, body) { res.writeHead(status, { 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Permitted-Cross-Domain-Policies': 'none', 'Strict-Transport-Security': 'max-age=86400', 'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", ...headers }); res.end(body); }
function neutral(res, status = 200) { send(res, status, { 'Content-Type': 'text/html; charset=utf-8' }, submittedPage()); }
function scriptResponse(req, res, url, body) {
  const versioned = /^[A-Za-z0-9_-]{1,64}$/.test(url.searchParams.get('v') || '');
  return send(res, 200, { 'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' },
  req.method === 'HEAD' ? '' : body);
}
function readText(req, maximum) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let failed = false;
    req.setEncoding('utf8');
    req.on('data', (part) => {
      if (failed) return;
      bytes += Buffer.byteLength(part);
      if (bytes > maximum) {
        failed = true;
        const error = new Error('Request too large');
        error.code = 'REQUEST_TOO_LARGE';
        reject(error);
      } else body += part;
    });
    req.on('end', () => { if (!failed) resolve(body); });
    req.on('aborted', () => {
      if (!failed) { failed = true; reject(Object.assign(new Error('Request aborted'), { code: 'REQUEST_ABORTED' })); }
    });
    req.on('error', (error) => { if (!failed) { failed = true; reject(error); } });
  });
}
async function readForm(req) { return new URLSearchParams(await readText(req, 2048)); }
async function readJson(req) {
  const value = JSON.parse((await readText(req, 4096)) || '{}');
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid JSON');
  return value;
}
function issueAssertion(session) { if (!assertionIssuer) assertionIssuer = new AssertionIssuer(); return assertionIssuer.issue(session); }
async function deliver(to, token) { if (!mailer) mailer = createMailer(loadSmtpConfig()); return mailer.sendMail({ from: loadSmtpConfig().from, to, subject: 'Confirm access', text: `Open this link to confirm access:\n${ORIGIN}/verify/${token}\n\nThis link expires in 15 minutes.` }); }
function security(type, req, url, data = {}) {
  try { return securityEvents.record(type, { request: req, pathname: url?.pathname || req.url,
    ip: ip(req), requestId: req.securityRequestId, ...data }); }
  catch (error) { console.error(JSON.stringify({ event: 'security_event_write_failed', type, error: error.code || error.name || 'Error' })); return null; }
}

async function handleRequest(req, res) {
  req.securityRequestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.securityRequestId);
  if (typeof req.url !== 'string' || !req.url.startsWith('/')) return send(res, 400, {}, '');
  store.purge(); const url = new URL(req.url, ORIGIN);
  const securityUrl = new URL(url);
  res.once('finish', () => {
    try { securityEvents.recordRequestFindings(req, securityUrl, res.statusCode); }
    catch (error) { console.error(JSON.stringify({ event: 'security_event_write_failed', type: 'suspicious_request', error: error.code || error.name || 'Error' })); }
  });
  if (url.pathname === '/healthz') return send(res, ['GET', 'HEAD'].includes(req.method) ? 200 : 405, { 'Content-Type': 'text/plain' }, req.method === 'HEAD' ? '' : 'ok\n');
  if (!allowedHost(req.headers.host)) return send(res, 421, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Misdirected Request\n');
  if (!['GET', 'HEAD', 'POST'].includes(req.method || '')) return send(res, 405, { Allow: 'GET, HEAD, POST' }, '');
  if (url.pathname === '/wolf3d' && ['GET', 'HEAD'].includes(req.method)) return send(res, 308, { Location: '/wolf3d/' }, '');
  const wolfPath = url.pathname === '/wolf3d/' ? '/wolf3d/index.html' : url.pathname;
  if (wolfAssets.has(wolfPath) && ['GET', 'HEAD'].includes(req.method)) {
    const asset = wolfAssets.get(wolfPath);
    const extension = path.extname(wolfPath).toLowerCase();
    const headers = { 'Content-Type': wolfTypes[extension] || 'application/octet-stream', 'Content-Length': asset.length,
      'Cache-Control': extension === '.wl6' || extension === '.sod' ? 'public, max-age=86400' : 'public, max-age=3600' };
    if (extension === '.html') headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'";
    return send(res, 200, headers, req.method === 'HEAD' ? '' : asset);
  }
  if (artwork.has(url.pathname) && ['GET', 'HEAD'].includes(req.method)) { const asset = artwork.get(url.pathname); return send(res, 200, { 'Content-Type': 'image/png', 'Content-Length': asset.length, 'Cache-Control': 'public, max-age=31536000, immutable' }, req.method === 'HEAD' ? '' : asset); }
  if (url.pathname === '/scene-motion.js' && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, motionScript);
  if (url.pathname === '/scene-framing.js' && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, framingScript);
  if (url.pathname === '/scene-game.js' && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, gameScript);
  if (url.pathname === '/future-motion-runtime.js' && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, futureMotionScript);
  if (url.pathname === '/future-feature-clicks.js' && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, featureClicksScript);
  if (url.pathname === '/future-game-carousel.js' && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, futureGameCarouselScript);
  if (url.pathname === '/future-nature-audio.js' && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, futureNatureAudioScript);
  if (url.pathname === '/future-sample-audio.js' && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, futureSampleAudioScript);
  if (url.pathname === '/future-wolf3d-crt.js' && futureWolfCrtScript && ['GET', 'HEAD'].includes(req.method)) return scriptResponse(req, res, url, futureWolfCrtScript);
  if (audioSamples.has(url.pathname) && ['GET', 'HEAD'].includes(req.method)) { const asset=audioSamples.get(url.pathname);return send(res,200,{'Content-Type':'audio/mpeg','Content-Length':asset.length,'Cache-Control':'public, max-age=31536000, immutable'},req.method==='HEAD'?'':asset); }
  if (bundleManifests.has(url.pathname) && ['GET', 'HEAD'].includes(req.method)) { const body = bundleManifests.get(url.pathname); return send(res, 200, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=3600' }, req.method === 'HEAD' ? '' : body); }
  const uploaded = /^\/assets\/uploads\/(img-[a-f0-9]{48})\.(png|webp)$/.exec(url.pathname);
  if (uploaded && ['GET', 'HEAD'].includes(req.method)) {
    if (sceneStore.active().scene.backgroundId !== uploaded[1]) return send(res, 404, {}, '');
    const image = imageLibrary.image(uploaded[1]);
    if (!image || image.mediaType !== 'image/' + uploaded[2]) return send(res, 404, {}, '');
    const asset = imageLibrary.body(uploaded[1]);
    if (!asset) return send(res, 404, {}, '');
    return send(res, 200, { 'Content-Type': image.mediaType, 'Content-Length': asset.length, 'Cache-Control': 'public, max-age=31536000, immutable' }, req.method === 'HEAD' ? '' : asset);
  }
  if (url.pathname === '/api/arcade/scores' && req.method === 'GET') {
    try { return send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ board: arcadeLeaderboard.list(url.searchParams.get('game') || '') })); }
    catch (_) { return send(res, 400, { 'Content-Type': 'application/json; charset=utf-8' }, '{"board":[]}'); }
  }
  if (url.pathname === '/api/arcade/scores' && req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, {}, '');
    const sourceIp = ip(req);
    if (!store.allowAttempt(sourceIp, 'arcade-score:' + sourceIp, 12, 12)) return send(res, 429, {}, '');
    try { const result = arcadeLeaderboard.submit(await readJson(req)); return send(res, 200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(result)); }
    catch (_) { return send(res, 409, { 'Content-Type': 'application/json; charset=utf-8' }, '{"detail":"Score could not be recorded"}'); }
  }
  if (url.pathname === '/') {
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/html; charset=utf-8' }, methodPage());
    const [browserId, browserCookie] = browser(req); const token = store.createChallenge(tokenHash(browserId), Date.now() + CHALLENGE_TTL);
    const nonce = crypto.randomBytes(18).toString('base64');
    const publicScene = sceneStore.active().scene;
    if (!firewallActive()) publicScene.hotspots = publicScene.hotspots.filter((item) => item.destinationId !== 'firewall');
    const body = landingPage(null, null, nonce, publicScene, backgrounds());
    const challengeCookie = portalChallengeCookie(token);
    if (req.method === 'GET') security('portal_visit', req, url, { outcome: 'challenge_created', status: 200, destination: 'torrentharbor' });
    return send(res, 200, { 'Content-Security-Policy': `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self' ${FIREWALL_ORIGIN}; frame-ancestors 'none'`, 'Referrer-Policy': 'strict-origin', 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': browserCookie ? [browserCookie, challengeCookie] : challengeCookie }, req.method === 'HEAD' ? '' : body);
  }
  if (url.pathname === '/challenge/current/qr' && req.method === 'GET') {
    const [token, challenge] = currentChallenge(req);
    if (!challenge || challenge.status !== 'pending' || challenge.destinationId === 'firewall' || Date.parse(challenge.expiresAt) <= Date.now()) return send(res, 404, {}, '');
    if (!sequenceUnlocked(token, sceneStore.active(), 'torrentharbor')) return send(res, 404, {}, '');
    const qr = await QRCode.toString(`${ORIGIN}/login/${token}`, { type: 'svg', errorCorrectionLevel: 'H', margin: 1 });
    return send(res, 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }, qr);
  }
  if (url.pathname === '/challenge/current' && req.method === 'GET') {
    const [token, challenge] = currentChallenge(req);
    if (!challenge || challenge.destinationId === 'firewall') return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ terminal: true }));
    url.pathname = '/challenge/' + token;
  }
  if (url.pathname === '/api/scene/hit' && req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, {}, '');
    let [token, challenge] = currentChallenge(req);
    const renewalCookies = [];
    if (!challenge || challenge.status !== 'pending' || Date.parse(challenge.expiresAt) <= Date.now()) {
      const [browserId, browserCookie] = browser(req);
      token = store.createChallenge(tokenHash(browserId), Date.now() + CHALLENGE_TTL);
      challenge = store.getChallenge(token, tokenHash(browserId));
      if (browserCookie) renewalCookies.push(browserCookie);
      renewalCookies.push(portalChallengeCookie(token));
    }
    let point;
    try { point = await readJson(req); } catch (_) { return send(res, 400, {}, ''); }
    const active = sceneStore.active();
    const session = clickSession(token, active.activationId || active.revisionId);
    const result = advanceSceneClick(active.scene, point.x, point.y,
      point.width, point.height, firewallActive(), session.progress, Date.now());
    session.progress = result.progress;
    if (result.destination && needsSequence(active.scene, result.destination)) session.unlocks.add(result.destination);
    const destination = result.destination;
    const accepted = Boolean(destination || result.progress);
    const acceptedStep = result.progress ? result.progress.next : (destination ? 'complete' : 0);
    return send(res, 200, { 'Content-Type': 'application/json; charset=utf-8',
      ...(renewalCookies.length ? { 'Set-Cookie': renewalCookies } : {}) },
    JSON.stringify({ destination, accepted, acceptedStep }));
  }
  if (url.pathname === '/api/challenge/firewall' && req.method === 'POST') {
    if (!firewallActive()) return send(res, 404, {}, '');
    if (!sameOrigin(req)) return send(res, 403, {}, '');
    const [pageToken, pageChallenge] = currentChallenge(req);
    if (needsSequence(sceneStore.active().scene, 'firewall') &&
        (!pageChallenge || pageChallenge.status !== 'pending' ||
         Date.parse(pageChallenge.expiresAt) <= Date.now() ||
         !sequenceUnlocked(pageToken, sceneStore.active(), 'firewall'))) return send(res, 404, {}, '');
    const [browserId, browserCookie] = browser(req);
    const priorToken = cookie(req, 'portal_firewall_challenge');
    const prior = /^[A-Za-z0-9_-]{43}$/.test(priorToken)
      ? store.getChallenge(priorToken, tokenHash(browserId)) : null;
    const reusable = prior?.destinationId === 'firewall' && prior.status === 'pending'
      && Date.parse(prior.expiresAt) > Date.now();
    if (!reusable && !store.allowAttempt(ip(req), 'firewall-challenge', 12, 100)) return send(res, 429, {}, '');
    const token = reusable ? priorToken : store.createChallenge(tokenHash(browserId), Date.now() + CHALLENGE_TTL, 'firewall');
    const qr = await QRCode.toString(`${ORIGIN}/login/${token}`, { type: 'svg', errorCorrectionLevel: 'H', margin: 1 });
    const challengeCookie = `portal_firewall_challenge=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`;
    return send(res, 200, { 'Content-Type': 'application/json', 'Set-Cookie': browserCookie ? [browserCookie, challengeCookie] : challengeCookie }, JSON.stringify({ qr, token }));
  }
  const registration = /^\/register-firewall\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
  if (registration && ['GET', 'POST'].includes(req.method)) {
    if (!firewallRegistration.preview(registration[1])) return neutral(res, 404);
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return neutral(res, 403);
      try { await firewallRegistration.confirm(registration[1]); return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, confirmedPage()); }
      catch (_) { return neutral(res, 404); }
    }
    return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' },
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm firewall access</title><style>body{font:18px system-ui;background:#101b25;color:#f8fafc;min-height:100vh;display:grid;place-items:center;margin:0}main{max-width:32rem;padding:2rem;background:#1d2c3a;border-radius:1rem}button{font:inherit;background:#62d9ca;color:#10212a;border:0;border-radius:.5rem;padding:.7rem 1rem;cursor:pointer}</style></head><body><main><h1>Confirm firewall access</h1><p>This registration adds your verified Authentik account to the firewall access list. Each firewall visit still requires a separate QR and email approval, followed by the normal firewall login.</p><form method="post"><button type="submit">Confirm registration</button></form></main></body></html>`);
  }
  if (url.pathname.startsWith('/login/') && ['GET', 'POST'].includes(req.method)) {
    const token = url.pathname.slice(7);
    const requestId = req.method === 'POST' ? req.securityRequestId || newLoginRequestId() : null;
    const record = (destination, outcome, smtpError) => {
      logLoginOutcome(requestId, destination, outcome, smtpError);
      const delivery = outcome.startsWith('smtp_');
      security(delivery ? 'qr_email_delivery' : outcome === 'rate_limited' ? 'rate_limited' : 'qr_login_attempt', req, url, {
        requestId, destination, outcome: outcome === 'smtp_accepted' ? 'accepted' : outcome,
        reason: smtpError || null, severity: ['rate_limited', 'invalid_challenge_token'].includes(outcome) ? 'warning' : 'info',
        status: outcome === 'smtp_accepted' ? 200 : null,
      });
    };
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      if (requestId) record('unknown', 'invalid_challenge_token');
      return neutral(res, 404);
    }
    if (req.method === 'GET') {
      security('qr_login_page_opened', req, url, { outcome: 'valid_token_format', status: 200,
        destination: requestDestination(token) || 'unknown' });
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, loginPage(token));
    }
    const submitted = identifier((await readForm(req)).get('identifier') || '');
    if (!submitted) { record('unknown', 'invalid_identifier'); return neutral(res); }
    if (!store.allowAttempt(ip(req), submitted)) { record('unknown', 'rate_limited'); return neutral(res); }
    let destinationId = 'unknown';
    try {
      const challenge = store.getChallenge(token);
      if (!challenge) { record(destinationId, 'challenge_unavailable'); return neutral(res); }
      destinationId = challenge.destinationId || 'torrentharbor';
      if (challenge.status !== 'pending') { record(destinationId, 'challenge_not_pending'); return neutral(res); }
      if (Date.parse(challenge.expiresAt) <= Date.now()) { record(destinationId, 'challenge_unavailable'); return neutral(res); }
      const group = AUTH_GROUPS[destinationId];
      if (!group || (destinationId === 'firewall' && !firewallActive())) { record(destinationId, 'destination_unavailable'); return neutral(res); }
      let identity;
      try { identity = await findAllowedIdentity(submitted, group); }
      catch (_) { record(destinationId, 'lookup_failed'); return neutral(res); }
      if (!identity) { record(destinationId, 'not_eligible'); return neutral(res); }
      let messageToken;
      try { messageToken = store.createMessage(token, identity, Date.now() + CHALLENGE_TTL); }
      catch (_) { record(destinationId, 'message_create_failed'); return neutral(res); }
      try {
        const result = await deliver(identity.email, messageToken);
        record(destinationId, Array.isArray(result.accepted) && result.accepted.some((address) => address.toLowerCase() === identity.email) ? 'smtp_accepted' : 'smtp_rejected');
      } catch (error) { record(destinationId, 'smtp_failed', smtpErrorClass(error)); }
    } catch (_) { record(destinationId, 'internal_error'); }
    return neutral(res);
  }
  if (url.pathname.startsWith('/verify/') && req.method === 'GET') {
    const token = url.pathname.slice(8);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !store.consumeMessage(token)) {
      security('qr_verified', req, url, { outcome: 'rejected', severity: 'warning', status: 404 });
      return neutral(res, 404);
    }
    security('qr_verified', req, url, { outcome: 'success', status: 200 });
    return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, confirmedPage());
  }
  if (url.pathname.startsWith('/challenge/') && req.method === 'GET') {
    const token = url.pathname.slice(11); const browserId = cookie(req, 'portal_browser'); const challenge = /^[A-Za-z0-9_-]{43}$/.test(token) && browserId ? store.getChallenge(token, tokenHash(browserId)) : null;
    if (!challenge) return send(res, 404, { 'Content-Type': 'application/json' }, '{}');
    if (challenge.status === 'approved') {
      const firewall = challenge.destinationId === 'firewall';
      if (firewall) {
        const handoff = store.approveAndCreateHandoff(token, Date.now() + HANDOFF_TTL);
        security('portal_session_created', req, url, { outcome: 'success', destination: 'firewall', status: 200 });
        return send(res, 200, { 'Content-Type': 'application/json' },
          JSON.stringify({ handoff, action: FIREWALL_ORIGIN + '/_handoff' }));
      }
      const ttl = firewall ? FIREWALL_TTL : SESSION_TTL;
      const session = store.approveAndCreateSession(token, Date.now() + ttl);
      const name = firewall ? 'fw_session' : 'portal_session';
      const redirect = firewall ? FIREWALL_ORIGIN + '/' : '/torrentharbor/';
      security('portal_session_created', req, url, { outcome: 'success', destination: 'torrentharbor', status: 200 });
      return send(res, 200, { 'Content-Type': 'application/json', 'Set-Cookie': `${name}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl / 1000}` }, JSON.stringify({ redirect }));
    }
    return send(res, 200, { 'Content-Type': 'application/json' }, '{}');
  }
  if (url.pathname === '/internal/firewall-handoff' && req.method === 'POST') {
    if (!firewallActive() || !sameOrigin(req)
      || req.headers['x-portal-handoff'] !== 'firewall-v1'
      || String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim() !== 'application/x-www-form-urlencoded')
      return send(res, 403, {}, '');
    const token = (await readForm(req)).get('handoff') || '';
    const session = store.consumeHandoff(token, Date.now() + FIREWALL_TTL);
    if (!session) return send(res, 403, {}, '');
    return send(res, 303, { Location: FIREWALL_ORIGIN + '/',
      'Set-Cookie': `fw_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${FIREWALL_TTL / 1000}` }, '');
  }
  if (url.pathname === '/request-access' && ['GET', 'POST'].includes(req.method)) {
    if (req.method === 'GET') {
      const token = url.searchParams.get('challenge');
      if (token !== null && !requestDestination(token)) return neutral(res, 404);
      return send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, requestPage(token));
    }
    const form = await readForm(req);
    const token = form.get('challenge');
    const destinationId = token === null ? 'torrentharbor' : requestDestination(token);
    const address = email(form.get('email') || '');
    const allowed = Boolean(destinationId && address && store.allowAttempt(ip(req), `${destinationId}:${address}`, 4, 2));
    const created = allowed ? store.createRequest(address, ip(req), destinationId) : null;
    security(allowed ? 'access_request' : 'rate_limited', req, url, {
      outcome: created ? 'accepted' : allowed ? 'duplicate_or_blocked' : 'rejected',
      severity: allowed ? 'info' : 'warning', destination: destinationId || 'unknown',
      identity: address, status: 200,
    });
    return neutral(res);
  }
  if (url.pathname === '/logout' && req.method === 'POST') {
    store.revokeSession(cookie(req, 'portal_session'));
    store.revokeSession(cookie(req, 'fw_session'));
    return send(res, 204, { 'Set-Cookie': [
      'portal_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'fw_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'th_session=; Path=/torrentharbor/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    ] }, '');
  }
  if (url.pathname === '/internal/session-check' && req.method === 'GET') {
    const session = store.session(cookie(req, 'portal_session'));
    if (!session) return send(res, 401, {}, '');
    return send(res, 204, {
      'X-Portal-Assertion': issueAssertion(session),
    }, '');
  }
  if (url.pathname === '/internal/firewall-check' && req.method === 'GET') {
    if (!firewallActive()) return send(res, 403, {}, '');
    const session = store.session(cookie(req, 'fw_session'), 'firewall');
    if (!session) return send(res, 401, {}, '');
    if (firewallChecks.size > 1024) for (const [id, until] of firewallChecks) if (until <= Date.now()) firewallChecks.delete(id);
    const cached = firewallChecks.get(session.id);
    if (cached && cached > Date.now()) return send(res, 204, {}, '');
    try {
      const identity = await findAllowedIdentity(session.identity.email, 'app:firewall');
      if (!identity || identity.subject !== session.identity.subject) return send(res, 403, {}, '');
      firewallChecks.set(session.id, Date.now() + 10000);
      return send(res, 204, {}, '');
    } catch (_) { return send(res, 403, {}, ''); }
  }
  if (url.pathname.startsWith('/internal/torrentharbor-management/')) {
    if (peerIp(req) !== MANAGEMENT_SOURCE_IP) return send(res, 404, {}, '');
    const acceptsJson = !req.headers.accept || req.headers.accept === '*/*' || req.headers.accept.split(',').some((value) => value.trim().split(';')[0] === 'application/json');
    const jsonRequest = req.method === 'GET' || String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim() === 'application/json';
    if (!acceptsJson || !jsonRequest) return send(res, 404, { 'Content-Type': 'application/json' }, '{}');
    try {
      const action = url.pathname.slice('/internal/torrentharbor-management'.length);
      let result;
      if (action === '/status' && req.method === 'GET') result = await management.status();
      else if (action === '/users' && req.method === 'POST') result = await management.provision(await readJson(req));
      else if (action === '/users/rollback' && req.method === 'POST') result = await management.rollback((await readJson(req)).subject);
      else if (action === '/access-requests' && req.method === 'GET') {
        const keys = [...url.searchParams.keys()];
        if (keys.some((key) => !['status', 'limit', 'cursor'].includes(key)) || new Set(keys).size !== keys.length) throw new Error('Invalid query');
        const rawLimit = url.searchParams.get('limit');
        const limit = rawLimit === null ? 100 : /^[1-9][0-9]{0,2}$/.test(rawLimit) ? Number(rawLimit) : NaN;
        result = store.listRequests(url.searchParams.has('status') ? url.searchParams.get('status') : 'pending', limit, url.searchParams.get('cursor'));
      }
      else if (/^\/access-requests\/[^/]+\/(approve|block|unblock)$/.test(action) && req.method === 'POST') {
        const [, id, decision] = /^\/access-requests\/([^/]+)\/(approve|block|unblock)$/.exec(action);
        const body = await readJson(req);
        if (Object.keys(body).length !== 1) throw new Error('Invalid decision body');
        result = store.decideRequest(id, decision, body.decisionRef);
      }
      else return send(res, 404, {}, '');
      return send(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify(result));
    } catch (_) { return send(res, 409, { 'Content-Type': 'application/json' }, '{"detail":"Request could not be completed"}'); }
  }
  security('request_rejected', req, url, { outcome: 'not_found', severity: 'warning', status: 404 });
  return send(res, 404, { 'Content-Type': 'text/html; charset=utf-8' }, notFoundPage());
}

function hardenedServer(handler, requestTimeout = 15000) {
  const instance = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      console.error(JSON.stringify({ event: 'request_failed', requestId: request.securityRequestId || null,
        error: error?.code || error?.name || 'Error' }));
      if (response.headersSent) return response.destroy();
      const status = error?.code === 'REQUEST_TOO_LARGE' ? 413
        : error?.code === 'REQUEST_ABORTED' ? 400 : 500;
      send(response, status, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Request could not be completed\n');
    });
  });
  instance.requestTimeout = requestTimeout;
  instance.headersTimeout = 10000;
  instance.keepAliveTimeout = 5000;
  instance.maxRequestsPerSocket = 500;
  instance.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return instance;
}

const server = hardenedServer(handleRequest);
let adminServer = null;
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`Access portal listening on ${PORT}`));
if (require.main === module && ADMIN_PORT) {
  adminServer = hardenedServer(createSceneAdmin(DATA_DIR, securityEvents, telegramAlerts, maxMindSetup), 60000);
  adminServer.listen(ADMIN_PORT, '0.0.0.0', () => console.log(`Access scene management listening on ${ADMIN_PORT}`));
}
if (require.main === module) {
  const shutdown = async () => {
    const deadline = setTimeout(() => process.exit(1), 8000);
    deadline.unref();
    const close = (instance) => new Promise((resolve) => {
      if (!instance?.listening) return resolve();
      instance.close(resolve);
    });
    try {
      await Promise.all([close(server), close(adminServer)]);
      wafIngestor.stop();
      await securityEvents.flush();
      process.exit(0);
    } catch (_) { process.exit(1); }
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
module.exports = { server };

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { BACKGROUNDS, DESTINATIONS, SCENE_BUNDLES, SceneStore } = require('./scene-config');
const { ImageLibrary } = require('./scene-assets');
const { DestinationRegistry } = require('./scene-destinations');
const { PortalStore } = require('./store');
const { createDestinationDirectory } = require('./destination-directory');
const { prepareFirewallDestination } = require('./destination-plan');
const { getFirewallRegistration } = require('./firewall-registration');
const { FIREWALL_PUBLIC } = require('./destination-plan');
const { GeoIpLookup } = require('./geoip');
const { SecurityEvents, sourceIp } = require('./security-events');
const { TelegramAlerts } = require('./telegram-alerts');

const ADMIN_ORIGIN = (process.env.ADMIN_ORIGIN || 'http://localhost:8081').replace(/\/$/, '');
// Renewals are throttled to 15 minutes, so include that margin to ensure
// every interaction leaves at least twelve hours before cookie expiry.
const EDITOR_SESSION_SECONDS = (12 * 60 * 60) + (15 * 60);
const CLIENT = fs.readFileSync(path.join(__dirname, 'scene-admin-client.js'));
const MOTION_CLIENT = fs.readFileSync(path.join(__dirname, 'scene-motion-renderer.js'));
const FRAMING_CLIENT = fs.readFileSync(path.join(__dirname, 'scene-framing.js'));
const GAME_CLIENT = fs.readFileSync(path.join(__dirname, 'scene-game.js'));
const FUTURE_MOTION_CLIENT = fs.readFileSync(path.join(__dirname, 'future-motion-runtime.js'));
const FEATURE_CLICKS_CLIENT = fs.readFileSync(path.join(__dirname, 'future-feature-clicks.js'));
const FUTURE_GAME_CAROUSEL_CLIENT = fs.readFileSync(path.join(__dirname, 'future-game-carousel.js'));
const PAGE = fs.readFileSync(path.join(__dirname, 'scene-admin.html'));
const ASSETS = new Map(Object.values(BACKGROUNDS).map((item) => [
  '/assets/' + item.file,
  { body: fs.readFileSync(path.join(__dirname, 'assets', item.file)), mediaType: item.mediaType },
]));
for (const file of ['clouds-upper.png', 'fog-near.png', 'rain.png', 'water-reflections.png']) {
  ASSETS.set('/motion/immersive-city-candidate-a/' + file, {
    body: fs.readFileSync(path.join(__dirname, 'assets', 'motion', 'immersive-city-candidate-a', file)), mediaType: 'image/png',
  });
}
for (const [id, bundle] of Object.entries(SCENE_BUNDLES)) {
  ASSETS.set('/scene-bundles/' + id + '/motion.json', { body: Buffer.from(JSON.stringify(bundle)), mediaType: 'application/json' });
}

function send(response, status, headers, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function identity(request) {
  // Nginx injects this only after the private listener's HTTP Basic check.
  // The public listener never routes to this server.
  const username = String(request.headers['x-scene-admin'] || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(username)) return null;
  return { username };
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((value) => value.trim().split('=', 2)).filter((parts) => parts.length === 2));
}

function csrf(request) {
  const cookie = cookies(request).scene_csrf || '';
  const header = String(request.headers['x-scene-csrf'] || '');
  const left = Buffer.from(cookie);
  const right = Buffer.from(header);
  return request.headers.origin === ADMIN_ORIGIN && left.length === 43 && right.length === 43 && crypto.timingSafeEqual(left, right);
}

function csrfFailure(request, response) {
  const cookie = cookies(request).scene_csrf || '';
  const header = String(request.headers['x-scene-csrf'] || '');
  if (!cookie || !header) return json(response, 419, { error: 'Editor session expired', reauthenticate: true });
  return json(response, 403, { error: 'Request rejected' });
}

function editorSession(response, page = false, head = false, existingToken = null) {
  const token = existingToken || crypto.randomBytes(32).toString('base64url');
  return send(response, 200, {
    'Content-Type': page ? 'text/html; charset=utf-8' : 'application/json',
    'Set-Cookie': 'scene_csrf=' + token + '; Path=/; Secure; SameSite=Strict; Max-Age=' + EDITOR_SESSION_SECONDS,
  }, head ? '' : page ? PAGE : JSON.stringify({ expiresInSeconds: EDITOR_SESSION_SECONDS }));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    request.setEncoding('utf8');
    request.on('data', (part) => {
      bytes += Buffer.byteLength(part);
      if (bytes > 65536) {
        reject(new Error('Request too large'));
        request.destroy();
        return;
      }
      body += part;
    });
    request.on('end', () => {
      try {
        const value = JSON.parse(body || '{}');
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid JSON');
        resolve(value);
      } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function json(response, status, value, headers = {}) {
  send(response, status, { 'Content-Type': 'application/json', ...headers }, JSON.stringify(value));
}

function readImage(request) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    request.on('data', (part) => {
      size += part.length;
      if (size > 15 * 1024 * 1024) {
        reject(new Error('Image exceeds size limit'));
        request.destroy();
      } else parts.push(part);
    });
    request.on('end', () => resolve(Buffer.concat(parts)));
    request.on('error', reject);
  });
}

function createSceneAdmin(directory, suppliedSecurityEvents = null, suppliedTelegramAlerts = null) {
  const images = new ImageLibrary(directory);
  const destinations = new DestinationRegistry(directory);
  function firewallProvisioningReceipt() {
    const file = path.join(directory, 'scene-management', 'firewall-provisioning-receipt.json');
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || (stat.mode & 0o022)) return null;
      const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (receipt.version !== 1 || receipt.route !== FIREWALL_PUBLIC
        || receipt.authentikLaunch !== FIREWALL_PUBLIC
        || !/^[a-f0-9]{64}$/.test(receipt.proxySha256 || '')
        || !/^[a-f0-9]{64}$/.test(receipt.routerSha256 || '')
        || !/^[0-9a-f-]{36}$/.test(receipt.groupPk || '')
        || !/^[0-9a-f-]{36}$/.test(receipt.applicationPk || '')
        || !/^[a-f0-9]{64}$/.test(receipt.certificateSha256 || '')
        || !Number.isFinite(Date.parse(receipt.validatedAt))
        || Date.now() - Date.parse(receipt.validatedAt) > 24 * 60 * 60 * 1000) return null;
      return receipt;
    } catch (_) { return null; }
  }
  const firewallRegistration = getFirewallRegistration(directory);
  const accessRequests = new PortalStore(directory);
  const securityEvents = suppliedSecurityEvents || new SecurityEvents(directory, new GeoIpLookup());
  const telegramAlerts = suppliedTelegramAlerts || new TelegramAlerts(directory);
  const directoryApi = createDestinationDirectory();
  const backgrounds = () => ({ ...BACKGROUNDS, ...images.catalog() });
  const activeDestinations = () => ['torrentharbor', ...destinations.list().filter((item) => item.status === 'active').map((item) => item.id)];
  const store = new SceneStore(directory, backgrounds, activeDestinations);
  function references() {
    const active = store.active().scene.backgroundId;
    const draft = store.draft()?.scene.backgroundId || null;
    const history = store.history().map((item) => item.scene.backgroundId);
    return { active, draft, history, all: new Set([active, draft, ...history]) };
  }
  return async function sceneAdmin(request, response) {
    const administrator = identity(request);
    if (!administrator) return send(response, 404, {}, '');
    const url = new URL(request.url, ADMIN_ORIGIN);

    if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(request.method)) {
      return send(response, 200, { 'Content-Type': 'text/plain' }, request.method === 'HEAD' ? '' : 'ok\n');
    }
    if (url.pathname === '/' && ['GET', 'HEAD'].includes(request.method)) {
      return editorSession(response, true, request.method === 'HEAD');
    }
    if (url.pathname === '/api/editor-session' && request.method === 'GET') {
      return editorSession(response);
    }
    if (url.pathname === '/api/editor-session' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      return editorSession(response, false, false, cookies(request).scene_csrf);
    }
    if (url.pathname === '/admin.js' && ['GET', 'HEAD'].includes(request.method)) {
      return send(response, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }, request.method === 'HEAD' ? '' : CLIENT);
    }
    if (url.pathname === '/scene-motion.js' && ['GET', 'HEAD'].includes(request.method)) {
      return send(response, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }, request.method === 'HEAD' ? '' : MOTION_CLIENT);
    }
    if (url.pathname === '/scene-framing.js' && ['GET', 'HEAD'].includes(request.method)) {
      return send(response, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }, request.method === 'HEAD' ? '' : FRAMING_CLIENT);
    }
    if (url.pathname === '/scene-game.js' && ['GET', 'HEAD'].includes(request.method)) {
      return send(response, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }, request.method === 'HEAD' ? '' : GAME_CLIENT);
    }
    if (url.pathname === '/future-motion-runtime.js' && ['GET', 'HEAD'].includes(request.method)) {
      return send(response, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }, request.method === 'HEAD' ? '' : FUTURE_MOTION_CLIENT);
    }
    if (url.pathname === '/future-feature-clicks.js' && ['GET', 'HEAD'].includes(request.method)) {
      return send(response, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }, request.method === 'HEAD' ? '' : FEATURE_CLICKS_CLIENT);
    }
    if (url.pathname === '/future-game-carousel.js' && ['GET', 'HEAD'].includes(request.method)) {
      return send(response, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }, request.method === 'HEAD' ? '' : FUTURE_GAME_CAROUSEL_CLIENT);
    }
    if (ASSETS.has(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
      const asset = ASSETS.get(url.pathname);
      return send(response, 200, { 'Content-Type': asset.mediaType, 'Content-Length': asset.body.length, 'Cache-Control': 'private, max-age=3600' }, request.method === 'HEAD' ? '' : asset.body);
    }
    const uploaded = /^\/assets\/uploads\/(img-[a-f0-9]{48})\.(png|webp)$/.exec(url.pathname);
    if (uploaded && ['GET', 'HEAD'].includes(request.method)) {
      const image = images.image(uploaded[1]);
      if (!image || image.mediaType !== 'image/' + uploaded[2]) return send(response, 404, {}, '');
      const body = images.body(uploaded[1]);
      if (!body) return send(response, 404, {}, '');
      return send(response, 200, { 'Content-Type': image.mediaType, 'Content-Length': body.length, 'Cache-Control': 'private, max-age=3600' }, request.method === 'HEAD' ? '' : body);
    }
    if (url.pathname.startsWith('/api/qr-preview/') && request.method === 'GET') {
      const destinationId = url.pathname.slice('/api/qr-preview/'.length);
      if (!activeDestinations().includes(destinationId)) return send(response, 404, {}, '');
      const preview = await QRCode.toString(ADMIN_ORIGIN + '/preview-only/' + destinationId, {
        type: 'svg', errorCorrectionLevel: 'H', margin: 1,
      });
      return send(response, 200, { 'Content-Type': 'image/svg+xml' }, preview);
    }
    if (url.pathname === '/api/state' && request.method === 'GET') {
      const refs = references();
      return json(response, 200, {
        active: store.active(),
        draft: store.draft(),
        history: store.distinctHistory().slice(0, 50),
        backgrounds: Object.values(backgrounds()).map((item) => ({
          ...item, bytes: item.bytes ?? ASSETS.get('/assets/' + item.file)?.body.length,
        })),
        bundles: SCENE_BUNDLES,
        imageReferences: { active: refs.active, draft: refs.draft, history: refs.history },
        destinations: Object.values(DESTINATIONS).filter((item) => activeDestinations().includes(item.id)),
        pendingDestinations: destinations.list(),
        firewallProvisioningReady: Boolean(firewallProvisioningReceipt()),
        firewallRegistrations: firewallRegistration.status(),
        accessRequests: Object.fromEntries(activeDestinations().map((id) => [id, accessRequests.listRequests('pending', 100, null, id)])),
        existingIntegration: {
          id: 'torrentharbor', status: 'configured; live import pending',
          publicRoute: process.env.TORRENTHARBOR_PUBLIC_ROUTE || 'http://localhost:8080/torrentharbor/',
          upstream: process.env.TORRENTHARBOR_UPSTREAM || 'torrentharbor.example.invalid:443',
          tlsName: process.env.TORRENTHARBOR_TLS_NAME || 'torrentharbor.example.invalid',
          authentikGroup: 'app:torrentharbor',
          authFlow: 'QR, canonical email, portal session, Ed25519 SSO',
          sessionHours: 168, assertionAudience: process.env.PORTAL_ASSERTION_AUDIENCE || 'torrentharbor',
          sceneRevision: store.active().revisionId,
          hotspot: store.active().scene.hotspots.find((item) => item.destinationId === 'torrentharbor') || null,
          smtp: 'inherited from the access portal',
        },
      });
    }
    if (url.pathname === '/api/security/summary' && request.method === 'GET') {
      return json(response, 200, securityEvents.summary());
    }
    if (url.pathname === '/api/security/events' && request.method === 'GET') {
      const keys = [...url.searchParams.keys()];
      if (keys.some((key) => !['limit', 'severity', 'type', 'since'].includes(key)) || new Set(keys).size !== keys.length) {
        return json(response, 400, { error: 'Invalid security-event query' });
      }
      return json(response, 200, { events: securityEvents.list(Object.fromEntries(url.searchParams)) });
    }
    if (url.pathname === '/api/security/telegram' && request.method === 'GET') {
      return json(response, 200, telegramAlerts.state());
    }
    if (url.pathname === '/api/security/telegram/setup/token' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try {
        const body = await readJson(request);
        if (Object.keys(body).sort().join(',') !== 'token') throw new Error('Invalid Telegram bot token');
        const result = await telegramAlerts.configureToken(body.token);
        securityEvents.record('admin_action', { request, pathname: url.pathname,
          ip: sourceIp(request), identity: administrator.username,
          outcome: 'success', reason: 'telegram_bot_configured', status: 200 });
        return json(response, 200, result);
      } catch (error) {
        const message = ['Invalid Telegram bot token', 'Telegram rejected the request',
          'Telegram API is unavailable', 'Telegram API returned an invalid response',
          'Telegram did not return a valid bot identity'].includes(error.message)
          ? error.message : 'Telegram bot configuration failed';
        return json(response, message.startsWith('Invalid') ? 400 : 502, { error: message });
      }
    }
    if (url.pathname === '/api/security/telegram/setup/chats' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try { return json(response, 200, await telegramAlerts.discoverChats()); }
      catch (error) {
        const message = error.message === 'Configure a Telegram bot token first' ? error.message
          : error.message === 'Telegram API is unavailable' ? error.message : 'Telegram chat discovery failed';
        return json(response, message.includes('first') ? 409 : 502, { error: message });
      }
    }
    if (url.pathname === '/api/security/telegram/setup/chat' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try {
        const body = await readJson(request);
        if (Object.keys(body).sort().join(',') !== 'chatId') throw new Error('Invalid Telegram chat ID');
        const result = await telegramAlerts.configureChat(body.chatId);
        securityEvents.record('admin_action', { request, pathname: url.pathname,
          ip: sourceIp(request), identity: administrator.username,
          outcome: 'success', reason: 'telegram_destination_configured', status: 200 });
        return json(response, 200, result);
      } catch (error) {
        const message = ['Invalid Telegram chat ID', 'Configure a Telegram bot token first',
          'Telegram rejected the request', 'Telegram API is unavailable',
          'Telegram did not return a valid destination'].includes(error.message)
          ? error.message : 'Telegram destination configuration failed';
        return json(response, message.startsWith('Invalid') ? 400
          : message.includes('first') ? 409 : 502, { error: message });
      }
    }
    if (url.pathname === '/api/security/telegram/setup' && request.method === 'DELETE') {
      if (!csrf(request)) return csrfFailure(request, response);
      try {
        const result = telegramAlerts.disconnect();
        securityEvents.record('admin_action', { request, pathname: url.pathname,
          ip: sourceIp(request), identity: administrator.username,
          outcome: 'success', reason: 'telegram_disconnected', status: 200 });
        return json(response, 200, result);
      } catch (_) { return json(response, 500, { error: 'Telegram integration could not be removed' }); }
    }
    if (url.pathname === '/api/security/telegram' && request.method === 'PUT') {
      if (!csrf(request)) return csrfFailure(request, response);
      try {
        const result = telegramAlerts.updatePolicy(await readJson(request));
        securityEvents.record('admin_action', { request, pathname: url.pathname,
          ip: sourceIp(request), identity: administrator.username,
          outcome: 'success', reason: 'telegram_policy_updated', status: 200 });
        return json(response, 200, result);
      } catch (_) { return json(response, 400, { error: 'Invalid Telegram alert policy' }); }
    }
    if (url.pathname === '/api/security/telegram/test' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try {
        const result = await telegramAlerts.test();
        securityEvents.record('admin_action', { request, pathname: url.pathname,
          ip: sourceIp(request), identity: administrator.username,
          outcome: 'success', reason: 'telegram_test_requested', status: 200 });
        return json(response, 200, result);
      } catch (error) {
        const message = error.message === 'Telegram credentials are not configured'
          ? error.message : error.message === 'Telegram test is rate limited' ? error.message : 'Telegram test failed';
        return json(response, message.includes('not configured') ? 409 : 429, { error: message });
      }
    }
    const destinationSnapshot = /^\/api\/destinations\/(torrentharbor|firewall)\/snapshot$/.exec(url.pathname);
    if (destinationSnapshot && request.method === 'GET') {
      if (!activeDestinations().includes(destinationSnapshot[1])) return json(response, 404, { error: 'Destination unavailable' });
      try {
        const id = destinationSnapshot[1];
        const imported = await directoryApi.snapshot(id);
        return json(response, 200, { ...imported,
          requests: { pending: accessRequests.listRequests('pending', 100, null, id),
            blocked: accessRequests.listRequests('blocked', 100, null, id) },
          registrations: id === 'firewall' ? firewallRegistration.status() : [] });
      } catch (_) { return json(response, 503, { error: 'Live destination import unavailable' }); }
    }
    const requestDecision = /^\/api\/destinations\/(torrentharbor|firewall)\/requests\/([A-Za-z0-9_-]{22})\/(approve|block|unblock|dismiss)$/.exec(url.pathname);
    if (requestDecision && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      const [, id, requestId, action] = requestDecision;
      if (!activeDestinations().includes(id)) return json(response, 404, { error: 'Destination unavailable' });
      try {
        if (action === 'approve') {
          if (id === 'torrentharbor') throw new Error('TorrentHarbor approval requires its application account workflow');
          const entry = accessRequests.getRequest(requestId, id);
          if (!entry || entry.status !== 'pending') throw new Error('Request changed');
          const imported = await directoryApi.snapshot(id);
          if (imported.users.filter((user) => user.active && user.email.toLowerCase() === entry.email).length !== 1) throw new Error('Add this user to the destination group before approving');
        }
        const result = accessRequests.adminRequest(requestId, id, action);
        securityEvents.record('admin_action', { request, pathname: url.pathname,
          ip: sourceIp(request), identity: administrator.username, destination: id,
          outcome: 'success', reason: `access_request_${action}`, status: 200 });
        return json(response, 200, result);
      } catch (error) { return json(response, 409, { error: ['Add this user to the destination group before approving', 'TorrentHarbor approval requires its application account workflow'].includes(error.message) ? error.message : 'Request changed; refresh the destination' }); }
    }
    const addMember = /^\/api\/destinations\/(torrentharbor|firewall)\/members$/.exec(url.pathname);
    if (addMember && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      if (!activeDestinations().includes(addMember[1])) return json(response, 404, { error: 'Destination unavailable' });
      try {
        const body = await readJson(request);
        if (Object.keys(body).length !== 1 || typeof body.identifier !== 'string') throw new Error('Invalid member');
        return json(response, 200, await directoryApi.addExisting(addMember[1], body.identifier));
      } catch (_) { return json(response, 409, { error: 'Exact account assignment unavailable; refresh and check Authentik permissions' }); }
    }
    const memberAction = /^\/api\/destinations\/(torrentharbor|firewall)\/members\/([0-9]{1,20})\/(remove|delete)$/.exec(url.pathname);
    if (memberAction && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      const [, id, subject, action] = memberAction;
      if (!activeDestinations().includes(id)) return json(response, 404, { error: 'Destination unavailable' });
      try {
        let result;
        if (action === 'remove') result = await directoryApi.removeMember(id, subject);
        else {
          const body = await readJson(request);
          if (Object.keys(body).length !== 1 || typeof body.confirmation !== 'string') throw new Error('Invalid confirmation');
          result = await directoryApi.deleteManagedUser(id, subject, body.confirmation);
        }
        const revoked = accessRequests.revokeDestinationSessions(subject, id);
        return json(response, 200, { ...result, portalSessionsRevoked: revoked });
      } catch (_) { return json(response, 409, { error: 'Member action unavailable; refresh and check account scope or Authentik permissions' }); }
    }
    if (url.pathname === '/api/destinations' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try { return json(response, 201, destinations.add(await readJson(request))); }
      catch (_) { return json(response, 400, { error: 'Invalid pending destination' }); }
    }
    if (url.pathname === '/api/destinations/prepare' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try { return json(response, 200, prepareFirewallDestination(await readJson(request))); }
      catch (_) { return json(response, 400, { error: 'Unsupported destination plan' }); }
    }
    if (url.pathname === '/api/destinations/firewall/activate' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      const receipt = firewallProvisioningReceipt();
      if (!receipt) return json(response, 409, { error: 'Firewall setup checks are incomplete' });
      try { return json(response, 200, destinations.activate('firewall', receipt)); }
      catch (_) { return json(response, 409, { error: 'Firewall destination is not pending' }); }
    }
    if (url.pathname === '/api/firewall-users' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try { return json(response, 202, await firewallRegistration.prepare(await readJson(request))); }
      catch (error) { return json(response, 409, { error: error.message === 'Account conflict' ? 'Account conflict; review the exact Authentik identity' : 'Registration unavailable' }); }
    }
    if (url.pathname === '/api/images' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      if (String(request.headers['content-type'] || '').split(';')[0].toLowerCase() !== 'image/png') return json(response, 415, { error: 'PNG images only' });
      if (Number(request.headers['content-length']) > 15 * 1024 * 1024) return json(response, 413, { error: 'Image exceeds size limit' });
      try { return json(response, 201, images.upload(await readImage(request), request.headers['x-image-label'])); }
      catch (error) { return json(response, 400, { error: error.message }); }
    }
    const optimize = /^\/api\/backgrounds\/([a-z][a-z0-9-]{0,63})\/optimize$/.exec(url.pathname);
    if (optimize && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      if (String(request.headers['content-type'] || '').split(';')[0].toLowerCase() !== 'application/json') return json(response, 415, { error: 'JSON required' });
      const source = backgrounds()[optimize[1]];
      if (!source || source.status === 'archived' || source.mediaType !== 'image/png') return json(response, 404, { error: 'PNG background not available' });
      try {
        const options = await readJson(request);
        if (!Object.keys(options).every((key) => key === 'quality') || ![88, 94].includes(options.quality)) throw new Error('Choose an available quality preset');
        const body = source.id.startsWith('img-') ? images.body(source.id) : ASSETS.get('/assets/' + source.file)?.body;
        if (!body) throw new Error('Background image unavailable');
        const result = await images.optimizePng(body, {
          sourceId: source.id, label: source.label || source.id, bundleId: source.bundleId || null, quality: options.quality,
        });
        return json(response, result.unchanged ? 200 : 201, result);
      } catch (error) { return json(response, 400, { error: error.message }); }
    }
    const imageAction = /^\/api\/images\/(img-[a-f0-9]{48})\/(archive|restore|purge)$/.exec(url.pathname);
    if (imageAction && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      if (imageAction[2] === 'purge') {
        if (String(request.headers['content-type'] || '').split(';')[0].toLowerCase() !== 'application/json') return json(response, 415, { error: 'JSON required' });
        const image = images.image(imageAction[1]);
        if (!image) return json(response, 404, { error: 'Image not found' });
        const refs = references();
        if (refs.active === image.id || refs.draft === image.id) return json(response, 409, { error: 'Switch the active scene or draft to another background before deleting this image' });
        if (refs.history.includes(image.id)) return json(response, 409, { error: 'This image is retained by a saved scene revision. Remove it from the background list instead so rollback remains available.' });
        try {
          const body = await readJson(request);
          const expected = image.optimizedFrom ? 'DELETE OPTIMIZED COPY' : 'PERMANENTLY DELETE ORIGINAL';
          if (body.confirmation !== expected) return json(response, 400, { error: 'Permanent-delete confirmation did not match' });
          if (image.status !== 'archived') images.archive(image.id);
          images.purge(image.id, refs.all, true);
          return json(response, 200, { id: image.id, deleted: true });
        } catch (error) { return json(response, 400, { error: error.message }); }
      }
      if (imageAction[2] === 'archive') {
        const refs = references();
        if (refs.active === imageAction[1] || refs.draft === imageAction[1]) return json(response, 409, { error: 'Image is active or in a draft' });
      }
      try { return json(response, 200, images[imageAction[2]](imageAction[1])); }
      catch (_) { return json(response, 404, { error: 'Image not found' }); }
    }
    if (url.pathname === '/api/draft' && request.method === 'PUT') {
      if (!csrf(request)) return csrfFailure(request, response);
      try { return json(response, 200, store.saveDraft((await readJson(request)).scene)); }
      catch (_) { return json(response, 400, { error: 'Invalid scene configuration' }); }
    }
    if (url.pathname === '/api/publish' && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try { return json(response, 201, store.publish((await readJson(request)).scene, administrator.username)); }
      catch (_) { return json(response, 400, { error: 'Invalid scene configuration' }); }
    }
    if (url.pathname.startsWith('/api/rollback/') && request.method === 'POST') {
      if (!csrf(request)) return csrfFailure(request, response);
      try {
        const result = store.rollback(url.pathname.slice('/api/rollback/'.length), administrator.username);
        return json(response, result.unchanged ? 200 : 201, result);
      }
      catch (_) { return json(response, 400, { error: 'Invalid rollback request' }); }
    }
    return send(response, 404, {}, '');
  };
}

module.exports = { createSceneAdmin };

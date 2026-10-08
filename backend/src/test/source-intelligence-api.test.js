'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { createSceneAdmin } = require('../scene-admin');

async function invoke(handler, method, url, body, headers = {}) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method;
  request.url = url;
  request.headers = headers;
  let status;
  let responseBody;
  const response = { writeHead(value) { status = value; }, end(value) { responseBody = value; } };
  await handler(request, response);
  return { status, body: responseBody ? JSON.parse(responseBody) : null };
}

test('Scene Management source-intelligence API requires auth, CSRF, and one exact target', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-intelligence-api-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const security = { geoip: { lookup: () => ({ scope: 'public' }) }, record() {}, destinationIp: '1.1.1.1' };
  const source = {
    status(ip) {
      if (ip.includes('/')) throw Object.assign(new Error('Select one public source IP'), { status: 400 });
      return { activeEnabled: false, investigation: { targetIp: ip } };
    },
    async investigate(ip, options) { return { activeEnabled: false, investigation: { targetIp: ip, requested: options } }; },
  };
  const handler = createSceneAdmin(directory, security, null, null, source);
  assert.equal((await invoke(handler, 'GET', '/api/security/source-intelligence?ip=8.8.8.8')).status, 404);
  const auth = { 'x-scene-admin': 'owner' };
  const read = await invoke(handler, 'GET', '/api/security/source-intelligence?ip=8.8.8.8', undefined, auth);
  assert.equal(read.status, 200);
  assert.equal(read.body.investigation.targetIp, '8.8.8.8');
  assert.equal((await invoke(handler, 'GET', '/api/security/source-intelligence?ip=8.8.8.8&ip=1.1.1.1', undefined, auth)).status, 400);
  assert.equal((await invoke(handler, 'POST', '/api/security/source-intelligence', { ip: '8.8.8.8', active: false }, auth)).status, 419);
  const csrf = { ...auth, origin: 'http://localhost:8081', cookie: 'scene_csrf=' + 'a'.repeat(43),
    'x-scene-csrf': 'a'.repeat(43) };
  const created = await invoke(handler, 'POST', '/api/security/source-intelligence', {
    ip: '8.8.8.8', active: false, acknowledgement: '',
  }, csrf);
  assert.equal(created.status, 200);
  assert.equal(created.body.investigation.targetIp, '8.8.8.8');
  assert.equal(created.body.investigation.requested.actor, 'owner');
});

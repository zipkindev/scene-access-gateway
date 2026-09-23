'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { MaxMindSetup, tarDatabase } = require('../maxmind-setup');

function archive(name, body) {
  const header = Buffer.alloc(512);
  header.write('release/' + name, 0, 'utf8');
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  header[156] = '0'.charCodeAt(0);
  return zlib.gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512), Buffer.alloc(1024)]));
}

function response(body, status = 200) {
  return new Response(body, { status, headers: { 'content-length': String(body.length) } });
}

test('tarDatabase extracts only the named bounded database', async () => {
  assert.deepEqual(await tarDatabase(archive('GeoLite2-City.mmdb', Buffer.from('city')), 'GeoLite2-City.mmdb'), Buffer.from('city'));
  await assert.rejects(() => tarDatabase(archive('other.mmdb', Buffer.from('wrong')), 'GeoLite2-City.mmdb'), /not found/);
  await assert.rejects(() => tarDatabase(Buffer.from('not gzip'), 'GeoLite2-City.mmdb'), /invalid database archive/);
});

test('MaxMind UI setup validates, stores write-only credentials, updates, and reloads lookup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-maxmind-'));
  const requests = [];
  const lookup = { reloads: 0, reload() { this.reloads += 1; }, status() {
    return { mode: 'local-mmdb', city: { loaded: this.reloads > 0, updatedAt: null },
      asn: { loaded: this.reloads > 0, updatedAt: null } };
  } };
  class Reader { get() { return { valid: true }; } }
  const fetch = async (url, options) => {
    requests.push({ url, authorization: options.headers.Authorization });
    const edition = url.includes('City') ? 'City' : 'ASN';
    return response(archive(`GeoLite2-${edition}.mmdb`, Buffer.from(edition.toLowerCase())));
  };
  try {
    const setup = new MaxMindSetup(directory, lookup, { fetch, Reader });
    assert.equal(setup.state().configured, false);
    await assert.rejects(() => setup.configure('not-numeric', 'valid_key_123'), /account ID/);
    const state = await setup.configure('123456', 'valid_key_123');
    assert.equal(state.configured, true);
    assert.equal(state.accountHint, '••••3456');
    assert.doesNotMatch(JSON.stringify(state), /valid_key_123|123456/);
    assert.equal(lookup.reloads, 1);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((item) => item.authorization.startsWith('Basic ')));
    const base = path.join(directory, 'scene-management', 'maxmind');
    assert.equal(fs.readFileSync(path.join(base, 'GeoLite2-City.mmdb'), 'utf8'), 'city');
    assert.equal(fs.statSync(path.join(base, 'license-key')).mode & 0o777, 0o600);
    await setup.update();
    assert.equal(lookup.reloads, 2);
    assert.equal(setup.disconnect().configured, false);
    assert.equal(fs.existsSync(path.join(base, 'GeoLite2-City.mmdb')), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('MaxMind setup reports rejected credentials without storing them', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-maxmind-auth-'));
  const lookup = { reload() {}, status() { return { city: {}, asn: {} }; } };
  try {
    const setup = new MaxMindSetup(directory, lookup, { fetch: async () => response(Buffer.alloc(0), 401) });
    await assert.rejects(() => setup.configure('123456', 'valid_key_123'), /rejected/);
    assert.equal(setup.state().configured, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('mounted-file mode refuses UI-managed credentials', async () => {
  const lookup = { status() { return { city: { loaded: true }, asn: { loaded: true } }; } };
  const setup = new MaxMindSetup('/unused', lookup, { managed: false });
  assert.equal(setup.state().mode, 'mounted-files');
  await assert.rejects(() => setup.configure('123456', 'valid_key_123'), /mounted server files/);
});

test('Scene Management exposes write-only MaxMind onboarding controls and routes', () => {
  const client = fs.readFileSync(path.join(__dirname, '../scene-admin-client.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../scene-admin.js'), 'utf8');
  for (const marker of ['IP geolocation · MaxMind GeoLite2', 'Connect and download',
    'Update databases', 'Remove saved account', '/api/security/maxmind/setup',
    '/api/security/maxmind/update']) assert.match(client + server, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(server, /licenseKey[^\n]+return/);
});

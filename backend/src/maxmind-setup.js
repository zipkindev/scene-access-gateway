'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const zlib = require('node:zlib');
const maxmind = require('maxmind');

const MAX_ARCHIVE_BYTES = 192 * 1024 * 1024;
const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const gunzip = promisify(zlib.gunzip);

function atomicFile(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(temporary, value, { mode, flag: 'wx' });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, mode);
}

function secret(file, pattern) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size < 1 || stat.size > 256) return null;
    const value = fs.readFileSync(file, 'utf8').trim();
    return pattern.test(value) ? value : null;
  } catch (_) { return null; }
}

async function limitedBody(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) throw new Error('MaxMind database download is too large');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    total += chunk.length;
    if (total > MAX_ARCHIVE_BYTES) throw new Error('MaxMind database download is too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

async function tarDatabase(archive, expectedName) {
  let unpacked;
  try { unpacked = await gunzip(archive, { maxOutputLength: MAX_DATABASE_BYTES + 8 * 1024 * 1024 }); }
  catch (_) { throw new Error('MaxMind returned an invalid database archive'); }
  for (let offset = 0; offset + 512 <= unpacked.length;) {
    const header = unpacked.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DATABASE_BYTES) {
      throw new Error('MaxMind returned an invalid database archive');
    }
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > unpacked.length) throw new Error('MaxMind returned an invalid database archive');
    if (path.posix.basename(name) === expectedName) return Buffer.from(unpacked.subarray(bodyStart, bodyEnd));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  throw new Error('MaxMind database file was not found in the archive');
}

class MaxMindSetup {
  constructor(directory, lookup, options = {}) {
    this.directory = path.join(directory, 'scene-management', 'maxmind');
    this.accountFile = path.join(this.directory, 'account-id');
    this.licenseFile = path.join(this.directory, 'license-key');
    this.cityFile = path.join(this.directory, 'GeoLite2-City.mmdb');
    this.asnFile = path.join(this.directory, 'GeoLite2-ASN.mmdb');
    this.lookup = lookup;
    this.fetch = options.fetch || globalThis.fetch;
    this.Reader = options.Reader || maxmind.Reader;
    this.managed = options.managed !== false;
    this.updating = null;
  }

  _credentials() {
    const accountId = secret(this.accountFile, /^\d{3,20}$/);
    const licenseKey = secret(this.licenseFile, /^[A-Za-z0-9_]{8,64}$/);
    return accountId && licenseKey ? { accountId, licenseKey } : null;
  }

  state() {
    const credentials = this._credentials();
    return {
      mode: this.managed ? 'scene-management' : 'mounted-files',
      configured: Boolean(credentials),
      accountHint: credentials ? '••••' + credentials.accountId.slice(-4) : null,
      database: this.lookup.status(),
    };
  }

  async _download(edition, credentials) {
    let response;
    try {
      response = await this.fetch(`https://download.maxmind.com/geoip/databases/GeoLite2-${edition}/download?suffix=tar.gz`, {
        headers: { Authorization: 'Basic ' + Buffer.from(credentials.accountId + ':' + credentials.licenseKey).toString('base64') },
        redirect: 'follow', signal: AbortSignal.timeout(120000),
      });
    } catch (_) { throw new Error('MaxMind download service is unavailable'); }
    if (response.status === 401 || response.status === 403) throw new Error('MaxMind rejected the account ID or license key');
    if (!response.ok || !response.body) throw new Error('MaxMind database download failed');
    const database = await tarDatabase(await limitedBody(response), `GeoLite2-${edition}.mmdb`);
    try {
      const reader = new this.Reader(database);
      if (!reader.get('8.8.8.8')) throw new Error('invalid');
    } catch (_) { throw new Error('MaxMind returned an invalid database'); }
    return database;
  }

  async _install(credentials) {
    const city = await this._download('City', credentials);
    const asn = await this._download('ASN', credentials);
    atomicFile(this.cityFile, city);
    atomicFile(this.asnFile, asn);
    this.lookup.reload();
  }

  async _run(credentials) {
    if (this.updating) throw new Error('MaxMind database update is already running');
    this.updating = this._install(credentials);
    try { await this.updating; } finally { this.updating = null; }
  }

  async configure(accountValue, licenseValue) {
    if (!this.managed) throw new Error('GeoIP is managed by mounted server files');
    const credentials = { accountId: String(accountValue || '').trim(), licenseKey: String(licenseValue || '').trim() };
    if (!/^\d{3,20}$/.test(credentials.accountId)) throw new Error('Invalid MaxMind account ID');
    if (!/^[A-Za-z0-9_]{8,64}$/.test(credentials.licenseKey)) throw new Error('Invalid MaxMind license key');
    await this._run(credentials);
    atomicFile(this.accountFile, credentials.accountId + '\n');
    atomicFile(this.licenseFile, credentials.licenseKey + '\n');
    return this.state();
  }

  async update() {
    const credentials = this._credentials();
    if (!credentials) throw new Error('Connect a MaxMind account first');
    await this._run(credentials);
    return this.state();
  }

  disconnect() {
    if (this.updating) throw new Error('MaxMind database update is already running');
    for (const file of [this.accountFile, this.licenseFile]) {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return this.state();
  }
}

module.exports = { MaxMindSetup, tarDatabase };

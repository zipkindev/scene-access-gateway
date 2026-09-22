'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { FIREWALL_PUBLIC } = require('./destination-plan');

const IDENTIFIER = /^[a-z][a-z0-9-]{1,47}$/;
const RESERVED = new Set(['api', 'assets', 'challenge', 'healthz', 'internal', 'login', 'logout', 'request-access', 'torrentharbor', 'verify']);

class DestinationRegistry {
  constructor(dataDirectory) {
    this.file = path.join(dataDirectory, 'scene-management', 'destinations.json');
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.file)) this._write({ schemaVersion: 1, destinations: [] });
    this.list();
  }

  _write(value) {
    const temporary = this.file + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  _read() {
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.destinations)) throw new Error('Invalid destination registry');
    const ids = new Set();
    for (const item of value.destinations) {
      if (!IDENTIFIER.test(item.id) || RESERVED.has(item.id) || ids.has(item.id)
        || item.route !== (item.id === 'firewall' ? FIREWALL_PUBLIC : '/' + item.id + '/') || !['pending', 'active'].includes(item.status)
        || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80
        || (item.status === 'active' && (!item.receipt || !/^[a-f0-9]{64}$/.test(item.receipt.proxySha256 || '')
          || !/^[a-f0-9]{64}$/.test(item.receipt.routerSha256 || '')))) {
        throw new Error('Invalid destination registry');
      }
      ids.add(item.id);
    }
    return value;
  }

  list() {
    return structuredClone(this._read().destinations);
  }

  add(input) {
    if (!input || Array.isArray(input) || typeof input !== 'object'
      || Object.keys(input).some((key) => !['id', 'name', 'route'].includes(key))) throw new Error('Invalid destination');
    const { id, route } = input;
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!IDENTIFIER.test(id || '') || RESERVED.has(id) || route !== (id === 'firewall' ? FIREWALL_PUBLIC : '/' + id + '/')
      || !name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid destination');
    const value = this._read();
    if (value.destinations.length >= 32 || value.destinations.some((item) => item.id === id)) throw new Error('Destination already exists or registry is full');
    const item = { id, name, route, status: 'pending', createdAt: new Date().toISOString() };
    value.destinations.push(item);
    this._write(value);
    return structuredClone(item);
  }

  activate(id, receipt) {
    if (id !== 'firewall' || !receipt || typeof receipt !== 'object'
      || !/^[a-f0-9]{64}$/.test(receipt.proxySha256 || '')
      || !/^[a-f0-9]{64}$/.test(receipt.routerSha256 || '')
      || !/^[0-9a-f-]{36}$/.test(receipt.groupPk || '')
      || !/^[0-9a-f-]{36}$/.test(receipt.applicationPk || '')) throw new Error('Invalid activation receipt');
    const value = this._read();
    const item = value.destinations.find((entry) => entry.id === id);
    if (!item || item.status !== 'pending') throw new Error('Destination is not pending');
    item.status = 'active';
    item.activatedAt = new Date().toISOString();
    item.receipt = { ...receipt };
    this._write(value);
    return structuredClone(item);
  }

  deactivate(id) {
    if (id !== 'firewall') throw new Error('Unsupported destination');
    const value = this._read();
    const item = value.destinations.find((entry) => entry.id === id);
    if (!item || item.status !== 'active') throw new Error('Destination is not active');
    item.status = 'pending';
    item.deactivatedAt = new Date().toISOString();
    this._write(value);
    return structuredClone(item);
  }
}

module.exports = { DestinationRegistry };

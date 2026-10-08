'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('firewall destination origin is canonical and accepts the persisted canonical route', () => {
  const previous = process.env.FIREWALL_ORIGIN;
  process.env.FIREWALL_ORIGIN = 'https://firewall.example.test';
  const planPath = require.resolve('../destination-plan');
  const registryPath = require.resolve('../scene-destinations');
  delete require.cache[planPath];
  delete require.cache[registryPath];
  try {
    const { FIREWALL_PUBLIC, prepareFirewallDestination } = require('../destination-plan');
    const { DestinationRegistry } = require('../scene-destinations');
    assert.equal(FIREWALL_PUBLIC, 'https://firewall.example.test/');
    assert.equal(prepareFirewallDestination({ name: 'Firewall',
      upstream: process.env.FIREWALL_UPSTREAM || 'https://firewall.example.invalid/' }).publicOrigin, FIREWALL_PUBLIC);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'destination-registry-'));
    const sceneDirectory = path.join(directory, 'scene-management');
    fs.mkdirSync(sceneDirectory);
    const destinationFile = path.join(sceneDirectory, 'destinations.json');
    fs.writeFileSync(destinationFile, JSON.stringify({ schemaVersion: 1, destinations: [{
      id: 'firewall', name: 'Firewall', route: 'https://firewall.example.test:44334/', status: 'active',
      createdAt: new Date().toISOString(), activatedAt: new Date().toISOString(),
      receipt: { proxySha256: 'a'.repeat(64), routerSha256: 'b'.repeat(64) },
    }] }) + '\n', { mode: 0o600 });
    const migrated = new DestinationRegistry(directory).list()[0];
    assert.equal(migrated.route, FIREWALL_PUBLIC);
    assert.deepEqual(migrated.receipt, { proxySha256: 'a'.repeat(64), routerSha256: 'b'.repeat(64) });
    assert.equal(JSON.parse(fs.readFileSync(destinationFile, 'utf8')).destinations[0].route, FIREWALL_PUBLIC);
  } finally {
    if (previous === undefined) delete process.env.FIREWALL_ORIGIN;
    else process.env.FIREWALL_ORIGIN = previous;
    delete require.cache[planPath];
    delete require.cache[registryPath];
  }
});

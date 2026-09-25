'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadApplicationContracts, validateApplicationContracts } = require('../application-contracts');

test('tracked application contracts describe every current protected route', () => {
  const value = loadApplicationContracts();
  assert.deepEqual(value.applications.map((item) => item.id), ['portal', 'torrentharbor', 'firewall']);
  const torrentharbor = value.applications.find((item) => item.id === 'torrentharbor');
  assert.equal(torrentharbor.access.authentikRelay, true);
  assert.equal(torrentharbor.access.qrDestination, true);
  assert.equal(torrentharbor.public.scheme, 'https');
  assert.equal(torrentharbor.public.port, 443);
  assert.deepEqual(torrentharbor.browserPolicy.externalSources.map((item) => item.origin), [
    'https://image.tmdb.org', 'https://i.ytimg.com', 'https://www.youtube-nocookie.com',
  ]);
});

test('browser-facing application origins cannot expose an internal listener port', () => {
  const value = structuredClone(loadApplicationContracts());
  value.applications[2].public.port = 44334;
  assert.throws(() => validateApplicationContracts(value), /standard HTTPS/);
});

test('application contracts reject broad or undocumented security exceptions', () => {
  const value = structuredClone(loadApplicationContracts());
  value.applications[1].waf.exclusions.push({
    ruleIds: ['930130'], path: '/*', methods: ['GET'], reason: 'Broad bypass for compatibility', reviewBy: '2027-01-01',
  });
  assert.throws(() => validateApplicationContracts(value), /exact path/);
  const browser = structuredClone(loadApplicationContracts());
  browser.applications[1].browserPolicy.externalSources[0].origin = 'https://*.example.invalid';
  assert.throws(() => validateApplicationContracts(browser), /invalid external origin/);
});

test('QR and Authentik applications cannot omit their required journeys', () => {
  const value = structuredClone(loadApplicationContracts());
  value.applications[1].verification = value.applications[1].verification.filter((item) => item !== 'authentik-relay');
  assert.throws(() => validateApplicationContracts(value), /Authentik relay verification/);
});

test('cross-host QR applications preserve the initiating portal origin', () => {
  const value = structuredClone(loadApplicationContracts());
  delete value.applications[2].access.returnToPortalOrigin;
  assert.throws(() => validateApplicationContracts(value), /initiating portal origin/);
});

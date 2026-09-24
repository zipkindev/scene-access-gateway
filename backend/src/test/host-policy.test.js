'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { configuredAliases, createHostPolicy } = require('../host-policy');

test('public host policy accepts the canonical hostname and configured aliases across the trusted proxy', () => {
  const allowed = createHostPolicy('https://access.zipkin.dev:44334', 'arcade.zipkin.dev');
  for (const host of ['access.zipkin.dev', 'access.zipkin.dev:44334', 'access.zipkin.dev:443',
    'arcade.zipkin.dev', 'arcade.zipkin.dev:44334', 'ARCADE.ZIPKIN.DEV']) assert.equal(allowed(host), true, host);
});

test('public host policy rejects unconfigured names, ports, credentials, paths, and malformed aliases', () => {
  const allowed = createHostPolicy('https://access.zipkin.dev:44334', 'arcade.zipkin.dev');
  for (const host of ['evil.example', 'arcade.zipkin.dev:444', 'arcade.zipkin.dev/path',
    'arcade.zipkin.dev@evil.example', 'arcade.zipkin.dev\n']) assert.equal(allowed(host), false, host);
  for (const aliases of ['*.zipkin.dev', 'arcade.zipkin.dev:443', '.zipkin.dev', 'zipkin..dev']) {
    assert.throws(() => configuredAliases(aliases), /Invalid public host alias/);
  }
});

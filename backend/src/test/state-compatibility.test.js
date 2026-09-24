'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { validateStateClone } = require('../state-compatibility');

test('state compatibility validator only runs against a marked disposable clone', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'state-compatibility-'));
  assert.throws(() => validateStateClone(directory), /marked disposable clone/);
  fs.writeFileSync(path.join(directory, '.state-compatibility-clone'), 'disposable\n');
  const result = validateStateClone(directory);
  assert.equal(result.compatible, undefined);
  assert.equal(result.activeRevision, true);
  assert.equal(result.destinations, 0);
});

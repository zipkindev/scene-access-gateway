'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('server accepts the separate game extension and bundled audio directory', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /process\.env\.WOLF3D_ROOT/);
  assert.match(source, /process\.env\.WOLF3D_CLIENT_SCRIPT/);
  assert.match(source, /process\.env\.AUDIO_SAMPLES_DIR/);
  assert.match(source, /if \(fs\.existsSync\(wolfRoot\)/);
  assert.match(source, /fs\.existsSync\(audioRoot\)/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'future-wolf3d-crt.js')), false);
});

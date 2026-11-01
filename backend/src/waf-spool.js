'use strict';

const fs = require('node:fs');
const path = require('node:path');

function identity(stat) { return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`; }

function segments(file) {
  const directory = path.dirname(file);
  const prefix = `${path.basename(file)}.segment-`;
  return fs.readdirSync(directory).filter((name) => name.startsWith(prefix)
    && /^\d{16}-[a-f0-9]{32}$/.test(name.slice(prefix.length)))
    .sort().map((name) => path.join(directory, name));
}

module.exports = { identity, segments };

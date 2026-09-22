#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destinationRoot = path.join(repositoryRoot, 'frontend', 'artwork', 'audio');
const manifest = JSON.parse(fs.readFileSync(path.join(destinationRoot, 'manifest.json'), 'utf8'));

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verify(file, sample) {
  const stat = fs.statSync(file);
  assert.ok(stat.isFile(), `${sample.filename} is not a regular file`);
  assert.equal(stat.size, sample.bytes, `unexpected byte length: ${sample.filename}`);
  assert.equal(digest(file), sample.sha256, `unexpected SHA-256: ${sample.filename}`);
}

try {
  const sourceRoot = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error('usage: import-audio.mjs <directory-containing-the-eight-mp3-files>');
  }
  for (const sample of manifest.samples) verify(path.join(sourceRoot, sample.filename), sample);
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const sample of manifest.samples) {
    const destination = path.join(destinationRoot, sample.filename);
    if (fs.existsSync(destination)) {
      verify(destination, sample);
      console.log(`kept verified ${sample.filename}`);
      continue;
    }
    const temporary = `${destination}.partial-${process.pid}`;
    fs.copyFileSync(path.join(sourceRoot, sample.filename), temporary, fs.constants.COPYFILE_EXCL);
    verify(temporary, sample);
    fs.chmodSync(temporary, 0o644);
    fs.renameSync(temporary, destination);
    console.log(`imported ${sample.filename}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

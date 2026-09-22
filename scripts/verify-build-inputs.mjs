#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artworkRoot = process.env.SAG_ARTWORK_ROOT
  ? path.resolve(process.env.SAG_ARTWORK_ROOT)
  : path.join(repositoryRoot, 'frontend', 'artwork');

function json(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function filesBelow(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute, relative) : [relative];
  });
}

function frozenLiteral(source, name) {
  const match = source.match(new RegExp(`const ${name} = Object\\.freeze\\(([\\s\\S]*?)\\);`));
  assert.ok(match, `missing ${name} in future-sample-audio.js`);
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${match[1]})`, Object.create(null))));
}

const artwork = json('frontend/artwork/manifest.json');
assert.equal(artwork.schemaVersion, 1);
const expectedArtwork = Object.keys(artwork.files).sort();
const discoveredArtwork = artwork.roots.flatMap((root) =>
  filesBelow(path.join(artworkRoot, root), root)).sort();
assert.deepEqual(discoveredArtwork, expectedArtwork, 'artwork manifest must list every project artwork input');
for (const [relative, expectedHash] of Object.entries(artwork.files)) {
  const absolute = path.join(artworkRoot, relative);
  assert.equal(hash(absolute), expectedHash, `artwork checksum mismatch: ${relative}`);
}

const audio = json('frontend/artwork/audio/manifest.json');
assert.equal(audio.schemaVersion, 1);
assert.equal(new Set(audio.samples.map((sample) => sample.id)).size, audio.samples.length,
  'audio IDs must be unique');
assert.ok(audio.samples.some((sample) => sample.id === audio.defaultSample), 'default audio sample is missing');
const expectedAudio = audio.samples.map((sample) => sample.filename).sort();
const discoveredAudio = filesBelow(path.join(artworkRoot, 'audio'))
  .filter((file) => file.endsWith('.mp3')).sort();
assert.ok(discoveredAudio.length === 0 || discoveredAudio.length === expectedAudio.length,
  'install either the complete verified audio set or no optional audio files');
assert.deepEqual(discoveredAudio, discoveredAudio.length ? expectedAudio : [],
  'audio directory contains missing or unexpected MP3 files');
if (process.env.SAG_REQUIRE_AUDIO === '1') {
  assert.deepEqual(discoveredAudio, expectedAudio, 'the complete verified audio set is required');
}
for (const sample of audio.samples) {
  const absolute = path.join(artworkRoot, 'audio', sample.filename);
  if (discoveredAudio.length) {
    const stat = fs.statSync(absolute);
    assert.equal(stat.size, sample.bytes, `audio byte length mismatch: ${sample.filename}`);
    assert.equal(hash(absolute), sample.sha256, `audio checksum mismatch: ${sample.filename}`);
  }
  assert.match(sample.sourceUrl, /^https:\/\/pixabay\.com\//, `invalid source URL: ${sample.filename}`);
  assert.ok(sample.loop.start >= 0, `invalid loop start: ${sample.id}`);
  assert.ok(sample.loop.end === null || sample.loop.end >= sample.loop.start + 0.25,
    `invalid loop end: ${sample.id}`);
}

const sampleSource = fs.readFileSync(path.join(repositoryRoot, 'backend', 'src', 'future-sample-audio.js'), 'utf8');
const expectedSamples = { none: null };
const expectedLoops = {};
const expectedNames = {};
for (const sample of audio.samples) {
  expectedSamples[sample.id] = `audio-samples/${sample.filename}`;
  expectedLoops[sample.id] = sample.loop;
  expectedNames[sample.id] = sample.name;
}
assert.deepEqual(frozenLiteral(sampleSource, 'SAMPLES'), expectedSamples, 'audio file mapping drifted');
assert.deepEqual(frozenLiteral(sampleSource, 'LOOP_PRESETS'), expectedLoops, 'audio loop boundaries drifted');
assert.deepEqual(frozenLiteral(sampleSource, 'SAMPLE_NAMES'), expectedNames, 'audio display names drifted');
assert.deepEqual(frozenLiteral(sampleSource, 'CYCLE_ORDER'), audio.samples.map((sample) => sample.id),
  'audio cycle order drifted');
assert.match(sampleSource, new RegExp(`defaultSample = '${audio.defaultSample}'`), 'default audio sample drifted');

const bases = json('manifests/container-bases.json').images;
const backendDockerfile = fs.readFileSync(path.join(repositoryRoot, 'backend', 'Dockerfile'), 'utf8');
const frontendDockerfile = fs.readFileSync(path.join(repositoryRoot, 'frontend', 'Dockerfile'), 'utf8');
assert.equal(backendDockerfile.match(new RegExp(`FROM ${bases.node.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`, 'g'))?.length, 2,
  'backend Node base must be pinned in both stages');
assert.match(frontendDockerfile, new RegExp(`FROM ${bases.nginx.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`),
  'frontend Nginx base must be pinned');

console.log(`verified ${expectedArtwork.length} artwork inputs, ${discoveredAudio.length}/${audio.samples.length} optional audio inputs, loop boundaries, and pinned container bases`);

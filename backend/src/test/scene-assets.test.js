'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PNG } = require('pngjs');
const sharp = require('sharp');
const { ImageLibrary, REVIEW_BUNDLES, inspectPng } = require('../scene-assets');
const { BACKGROUNDS, DEFAULT_SCENE, validateScene } = require('../scene-config');

function png() {
  const image = new PNG({ width: 2, height: 2 });
  image.data.fill(180);
  return PNG.sync.write(image);
}

function withLibrary(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'access-images-'));
  try { run(new ImageLibrary(directory), directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function withAsyncLibrary(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'access-images-'));
  try { await run(new ImageLibrary(directory), directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function photographicPng() {
  const image = new PNG({ width: 256, height: 256 });
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const index = (y * 256 + x) * 4;
    image.data[index] = (x * 3 + y) % 256;
    image.data[index + 1] = (x + y * 2) % 256;
    image.data[index + 2] = (x * 2 + y * 3) % 256;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

test('upload creates an immutable sanitized image and survives restart', () => withLibrary((library, directory) => {
  const uploaded = library.upload(png(), 'Night scene');
  assert.match(uploaded.id, /^img-[a-f0-9]{48}$/);
  assert.equal(uploaded.width, 2);
  assert.equal(uploaded.height, 2);
  assert.equal(uploaded.status, 'available');
  assert.equal(library.body(uploaded.id).length, uploaded.bytes);
  assert.deepEqual(new ImageLibrary(directory).image(uploaded.id), uploaded);
  assert.equal(library.upload(png(), 'Same pixels').duplicate, true);
  assert.equal(library.list().length, 1);
}));

test('archive hides from selection without breaking revisions; purge is gated', () => withLibrary((library) => {
  const image = library.upload(png(), 'Candidate');
  library.archive(image.id);
  assert.equal(library.image(image.id).status, 'archived');
  assert.ok(library.body(image.id));
  assert.throws(() => library.purge(image.id, new Set([image.id]), true), /not safe/);
  assert.throws(() => library.purge(image.id, new Set(), false), /not safe/);
  assert.equal(library.restore(image.id).status, 'available');
  assert.throws(() => library.purge(image.id, new Set(), true), /not safe/);
  library.archive(image.id);
  library.purge(image.id, new Set(), true);
  assert.equal(library.image(image.id), null);
  assert.equal(library.body(image.id), null);
}));

test('rejects corrupt, trailing, animated, huge, and unlabeled images', () => withLibrary((library) => {
  const valid = png();
  assert.throws(() => library.upload(Buffer.from('not a png'), 'Bad'), /PNG/);
  assert.throws(() => library.upload(Buffer.concat([valid, Buffer.from('x')]), 'Trailing'), /Trailing/);
  const huge = Buffer.from(valid);
  huge.writeUInt32BE(5000, 16);
  assert.throws(() => inspectPng(huge), /dimensions/);
  assert.throws(() => library.upload(valid, ''), /label/);
  assert.throws(() => library.upload(valid, 'bad\nlabel'), /label/);
  assert.equal(library.list().length, 0);
}));

test('refuses a corrupted manifest instead of recreating or discarding it', () => withLibrary((library, directory) => {
  const manifest = path.join(directory, 'scene-management', 'images', 'manifest.json');
  fs.writeFileSync(manifest, '{broken');
  assert.throws(() => library.list(), SyntaxError);
  assert.throws(() => new ImageLibrary(directory), SyntaxError);
}));

test('only exact sanitized review images receive their scene-specific motion bundle', () => withLibrary((library, directory) => {
  const manifestFile = path.join(directory, 'scene-management', 'images', 'manifest.json');
  const images = Object.entries(REVIEW_BUNDLES).map(([sha256, bundleId]) => ({
    id: 'img-' + sha256.slice(0, 48), sha256, label: bundleId + ' review',
    mediaType: 'image/png', width: 1672, height: 941, bytes: 1,
    status: 'available', createdAt: '2026-09-19T00:00:00Z',
    url: '/assets/uploads/img-' + sha256.slice(0, 48) + '.png',
  }));
  images.push({ ...images[0], id: 'img-' + 'a'.repeat(48), sha256: 'a'.repeat(64), url: '/assets/uploads/img-' + 'a'.repeat(48) + '.png', label: 'Wildlife Preserve v2 - lookalike' });
  fs.writeFileSync(manifestFile, JSON.stringify({ schemaVersion: 1, images }));
  const catalog = library.catalog();
  for (const image of images.slice(0, 3)) {
    assert.equal(catalog[image.id].bundleId, REVIEW_BUNDLES[image.sha256]);
    const scene = structuredClone(DEFAULT_SCENE);
    scene.backgroundId = image.id;
    scene.motion = { enabled: true, effects: {} };
    assert.equal(validateScene(scene, { ...BACKGROUNDS, ...catalog }).motion.enabled, true);
  }
  assert.equal(catalog[images[3].id].bundleId, undefined);
}));

test('optimization stores a separate verified WebP, reports bytes, and keeps original', () => withAsyncLibrary(async (library, directory) => {
  const original = library.upload(photographicPng(), 'Landscape');
  const optimized = await library.optimizePng(library.body(original.id), { sourceId: original.id, label: original.label, quality: 94 });
  assert.equal(optimized.unchanged, undefined);
  assert.equal(optimized.mediaType, 'image/webp');
  assert.ok(optimized.bytes <= original.bytes * 0.9);
  assert.equal(library.body(optimized.id).length, optimized.bytes);
  const metadata = await sharp(library.body(optimized.id)).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, original.width);
  assert.equal(metadata.height, original.height);
  assert.equal(library.catalog()[optimized.id].bytes, optimized.bytes);
  assert.deepEqual(new ImageLibrary(directory).image(original.id), original);
  assert.equal((await library.optimizePng(library.body(original.id), { sourceId: original.id, label: original.label, quality: 94 })).duplicate, true);
  assert.equal(library.list().length, 2);
}));

test('optimizer rejects unsupported quality and untrusted motion bindings', () => withAsyncLibrary(async (library) => {
  const source = photographicPng();
  await assert.rejects(library.optimizePng(source, { sourceId: 'scene', quality: 10 }), /Invalid image optimization/);
  await assert.rejects(library.optimizePng(source, { sourceId: 'scene', bundleId: 'untrusted', quality: 94 }), /Invalid image optimization/);
  assert.equal(library.list().length, 0);
}));

test('an optimized motion master retains its trusted effects binding', () => withAsyncLibrary(async (library) => {
  const source = BACKGROUNDS['wildlife-preserve-v2'];
  const body = fs.readFileSync(path.join(__dirname, '..', 'assets', source.file));
  const optimized = await library.optimizePng(body, { sourceId: source.id, label: source.label, bundleId: source.bundleId, quality: 94 });
  assert.equal(optimized.bundleId, source.bundleId);
  const catalog = library.catalog();
  const scene = structuredClone(DEFAULT_SCENE);
  scene.backgroundId = optimized.id;
  scene.motion = { enabled: true, effects: { river: true } };
  assert.equal(validateScene(scene, { ...BACKGROUNDS, ...catalog }).motion.enabled, true);
}));

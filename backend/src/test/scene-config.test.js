'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BACKGROUNDS, DEFAULT_SCENE, SCENE_BUNDLES, SceneStore, validateScene } = require('../scene-config');
const SceneMotion = require('../scene-motion-renderer');

function temporary() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'access-scene-'));
}

test('default scene preserves the rendered background and original Z hotspot', () => {
  const scene = validateScene(DEFAULT_SCENE);
  assert.equal(scene.backgroundId, 'rain-city-qr-embossed-v6');
  assert.deepEqual(scene.hotspots[0], {
    id: 'torrentharbor', shape: 'circle', x: 0.185, y: 0.392, radius: 0.037,
    destinationId: 'torrentharbor', activation: 'qr-popup', visible: false, enabled: true,
  });
  assert.equal(scene.publicText, false);
});

test('scene validation refuses public text, arbitrary destinations, and duplicate hotspots', () => {
  const publicText = structuredClone(DEFAULT_SCENE);
  publicText.publicText = true;
  assert.throws(() => validateScene(publicText), /public scene text/);

  const redirect = structuredClone(DEFAULT_SCENE);
  redirect.hotspots[0].destinationId = 'arbitrary-host';
  assert.throws(() => validateScene(redirect), /unknown destination/);

  const duplicate = structuredClone(DEFAULT_SCENE);
  duplicate.hotspots.push(structuredClone(duplicate.hotspots[0]));
  assert.throws(() => validateScene(duplicate), /duplicate hotspot ID/);

  const firewall = structuredClone(DEFAULT_SCENE);
  firewall.hotspots.push({ ...firewall.hotspots[0], id: 'firewall', destinationId: 'firewall', x: 0.8 });
  assert.throws(() => validateScene(firewall), /unavailable/);
  assert.equal(validateScene(firewall, BACKGROUNDS, ['torrentharbor', 'firewall']).hotspots.length, 2);
});

test('authored wide and portrait frames are image-relative and aspect locked', () => {
  const scene = structuredClone(DEFAULT_SCENE);
  const aspect = BACKGROUNDS[scene.backgroundId].width / BACKGROUNDS[scene.backgroundId].height;
  scene.viewport.frames = {
    wide: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 * aspect / (16 / 9) },
    portrait: { x: 0.3, y: 0, width: (9 / 16) / aspect, height: 1 },
  };
  assert.deepEqual(validateScene(scene).viewport.frames, scene.viewport.frames);
  scene.viewport.frames.wide.x = 0.5;
  assert.throws(() => validateScene(scene), /frame must fit/);
  scene.viewport.frames.wide.x = 0.1;
  scene.viewport.frames.portrait.width = 0.8;
  assert.throws(() => validateScene(scene), /frame must fit/);
});

test('three artwork-specific motion bundles validate and reject cross-scene effects', () => {
  for (const [id, bundle] of Object.entries(SCENE_BUNDLES)) {
    assert.equal(SceneMotion.validate(bundle), bundle);
    assert.equal(bundle.sceneId, id);
    assert.equal(BACKGROUNDS[id].bundleId, id);
    assert.ok(bundle.effects.some((effect) => effect.kind === 'light' && effect.amplitude >= 0.1));
    assert.ok(bundle.effects.some((effect) =>
      ['flow-x', 'drift-x'].includes(effect.kind) ? effect.amplitude * 900 >= 2
        : effect.kind === 'flow-y' && effect.amplitude * 506 >= 2));
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'assets', BACKGROUNDS[id].file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), BACKGROUNDS[id].sha256);
    const scene = structuredClone(DEFAULT_SCENE);
    scene.backgroundId = id;
    scene.motion = { enabled: true, effects: { [bundle.effects[0].id]: true } };
    assert.equal(validateScene(scene).motion.effects[bundle.effects[0].id], true);
    scene.motion.effects.clouds = true;
    assert.throws(() => validateScene(scene), /unsupported fields/);
  }
  const legacy = structuredClone(DEFAULT_SCENE);
  legacy.backgroundId = 'immersive-city-candidate-b';
  legacy.motion = { enabled: true, effects: {} };
  assert.throws(() => validateScene(legacy), /unavailable/);
});

test('scene store publishes immutable history and supports rollback', () => {
  const directory = temporary();
  try {
    const store = new SceneStore(directory);
    const original = store.active();
    const changed = structuredClone(DEFAULT_SCENE);
    changed.viewport.maximumZoom = 4;
    store.saveDraft(changed);
    const published = store.publish(changed, 'editor');
    assert.equal(store.active().scene.viewport.maximumZoom, 4);
    assert.equal(store.draft(), null);
    store.saveDraft(changed);
    const rolledBack = store.rollback(original.revisionId, 'editor');
    assert.equal(rolledBack.rolledBackFrom, original.revisionId);
    assert.equal(store.active().scene.viewport.maximumZoom, 2.8);
    assert.equal(store.draft(), null);
    assert.equal(store.history().length, 2);
    assert.notEqual(published.revisionId, rolledBack.revisionId);
    store.saveDraft(changed);
    const before = fs.readFileSync(store.activeFile, 'utf8');
    const duplicate = store.rollback(original.revisionId, 'editor');
    assert.equal(duplicate.unchanged, true);
    assert.equal(duplicate.revisionId, rolledBack.revisionId);
    assert.equal(fs.readFileSync(store.activeFile, 'utf8'), before);
    assert.equal(store.history().length, 2);
    assert.ok(store.draft());
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

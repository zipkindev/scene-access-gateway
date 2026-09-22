'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULT_SCENE } = require('../scene-config');
const { advanceSceneClick } = require('../scene-hit');

test('a ten-click sequence unlocks only after its final ordered point', () => {
  const scene = structuredClone(DEFAULT_SCENE);
  const hotspot = scene.hotspots[0];
  hotspot.sequence = {
    steps: Array.from({ length: 9 }, (_, index) => ({
      x: 0.1 + (index % 5) * 0.16,
      y: 0.65 + Math.floor(index / 5) * 0.15,
      radius: 0.02,
    })),
    maxGapSeconds: 8,
    totalSeconds: 30,
  };

  const points = [hotspot, ...hotspot.sequence.steps];
  let progress = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const result = advanceSceneClick(scene, point.x, point.y, 1600, 900, false,
      progress, 1_000 + index * 500);
    if (index < points.length - 1) {
      assert.equal(result.destination, null);
      assert.ok(result.progress);
    } else {
      assert.equal(result.destination, 'torrentharbor');
      assert.equal(result.progress, null);
    }
    progress = result.progress;
  }
});

test('a wrong click resets ordered sequence progress', () => {
  const scene = structuredClone(DEFAULT_SCENE);
  const hotspot = scene.hotspots[0];
  hotspot.sequence = {
    steps: [{ x: 0.5, y: 0.5, radius: 0.02 }],
    maxGapSeconds: 8,
    totalSeconds: 30,
  };
  const started = advanceSceneClick(scene, hotspot.x, hotspot.y, 1600, 900, false, null, 1_000);
  assert.ok(started.progress);
  const missed = advanceSceneClick(scene, 0.95, 0.95, 1600, 900, false, started.progress, 1_500);
  assert.deepEqual(missed, { destination: null, progress: null });
});

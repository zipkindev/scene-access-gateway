'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { layout, profileFor, frameFromCorners, moveFrame } = require('../scene-framing');

test('wide and portrait profiles follow viewport shape, not user agent', () => {
  assert.equal(profileFor(1920, 1080), 'wide');
  assert.equal(profileFor(390, 844), 'portrait');
  assert.equal(profileFor(900, 800), null);
});

test('without a guide the entire image fits even when CSS viewport is narrower than 1150 pixels', () => {
  const result = layout(1672, 941, 960, 540);
  assert.equal(result.profile, 'full');
  assert.ok(result.left >= -0.01 && result.left + result.width <= 960.01);
  assert.ok(result.top >= -0.01 && result.top + result.height <= 540.01);
});

test('a wide guide shifts the focal point without changing image coordinates', () => {
  const frame = { x: 0.2, y: 0.2, width: 0.7, height: 0.7 * 1672 / 941 / (16 / 9) };
  const result = layout(1672, 941, 1920, 1080, { wide: frame });
  assert.equal(result.profile, 'wide');
  assert.ok(result.width > 1920);
  assert.ok(result.left < 0);
});

test('a phone guide remains the initial view even when a QR hotspot is offscreen', () => {
  const frame = { x: 0.6, y: 0, width: (9 / 16) * 941 / 1672, height: 1 };
  const result = layout(1672, 941, 390, 844, { portrait: frame }, [{ x: 0.18, y: 0.4, radius: 0.03 }]);
  assert.equal(result.profile, 'portrait');
  assert.ok(result.left < 0);
  assert.ok(result.width >= 390 && result.height >= 844);
});

test('a framed OnePlus-sized portrait viewport fills both axes without black margins', () => {
  const frame = { x: 0.35835783285782963, y: 0.10856800310382975,
    width: 0.2822046045796077, height: 0.8914319968961703 };
  const result = layout(1672, 941, 412, 915, { portrait: frame });
  assert.equal(result.profile, 'portrait');
  assert.ok(result.width >= 412 && result.height >= 915);
  assert.ok(result.left <= 0 && result.left + result.width >= 412);
  assert.ok(result.top <= 0 && result.top + result.height >= 915);
});

test('corner drawing holds the first corner and locks the device aspect ratio', () => {
  const ratio = (16 / 9) * 941 / 1672;
  const frame = frameFromCorners({ x: 0.15, y: 0.2 }, { x: 0.65, y: 0.55 }, ratio);
  assert.equal(frame.x, 0.15);
  assert.equal(frame.y, 0.2);
  assert.ok(Math.abs(frame.width / frame.height - ratio) < 1e-9);
  assert.ok(frame.x + frame.width <= 1 && frame.y + frame.height <= 1);
});

test('dragging a corner keeps its opposite corner fixed and clamps to the image', () => {
  const ratio = (9 / 16) * 941 / 1672;
  const opposite = { x: 0.8, y: 0.9 };
  const frame = frameFromCorners(opposite, { x: -1, y: -1 }, ratio);
  assert.ok(frame.x >= 0 && frame.y >= 0);
  assert.ok(Math.abs(frame.x + frame.width - opposite.x) < 1e-9);
  assert.ok(Math.abs(frame.y + frame.height - opposite.y) < 1e-9);
  assert.ok(Math.abs(frame.width / frame.height - ratio) < 1e-9);
});

test('moving a frame preserves its size and keeps it inside the image', () => {
  const frame = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 };
  assert.deepEqual(moveFrame(frame, 1, -1), { x: 0.5, y: 0, width: 0.5, height: 0.4 });
});

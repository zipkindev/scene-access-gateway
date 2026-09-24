'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../security-globe.js'), 'utf8');

test('security globe paints an opaque dark frame and a bounded globe', async () => {
  const frames = [];
  const fills = [];
  const arcs = [];
  const gradient = () => ({ addColorStop() {} });
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', shadowBlur: 0, filter: 'none',
    fillStyle: '', strokeStyle: '', lineWidth: 1, shadowColor: '', font: '',
    clearRect() {}, fillRect(x, y, width, height) { fills.push({ style: this.fillStyle, x, y, width, height }); },
    createRadialGradient: gradient, createLinearGradient: gradient,
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, save() {}, restore() {}, clip() {},
    moveTo() {}, lineTo() {}, fillText() {},
    arc(x, y, radius) { arcs.push({ x, y, radius }); },
  };
  const listeners = {};
  const canvas = {
    width: 0, height: 0, style: {},
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    addEventListener: (name, listener) => { listeners[name] = listener; },
  };
  const sandbox = {
    window: { devicePixelRatio: 1 }, performance: { now: () => 0 },
    requestAnimationFrame: (callback) => { frames.push(callback); },
    fetch: async () => ({ ok: true, json: async () => ({ type: 'Topology', arcs: [], objects: { land: { arcs: [] } } }) }),
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../security-globe.js'), 'utf8'), sandbox);
  const globe = sandbox.window.SecurityGlobe.create(canvas);
  globe.setData({ destination: { latitude: 35, longitude: -77 }, sources: [] });
  assert.equal(frames.length, 1);
  frames.shift()(1000);
  assert.equal(fills[0].x, 0);
  assert.equal(fills[0].y, 0);
  assert.equal(fills[0].width, 800);
  assert.equal(fills[0].height, 600);
  assert.ok(arcs.some((item) => item.radius > 200 && item.radius < 240));
  assert.equal(canvas.style.background, '#02050d');
  assert.ok(listeners.pointerdown && listeners.wheel && listeners.keydown && listeners.contextmenu);
  assert.equal(globe.setTravelEnabled(false), false);
  assert.equal(globe.setTravelEnabled(true), true);
  assert.match(source, /world-land-50m\.json\?v=96/);
  assert.match(source, /nasa-blue-marble-day\.webp\?v=96/);
  assert.match(source, /nasa-black-marble-night\.webp\?v=96/);
  assert.match(source, /createEarthTextureRenderer/);
  assert.match(source, /smoothstep\(-0\.08, 0\.12, solar\)/);
  assert.match(source, /perspectiveDistance/);
  assert.match(source, /uCameraDistance/);
  assert.match(source, /uViewTilt/);
  assert.match(source, /function updateFlight\(now\)/);
  assert.match(source, /departDuration: 850, travelDuration: 5200, holdDuration: 650, revealDuration: 1250/);
  assert.match(source, /active && state\.flight \? \.008 : \.28/);
  assert.match(source, /event\.button === 2 \? 'flightView' : 'orbit'/);
  assert.match(source, /state\.roll = wrap\(state\.roll \+ dx \* \.004\)/);
  assert.match(source, /Travel controls camera animation, never whether connection evidence is visible/);
  assert.doesNotMatch(source, /if \(destination && state\.travelEnabled\)/);
  assert.match(source, /context\.fill\('evenodd'\)/);
  assert.match(source, /state\.horizon/);
  assert.doesNotMatch(source, /createImageData|cellSize/);
});

test('security globe waits while collapsed and renders after expansion', () => {
  const frames = [];
  const arcs = [];
  let rectangle = { width: 0, height: 0, left: 0, top: 0 };
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', shadowBlur: 0, filter: 'none',
    fillStyle: '', strokeStyle: '', lineWidth: 1, shadowColor: '', font: '',
    clearRect() {}, fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    beginPath() {}, closePath() {}, fill() {}, stroke() {}, save() {}, restore() {}, clip() {}, moveTo() {}, lineTo() {}, fillText() {},
    arc(x, y, radius) { if (radius < 0) throw new Error('negative radius'); arcs.push({ x, y, radius }); },
  };
  const canvas = {
    width: 300, height: 150, style: {}, getContext: () => context,
    getBoundingClientRect: () => rectangle, addEventListener() {},
  };
  const sandbox = {
    window: { devicePixelRatio: 1 }, performance: { now: () => 0 },
    requestAnimationFrame: (callback) => { frames.push(callback); },
    fetch: async () => ({ ok: true, json: async () => ({ type: 'Topology', arcs: [], objects: { land: { arcs: [] } } }) }),
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../security-globe.js'), 'utf8'), sandbox);
  const globe = sandbox.window.SecurityGlobe.create(canvas);
  frames.shift()(0);
  assert.equal(arcs.length, 0);
  assert.equal(frames.length, 0);
  rectangle = { width: 800, height: 600, left: 0, top: 0 };
  globe.setActive(false);
  globe.setActive(true);
  frames.shift()(16);
  assert.ok(arcs.some((item) => item.radius > 200));
});

test('turning automatic travel off keeps every connection route visible', () => {
  const frames = [];
  const routeStrokes = [];
  let segments = 0;
  const context = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', shadowBlur: 0, filter: 'none',
    fillStyle: '', strokeStyle: '', lineWidth: 1, shadowColor: '', font: '',
    clearRect() {}, fillRect() {}, createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    beginPath() { segments = 0; }, closePath() {}, fill() {},
    stroke() { if (this.strokeStyle === '#ff6c83' || this.strokeStyle === '#ff3658') routeStrokes.push(segments); },
    save() {}, restore() {}, clip() {}, moveTo() {}, lineTo() { segments += 1; }, fillText() {}, arc() {},
  };
  const canvas = {
    width: 0, height: 0, style: {}, getContext: () => context,
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    addEventListener() {},
  };
  const sandbox = {
    window: { devicePixelRatio: 1 }, performance: { now: () => 0 },
    requestAnimationFrame: (callback) => { frames.push(callback); },
    fetch: async () => ({ ok: true, json: async () => ({ type: 'Topology', arcs: [], objects: { land: { arcs: [] } } }) }),
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../security-globe.js'), 'utf8'), sandbox);
  const globe = sandbox.window.SecurityGlobe.create(canvas);
  globe.setTravelEnabled(false);
  globe.setData({
    destination: { latitude: 35.6, longitude: -77.4 },
    sources: [
      { ip: '203.0.113.10', latitude: 50.8, longitude: 4.3, count: 20, city: 'Brussels' },
      { ip: '198.51.100.20', latitude: 51.5, longitude: -0.1, count: 10, city: 'London' },
    ],
  });
  frames.shift()(1000);
  assert.equal(routeStrokes.length, 2);
  assert.ok(routeStrokes.every((count) => count > 20));
});

test('coastline annotations remain flush with the Earth surface at horizon view', () => {
  assert.doesNotMatch(source, /pair\[0\],\s*1\.00[24]/);
  assert.match(source, /coastline is a surface annotation/);
});

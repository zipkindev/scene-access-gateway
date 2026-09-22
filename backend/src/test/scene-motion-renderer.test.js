'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const SceneMotion = require('../scene-motion-renderer');
const wildlife = require('../assets/scene-bundles/wildlife-preserve-v2/motion.json');

test('preview renderer schedules changing frames for enabled artwork effects', () => {
  const previous = {
    document: globalThis.document,
    matchMedia: globalThis.matchMedia,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const queue = new Map();
  const calls = [];
  let nextFrame = 0;
  const gl = new Proxy({
    COMPILE_STATUS: 1, LINK_STATUS: 2, VERTEX_SHADER: 3, FRAGMENT_SHADER: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TEXTURE0: 8, TEXTURE_2D: 9,
    UNPACK_FLIP_Y_WEBGL: 10, TEXTURE_MIN_FILTER: 11, TEXTURE_MAG_FILTER: 12,
    TEXTURE_WRAP_S: 13, TEXTURE_WRAP_T: 14, LINEAR: 15, CLAMP_TO_EDGE: 16,
    RGBA: 17, UNSIGNED_BYTE: 18, TRIANGLE_STRIP: 19,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program, name) => name,
    getAttribLocation: () => 0,
    getError: () => 0,
    isContextLost: () => false,
    uniform4fv: (name, value) => { if (name === 'settings[0]') calls.push([...value]); },
  }, { get(target, key) { return key in target ? target[key] : () => ({}); } });
  try {
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    globalThis.requestAnimationFrame = (callback) => { queue.set(++nextFrame, callback); return nextFrame; };
    globalThis.cancelAnimationFrame = (id) => queue.delete(id);
    const canvas = { getContext: () => gl };
    const image = { naturalWidth: 1672, naturalHeight: 941 };
    const motion = SceneMotion.create(canvas, image, wildlife, ['river', 'mist', 'bioluminescence']);
    const first = queue.entries().next().value;
    queue.delete(first[0]);
    first[1](performance.now() + 1000);
    const second = queue.entries().next().value;
    queue.delete(second[0]);
    second[1](performance.now() + 1100);
    assert.equal(motion.status().framesRendered, 2);
    assert.equal(motion.status().animating, true);
    assert.equal(calls.length, 2);
    assert.ok(calls[0][3] === 1 && calls[0][7] === 1 && calls[0][11] === 1);
    motion.setEffects([]);
    const final = queue.entries().next().value;
    queue.delete(final[0]);
    final[1](performance.now() + 1200);
    assert.equal(motion.status().animating, false);
    assert.equal(calls[2][3], 0);
    motion.destroy();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});

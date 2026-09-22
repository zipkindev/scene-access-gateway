'use strict';

// Scene motion samples the scene's own pixels. There are no atmospheric image
// overlays: each effect is confined to a reviewed region of its source image.
(function (scope) {
  const MAX_EFFECTS = 4;
  const VERTEX = `attribute vec2 position;
    varying vec2 coordinate;
    void main() { coordinate = (position + 1.0) * 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;
  const FRAGMENT = `precision mediump float;
    varying vec2 coordinate;
    uniform sampler2D artwork;
    uniform float seconds;
    uniform int count;
    uniform vec4 regions[4];
    uniform vec4 settings[4];
    void main() {
      vec2 sampleAt = coordinate;
      float lighting = 0.0;
      for (int i = 0; i < 4; i++) {
        if (i >= count) break;
        vec4 area = regions[i];
        vec4 effect = settings[i];
        if (effect.w < 0.5) continue;
        vec2 span = max(area.zw, vec2(0.001));
        float distanceFromCenter = length((coordinate - area.xy) / span);
        float edge = 1.0 - smoothstep(0.55, 1.0, distanceFromCenter);
        if (effect.x < 1.5) {
          sampleAt.x += effect.y * edge *
            (sin(coordinate.y * 112.0 + seconds * effect.z * 2.0) * 0.72 +
             sin(coordinate.y * 211.0 - seconds * effect.z * 1.3) * 0.28);
        } else if (effect.x < 2.5) {
          sampleAt.y += effect.y * edge *
            (sin(coordinate.x * 104.0 + seconds * effect.z * 2.0) * 0.72 +
             sin(coordinate.x * 187.0 - seconds * effect.z * 1.1) * 0.28);
        } else if (effect.x < 3.5) {
          lighting += effect.y * edge *
            sin(seconds * effect.z * 2.0 + coordinate.x * 7.0);
        } else {
          sampleAt.x += effect.y * edge *
            sin(seconds * effect.z * 2.0 + coordinate.y * 14.0);
        }
      }
      vec4 color = texture2D(artwork, clamp(sampleAt, 0.0, 1.0));
      float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb *= 1.0 + lighting * smoothstep(0.18, 0.7, luminance);
      gl_FragColor = color;
    }`;

  function validateMotion(bundle) {
    if (!bundle || bundle.schemaVersion !== 1 || !Array.isArray(bundle.effects) ||
        !Array.isArray(bundle.designSize) || bundle.designSize.length !== 2 ||
        bundle.designSize.some((value) => !Number.isInteger(value) || value < 1 || value > 4096) ||
        bundle.base !== 'base.png' || bundle.reducedMotion !== 'still' ||
        !/^[a-z][a-z0-9-]*$/.test(bundle.sceneId || '') ||
        bundle.effects.length > MAX_EFFECTS) throw new Error('Invalid motion bundle');
    const identifiers = new Set();
    for (const effect of bundle.effects) {
      if (!/^[a-z][a-z0-9-]*$/.test(effect.id || '') || identifiers.has(effect.id) ||
          !['flow-x', 'flow-y', 'light', 'drift-x'].includes(effect.kind) ||
          !Array.isArray(effect.center) || effect.center.length !== 2 ||
          !Array.isArray(effect.radius) || effect.radius.length !== 2 ||
          [...effect.center, ...effect.radius, effect.amplitude, effect.speed].some((value) => !Number.isFinite(value)) ||
          effect.center.some((value) => value < 0 || value > 1) ||
          effect.radius.some((value) => value <= 0 || value > 0.5) ||
          effect.amplitude <= 0 || effect.amplitude > (effect.kind === 'light' ? 0.2 : 0.008) ||
          effect.speed <= 0 || effect.speed > 2) throw new Error('Invalid motion effect');
      identifiers.add(effect.id);
    }
    return bundle;
  }

  function shader(gl, kind, source) {
    const value = gl.createShader(kind);
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error('Scene shader failed');
    return value;
  }

  function createSceneMotion(canvas, image, bundle, initialEffects) {
    validateMotion(bundle);
    if (image.naturalWidth !== bundle.designSize[0] || image.naturalHeight !== bundle.designSize[1]) {
      throw new Error('Scene artwork dimensions do not match its motion bundle');
    }
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Scene program failed');
    gl.useProgram(program);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(gl.getUniformLocation(program, 'artwork'), 0);
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1i(gl.getUniformLocation(program, 'count'), bundle.effects.length);
    const regionData = new Float32Array(MAX_EFFECTS * 4);
    for (const [index, effect] of bundle.effects.entries()) {
      // Author coordinates use top-left origin; WebGL uses bottom-left.
      regionData.set([effect.center[0], 1 - effect.center[1], effect.radius[0], effect.radius[1]], index * 4);
    }
    gl.uniform4fv(gl.getUniformLocation(program, 'regions[0]'), regionData);
    const settingsLocation = gl.getUniformLocation(program, 'settings[0]');
    const timeLocation = gl.getUniformLocation(program, 'seconds');
    const reduced = scope.matchMedia?.('(prefers-reduced-motion: reduce)');
    let effects = new Set(initialEffects || []);
    let active = true;
    let frame = 0;
    let lastPaint = 0;
    let framesRendered = 0;
    let graphicsError = 0;
    const started = performance.now();
    function shouldAnimate() {
      return effects.size > 0 && !reduced?.matches && !document.hidden;
    }
    function requestFrame() {
      if (active && !frame) frame = scope.requestAnimationFrame(draw);
    }
    function draw(now) {
      frame = 0;
      if (!active) return;
      if (now - lastPaint >= 33 || lastPaint === 0) {
        const settings = new Float32Array(MAX_EFFECTS * 4);
        for (const [index, effect] of bundle.effects.entries()) {
          settings.set([
            effect.kind === 'flow-x' ? 1 : effect.kind === 'flow-y' ? 2 : effect.kind === 'light' ? 3 : 4,
            effect.amplitude, effect.speed,
            effects.has(effect.id) && shouldAnimate() ? 1 : 0,
          ], index * 4);
        }
        gl.uniform4fv(settingsLocation, settings);
        gl.uniform1f(timeLocation, (now - started) / 1000);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        graphicsError = gl.getError();
        framesRendered += 1;
        lastPaint = now;
      }
      if (shouldAnimate()) requestFrame();
    }
    const refresh = () => requestFrame();
    document.addEventListener('visibilitychange', refresh);
    reduced?.addEventListener?.('change', refresh);
    requestFrame();
    return {
      setEffects(ids) { effects = new Set(ids); requestFrame(); },
      status() {
        return { framesRendered, selectedEffects: effects.size,
          reducedMotion: !!reduced?.matches, pageHidden: document.hidden,
          contextLost: !!gl.isContextLost?.(), graphicsError,
          animating: shouldAnimate() };
      },
      destroy() {
        active = false;
        scope.cancelAnimationFrame(frame);
        document.removeEventListener('visibilitychange', refresh);
        reduced?.removeEventListener?.('change', refresh);
        gl.deleteTexture(texture); gl.deleteBuffer(corners); gl.deleteProgram(program);
      },
    };
  }

  scope.SceneMotion = { create: createSceneMotion, validate: validateMotion };
})(typeof window === 'undefined' ? globalThis : window);

if (typeof module !== 'undefined') module.exports = globalThis.SceneMotion;

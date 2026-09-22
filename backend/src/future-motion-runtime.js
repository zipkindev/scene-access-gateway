(() => {
  'use strict';
  function mount(root, options = {}) {
  let destroyed = false;
  const interactionTarget = options.interactionTarget || root;
  const W = 1672;
  const H = 941;
  const image = root.querySelector('.future-motion-source');
  const canvas = root.querySelector('.future-motion-canvas');
  const maskPreview = root.querySelector('.future-motion-mask');
  const symbolGlow = root.querySelector('.future-motion-symbol');
  if (!image || !canvas || !maskPreview || !symbolGlow) throw new Error('Future motion layer is incomplete');
  const status = options.status || { textContent: '' };
  const dummyButton = { getAttribute: () => 'false', addEventListener: () => {} };
  const controls = Object.fromEntries(['atmosphere', 'water', 'lights', 'trace', 'fire', 'ground', 'crystal', 'lantern', 'portal', 'tower']
    .map((id) => [id, { checked: true }]));
  Object.assign(controls, { strength: { value: '100' }, overrideReduced: { checked: false },
    still: dummyButton, masks: dummyButton }, options.controls || {});

  function mask(polygons, blur) {
    const surface = document.createElement('canvas');
    surface.width = W;
    surface.height = H;
    const context = surface.getContext('2d');
    context.fillStyle = '#fff';
    context.filter = `blur(${blur}px)`;
    for (const polygon of polygons) {
      context.beginPath();
      polygon.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
      context.closePath();
      context.fill();
    }
    context.filter = 'none';
    return surface;
  }

  // Source-image pixel coordinates. Deliberately leave a still margin at every
  // hard skyline, bridge, cliff, waterfall rim, and table edge.
  const atmosphere = mask([
    [[340, 30], [447, 23], [455, 82], [409, 99], [344, 77]],
    [[499, 20], [622, 20], [642, 76], [584, 92], [503, 78]],
    [[504, 279], [590, 258], [648, 270], [655, 305], [595, 326], [514, 317]],
    [[651, 279], [733, 259], [745, 290], [718, 329], [663, 322]],
    [[796, 306], [860, 289], [886, 313], [872, 343], [814, 342]],
  ], 15);
  const water = mask([
    // Calibrated against blue/bright source pixels. The first mask mistakenly
    // covered x=3..55 (cliff) while the actual far-left water is x=58..101.
    [[59, 112], [79, 110], [95, 124], [100, 162], [97, 197], [79, 210], [69, 173]],
    [[371, 201], [402, 200], [409, 238], [413, 269], [400, 282], [375, 282]],
    [[747, 279], [763, 279], [765, 320], [750, 333], [743, 315]],
    [[871, 253], [889, 253], [891, 298], [876, 315], [869, 294]],
    [[1116, 150], [1136, 150], [1134, 207], [1120, 227], [1115, 210]],
  ], 2);
  const lights = mask([
    // Table rim and inset ornaments; no tile surface or grout.
    [[454, 366], [1192, 366], [1217, 388], [438, 388]],
    [[151, 714], [1385, 714], [1462, 762], [116, 762]],
    [[340, 389], [439, 389], [160, 711], [126, 711]],
    [[1180, 389], [1235, 389], [1458, 711], [1371, 711]],
    [[525, 803], [1079, 803], [1063, 924], [542, 924]],
  ], 4);

  // This follows existing gold perimeter lines, never grout or game tiles.
  // It is deliberately separate from the broad brightness mask so alignment
  // can be inspected and the current turned off independently.
  const trace = document.createElement('canvas');
  trace.width = W;
  trace.height = H;
  const traceContext = trace.getContext('2d');
  traceContext.strokeStyle = '#fff';
  traceContext.lineWidth = 7;
  traceContext.lineJoin = 'round';
  traceContext.filter = 'blur(4px)';
  traceContext.beginPath();
  traceContext.moveTo(451, 377);
  traceContext.lineTo(1190, 377);
  traceContext.lineTo(1402, 721);
  traceContext.lineTo(168, 721);
  traceContext.closePath();
  traceContext.stroke();
  traceContext.filter = 'none';

  const leftFire = mask([
    [[29, 602], [62, 597], [81, 625], [70, 655], [34, 656]],
  ], 4);
  const upperFire = mask([
    [[477, 303], [506, 302], [510, 330], [475, 332]],
    [[1068, 301], [1092, 301], [1094, 329], [1064, 329]],
  ], 4);
  const fire = mask([
    [[29, 602], [62, 597], [81, 625], [70, 655], [34, 656]],
    [[477, 303], [506, 302], [510, 330], [475, 332]],
    [[1068, 301], [1092, 301], [1094, 329], [1064, 329]],
  ], 4);
  const ground = mask([
    // The user's crops locate these reflections below the tabletop, not
    // beside its upper corners: left y≈778–910, right y≈716–941.
    [[0, 799], [191, 780], [210, 831], [100, 916], [0, 930]],
    [[1599, 756], [1672, 758], [1672, 817], [1606, 799]],
    [[1479, 828], [1548, 838], [1672, 913], [1672, 941], [1572, 919], [1483, 867]],
  ], 8);
  const crystal = mask([
    [[1488, 313], [1515, 291], [1541, 314], [1546, 419], [1483, 421]],
  ], 6);
  const lantern = mask([
    [[1387, 353], [1456, 352], [1459, 450], [1385, 450]],
  ], 5);
  const portal = document.createElement('canvas');
  portal.width = W;
  portal.height = H;
  const portalContext = portal.getContext('2d');
  portalContext.strokeStyle = '#fff';
  portalContext.lineWidth = 14;
  portalContext.filter = 'blur(5px)';
  portalContext.beginPath();
  portalContext.ellipse(1438, 86, 40, 37, 0, 0, Math.PI * 2);
  portalContext.stroke();
  portalContext.filter = 'none';
  // Pack the three small detail masks into one texture; WebGL1 guarantees
  // enough texture units without sacrificing the independent controls.
  const details = document.createElement('canvas');
  details.width = W;
  details.height = H;
  const detailContext = details.getContext('2d');
  const packed = detailContext.createImageData(W, H);
  const channels = [fire, ground, crystal].map((surface) =>
    surface.getContext('2d').getImageData(0, 0, W, H).data);
  for (let i = 0; i < packed.data.length; i += 4) {
    packed.data[i] = channels[0][i + 3];
    packed.data[i + 1] = channels[1][i + 3];
    packed.data[i + 2] = channels[2][i + 3];
    packed.data[i + 3] = 255;
  }
  detailContext.putImageData(packed, 0, 0);

  const VERTEX = `attribute vec2 vertex;
    varying vec2 uv;
    void main() { uv = (vertex + 1.0) * 0.5; gl_Position = vec4(vertex, 0.0, 1.0); }`;
  const FRAGMENT = `precision highp float;
    varying vec2 uv;
    uniform sampler2D source;
    uniform sampler2D atmosphereMask;
    uniform sampler2D waterfallMask;
    uniform sampler2D lightMask;
    uniform sampler2D traceMask;
    uniform sampler2D detailsMask;
    uniform sampler2D lanternMask;
    uniform sampler2D portalMask;
    uniform vec4 options;
    uniform float traceEnabled;
    uniform vec3 detailOptions;
    uniform float lanternEnabled;
    uniform float portalEnabled;
    uniform float time;
    void main() {
      float strength = options.w;
      float a = texture2D(atmosphereMask, uv).a * options.x;
      vec4 original = texture2D(source, uv);
      float originalLuma = dot(original.rgb, vec3(0.2126, 0.7152, 0.0722));
      float waterColor = smoothstep(0.01, 0.09, original.b - original.r) *
        smoothstep(0.22, 0.50, originalLuma);
      float w = texture2D(waterfallMask, uv).a * options.y * waterColor;
      float l = texture2D(lightMask, uv).a * options.z;
      float line = texture2D(traceMask, uv).a * traceEnabled;
      vec3 detail = texture2D(detailsMask, uv).rgb * detailOptions;
      float lanternArea = texture2D(lanternMask, uv).a * lanternEnabled;
      float portalArea = texture2D(portalMask, uv).a * portalEnabled;
      // Cloud motion is conveyed by traveling light/density only. Sampling
      // coordinates remain fixed, so skyline and bridge geometry cannot wave.
      // Each fall uses its own source pixels; the mask feather prevents a
      // visible cut at stone and cliff boundaries.
      vec2 flow = vec2(0.45 * sin(uv.y * 500.0 + time * 2.8) / 1672.0,
        (4.0 * sin(uv.y * 91.0 - time * 1.55) + 1.8 * sin(uv.y * 173.0 - time * 2.05)) / 941.0
      ) * w * strength;
      float firePixel = smoothstep(0.02, 0.12, original.r - original.b) *
        smoothstep(0.18, 0.55, originalLuma);
      float leftFireScale = uv.x < 0.10 && uv.y < 0.39 ? 0.32 : 1.0;
      vec2 flame = vec2(sin(time * 8.0 + uv.y * 180.0) * 0.65 / 1672.0,
        sin(time * 10.0 + uv.x * 110.0) * 1.5 / 941.0) * detail.r *
        firePixel * leftFireScale * strength;
      vec4 color = texture2D(source, clamp(uv + flow + flame, 0.0, 1.0));
      float cloudPixel = smoothstep(0.36, 0.59, originalLuma);
      float edgeX = abs(dot(texture2D(source, uv + vec2(2.0 / 1672.0, 0.0)).rgb,
        vec3(0.2126, 0.7152, 0.0722)) -
        dot(texture2D(source, uv - vec2(2.0 / 1672.0, 0.0)).rgb,
        vec3(0.2126, 0.7152, 0.0722)));
      float edgeY = abs(dot(texture2D(source, uv + vec2(0.0, 2.0 / 941.0)).rgb,
        vec3(0.2126, 0.7152, 0.0722)) -
        dot(texture2D(source, uv - vec2(0.0, 2.0 / 941.0)).rgb,
        vec3(0.2126, 0.7152, 0.0722)));
      float cloudSafe = a * cloudPixel * (1.0 - smoothstep(0.035, 0.12, edgeX + edgeY));
      vec2 cloudShift = vec2(1.5 * sin(time * 0.25 + uv.y * 9.0) / 1672.0,
        0.4 * sin(time * 0.18 + uv.x * 7.0) / 941.0) * cloudSafe * strength;
      color = texture2D(source, clamp(uv + cloudShift + flow + flame, 0.0, 1.0));
      float cloudTime = time * (uv.y > 0.78 ? 0.38 : 0.25);
      float cloudWave = 0.55 * sin(uv.x * 17.0 + cloudTime + sin(uv.y * 28.0)) +
        0.45 * sin(uv.x * 31.0 - cloudTime * 0.63 + uv.y * 19.0);
      color.rgb *= 1.0 + a * cloudPixel * strength * 0.18 * cloudWave;
      float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float gold = smoothstep(0.005, 0.08, color.r - color.b);
      float cyan = smoothstep(0.02, 0.15, color.b - color.r);
      float bright = smoothstep(0.09, 0.45, luminance);
      float pulse = 0.5 + 0.5 * sin(time * 1.3 + uv.x * 13.0 + uv.y * 8.0);
      float edgeShimmer = pow(max(0.0, sin(time * 3.2 + uv.x * 145.0 + uv.y * 72.0)), 4.0);
      float frontRim = smoothstep(0.16, 0.19, uv.y) * (1.0 - smoothstep(0.24, 0.27, uv.y));
      float glintX = 0.10 + mod(time * 0.065, 0.84);
      float glint = frontRim * exp(-pow((uv.x - glintX) / 0.045, 2.0));
      float intensity = l * bright * strength * (0.04 + 0.35 * pulse + 0.32 * glint + 0.26 * edgeShimmer);
      color.rgb += intensity * (gold * vec3(0.52, 0.31, 0.10) + cyan * vec3(0.08, 0.32, 0.56));
      // One restrained current pulse follows the real table perimeter. The
      // blurred line mask gives it a halo but never displaces surface pixels.
      vec2 point = vec2(uv.x * 1672.0, (1.0 - uv.y) * 941.0);
      float progress = 0.0;
      if (point.y < 405.0) progress = (point.x - 451.0) / 739.0 * 0.25;
      else if (point.x > 1190.0 + (point.y - 377.0) * 0.616 - 25.0)
        progress = 0.25 + (point.y - 377.0) / 344.0 * 0.125;
      else if (point.x < 451.0 - (point.y - 377.0) * 0.823 + 25.0)
        progress = 0.805 + (721.0 - point.y) / 344.0 * 0.195;
      else if (point.y > 675.0) progress = 0.375 + (1402.0 - point.x) / 1234.0 * 0.43;
      else progress = 0.805 + (721.0 - point.y) / 344.0 * 0.195;
      float cycle = fract(progress - time * 0.075);
      float distanceToPulse = min(cycle, 1.0 - cycle);
      float current = exp(-pow(distanceToPulse / 0.034, 2.0));
      float warmPath = smoothstep(0.005, 0.11, color.r - color.b);
      color.rgb += line * strength * current * (0.12 + 0.88 * warmPath) * vec3(0.64, 0.36, 0.12);
      float flamePulse = max(0.0, 0.35 + 0.35 * sin(time * 10.0 + uv.x * 45.0) +
        0.30 * sin(time * 14.0 - uv.y * 73.0));
      color.rgb += detail.r * firePixel * leftFireScale * strength * flamePulse *
        vec3(0.42, 0.18, 0.035);
      float shimmer = pow(max(0.0, sin(time * 2.2 + uv.x * 105.0 + uv.y * 48.0)), 3.0);
      float groundPosition = uv.x < 0.5 ? uv.x / 0.13 : (uv.x - 0.88) / 0.12;
      float groundBeam = exp(-pow((groundPosition - fract(time * 0.10)) / 0.19, 2.0));
      float groundLight = 0.10 + 0.50 * shimmer + 0.90 * groundBeam;
      color.rgb += detail.g * strength * bright * (0.20 + 0.80 * max(gold, cyan)) * groundLight *
        vec3(0.30, 0.24, 0.18);
      float crystalPulse = 0.5 + 0.5 * sin(time * 1.1 + uv.y * 13.0);
      color.rgb += detail.b * strength * bright * crystalPulse * vec3(0.08, 0.20, 0.34);
      float lanternTwinkle = 0.35 + 0.45 * pow(max(0.0, sin(time * 3.7 + uv.y * 21.0)), 3.0);
      color.rgb += lanternArea * strength * bright * gold * lanternTwinkle *
        vec3(0.45, 0.26, 0.09);
      float portalAngle = atan(point.y - 86.0, point.x - 1438.0);
      float portalGlint = pow(max(0.0, sin(portalAngle - time * 1.15)), 9.0);
      color.rgb += portalArea * strength * bright * cyan * (0.08 + 0.38 * portalGlint) *
        vec3(0.07, 0.28, 0.45);
      gl_FragColor = color;
    }`;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  function texture(gl, unit, source) {
    const value = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, value);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return value;
  }
  function showMasks() {
    maskPreview.hidden = controls.masks.getAttribute('aria-pressed') !== 'true';
    if (maskPreview.hidden) return;
    const ctx = maskPreview.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    for (const [surface, color] of [[atmosphere, '#21d5ef'], [water, '#728dff'],
      [lights, '#ffc65f'], [trace, '#f575d1'], [fire, '#ff7030'],
      [ground, '#8efab6'], [crystal, '#b59cff'], [lantern, '#fff17a'], [portal, '#9deeff']]) {
      const tinted = document.createElement('canvas');
      tinted.width = W;
      tinted.height = H;
      const tint = tinted.getContext('2d');
      tint.drawImage(surface, 0, 0);
      tint.globalCompositeOperation = 'source-in';
      tint.fillStyle = color;
      tint.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.65;
      ctx.drawImage(tinted, 0, 0);
    }
    if (towerMask) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(towerMask, towerRect.left, towerRect.top);
    }
    ctx.globalAlpha = 1;
  }
  function toggle(button, callback) {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', button.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      callback();
    });
  }
  toggle(controls.masks, showMasks);
  toggle(controls.still, () => {
    canvas.hidden = controls.still.getAttribute('aria-pressed') === 'true';
  });

  const symbols = [
    [486, 375], [566, 377], [648, 377], [741, 376], [846, 375], [946, 377], [1040, 377], [1154, 376],
    [393, 431], [353, 499], [302, 557], [240, 626],
    [1250, 431], [1302, 504], [1367, 595],
    [224, 710], [524, 728], [658, 728], [820, 729], [983, 728], [1134, 727], [1397, 708],
    [820, 903],
  ].map(([x, y]) => ({ x, y, color: x === 820 && y === 729 ? 'cyan' : 'gold' }));
  const featureRegions = [
    { id: 'left plaque', left: 125, top: 345, width: 87, height: 133,
      hit: [69, 302, 245, 526] },
    { id: 'right plaque', left: 1447, top: 512, width: 153, height: 127,
      hit: [1408, 457, 1642, 672] },
    { id: 'left banner', left: 151, top: 53, width: 65, height: 187,
      hit: [130, 0, 237, 310] },
    { id: 'right banner', left: 1582, top: 99, width: 48, height: 158,
      hit: [1539, 0, 1669, 365] },
  ];
  const symbolContext = symbolGlow.getContext('2d');
  let symbolPulses = [];
  let symbolFrame = 0;
  function symbolSprite(x, y, color, region = null) {
    const width = region?.width || 96;
    const height = region?.height || 96;
    const left = region?.left ?? Math.round(x) - width / 2;
    const top = region?.top ?? Math.round(y) - height / 2;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sourceContext = source.getContext('2d');
    sourceContext.drawImage(image, left, top, width, height, 0, 0, width, height);
    const pixels = sourceContext.getImageData(0, 0, width, height);
    const sprite = document.createElement('canvas');
    sprite.width = width;
    sprite.height = height;
    const spriteContext = sprite.getContext('2d');
    const glow = spriteContext.createImageData(width, height);
    function luminance(index) {
      return (0.2126 * pixels.data[index] + 0.7152 * pixels.data[index + 1] +
        0.0722 * pixels.data[index + 2]) / 255;
    }
    function ramp(low, high, value) {
      const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
      return t * t * (3 - 2 * t);
    }
    let selectedPixels = 0;
    for (let py = 4; py < height - 4; py += 1) {
      for (let px = 4; px < width - 4; px += 1) {
        const index = (py * width + px) * 4;
        const r = pixels.data[index];
        const g = pixels.data[index + 1];
        const b = pixels.data[index + 2];
        const light = luminance(index);
        const offset = region ? 8 : 4;
        const neighbors = (luminance((py * width + Math.max(0, px - offset)) * 4) +
          luminance((py * width + Math.min(width - 1, px + offset)) * 4) +
          luminance((Math.max(0, py - offset) * width + px) * 4) +
          luminance((Math.min(height - 1, py + offset) * width + px) * 4)) / 4;
        const localDetail = ramp(region ? 0.09 : 0.07, region ? 0.25 : 0.22,
          Math.abs(light - neighbors));
        const chroma = color === 'cyan' ? ramp(0.025, 0.15, (b - r) / 255) :
          ramp(region ? 0.075 : 0.025, region ? 0.20 : 0.13, (r - b) / 255);
        // Both lit and dark engraved strokes have local contrast. Broad warm
        // stone no longer emits simply because its color resembles gold.
        const linework = region ? localDetail * chroma * ramp(0.18, 0.40, light) :
          localDetail * (0.08 + 0.92 * chroma);
        const radius = Math.hypot(px - width / 2, py - height / 2);
        const bounds = region ? Math.min(ramp(0, 9, px), ramp(0, 9, width - px),
          ramp(0, 9, py), ramp(0, 9, height - py)) : 1 - ramp(26, 38, radius);
        const alpha = Math.round(255 * linework * bounds);
        if (alpha < 8) continue;
        selectedPixels += 1;
        glow.data[index] = color === 'cyan' ? 135 : 255;
        glow.data[index + 1] = color === 'cyan' ? 231 : 211;
        glow.data[index + 2] = color === 'cyan' ? 255 : 122;
        glow.data[index + 3] = alpha;
      }
    }
    if (selectedPixels < 12) return null;
    spriteContext.putImageData(glow, 0, 0);
    return { sprite, left, top, duration: region ? 1750 : 1150 };
  }
  function paintSymbolGlow(now) {
    symbolFrame = 0;
    if (destroyed) return;
    symbolPulses = symbolPulses.filter((pulse) => now - pulse.started < pulse.duration);
    symbolContext.clearRect(0, 0, W, H);
    for (const pulse of symbolPulses) {
      const progress = Math.max(0, Math.min(1, (now - pulse.started) / pulse.duration));
      const fade = (1 - progress) ** 2;
      symbolContext.globalCompositeOperation = 'screen';
      symbolContext.filter = pulse.duration > 1150 ? 'blur(9px)' : 'blur(7px)';
      symbolContext.globalAlpha = (pulse.duration > 1150 ? 0.68 : 0.55) * fade;
      symbolContext.drawImage(pulse.sprite, pulse.left, pulse.top - 3);
      symbolContext.filter = 'none';
      symbolContext.globalAlpha = (pulse.duration > 1150 ? 0.82 : 0.95) * fade;
      symbolContext.drawImage(pulse.sprite, pulse.left, pulse.top);
      symbolContext.globalAlpha = 1;
      symbolContext.globalCompositeOperation = 'source-over';
    }
    if (symbolPulses.length) symbolFrame = requestAnimationFrame(paintSymbolGlow);
  }
  const towerGlow = root.querySelector('.future-motion-tower');
  if (!towerGlow) throw new Error('Tower motion layer is missing');
  const towerContext = towerGlow.getContext('2d');
  const towerRect = { left: 750, top: 0, width: 68, height: 190 };
  const towerBand = document.createElement('canvas');
  towerBand.width = towerRect.width;
  towerBand.height = towerRect.height;
  const towerBandContext = towerBand.getContext('2d');
  let towerMask = null;
  let towerShotAt = -Infinity;
  let towerLastFrame = 0;
  let towerFrame = 0;
  function smooth(low, high, value) {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  }
  function prepareTower() {
    const source = document.createElement('canvas');
    source.width = towerRect.width;
    source.height = towerRect.height;
    const context = source.getContext('2d');
    context.drawImage(image, towerRect.left, towerRect.top, towerRect.width, towerRect.height,
      0, 0, towerRect.width, towerRect.height);
    const original = context.getImageData(0, 0, towerRect.width, towerRect.height).data;
    towerMask = document.createElement('canvas');
    towerMask.width = towerRect.width;
    towerMask.height = towerRect.height;
    const maskContext = towerMask.getContext('2d');
    const pixels = maskContext.createImageData(towerRect.width, towerRect.height);
    for (let py = 0; py < towerRect.height; py += 1) {
      const center = 782.5 + 2.5 * smooth(90, 185, py);
      const radius = 8 + 10 * smooth(105, 185, py);
      for (let px = 0; px < towerRect.width; px += 1) {
        const index = (py * towerRect.width + px) * 4;
        const r = original[index];
        const g = original[index + 1];
        const b = original[index + 2];
        const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const cool = smooth(0.025, 0.19, (b - r) / 255);
        const whiteCore = 0.6 * smooth(0.53, 0.82, light);
        const corridor = 1 - smooth(radius - 3, radius + 2, Math.abs(towerRect.left + px - center));
        const alpha = Math.round(255 * corridor * smooth(0.13, 0.48, light) * Math.max(cool, whiteCore));
        pixels.data[index] = 133;
        pixels.data[index + 1] = 222;
        pixels.data[index + 2] = 255;
        pixels.data[index + 3] = alpha;
      }
    }
    maskContext.putImageData(pixels, 0, 0);
    if (controls.masks.getAttribute('aria-pressed') === 'true') showMasks();
    towerFrame = requestAnimationFrame(paintTower);
  }
  function towerSweep(centerY, halfWidth, strength) {
    towerBandContext.clearRect(0, 0, towerRect.width, towerRect.height);
    towerBandContext.drawImage(towerMask, 0, 0);
    towerBandContext.globalCompositeOperation = 'destination-in';
    const gradient = towerBandContext.createLinearGradient(0, centerY - halfWidth, 0, centerY + halfWidth);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    towerBandContext.fillStyle = gradient;
    towerBandContext.fillRect(0, 0, towerRect.width, towerRect.height);
    towerBandContext.globalCompositeOperation = 'source-over';
    towerContext.globalCompositeOperation = 'screen';
    towerContext.filter = 'blur(7px)';
    towerContext.globalAlpha = Math.min(1, 0.36 * strength);
    towerContext.drawImage(towerBand, towerRect.left, towerRect.top);
    towerContext.filter = 'none';
    towerContext.globalAlpha = Math.min(1, 0.9 * strength);
    towerContext.drawImage(towerBand, towerRect.left, towerRect.top);
    towerContext.globalAlpha = 1;
    towerContext.globalCompositeOperation = 'source-over';
  }
  function paintTower(now) {
    if (destroyed) return;
    towerFrame = requestAnimationFrame(paintTower);
    if (now - towerLastFrame < 40 || document.hidden) return;
    towerLastFrame = now;
    towerContext.clearRect(0, 0, W, H);
    if (!controls.tower.checked ||
      (window.matchMedia('(prefers-reduced-motion: reduce)').matches && !controls.overrideReduced.checked) ||
      controls.still.getAttribute('aria-pressed') === 'true') return;
    const strength = Number(controls.strength.value) / 100;
    if (!strength) return;
    towerContext.globalCompositeOperation = 'screen';
    towerContext.globalAlpha = strength * (0.08 + 0.025 * Math.sin(now / 520));
    towerContext.drawImage(towerMask, towerRect.left, towerRect.top);
    towerContext.globalAlpha = 1;
    towerContext.globalCompositeOperation = 'source-over';
    const travellingY = 178 - (now % 4000) / 4000 * 187;
    towerSweep(travellingY, 30, strength * 0.58);
    const age = now - towerShotAt;
    if (age >= 0 && age < 1800) {
      const fade = (1 - age / 1800) ** 1.5;
      const shotY = 178 - Math.min(1, age / 1050) * 185;
      towerContext.globalCompositeOperation = 'screen';
      towerContext.globalAlpha = strength * 0.35 * fade;
      towerContext.drawImage(towerMask, towerRect.left, towerRect.top);
      towerContext.globalAlpha = 1;
      towerContext.globalCompositeOperation = 'source-over';
      towerSweep(shotY, 42, strength * 1.45 * fade);
      towerSweep(shotY + 36, 55, strength * 0.35 * fade);
    }
  }
  const onSymbolClick = (event) => {
    const box = image.getBoundingClientRect();
    const x = (event.clientX - box.left) * W / box.width;
    const y = (event.clientY - box.top) * H / box.height;
    if (x >= 754 && x <= 811 && y >= 0 && y <= 185) {
      towerShotAt = performance.now();
      return;
    }
    const feature = featureRegions.find((region) => x >= region.hit[0] && x <= region.hit[2] &&
      y >= region.hit[1] && y <= region.hit[3]);
    if (feature) {
      const geometry = symbolSprite(x, y, 'gold', feature);
      if (!geometry) return;
      symbolPulses.push({ ...geometry, started: performance.now() });
      if (!symbolFrame) symbolFrame = requestAnimationFrame(paintSymbolGlow);
      return;
    }
    const onTop = y >= 350 && y <= 397 && x >= 430 && x <= 1230;
    const onFront = y >= 700 && y <= 762 && x >= 118 && x <= 1460;
    const onLeft = y >= 390 && y <= 714 &&
      Math.abs(x - (430 - (y - 390) * 0.85)) <= 55;
    const onRight = y >= 390 && y <= 714 &&
      Math.abs(x - (1210 + (y - 390) * 0.74)) <= 55;
    const onBase = y >= 800 && y <= 940 && x >= 525 && x <= 1080;
    if (!(onTop || onFront || onLeft || onRight || onBase)) return;
    const nearest = symbols.map((symbol) => ({ symbol,
      distance: Math.hypot(symbol.x - x, symbol.y - y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    const color = nearest && nearest.distance < 45 ? nearest.symbol.color : 'gold';
    const geometry = symbolSprite(x, y, color);
    if (!geometry) return;
    symbolPulses.push({ ...geometry, started: performance.now() });
    if (!symbolFrame) symbolFrame = requestAnimationFrame(paintSymbolGlow);
  };
  interactionTarget.addEventListener('click', onSymbolClick);

  function startCanvasFallback(reason) {
    // A canvas cannot switch from a partially initialized WebGL context to
    // 2D. Replace only this prototype's canvas; the still image remains below.
    const replacement = document.createElement('canvas');
    replacement.className = canvas.className;
    replacement.style.cssText = canvas.style.cssText;
    replacement.width = W;
    replacement.height = H;
    replacement.setAttribute('aria-hidden', 'true');
    canvas.replaceWith(replacement);
    const main = replacement.getContext('2d');
    if (!main) { status.textContent = `${reason}; still image shown.`; return; }
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    const overlay = layer.getContext('2d');
    const sourcePixels = document.createElement('canvas');
    sourcePixels.width = W;
    sourcePixels.height = H;
    const sourceContext = sourcePixels.getContext('2d');
    sourceContext.drawImage(image, 0, 0);
    const pixels = sourceContext.getImageData(0, 0, W, H).data;
    const waterfallPixels = document.createElement('canvas');
    waterfallPixels.width = W;
    waterfallPixels.height = H;
    const waterfallContext = waterfallPixels.getContext('2d');
    waterfallContext.drawImage(water, 0, 0);
    const filtered = waterfallContext.getImageData(0, 0, W, H);
    const cloudPixels = document.createElement('canvas');
    cloudPixels.width = W;
    cloudPixels.height = H;
    const cloudContext = cloudPixels.getContext('2d');
    cloudContext.drawImage(atmosphere, 0, 0);
    const filteredCloud = cloudContext.getImageData(0, 0, W, H);
    const groundPixels = document.createElement('canvas');
    groundPixels.width = W;
    groundPixels.height = H;
    const groundContext = groundPixels.getContext('2d');
    groundContext.drawImage(ground, 0, 0);
    const filteredGround = groundContext.getImageData(0, 0, W, H);
    function smoothstep(low, high, value) {
      const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
      return t * t * (3 - 2 * t);
    }
    function pixelLuma(index) {
      return (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] +
        0.0722 * pixels[index + 2]) / 255;
    }
    for (let i = 0; i < pixels.length; i += 4) {
      const luminance = pixelLuma(i);
      filtered.data[i + 3] *= smoothstep(0.01, 0.09, (pixels[i + 2] - pixels[i]) / 255) *
        smoothstep(0.22, 0.50, luminance);
      if (filteredCloud.data[i + 3]) {
        const pixel = i / 4;
        const x = pixel % W;
        const y = Math.floor(pixel / W);
        const edgeX = x > 1 && x < W - 2 ? Math.abs(pixelLuma(i + 8) - pixelLuma(i - 8)) : 1;
        const edgeY = y > 1 && y < H - 2 ? Math.abs(pixelLuma(i + 8 * W) - pixelLuma(i - 8 * W)) : 1;
        filteredCloud.data[i + 3] *= smoothstep(0.36, 0.59, luminance) *
          (1 - smoothstep(0.035, 0.12, edgeX + edgeY));
      }
      const warm = smoothstep(0.005, 0.08, (pixels[i] - pixels[i + 2]) / 255);
      const cool = smoothstep(0.02, 0.15, (pixels[i + 2] - pixels[i]) / 255);
      filteredGround.data[i + 3] *= smoothstep(0.09, 0.45, luminance) *
        (0.20 + 0.80 * Math.max(warm, cool));
    }
    waterfallContext.putImageData(filtered, 0, 0);
    cloudContext.putImageData(filteredCloud, 0, 0);
    groundContext.putImageData(filteredGround, 0, 0);
    let last = 0;
    let lastStatus = 0;
    let frames = 0;
    const started = performance.now();
    function applyMaskedShift(maskImage, dx, dy) {
      overlay.clearRect(0, 0, W, H);
      overlay.globalCompositeOperation = 'source-over';
      overlay.drawImage(image, dx, dy, W, H);
      overlay.globalCompositeOperation = 'destination-in';
      overlay.drawImage(maskImage, 0, 0);
      overlay.globalCompositeOperation = 'source-over';
      main.drawImage(layer, 0, 0);
    }
    function screenMasked(maskImage, alpha) {
      overlay.clearRect(0, 0, W, H);
      overlay.globalCompositeOperation = 'source-over';
      overlay.drawImage(image, 0, 0);
      overlay.globalCompositeOperation = 'destination-in';
      overlay.drawImage(maskImage, 0, 0);
      overlay.globalCompositeOperation = 'source-over';
      main.globalCompositeOperation = 'screen';
      main.globalAlpha = alpha;
      main.drawImage(layer, 0, 0);
      main.globalAlpha = 1;
      main.globalCompositeOperation = 'source-over';
    }
    function screenBand(maskImage, centers, halfWidth, alpha, color) {
      overlay.clearRect(0, 0, W, H);
      overlay.globalCompositeOperation = 'source-over';
      for (const center of centers) {
        const band = overlay.createLinearGradient(center - halfWidth, 0, center + halfWidth, 0);
        band.addColorStop(0, 'rgba(0,0,0,0)');
        band.addColorStop(0.5, color);
        band.addColorStop(1, 'rgba(0,0,0,0)');
        overlay.fillStyle = band;
        overlay.fillRect(center - halfWidth, 0, halfWidth * 2, H);
      }
      overlay.globalCompositeOperation = 'destination-in';
      overlay.drawImage(maskImage, 0, 0);
      overlay.globalCompositeOperation = 'source-over';
      main.globalCompositeOperation = 'screen';
      main.globalAlpha = alpha;
      main.drawImage(layer, 0, 0);
      main.globalAlpha = 1;
      main.globalCompositeOperation = 'source-over';
    }
    function draw(now) {
      if (destroyed) return;
      requestAnimationFrame(draw);
      if (now - last < 50 || document.hidden) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches && !controls.overrideReduced.checked) {
        replacement.hidden = true;
        return;
      }
      replacement.hidden = false;
      last = now;
      const enabled = (!window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        controls.overrideReduced.checked) && controls.still.getAttribute('aria-pressed') !== 'true';
      const strength = Number(controls.strength.value) / 100;
      const seconds = (now - started) / 1000;
      main.clearRect(0, 0, W, H);
      main.drawImage(image, 0, 0);
      if (enabled && controls.atmosphere.checked) {
        const phase = (seconds * 0.035) % 1;
        applyMaskedShift(cloudPixels, Math.sin(seconds * 0.25) * 1.5 * strength,
          Math.sin(seconds * 0.18) * 0.4 * strength);
        screenBand(cloudPixels, [330 + phase * 340, 510 + phase * 370], 150,
          strength * 0.23, 'rgba(255,242,224,0.45)');
      }
      if (enabled && controls.water.checked) {
        applyMaskedShift(waterfallPixels, 0, Math.sin(seconds * 1.6) * 5 * strength);
      }
      if (enabled && controls.lights.checked) {
        const sparkle = Math.max(0, Math.sin(seconds * 3.2));
        screenMasked(lights, strength * (0.06 + 0.22 * (0.5 + 0.5 * Math.sin(seconds * 1.3)) +
          0.12 * sparkle ** 4));
      }
      if (enabled && controls.fire.checked) {
        screenMasked(upperFire, strength * (0.10 + 0.32 * (0.5 + 0.5 * Math.sin(seconds * 11))));
        screenMasked(leftFire, strength * (0.02 + 0.11 * (0.5 + 0.5 * Math.sin(seconds * 8))));
      }
      if (enabled && controls.ground.checked) {
        const phase = (seconds * 0.10) % 1;
        screenBand(groundPixels, [phase * 220, 1475 + phase * 200], 65,
          strength * 0.68, 'rgba(255,216,161,0.90)');
      }
      if (enabled && controls.crystal.checked) {
        screenMasked(crystal, strength * (0.10 + 0.32 * (0.5 + 0.5 * Math.sin(seconds * 1.1))));
      }
      if (enabled && controls.lantern.checked) {
        const twinkle = Math.max(0, Math.sin(seconds * 3.7));
        screenMasked(lantern, strength * (0.05 + 0.23 * twinkle ** 3));
      }
      if (enabled && controls.portal.checked) {
        screenMasked(portal, strength * (0.06 + 0.25 * (0.5 + 0.5 * Math.sin(seconds * 1.2))));
      }
      if (enabled && controls.trace.checked) {
        const route = [[451, 377], [1190, 377], [1402, 721], [168, 721], [451, 377]];
        const lengths = [739, 404, 1234, 445];
        let distance = ((seconds * 0.075) % 1) * lengths.reduce((total, value) => total + value, 0);
        let center = route[0];
        for (let i = 0; i < lengths.length; i += 1) {
          if (distance <= lengths[i]) {
            const fraction = distance / lengths[i];
            center = [route[i][0] + (route[i + 1][0] - route[i][0]) * fraction,
              route[i][1] + (route[i + 1][1] - route[i][1]) * fraction];
            break;
          }
          distance -= lengths[i];
        }
        overlay.clearRect(0, 0, W, H);
        overlay.globalCompositeOperation = 'source-over';
        const beam = overlay.createRadialGradient(center[0], center[1], 0, center[0], center[1], 85);
        beam.addColorStop(0, 'rgba(255,226,157,0.8)');
        beam.addColorStop(1, 'rgba(255,226,157,0)');
        overlay.fillStyle = beam;
        overlay.fillRect(center[0] - 85, center[1] - 85, 170, 170);
        overlay.globalCompositeOperation = 'destination-in';
        overlay.drawImage(trace, 0, 0);
        overlay.globalCompositeOperation = 'source-over';
        main.globalCompositeOperation = 'screen';
        main.globalAlpha = strength * 0.9;
        main.drawImage(layer, 0, 0);
        main.globalAlpha = 1;
        main.globalCompositeOperation = 'source-over';
      }
      frames += 1;
      if (now - lastStatus > 1000) {
        status.textContent = `${enabled ? 'Animating' : 'Paused'} · 2D fallback frames ${frames} · ${reason}`;
        lastStatus = now;
      }
    }
    requestAnimationFrame(draw);
  }

  image.addEventListener('load', () => {
    if (destroyed) return;
    try {
      if (image.naturalWidth !== W || image.naturalHeight !== H) throw new Error('Source image dimensions changed');
      prepareTower();
      const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WebGL unavailable; showing still image');
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const vertex = gl.getAttribLocation(program, 'vertex');
      gl.enableVertexAttribArray(vertex);
      gl.vertexAttribPointer(vertex, 2, gl.FLOAT, false, 0, 0);
      [image, atmosphere, water, lights, trace, details, lantern, portal].forEach((item, index) => texture(gl, index, item));
      ['source', 'atmosphereMask', 'waterfallMask', 'lightMask', 'traceMask', 'detailsMask', 'lanternMask', 'portalMask'].forEach((name, index) =>
        gl.uniform1i(gl.getUniformLocation(program, name), index));
      gl.viewport(0, 0, W, H);
      const options = gl.getUniformLocation(program, 'options');
      const traceEnabled = gl.getUniformLocation(program, 'traceEnabled');
      const detailOptions = gl.getUniformLocation(program, 'detailOptions');
      const lanternEnabled = gl.getUniformLocation(program, 'lanternEnabled');
      const portalEnabled = gl.getUniformLocation(program, 'portalEnabled');
      const time = gl.getUniformLocation(program, 'time');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      let last = 0;
      let lastStatus = 0;
      let frames = 0;
      const start = performance.now();
      function draw(now) {
        if (destroyed) return;
        requestAnimationFrame(draw);
        if (now - last < 40 || document.hidden) return;
        if (reduced.matches && !controls.overrideReduced.checked) {
          canvas.hidden = true;
          return;
        }
        canvas.hidden = false;
        last = now;
        const enabled = (!reduced.matches || controls.overrideReduced.checked) &&
          controls.still.getAttribute('aria-pressed') !== 'true';
        gl.uniform4f(options, Number(enabled && controls.atmosphere.checked),
          Number(enabled && controls.water.checked), Number(enabled && controls.lights.checked),
          Number(controls.strength.value) / 100);
        gl.uniform1f(traceEnabled, Number(enabled && controls.trace.checked));
        gl.uniform3f(detailOptions, Number(enabled && controls.fire.checked),
          Number(enabled && controls.ground.checked), Number(enabled && controls.crystal.checked));
        gl.uniform1f(lanternEnabled, Number(enabled && controls.lantern.checked));
        gl.uniform1f(portalEnabled, Number(enabled && controls.portal.checked));
        gl.uniform1f(time, (now - start) / 1000);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        frames += 1;
        if (now - lastStatus > 1000) {
          const reason = reduced.matches && !controls.overrideReduced.checked ?
            'Paused by reduced-motion preference; check the override to preview.' :
            !enabled ? 'Held still.' : 'Animating';
          const error = gl.getError();
          status.textContent = `${reason} · WebGL frames ${frames} · graphics error ${error}`;
          lastStatus = now;
        }
      }
      status.textContent = 'Starting WebGL motion preview…';
      requestAnimationFrame(draw);
    } catch (error) {
      startCanvasFallback(error.message || 'WebGL unavailable');
    }
  }, { once: true });
  if (image.complete && image.naturalWidth) image.dispatchEvent(new Event('load'));
  return { destroy() { destroyed = true; interactionTarget.removeEventListener('click', onSymbolClick);
    if (symbolFrame) cancelAnimationFrame(symbolFrame);
    if (towerFrame) cancelAnimationFrame(towerFrame);
    symbolContext.clearRect(0, 0, W, H);
    towerContext.clearRect(0, 0, W, H); },
    status: () => status.textContent };
  }
  window.FutureMotion = Object.freeze({ mount });
})();

(() => {
  'use strict';

  const W = 1672;
  const H = 941;
  const FEATURES = [
    { id: 'crystal', label: 'Crystal', color: 'cyan', kind: 'rise',
      rect: [1490, 293, 62, 137], hit: [1485, 290, 1558, 441],
      polygon: [[1525, 296], [1549, 328], [1550, 407], [1526, 426], [1492, 415], [1498, 335]] },
    { id: 'portal', label: 'Portal ring', color: 'gold', kind: 'orbit',
      rect: [1384, 35, 110, 107], hit: [1384, 30, 1495, 146],
      center: [1438, 85], radii: [42, 40], annulus: true },
    { id: 'armillary', label: 'Armillary', color: 'gold', kind: 'orbit',
      rect: [246, 225, 133, 133], hit: [243, 222, 380, 365],
      center: [312, 289], radii: [68, 67] },
    { id: 'left-medallion', label: 'Left medallion', color: 'gold', kind: 'orbit',
      rect: [442, 824, 112, 115], hit: [445, 825, 554, 939],
      center: [498, 880], radii: [57, 58] },
    { id: 'right-medallion', label: 'Right medallion', color: 'gold', kind: 'orbit',
      rect: [1090, 825, 120, 115], hit: [1094, 827, 1208, 939],
      center: [1150, 880], radii: [61, 58] },
  ];
  const CENTER = { id: 'center-selector', label: 'Planetary selector', color: 'gold', kind: 'orbit',
    rect: [620, 793, 408, 148], hit: [610, 785, 1035, 941], center: [821, 870], radii: [202, 72] };

  function smooth(low, high, value) {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  }
  function inPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a[1] > y) !== (b[1] > y) &&
        x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function mount({ image, canvas, target, status }) {
    const context = canvas.getContext('2d');
    if (!context) return { destroy() {} };
    const features = [...FEATURES, CENTER].map((item) => ({ ...item }));
    const byId = new Map(features.map((item) => [item.id, item]));
    let ready = false;
    let destroyed = false;
    let frame = 0;
    let pulses = [];
    let recent = [];
    let lastResonance = -Infinity;

    function prepare(feature) {
      const [left, top, width, height] = feature.rect;
      const source = document.createElement('canvas');
      source.width = width;
      source.height = height;
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      sourceContext.drawImage(image, left, top, width, height, 0, 0, width, height);
      const original = sourceContext.getImageData(0, 0, width, height).data;
      const sprite = document.createElement('canvas');
      sprite.width = width;
      sprite.height = height;
      const spriteContext = sprite.getContext('2d');
      const glow = spriteContext.createImageData(width, height);
      let selected = 0;
      for (let py = 2; py < height - 2; py++) {
        for (let px = 2; px < width - 2; px++) {
          const x = left + px, y = top + py;
          const distance = feature.radii ? Math.hypot((x - feature.center[0]) / feature.radii[0],
            (y - feature.center[1]) / feature.radii[1]) : 0;
          const geometry = feature.polygon ? Number(inPolygon(x, y, feature.polygon)) :
            feature.annulus ? 1 - smooth(.08, .20, Math.abs(distance - .98)) :
              1 - smooth(.74, 1.04, distance);
          if (geometry <= 0) continue;
          const index = (py * width + px) * 4;
          const r = original[index], g = original[index + 1], b = original[index + 2];
          const light = (.2126 * r + .7152 * g + .0722 * b) / 255;
          const nearby = (py * width + Math.min(width - 1, px + 4)) * 4;
          const neighbor = (.2126 * original[nearby] + .7152 * original[nearby + 1] +
            .0722 * original[nearby + 2]) / 255;
          const detail = smooth(.012, .13, Math.abs(light - neighbor));
          const chroma = feature.color === 'cyan' ? smooth(4, 53, b - r) :
            feature.annulus ? smooth(16, 68, r - b) :
              feature.id.includes('medallion') ? smooth(3, 27, r - b) : smooth(5, 57, r - b);
          const surface = feature.annulus ? smooth(.30, .67, light) :
            feature.id.includes('medallion') ? smooth(.025, .18, light) : smooth(.075, .38, light);
          const strokeDetail = feature.annulus ? smooth(.012, .12, Math.abs(light - neighbor)) :
            feature.id === 'armillary' ? smooth(.018, .14, Math.abs(light - neighbor)) :
            feature.id.includes('medallion') ? smooth(.006, .08, Math.abs(light - neighbor)) : detail;
          const alpha = Math.round(255 * geometry * chroma * surface *
            (feature.annulus ? .08 + .92 * strokeDetail :
              feature.id === 'armillary' ? strokeDetail : .20 + .80 * strokeDetail));
          if (alpha < 9) continue;
          selected++;
          glow.data[index] = feature.color === 'cyan' ? 130 : 255;
          glow.data[index + 1] = feature.color === 'cyan' ? 228 : 207;
          glow.data[index + 2] = feature.color === 'cyan' ? 255 : 120;
          glow.data[index + 3] = alpha;
        }
      }
      if (selected < 16) return false;
      spriteContext.putImageData(glow, 0, 0);
      feature.sprite = sprite;
      feature.band = document.createElement('canvas');
      feature.band.width = width;
      feature.band.height = height;
      return true;
    }

    function initialize() {
      if (destroyed || ready || !image.naturalWidth) return;
      for (const feature of features) prepare(feature);
      ready = true;
    }
    if (image.complete) initialize();
    else image.addEventListener('load', initialize, { once: true });

    function band(feature, progress) {
      const [left, top, width, height] = feature.rect;
      const context = feature.band.getContext('2d');
      context.clearRect(0, 0, width, height);
      context.drawImage(feature.sprite, 0, 0);
      context.globalCompositeOperation = 'destination-in';
      if (feature.kind === 'rise') {
        const center = height * (1.06 - progress * 1.13);
        const gradient = context.createLinearGradient(0, center - 24, 0, center + 24);
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(.5, 'rgba(255,255,255,1)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      } else {
        const angle = -Math.PI / 2 + progress * Math.PI * 2.25;
        context.beginPath();
        context.moveTo(feature.center[0] - left, feature.center[1] - top);
        context.arc(feature.center[0] - left, feature.center[1] - top,
          Math.max(width, height) * 1.2, angle - .38, angle + .38);
        context.closePath();
        context.fillStyle = '#fff';
        context.fill();
      }
      context.globalCompositeOperation = 'source-over';
      return feature.band;
    }

    function paint(now) {
      frame = 0;
      if (destroyed) return;
      context.clearRect(0, 0, W, H);
      pulses = pulses.filter((pulse) => now - pulse.started < pulse.duration);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      for (const pulse of pulses) {
        const age = now - pulse.started;
        if (age < 0 || !pulse.feature.sprite) continue;
        const progress = Math.min(1, age / pulse.duration);
        const fade = (1 - smooth(.25, 1, progress)) * pulse.intensity;
        const [left, top] = pulse.feature.rect;
        context.globalCompositeOperation = 'screen';
        context.filter = pulse.feature.annulus ? 'none' : 'blur(8px)';
        context.globalAlpha = (pulse.feature.annulus ? .25 : .62) * fade;
        context.drawImage(pulse.feature.sprite, left, top);
        context.filter = 'none';
        context.globalAlpha = (pulse.feature.annulus ? .48 : .74) * fade;
        context.drawImage(pulse.feature.sprite, left, top);
        if (!reduced) {
          const sweep = band(pulse.feature, progress);
          if (!pulse.feature.annulus) {
            context.filter = 'blur(5px)';
            context.globalAlpha = .95 * fade;
            context.drawImage(sweep, left, top);
          }
          context.filter = 'none';
          context.globalAlpha = (pulse.feature.annulus ? .85 : .9) * fade;
          context.drawImage(sweep, left, top);
        }
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
      }
      if (pulses.length) frame = requestAnimationFrame(paint);
    }

    function activate(feature, now, intensity = 1, delay = 0) {
      if (!feature.sprite) return;
      pulses.push({ feature, started: now + delay,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 620 : 1550,
        intensity });
      if (!frame) frame = requestAnimationFrame(paint);
    }

    function onClick(event) {
      if (!ready || destroyed) return;
      const box = image.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const x = (event.clientX - box.left) * W / box.width;
      const y = (event.clientY - box.top) * H / box.height;
      const feature = features.find((item) => {
        const hit = item.hit || [item.center[0] - item.radii[0], item.center[1] - item.radii[1],
          item.center[0] + item.radii[0], item.center[1] + item.radii[1]];
        return x >= hit[0] && x <= hit[2] && y >= hit[1] && y <= hit[3];
      });
      if (!feature) return;
      const selected = byId.get(feature.id);
      const now = performance.now();
      activate(selected, now);
      recent = recent.filter((entry) => now - entry.at < 6000 && entry.id !== feature.id);
      recent.push({ id: feature.id, at: now });
      if (status) status.textContent = feature.label + ' illuminated' +
        (recent.length > 1 ? ' · ' + recent.length + ' symbols resonating' : '');
      if (recent.length >= 3 && now - lastResonance > 4500) {
        lastResonance = now;
        recent = [];
        FEATURES.forEach((item, index) => activate(byId.get(item.id), now, .6, index * 110));
        activate(byId.get(CENTER.id), now, .95, 360);
        if (status) status.textContent = 'Constellation resonance · five lights answered';
      }
    }
    target.addEventListener('click', onClick);
    return { destroy() {
      destroyed = true;
      target.removeEventListener('click', onClick);
      image.removeEventListener('load', initialize);
      if (frame) cancelAnimationFrame(frame);
      context.clearRect(0, 0, W, H);
    } };
  }

  window.FutureFeatureClicks = { mount, features: FEATURES.map(({ id, hit }) => ({ id, hit })) };
})();

'use strict';

(() => {
  const TAU = Math.PI * 2;
  const radians = (value) => Number(value) * Math.PI / 180;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const ease = (value) => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
  const smooth = (value) => { const amount = clamp(value, 0, 1); return amount * amount * (3 - 2 * amount); };
  const wrap = (value) => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const degrees = (value) => value * 180 / Math.PI;
  function perspectiveDistance(horizon) {
    let amount = clamp((horizon - .02) / .72, 0, 1);
    amount = amount * amount * (3 - 2 * amount);
    return 1.18 + 24 * (1 - amount) * (1 - amount);
  }
  function viewTilt(horizon, cameraDistance) {
    const amount = clamp(horizon, 0, 1);
    return Math.asin(1 / cameraDistance) * amount * .78;
  }

  const BRIGHT_STARS = [
    [6.752, -16.716, -1.46], [6.399, -52.696, -.74], [14.261, 19.182, -.05], [18.615, 38.783, .03],
    [5.279, 45.998, .08], [5.243, -8.202, .13], [7.655, 5.225, .34], [5.919, 7.407, .42],
    [1.629, -57.237, .46], [14.063, -60.373, .61], [19.846, 8.868, .77], [12.443, -63.099, .76],
    [4.599, 16.509, .85], [16.49, -26.432, .96], [13.42, -11.161, .98], [7.755, 28.026, 1.14],
    [22.961, -29.622, 1.16], [20.691, 45.28, 1.25], [10.139, 11.967, 1.35], [6.977, -28.972, 1.5],
    [7.576, 31.888, 1.58], [12.519, -57.113, 1.63], [17.56, -37.104, 1.62], [5.419, 6.35, 1.64],
    [5.438, 28.608, 1.65], [9.22, -69.717, 1.67], [5.604, -1.201, 1.69], [22.138, -46.961, 1.74],
    [12.9, 55.96, 1.76], [3.405, 49.861, 1.79], [11.062, 61.751, 1.79], [17.622, -42.998, 1.86],
  ];
  function vector(latitude, longitude, scale = 1) {
    const lat = radians(latitude), lon = radians(longitude), cos = Math.cos(lat);
    return { x: Math.sin(lon) * cos * scale, y: Math.sin(lat) * scale, z: Math.cos(lon) * cos * scale };
  }

  function coordinate(point) {
    const length = Math.hypot(point.x, point.y, point.z) || 1;
    return { latitude: Math.asin(point.y / length) * 180 / Math.PI,
      longitude: Math.atan2(point.x, point.z) * 180 / Math.PI };
  }

  function astronomy(now) {
    const days = now / 86400000 - 10957.5;
    const gmst = (280.46061837 + 360.98564736629 * days) % 360;
    const obliquity = radians(23.4393 - 3.563e-7 * days);
    const anomaly = radians((357.529 + .98560028 * days) % 360);
    const longitude = radians((280.459 + .98564736 * days + 1.915 * Math.sin(anomaly) + .02 * Math.sin(2 * anomaly)) % 360);
    const sunRa = degrees(Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude)));
    const sunDec = degrees(Math.asin(Math.sin(obliquity) * Math.sin(longitude)));
    const moonNode = radians((125.1228 - .0529538083 * days) % 360);
    const moonInclination = radians(5.1454);
    const moonPerigee = radians((318.0634 + .1643573223 * days) % 360);
    const moonMean = radians((115.3654 + 13.0649929509 * days) % 360);
    const eccentricity = .0549;
    const eccentric = moonMean + eccentricity * Math.sin(moonMean) * (1 + eccentricity * Math.cos(moonMean));
    const xv = Math.cos(eccentric) - eccentricity;
    const yv = Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentric);
    const trueAnomaly = Math.atan2(yv, xv);
    const moonLongitude = trueAnomaly + moonPerigee;
    const mx = Math.cos(moonNode) * Math.cos(moonLongitude) - Math.sin(moonNode) * Math.sin(moonLongitude) * Math.cos(moonInclination);
    const my = Math.sin(moonNode) * Math.cos(moonLongitude) + Math.cos(moonNode) * Math.sin(moonLongitude) * Math.cos(moonInclination);
    const mz = Math.sin(moonLongitude) * Math.sin(moonInclination);
    const equatorialY = my * Math.cos(obliquity) - mz * Math.sin(obliquity);
    const equatorialZ = my * Math.sin(obliquity) + mz * Math.cos(obliquity);
    const moonRa = degrees(Math.atan2(equatorialY, mx));
    const moonDec = degrees(Math.atan2(equatorialZ, Math.hypot(mx, equatorialY)));
    return {
      gmst,
      sun: { latitude: sunDec, longitude: wrap(radians(sunRa - gmst)) * 180 / Math.PI },
      moon: { latitude: moonDec, longitude: wrap(radians(moonRa - gmst)) * 180 / Math.PI },
    };
  }

  function slerp(left, right, amount, scale = 1) {
    const dot = clamp(left.x * right.x + left.y * right.y + left.z * right.z, -1, 1);
    const angle = Math.acos(dot);
    if (angle < 0.0001) return { x: left.x * scale, y: left.y * scale, z: left.z * scale };
    const sine = Math.sin(angle);
    const a = Math.sin((1 - amount) * angle) / sine;
    const b = Math.sin(amount * angle) / sine;
    return { x: (left.x * a + right.x * b) * scale,
      y: (left.y * a + right.y * b) * scale, z: (left.z * a + right.z * b) * scale };
  }

  function distanceKilometres(left, right) {
    const a = vector(left.latitude, left.longitude), b = vector(right.latitude, right.longitude);
    return Math.acos(clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1)) * 6371;
  }

  function decodeTopology(topology) {
    const transform = topology.transform || { scale: [1, 1], translate: [0, 0] };
    const cache = new Map();
    const arc = (index) => {
      const reversed = index < 0;
      const key = reversed ? ~index : index;
      if (!cache.has(key)) {
        let x = 0, y = 0;
        cache.set(key, topology.arcs[key].map((delta) => {
          x += delta[0]; y += delta[1];
          return [x * transform.scale[0] + transform.translate[0],
            y * transform.scale[1] + transform.translate[1]];
        }));
      }
      const points = cache.get(key);
      return reversed ? [...points].reverse() : points;
    };
    const rings = [];
    const visit = (value) => {
      if (!Array.isArray(value)) return;
      if (value.length && value.every(Number.isInteger)) {
        const ring = [];
        for (const index of value) {
          const points = arc(index);
          ring.push(...(ring.length ? points.slice(1) : points));
        }
        if (ring.length > 2) rings.push(ring);
        return;
      }
      value.forEach(visit);
    };
    visit(topology.objects?.land?.geometries?.map((item) => item.arcs) || topology.objects?.land?.arcs);
    return rings;
  }

  function createEarthTextureRenderer(redraw) {
    if (typeof document === 'undefined') return null;
    const surface = document.createElement('canvas');
    const gl = surface.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) return null;
    const vertexSource = `
      attribute vec2 aPosition;
      void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const fragmentSource = `
      precision highp float;
      uniform vec2 uCenter;
      uniform float uRadius;
      uniform float uYaw;
      uniform float uPitch;
      uniform float uRoll;
      uniform float uCameraDistance;
      uniform float uViewTilt;
      uniform vec3 uSun;
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      const float PI = 3.141592653589793;
      void main() {
        vec2 p = (gl_FragCoord.xy - uCenter) / uRadius;
        float screenX = p.x;
        float screenY = -p.y;
        float cr = cos(uRoll), sr = sin(uRoll);
        float viewY = -screenY;
        float perspectiveScale = sqrt(uCameraDistance * uCameraDistance - 1.0);
        float ct = cos(uViewTilt), st = sin(uViewTilt);
        float rolledY = viewY / perspectiveScale * ct + st;
        vec3 ray = vec3(screenX / perspectiveScale * cr - rolledY * sr,
          screenX / perspectiveScale * sr + rolledY * cr,
          viewY / perspectiveScale * st - ct);
        float raySquared = dot(ray, ray);
        float cameraDot = uCameraDistance * ray.z;
        float discriminant = cameraDot * cameraDot
          - raySquared * (uCameraDistance * uCameraDistance - 1.0);
        if (discriminant <= 0.0) discard;
        float travel = (-cameraDot - sqrt(discriminant)) / raySquared;
        vec3 cameraPoint = vec3(0.0, 0.0, uCameraDistance) + ray * travel;
        float cp = cos(uPitch), sp = sin(uPitch);
        float worldY = cameraPoint.y * cp + cameraPoint.z * sp;
        float yawZ = -cameraPoint.y * sp + cameraPoint.z * cp;
        float cy = cos(uYaw), sy = sin(uYaw);
        vec3 world = normalize(vec3(cameraPoint.x * cy - yawZ * sy, worldY,
          cameraPoint.x * sy + yawZ * cy));
        float longitude = atan(world.x, world.z);
        vec2 uv = vec2(fract(longitude / (2.0 * PI) + 0.5),
          0.5 - asin(clamp(world.y, -1.0, 1.0)) / PI);
        vec3 day = texture2D(uDay, uv).rgb;
        float lights = texture2D(uNight, uv).r;
        float solar = dot(world, normalize(uSun));
        float daylight = smoothstep(-0.08, 0.12, solar);
        vec3 dayColor = day * (0.18 + 0.82 * max(solar, 0.0));
        vec3 nightBase = day * 0.018 + vec3(0.001, 0.004, 0.009);
        vec3 nightLights = vec3(1.0, 0.67, 0.28) * pow(lights, 0.72) * 2.35;
        vec3 color = mix(nightBase + nightLights, dayColor, daylight);
        vec3 toCamera = normalize(vec3(0.0, 0.0, uCameraDistance) - cameraPoint);
        float facing = clamp(dot(cameraPoint, toCamera), 0.0, 1.0);
        float atmosphere = pow(1.0 - facing, 3.0);
        color += vec3(0.0, 0.16, 0.25) * atmosphere * 0.55;
        float alpha = smoothstep(0.0, 0.018, facing);
        gl_FragColor = vec4(color, alpha);
      }
    `;
    const shader = (type, source) => {
      const item = gl.createShader(type); gl.shaderSource(item, source); gl.compileShader(item);
      if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw new Error('Earth texture shader unavailable');
      return item;
    };
    let program;
    try {
      program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Earth texture program unavailable');
    } catch (_) { return null; }
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(['uCenter','uRadius','uYaw','uPitch','uRoll','uCameraDistance','uViewTilt','uSun','uDay','uNight']
      .map((name) => [name, gl.getUniformLocation(program, name)]));
    const textures = [gl.createTexture(), gl.createTexture()];
    let loaded = 0;
    const loadTexture = (url, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array(unit ? [0,0,0,255] : [4,14,30,255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const image = new Image();
      image.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, textures[unit]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        loaded += 1; redraw();
      };
      image.src = url;
    };
    loadTexture('/nasa-blue-marble-day.webp?v=96', 0);
    loadTexture('/nasa-black-marble-night.webp?v=96', 1);
    gl.uniform1i(uniforms.uDay, 0); gl.uniform1i(uniforms.uNight, 1);
    return {
      surface,
      ready: () => loaded === 2,
      draw(view, state, sun) {
        if (surface.width !== view.width || surface.height !== view.height) {
          surface.width = view.width; surface.height = view.height;
        }
        gl.viewport(0, 0, surface.width, surface.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(uniforms.uCenter, view.centerX, view.height - view.centerY);
        gl.uniform1f(uniforms.uRadius, view.radius); gl.uniform1f(uniforms.uYaw, state.yaw);
        gl.uniform1f(uniforms.uPitch, state.pitch); gl.uniform1f(uniforms.uRoll, state.roll);
        gl.uniform1f(uniforms.uCameraDistance, view.cameraDistance);
        gl.uniform1f(uniforms.uViewTilt, view.viewTilt);
        gl.uniform3f(uniforms.uSun, sun.x, sun.y, sun.z);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
    };
  }

  function create(canvas, callbacks = {}) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable');
    canvas.style.background = '#02050d';
    const state = { yaw: -.35, pitch: .12, roll: 0, horizon: 0, zoom: 1, velocityX: 0, velocityY: 0,
      dragging: false, dragMode: 'orbit', pointer: null, lastX: 0, lastY: 0, moved: false, data: null,
      selectedSource: null, selectedCity: null, routeStarted: 0, routeDuration: 5200, routeProgress: 0,
      camera: null, cameraQueue: [], flight: null,
      rings: [],
      stars: [], hotspots: [], active: true, travelEnabled: true,
      framePending: false, idleTimer: null, lastPaint: 0 };
    for (let index = 0; index < 180; index += 1) state.stars.push({
      x: (Math.sin(index * 91.73) * .5 + .5), y: (Math.sin(index * 47.11 + 2) * .5 + .5),
      size: .35 + (index % 7) * .16, alpha: .18 + (index % 5) * .11,
    });

    fetch('/world-land-50m.json?v=96', { cache: 'force-cache' }).then((response) => {
      if (!response.ok) throw new Error('world outline unavailable');
      return response.json();
    }).then((topology) => {
      state.rings = decodeTopology(topology);
      requestDraw();
    }).catch(() => {});
    function requestDraw() {
      if (!state.active || state.framePending) return;
      state.framePending = true;
      requestAnimationFrame(frame);
    }

    function scheduleClockRefresh() {
      if (!state.active || state.idleTimer || !window.setTimeout) return;
      state.idleTimer = window.setTimeout(() => {
        state.idleTimer = null;
        requestDraw();
      }, 60000);
    }
    const earthTexture = createEarthTextureRenderer(requestDraw);

    function resize() {
      const rectangle = canvas.getBoundingClientRect();
      if (rectangle.width < 16 || rectangle.height < 16) return null;
      // A 1.5x backing store stays crisp while avoiding the 4x pixel cost of
      // a 2x canvas on large desktop displays.
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rectangle.width * ratio));
      const height = Math.max(1, Math.round(rectangle.height * ratio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const radius = Math.min(width, height) * .365 * state.zoom;
      const cameraDistance = perspectiveDistance(state.horizon);
      return { width, height, ratio, radius,
        centerX: width * .5, centerY: height * .51,
        cameraDistance, viewTilt: viewTilt(state.horizon, cameraDistance) };
    }

    function project(point, view) {
      const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
      const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      const x = point.x * cy + point.z * sy;
      const z = -point.x * sy + point.z * cy;
      const y = point.y * cp - z * sp;
      const depth = point.y * sp + z * cp;
      const cr = Math.cos(state.roll), sr = Math.sin(state.roll);
      const horizontal = x * cr + y * sr;
      const rolledVertical = y * cr - x * sr;
      const ct = Math.cos(view.viewTilt), st = Math.sin(view.viewTilt);
      const vertical = rolledVertical * ct + (depth - view.cameraDistance) * st;
      const forward = rolledVertical * st - (depth - view.cameraDistance) * ct;
      const screenX = horizontal;
      const screenY = -vertical;
      const magnitude = Math.hypot(point.x, point.y, point.z);
      const celestial = magnitude > 1.4;
      const factor = celestial ? 1 : Math.sqrt(view.cameraDistance * view.cameraDistance - 1)
        / Math.max(.015, forward);
      return { x: view.centerX + screenX * factor * view.radius,
        y: view.centerY + screenY * factor * view.radius,
        depth: celestial ? depth : depth - 1 / view.cameraDistance };
    }

    function limbIntersection(left, right, view) {
      let low = 0, high = 1;
      const leftFront = project(left, view).depth > 0;
      for (let index = 0; index < 12; index += 1) {
        const middle = (low + high) / 2;
        if ((project(slerp(left, right, middle), view).depth > 0) === leftFront) low = middle;
        else high = middle;
      }
      const point = project(slerp(left, right, (low + high) / 2), view);
      const angle = Math.atan2(point.y - view.centerY, point.x - view.centerX);
      return { x: view.centerX + Math.cos(angle) * view.radius,
        y: view.centerY + Math.sin(angle) * view.radius, angle };
    }

    function closeAlongLimb(exit, entry, view) {
      const delta = wrap(entry.angle - exit.angle);
      const steps = Math.max(2, Math.min(64, Math.ceil(Math.abs(delta) * view.radius / 22)));
      for (let index = 1; index <= steps; index += 1) {
        const angle = exit.angle + delta * index / steps;
        context.lineTo(view.centerX + Math.cos(angle) * view.radius,
          view.centerY + Math.sin(angle) * view.radius);
      }
      context.closePath();
    }

    function traceVisibleLand(ring, view) {
      const vectors = ring.map((pair) => vector(pair[1], pair[0]));
      const projected = vectors.map((point) => project(point, view));
      const hiddenIndex = projected.findIndex((point) => point.depth <= 0);
      if (hiddenIndex < 0) {
        context.moveTo(projected[0].x, projected[0].y);
        projected.slice(1).forEach((point) => context.lineTo(point.x, point.y));
        context.closePath();
        return;
      }
      if (!projected.some((point) => point.depth > 0)) return;
      let entry = null;
      for (let offset = 1; offset <= vectors.length; offset += 1) {
        const previousIndex = (hiddenIndex + offset - 1) % vectors.length;
        const currentIndex = (hiddenIndex + offset) % vectors.length;
        const previous = projected[previousIndex], current = projected[currentIndex];
        if (previous.depth <= 0 && current.depth > 0) {
          entry = limbIntersection(vectors[previousIndex], vectors[currentIndex], view);
          context.moveTo(entry.x, entry.y); context.lineTo(current.x, current.y);
        } else if (previous.depth > 0 && current.depth > 0) context.lineTo(current.x, current.y);
        else if (previous.depth > 0 && current.depth <= 0 && entry) {
          const exit = limbIntersection(vectors[previousIndex], vectors[currentIndex], view);
          context.lineTo(exit.x, exit.y); closeAlongLimb(exit, entry, view); entry = null;
        }
      }
    }

    function horizonRoll(left, right, amount) {
      const first = coordinate(slerp(left, right, clamp(amount - .012, 0, 1)));
      const second = coordinate(slerp(left, right, clamp(amount + .012, 0, 1)));
      const yaw = -radians(coordinate(slerp(left, right, amount)).longitude);
      const pitch = radians(coordinate(slerp(left, right, amount)).latitude);
      const raw = (location) => {
        const point = vector(location.latitude, location.longitude);
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const x = point.x * cy + point.z * sy;
        const z = -point.x * sy + point.z * cy;
        const y = point.y * cp - z * sp;
        return { x, y: -y };
      };
      const a = raw(first), b = raw(second);
      return -Math.atan2(b.y - a.y, b.x - a.x);
    }

    function cameraTo(location, zoom, duration, delay = 0, roll = state.roll, horizon = state.horizon) {
      const targetYaw = -radians(location.longitude);
      const targetPitch = radians(location.latitude);
      state.camera = { start: performance.now() + delay, duration, fromYaw: state.yaw,
        fromPitch: state.pitch, fromRoll: state.roll, fromHorizon: state.horizon, fromZoom: state.zoom,
        targetYaw, targetPitch, targetRoll: roll, targetHorizon: horizon, targetZoom: zoom };
      state.flight = null;
      state.velocityX = 0; state.velocityY = 0;
      requestDraw();
    }

    function cameraSequence(steps) {
      state.cameraQueue = [...steps];
      const first = state.cameraQueue.shift();
      if (first) cameraTo(first.location, first.zoom, first.duration, first.delay || 0,
        first.roll ?? state.roll, first.horizon ?? state.horizon);
    }

    function animatePath(source) {
      if (!state.data?.destination) return;
      const destination = state.data.destination;
      const start = vector(destination.latitude, destination.longitude);
      const end = vector(source.latitude, source.longitude);
      const now = performance.now();
      state.camera = null; state.cameraQueue = [];
      state.flight = {
        start: now, departDuration: 850, travelDuration: 5200, holdDuration: 650, revealDuration: 1250,
        routeStart: start, routeEnd: end, destination, source,
        fromYaw: state.yaw, fromPitch: state.pitch, fromRoll: state.roll,
        fromHorizon: state.horizon, fromZoom: state.zoom,
      };
      state.routeStarted = now + state.flight.departDuration;
      state.routeProgress = 0;
      state.velocityX = 0; state.velocityY = 0;
      requestDraw();
    }

    function updateFlight(now) {
      const flight = state.flight;
      if (!flight) return false;
      const departureEnd = flight.departDuration;
      const travelEnd = departureEnd + flight.travelDuration;
      const holdEnd = travelEnd + flight.holdDuration;
      const revealEnd = holdEnd + flight.revealDuration;
      const elapsed = now - flight.start;
      const destinationYaw = -radians(flight.destination.longitude);
      const destinationPitch = radians(flight.destination.latitude);
      const sourceYaw = -radians(flight.source.longitude);
      const sourcePitch = radians(flight.source.latitude);
      const flightRoll = (amount) => wrap(horizonRoll(flight.routeStart, flight.routeEnd, amount) - Math.PI / 2);
      if (elapsed < departureEnd) {
        const amount = smooth(elapsed / departureEnd);
        state.yaw = flight.fromYaw + wrap(destinationYaw - flight.fromYaw) * amount;
        state.pitch = flight.fromPitch + (destinationPitch - flight.fromPitch) * amount;
        state.roll = flight.fromRoll + wrap(flightRoll(.002) - flight.fromRoll) * amount;
        state.horizon = flight.fromHorizon + (.9 - flight.fromHorizon) * amount;
        state.zoom = flight.fromZoom + (1.35 - flight.fromZoom) * amount;
      } else if (elapsed < travelEnd) {
        const amount = clamp((elapsed - departureEnd) / flight.travelDuration, 0, 1);
        const location = coordinate(slerp(flight.routeStart, flight.routeEnd, amount));
        state.yaw = -radians(location.longitude); state.pitch = radians(location.latitude);
        state.roll = flightRoll(amount); state.horizon = .9; state.zoom = 1.35;
        state.routeProgress = amount;
      } else if (elapsed < holdEnd) {
        state.yaw = sourceYaw; state.pitch = sourcePitch; state.roll = flightRoll(.998);
        state.horizon = .72; state.zoom = 1.6; state.routeProgress = 1;
      } else if (elapsed < revealEnd) {
        const amount = smooth((elapsed - holdEnd) / flight.revealDuration);
        state.yaw = sourceYaw; state.pitch = sourcePitch;
        state.roll = flightRoll(.998) + wrap(-flightRoll(.998)) * amount;
        state.horizon = .72 * (1 - amount); state.zoom = 1.6 + (1.42 - 1.6) * amount;
        state.routeProgress = 1;
      } else {
        state.yaw = sourceYaw; state.pitch = sourcePitch; state.roll = 0;
        state.horizon = 0; state.zoom = 1.42; state.routeProgress = 1; state.flight = null;
      }
      return true;
    }

    function updateCamera(now) {
      if (updateFlight(now)) return;
      const item = state.camera;
      if (!item || now < item.start) return;
      const progress = ease((now - item.start) / item.duration);
      state.yaw = item.fromYaw + wrap(item.targetYaw - item.fromYaw) * progress;
      state.pitch = item.fromPitch + (item.targetPitch - item.fromPitch) * progress;
      state.roll = item.fromRoll + wrap(item.targetRoll - item.fromRoll) * progress;
      state.horizon = item.fromHorizon + (item.targetHorizon - item.fromHorizon) * progress;
      state.zoom = item.fromZoom + (item.targetZoom - item.fromZoom) * progress;
      if (progress >= 1) {
        state.camera = null;
        const next = state.cameraQueue.shift();
        if (next) cameraTo(next.location, next.zoom, next.duration, next.delay || 0,
          next.roll ?? state.roll, next.horizon ?? state.horizon);
      }
    }

    function drawSpace(view, now, sky) {
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      context.shadowBlur = 0; context.filter = 'none';
      context.clearRect(0, 0, view.width, view.height);
      const voidGradient = context.createRadialGradient(view.centerX, view.centerY, 0, view.centerX, view.centerY, Math.max(view.width, view.height));
      voidGradient.addColorStop(0, '#06101e'); voidGradient.addColorStop(.45, '#020711'); voidGradient.addColorStop(1, '#000105');
      context.fillStyle = voidGradient; context.fillRect(0, 0, view.width, view.height);
      for (const star of state.stars) {
        context.globalAlpha = star.alpha * .3;
        context.fillStyle = '#b9d4ee'; context.fillRect(star.x * view.width, star.y * view.height, star.size * view.ratio, star.size * view.ratio);
      }
      for (const star of BRIGHT_STARS) {
        const point = project(vector(star[1], star[0] * 15 - sky.gmst, 1.56), view);
        if (point.depth <= 0 || Math.hypot(point.x - view.centerX, point.y - view.centerY) < view.radius * 1.04) continue;
        const size = clamp(3.2 - star[2], 1, 4.6) * view.ratio;
        context.globalAlpha = .72 + Math.sin(now * .0012 + star[0]) * .2;
        context.shadowBlur = size * 2.8; context.shadowColor = '#a9d9ff'; context.fillStyle = star[2] < .2 ? '#fff8dc' : '#d9eeff';
        context.beginPath(); context.arc(point.x, point.y, size * .45, 0, TAU); context.fill();
      }
      context.globalAlpha = 1;
      const aura = context.createRadialGradient(view.centerX, view.centerY, view.radius * .62,
        view.centerX, view.centerY, view.radius * 1.24);
      aura.addColorStop(0, 'rgba(6,33,58,0)'); aura.addColorStop(.68, 'rgba(0,217,255,.09)'); aura.addColorStop(1, 'rgba(0,217,255,0)');
      context.fillStyle = aura; context.beginPath(); context.arc(view.centerX, view.centerY, view.radius * 1.3, 0, TAU); context.fill();

      const sun = project(vector(sky.sun.latitude, sky.sun.longitude, 1.58), view);
      if (sun.depth > 0 && Math.hypot(sun.x - view.centerX, sun.y - view.centerY) > view.radius * 1.04) {
        const glow = context.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, 30 * view.ratio);
        glow.addColorStop(0, '#fff'); glow.addColorStop(.12, '#fff3a6'); glow.addColorStop(.45, '#ffab3970'); glow.addColorStop(1, '#ff7b0000');
        context.fillStyle = glow; context.beginPath(); context.arc(sun.x, sun.y, 30 * view.ratio, 0, TAU); context.fill();
      }
      const moon = project(vector(sky.moon.latitude, sky.moon.longitude, 1.48), view);
      if (moon.depth > 0 && Math.hypot(moon.x - view.centerX, moon.y - view.centerY) > view.radius * 1.04) {
        context.shadowBlur = 9 * view.ratio; context.shadowColor = '#dbeaff'; context.fillStyle = '#c8d0d6';
        context.beginPath(); context.arc(moon.x, moon.y, 4.5 * view.ratio, 0, TAU); context.fill();
        context.shadowBlur = 0;
      }
    }

    function drawEarth(view, sky) {
      const sunlight = vector(sky.sun.latitude, sky.sun.longitude);
      if (earthTexture?.ready()) {
        earthTexture.draw(view, state, sunlight);
        context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.shadowBlur = 0;
        context.drawImage(earthTexture.surface, 0, 0, view.width, view.height);
        if (view.viewTilt < .02) {
          context.strokeStyle = 'rgba(82,232,255,.5)'; context.lineWidth = 1.1 * view.ratio;
          context.beginPath(); context.arc(view.centerX, view.centerY, view.radius, 0, TAU); context.stroke();
        }
        return;
      }
      const globe = context.createRadialGradient(view.centerX - view.radius * .28, view.centerY - view.radius * .32,
        view.radius * .05, view.centerX, view.centerY, view.radius);
      globe.addColorStop(0, '#126081'); globe.addColorStop(.48, '#063550'); globe.addColorStop(.82, '#031526'); globe.addColorStop(1, '#01050b');
      context.fillStyle = globe; context.beginPath(); context.arc(view.centerX, view.centerY, view.radius, 0, TAU); context.fill();
      context.save(); context.beginPath(); context.arc(view.centerX, view.centerY, view.radius - 1, 0, TAU); context.clip();
      context.fillStyle = '#347b5d'; context.beginPath();
      for (const ring of state.rings) traceVisibleLand(ring, view);
      context.fill('evenodd');
      const sunPoint = project(sunlight, view);
      const directionX = sunPoint.x - view.centerX, directionY = sunPoint.y - view.centerY;
      const length = Math.hypot(directionX, directionY) || 1;
      const dx = directionX / length, dy = directionY / length;
      const shade = context.createLinearGradient(view.centerX - dx * view.radius, view.centerY - dy * view.radius,
        view.centerX + dx * view.radius, view.centerY + dy * view.radius);
      shade.addColorStop(0, sunPoint.depth >= 0 ? 'rgba(0,3,10,.82)' : 'rgba(214,239,255,.02)');
      shade.addColorStop(.43, 'rgba(0,7,15,.48)');
      shade.addColorStop(.58, 'rgba(0,10,18,.14)');
      shade.addColorStop(1, sunPoint.depth >= 0 ? 'rgba(157,220,220,.04)' : 'rgba(0,3,10,.88)');
      context.fillStyle = shade; context.beginPath(); context.arc(view.centerX, view.centerY, view.radius, 0, TAU); context.fill();
      context.restore(); context.globalAlpha = 1; context.shadowBlur = 0; context.globalCompositeOperation = 'source-over';
      context.strokeStyle = 'rgba(82,232,255,.65)'; context.lineWidth = 1.2 * view.ratio;
      context.beginPath(); context.arc(view.centerX, view.centerY, view.radius, 0, TAU); context.stroke();
    }

    function drawLines(view) {
      context.save();
      if (view.viewTilt < .02) {
        context.beginPath(); context.arc(view.centerX, view.centerY, view.radius - 1, 0, TAU); context.clip();
      }
      context.strokeStyle = 'rgba(54,204,228,.15)'; context.lineWidth = .65 * view.ratio;
      for (let latitude = -60; latitude <= 60; latitude += 30) {
        context.beginPath(); let open = false;
        for (let longitude = -180; longitude <= 180; longitude += 3) {
          const point = project(vector(latitude, longitude), view);
          if (point.depth > 0) { if (!open) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); open = true; }
          else open = false;
        }
        context.stroke();
      }
      for (let longitude = -180; longitude < 180; longitude += 30) {
        context.beginPath(); let open = false;
        for (let latitude = -90; latitude <= 90; latitude += 2) {
          const point = project(vector(latitude, longitude), view);
          if (point.depth > 0) { if (!open) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); open = true; }
          else open = false;
        }
        context.stroke();
      }
      context.strokeStyle = 'rgba(113,244,208,.54)'; context.lineWidth = 1.05 * view.ratio;
      for (const ring of state.rings) {
        context.beginPath(); let open = false;
        for (const pair of ring) {
          // The coastline is a surface annotation, not an atmospheric shell.
          // Drawing it at an inflated radius makes it visibly float above the
          // terrain during low horizon fly-bys.
          const point = project(vector(pair[1], pair[0]), view);
          if (point.depth > .002) { if (!open) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y); open = true; }
          else open = false;
        }
        context.stroke();
      }
      context.restore();
    }

    function drawRoute(view, now, source, destination, active = false) {
      const left = vector(destination.latitude, destination.longitude);
      const right = vector(source.latitude, source.longitude);
      // Overview routes arc above the globe. During a flight the selected
      // route becomes a low guidance line, so it follows the surface toward
      // the horizon instead of shooting vertically through the sky.
      const arcHeight = active && state.flight ? .008 : .28;
      const points = [];
      for (let index = 0; index <= 96; index += 1) {
        const amount = index / 96;
        points.push(project(slerp(left, right, amount, 1 + Math.sin(Math.PI * amount) * arcHeight), view));
      }
      context.save(); context.globalAlpha = active ? 1 : state.selectedSource ? .09 : .34;
      context.shadowBlur = (active ? 12 : 5) * view.ratio; context.shadowColor = '#ff274f';
      context.strokeStyle = active ? '#ff3658' : '#ff6c83';
      context.lineWidth = (active ? 2.4 : 1) * view.ratio; context.beginPath();
      let open = false;
      for (const point of points) {
        const visible = point.depth > 0;
        if (!visible) { open = false; continue; }
        if (open) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
        open = true;
      }
      context.stroke();
      if (active && state.travelEnabled) {
        const amount = state.flight ? state.routeProgress : clamp((now - state.routeStarted) / state.routeDuration, 0, 1);
        const pulse = points[Math.round(amount * (points.length - 1))];
        if (pulse.depth > 0) {
          context.fillStyle = '#fff'; context.shadowBlur = 22 * view.ratio; context.beginPath();
          context.arc(pulse.x, pulse.y, 3.8 * view.ratio, 0, TAU); context.fill();
        }
      }
      context.restore();
    }

    function drawHotspots(view, now) {
      state.hotspots = [];
      const sources = state.data?.sources || [];
      const destination = state.data?.destination;
      const selected = sources.find((source) => source.ip === state.selectedSource);
      // Travel controls camera animation, never whether connection evidence is visible.
      if (destination) {
        for (const source of sources) if (source !== selected) drawRoute(view, now, source, destination);
        if (selected) drawRoute(view, now, selected, destination, true);
      }
      for (const source of [...sources].sort((a, b) => a.count - b.count)) {
        const point = project(vector(source.latitude, source.longitude, 1.015), view);
        if (point.depth <= 0) continue;
        const chosen = source.ip === state.selectedSource;
        const cityMatch = !state.selectedCity || source.city === state.selectedCity;
        const radius = (4 + Math.sqrt(source.count) * 1.65) * view.ratio * Math.sqrt(state.zoom);
        context.globalAlpha = (state.selectedSource && !chosen) || !cityMatch ? .16 : 1;
        context.shadowBlur = (chosen ? 25 : 14) * view.ratio; context.shadowColor = '#ff3156';
        context.fillStyle = chosen ? '#fff' : '#ff3156'; context.strokeStyle = '#ff9bac';
        context.lineWidth = (chosen ? 2.2 : 1) * view.ratio; context.beginPath();
        context.arc(point.x, point.y, radius + (chosen ? Math.sin(now * .008) * 1.5 : 0), 0, TAU); context.fill(); context.stroke();
        state.hotspots.push({ source, x: point.x, y: point.y, radius: Math.max(radius, 12 * view.ratio) });
      }
      if (destination) {
        const point = project(vector(destination.latitude, destination.longitude, 1.02), view);
        if (point.depth > 0) {
          const pulse = 10 + (now * .018 % 18);
          context.globalAlpha = 1 - (pulse - 10) / 18; context.strokeStyle = '#4fffe1'; context.lineWidth = 1.6 * view.ratio;
          context.beginPath(); context.arc(point.x, point.y, pulse * view.ratio, 0, TAU); context.stroke();
          context.globalAlpha = 1; context.shadowBlur = 22 * view.ratio; context.shadowColor = '#4fffe1';
          context.fillStyle = '#f5ffff'; context.beginPath(); context.arc(point.x, point.y, 5.5 * view.ratio, 0, TAU); context.fill();
        }
      }
      context.globalAlpha = 1; context.shadowBlur = 0;
    }

    function frame(now) {
      state.framePending = false;
      if (!state.active) return;
      try {
        const view = resize();
        if (!view) {
          scheduleClockRefresh();
          return;
        }
        updateCamera(now);
        if (!state.dragging && !state.camera) {
          state.yaw = wrap(state.yaw + state.velocityX); state.pitch = clamp(state.pitch + state.velocityY, -1.35, 1.35);
          state.velocityX *= .94; state.velocityY *= .94;
          if (Math.abs(state.velocityX) < .00008) state.velocityX = 0;
          if (Math.abs(state.velocityY) < .00008) state.velocityY = 0;
        }
        const sky = astronomy(Date.now());
        drawSpace(view, now, sky); drawEarth(view, sky); drawLines(view); drawHotspots(view, now);
        state.lastPaint = now;
      } catch (error) {
        const view = resize();
        if (!view) {
          scheduleClockRefresh();
          return;
        }
        context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; context.shadowBlur = 0;
        context.fillStyle = '#02050d'; context.fillRect(0, 0, view.width, view.height);
        context.fillStyle = '#ff6680'; context.font = `${14 * view.ratio}px system-ui`;
        context.fillText('Globe renderer unavailable — refresh to retry', 24 * view.ratio, 80 * view.ratio);
        state.active = false;
        callbacks.onError?.(error);
      }
      const routeAnimating = state.selectedSource && state.travelEnabled
        && (state.flight || now < state.routeStarted + state.routeDuration);
      if (state.active && (state.dragging || state.camera || state.cameraQueue.length
        || state.velocityX || state.velocityY || routeAnimating)) requestDraw();
      else scheduleClockRefresh();
    }

    function pointerPosition(event) {
      const rectangle = canvas.getBoundingClientRect();
      const ratioX = canvas.width / rectangle.width, ratioY = canvas.height / rectangle.height;
      return { x: (event.clientX - rectangle.left) * ratioX, y: (event.clientY - rectangle.top) * ratioY };
    }
    canvas.addEventListener('pointerdown', (event) => {
      state.dragging = true; state.pointer = event.pointerId; state.lastX = event.clientX; state.lastY = event.clientY;
      state.dragMode = event.button === 2 ? 'flightView' : 'orbit';
      state.moved = false; state.camera = null; state.cameraQueue = []; state.flight = null;
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!state.dragging || event.pointerId !== state.pointer) return;
      const dx = event.clientX - state.lastX, dy = event.clientY - state.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true;
      const factor = .006 / state.zoom;
      if (state.dragMode === 'flightView') {
        state.horizon = clamp(state.horizon + dy * .0035, 0, .95);
        state.roll = wrap(state.roll + dx * .004);
        state.velocityX = 0; state.velocityY = 0;
      } else {
        state.yaw = wrap(state.yaw + dx * factor); state.pitch = clamp(state.pitch + dy * factor, -1.35, 1.35);
        state.velocityX = dx * factor; state.velocityY = dy * factor;
      }
      state.lastX = event.clientX; state.lastY = event.clientY;
      requestDraw();
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerup', (event) => {
      if (event.pointerId !== state.pointer) return;
      state.dragging = false; canvas.releasePointerCapture(event.pointerId);
      if (!state.moved && state.dragMode === 'orbit') {
        const point = pointerPosition(event);
        const hit = [...state.hotspots].reverse().find((item) => Math.hypot(item.x - point.x, item.y - point.y) <= item.radius);
        if (hit) callbacks.onSource?.(hit.source); else callbacks.onBackground?.();
      }
      requestDraw();
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault(); state.camera = null; state.cameraQueue = []; state.flight = null;
      state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * .0012), .72, 4.4);
      requestDraw();
    }, { passive: false });
    canvas.addEventListener('keydown', (event) => {
      if (event.key === '+' || event.key === '=') state.zoom = clamp(state.zoom * 1.18, .72, 4.4);
      else if (event.key === '-') state.zoom = clamp(state.zoom / 1.18, .72, 4.4);
      else if (event.key === 'ArrowLeft') state.yaw -= .09;
      else if (event.key === 'ArrowRight') state.yaw += .09;
      else if (event.key === 'ArrowUp') state.pitch = clamp(state.pitch - .09, -1.35, 1.35);
      else if (event.key === 'ArrowDown') state.pitch = clamp(state.pitch + .09, -1.35, 1.35);
      else return;
      event.preventDefault(); state.camera = null; state.cameraQueue = []; state.flight = null;
      requestDraw();
    });

    window.addEventListener?.('resize', requestDraw);
    requestDraw();
    return {
      setData(data, selection = {}) {
        state.data = data; state.selectedCity = selection.city || null;
        const previous = data?.sources?.find((item) => item.ip === state.selectedSource);
        const changed = state.selectedSource !== (selection.source || null);
        state.selectedSource = selection.source || null;
        if (changed && state.selectedSource) {
          const source = data?.sources?.find((item) => item.ip === state.selectedSource);
          if (source && state.travelEnabled) {
            if (previous && state.zoom >= 1.45 && distanceKilometres(previous, source) < 350) cameraTo(source, Math.max(2.25, state.zoom), 480);
            else animatePath(source);
          } else if (source) cameraTo(source, Math.max(2.1, state.zoom), 520);
        } else if (changed) {
          state.camera = null;
          state.cameraQueue = [];
        }
        requestDraw();
      },
      focusSource(source) { state.selectedSource = source.ip; if (state.travelEnabled) animatePath(source); else cameraTo(source, 2.35, 520); },
      focusLocation(location, zoom = 2.1) { cameraTo(location, zoom, 800); },
      setTravelEnabled(enabled) {
        state.travelEnabled = Boolean(enabled);
        if (!state.travelEnabled) { state.camera = null; state.cameraQueue = []; state.flight = null; }
        requestDraw();
        return state.travelEnabled;
      },
      reset() { cameraSequence([{ location: { latitude: 10, longitude: -20 }, zoom: 1, duration: 750, roll: 0, horizon: 0 }]); },
      zoomBy(amount) { state.camera = null; state.cameraQueue = []; state.zoom = clamp(state.zoom * amount, .72, 4.4); requestDraw(); },
      setActive(active) {
        state.active = Boolean(active);
        if (!state.active && state.idleTimer) { window.clearTimeout?.(state.idleTimer); state.idleTimer = null; }
        if (state.active) requestDraw();
      },
      destroy() {
        state.active = false;
        if (state.idleTimer) window.clearTimeout?.(state.idleTimer);
        state.idleTimer = null;
      },
    };
  }

  window.SecurityGlobe = { create };
})();

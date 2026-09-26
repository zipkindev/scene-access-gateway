'use strict';

const elements = Object.fromEntries(['revision','workspace','frame','scenePlane','background','motionPreview','motionPanel','motionEnabled','motionOptions','motionNote','motionStatus','gamePanel','gameEnabled','gamePreview','gamePreviewMenu','gamePreviewTitle','gamePreviewDetail','gameTest','gameReset','gameStatus','hotspot','qrPreview','zoomOut','zoomIn','zoomReset','zoomLevel','backgroundSelect','backgroundSize','browserTitle','clickDebugger','framingPanel','framingProfile','drawFocus','clearFocus','focusRect','focusStatus','focusPreview','focusPreviewImage','hotspotSelect','addSelectedHotspot','removeHotspot','destinationSelect','unlockMode','sequenceControls','sequencePointSelect','addSequencePoint','removeSequencePoint','maxGapSeconds','totalSeconds','coordinateLabel','x','y','radius','maximumZoom','preview','save','publish','status','history','imageLabel','imageFile','selectedUploadSize','uploadImage','optimizeQuality','optimizeImage','images','destinationType','destinationName','destinationUpstream','prepareDestination','destinationPlan','addDestination','pendingDestinations','managedDestination','destinationSnapshot','firewallUsername','firewallEmail','registerFirewallUser','firewallRegistrationStatus','firewallRegistrations','securityPanel','securitySummary','securitySeverity','securityRefresh','securityStatus','securityEvents','securityMap','securityMapSvg','securityMapRoutes','securityMapNodes','securityMapSummary','securityMapSelection','securityMapDestination','telegramToken','telegramVerifyBot','telegramBotLink','telegramBotStatus','telegramChat','telegramChatId','telegramDiscoverChats','telegramConnectChat','telegramDisconnect','telegramConfigured','telegramEnabled','telegramSeverity','telegramRedaction','telegramThreshold','telegramWindow','telegramCooldown','telegramReminder','telegramQuietAfter','telegramHourlyLimit','telegramQuietEnabled','telegramQuietStart','telegramQuietEnd','telegramCriticalOverride','telegramSave','telegramTest','telegramStatus','sourceReconDialog','sourceReconTarget','sourceReconCancel','sourceReconConfirm','sessionExpired','sessionSignIn','sessionSignInStatus'].map((id) => [id, document.getElementById(id)]));
let state;
let scene;
let selectedIndex = 0;
let selectedPointIndex = 0;
let dragging = false;
let motionPreview;
let gamePreview;
let previewVersion = 0;
let motionFailure = '';
let lastSessionRenewal = Date.now();
let lastRenewalAttempt = 0;
let renewalInFlight = false;
const RENEW_INTERVAL_MS = 15 * 60 * 1000;
const view = { scale: 1, x: 0, y: 0 };
const pointers = new Map();
let pinch = null;
let focusDrawing = false;
let focusDrag = null;

function gameCapable(background) {
  return !!background && (background.id === 'future-minesweeper-v1' ||
    (background.optimizedFrom === 'future-minesweeper-v1' && background.mediaType === 'image/webp')) &&
    background.width === 1672 && background.height === 941;
}

function limitView() {
  view.x = Math.max(-elements.frame.clientWidth * (view.scale - 1) / 2, Math.min(elements.frame.clientWidth * (view.scale - 1) / 2, view.x));
  view.y = Math.max(-elements.frame.clientHeight * (view.scale - 1) / 2, Math.min(elements.frame.clientHeight * (view.scale - 1) / 2, view.y));
}

function paintView() {
  limitView();
  elements.scenePlane.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  elements.zoomLevel.value = Math.round(view.scale * 100) + '%';
  elements.zoomOut.disabled = view.scale <= 1;
  elements.zoomIn.disabled = view.scale >= 8;
}

function resetView() {
  view.scale = 1;
  view.x = 0;
  view.y = 0;
  paintView();
}

function zoomAt(scale, clientX, clientY) {
  const bounds = elements.frame.getBoundingClientRect();
  const anchorX = clientX - bounds.left - bounds.width / 2;
  const anchorY = clientY - bounds.top - bounds.height / 2;
  const next = Math.max(1, Math.min(8, scale));
  view.x = anchorX - (anchorX - view.x) * next / view.scale;
  view.y = anchorY - (anchorY - view.y) * next / view.scale;
  view.scale = next;
  paintView();
}

function fitFrame() {
  if (!state || !scene) return;
  const background = state.backgrounds.find((item) => item.id === scene.backgroundId);
  if (!background) return;
  const style = getComputedStyle(elements.workspace);
  const width = elements.workspace.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const height = elements.workspace.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const ratio = background.width / background.height;
  const fittedWidth = Math.max(1, Math.min(width, height * ratio));
  elements.frame.style.width = fittedWidth + 'px';
  elements.frame.style.height = Math.max(1, fittedWidth / ratio) + 'px';
  paintView();
}

function middle() {
  const bounds = elements.frame.getBoundingClientRect();
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

function csrf() {
  return document.cookie.split(';').map((value) => value.trim()).find((value) => value.startsWith('scene_csrf='))?.slice(11) || '';
}

function showSessionExpired() {
  if (!elements.sessionExpired.open) elements.sessionExpired.showModal();
  elements.sessionSignInStatus.textContent = '';
}

function requireCsrf() {
  const token = csrf();
  if (!token) {
    showSessionExpired();
    throw new Error('Editor session expired. Sign in again to continue.');
  }
  return token;
}

async function readWriteResponse(response) {
  const result = await response.json();
  if (response.status === 419) showSessionExpired();
  return result;
}

async function maybeRenewSession() {
  if (renewalInFlight || document.hidden || elements.sessionExpired.open) return;
  if (!csrf()) return showSessionExpired();
  const now = Date.now();
  if (now - lastSessionRenewal < RENEW_INTERVAL_MS || now - lastRenewalAttempt < 60 * 1000) return;
  lastRenewalAttempt = now;
  renewalInFlight = true;
  try {
    const response = await fetch('/api/editor-session', { method: 'POST', headers: { 'X-Scene-CSRF': requireCsrf() }, cache: 'no-store' });
    if (response.status === 419) showSessionExpired();
    else if (response.ok && csrf()) lastSessionRenewal = Date.now();
    else elements.status.textContent = 'Could not extend the editor session.';
  } catch (_) {
    elements.status.textContent = 'Connection lost; editor session was not extended.';
  } finally { renewalInFlight = false; }
}

for (const eventName of ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart']) {
  document.addEventListener(eventName, maybeRenewSession, { passive: true });
}
setInterval(() => { if (!document.hidden && !csrf()) showSessionExpired(); }, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !csrf()) showSessionExpired(); });
elements.sessionExpired.addEventListener('cancel', (event) => event.preventDefault());
elements.sessionSignIn.addEventListener('click', async () => {
  elements.sessionSignIn.disabled = true;
  elements.sessionSignInStatus.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/editor-session', { cache: 'no-store' });
    if (!response.ok || !csrf()) throw new Error('Sign-in did not complete. Check your credentials and try again.');
    lastSessionRenewal = Date.now();
    elements.sessionExpired.close();
    elements.sessionSignInStatus.textContent = '';
    elements.status.textContent = 'Editor session renewed. Unsaved changes are still here.';
  } catch (error) { elements.sessionSignInStatus.textContent = error.message; }
  finally { elements.sessionSignIn.disabled = false; }
});

function selected() {
  return scene.hotspots[selectedIndex];
}

function selectedPoint() {
  return selectedPointIndex === 0 ? selected() : selected().sequence.steps[selectedPointIndex - 1];
}

function offsetPoint(point, index) {
  const dx = point.x > 0.7 ? -0.14 : 0.14;
  const dy = point.y > 0.7 ? -0.14 : 0.14;
  return { x: Math.max(0, Math.min(1, point.x + dx * (index % 2))),
    y: Math.max(0, Math.min(1, point.y + dy * (index % 2 ? 0 : 1))),
    radius: point.radius };
}

function formatBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return 'Size unavailable';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MiB (' + bytes.toLocaleString() + ' bytes)';
}

function imagePoint(event) {
  const bounds = elements.frame.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, ((event.clientX - bounds.left - bounds.width / 2 - view.x) / view.scale + bounds.width / 2) / bounds.width)),
    y: Math.max(0, Math.min(1, ((event.clientY - bounds.top - bounds.height / 2 - view.y) / view.scale + bounds.height / 2) / bounds.height)),
  };
}

function renderFocusGuide() {
  if (!scene || !state) return;
  elements.frame.classList.toggle('focus-editing', elements.framingPanel.open);
  scene.viewport.frames ||= {};
  const background = state.backgrounds.find((item) => item.id === scene.backgroundId);
  const profile = elements.framingProfile.value;
  const frame = scene.viewport.frames[profile];
  elements.focusRect.hidden = !frame;
  if (frame) {
    Object.assign(elements.focusRect.style, {
      left: frame.x * 100 + '%', top: frame.y * 100 + '%',
      width: frame.width * 100 + '%', height: frame.height * 100 + '%',
    });
  }
  elements.focusPreview.classList.toggle('portrait', profile === 'portrait');
  if (elements.focusPreviewImage.src !== elements.background.src) elements.focusPreviewImage.src = elements.background.src;
  const width = elements.focusPreview.clientWidth;
  const height = elements.focusPreview.clientHeight;
  if (width && height) {
    const result = SceneFraming.layout(background.width, background.height, width, height,
      scene.viewport.frames, scene.hotspots);
    Object.assign(elements.focusPreviewImage.style, {
      left: result.left + 'px', top: result.top + 'px',
      width: result.width + 'px', height: result.height + 'px',
    });
    elements.focusStatus.value = frame
      ? result.profile === 'full' ? 'This frame would hide a QR hotspot; viewers get the full image.'
        : 'Saved frame: ' + Math.round(frame.width * 100) + '% × ' + Math.round(frame.height * 100) + '% of the original image.'
      : 'No custom frame. This screen shape shows the full image.';
  } else {
    elements.focusStatus.value = frame ? 'Frame selected; open this section to preview.' : 'No custom frame.';
  }
}

function renderHotspot() {
  const hotspot = selected();
  const sequence = hotspot.sequence;
  if (!sequence || selectedPointIndex > sequence.steps.length) selectedPointIndex = 0;
  const point = selectedPoint();
  elements.hotspot.style.left = (point.x * 100) + '%';
  elements.hotspot.style.top = (point.y * 100) + '%';
  elements.hotspot.style.width = (point.radius * 200) + '%';
  elements.hotspot.style.aspectRatio = '1';
  if (sequence) elements.hotspot.dataset.step = String(selectedPointIndex + 1);
  else delete elements.hotspot.dataset.step;
  elements.x.value = point.x.toFixed(3);
  elements.y.value = point.y.toFixed(3);
  elements.radius.value = point.radius.toFixed(3);
  elements.coordinateLabel.textContent = sequence ? 'Point ' + (selectedPointIndex + 1) + ' coordinates' : 'Hotspot coordinates';
  elements.unlockMode.value = sequence ? 'sequence' : 'single';
  elements.sequenceControls.hidden = !sequence;
  for (const marker of elements.scenePlane.querySelectorAll('.sequence-point')) marker.remove();
  if (sequence) {
    const points = [hotspot, ...sequence.steps];
    elements.sequencePointSelect.replaceChildren(...points.map((_, index) => new Option('Point ' + (index + 1), String(index))));
    elements.sequencePointSelect.value = String(selectedPointIndex);
    elements.addSequencePoint.disabled = points.length >= 10;
    elements.removeSequencePoint.disabled = selectedPointIndex === 0 || points.length <= 2;
    elements.maxGapSeconds.value = sequence.maxGapSeconds;
    elements.totalSeconds.value = sequence.totalSeconds;
    points.forEach((other, index) => {
      if (index === selectedPointIndex) return;
      const marker = document.createElement('div');
      marker.className = 'sequence-point';
      marker.dataset.step = String(index + 1);
      marker.setAttribute('aria-hidden', 'true');
      Object.assign(marker.style, { left: other.x * 100 + '%', top: other.y * 100 + '%',
        width: other.radius * 200 + '%', aspectRatio: '1' });
      elements.scenePlane.append(marker);
    });
  }
}

function stopGamePreview() {
  gamePreview?.destroy();
  gamePreview = null;
  elements.gamePreview.hidden = true;
  elements.hotspot.hidden = false;
  elements.gameTest.textContent = 'Play-test in preview';
  elements.gameReset.disabled = true;
  elements.gameStatus.value = '';
}

function renderGameControls() {
  scene.interaction ||= { kind: 'none' };
  const available = gameCapable(state.backgrounds.find((item) => item.id === scene.backgroundId));
  elements.gamePanel.hidden = !available;
  elements.gameEnabled.checked = available && scene.interaction.kind === 'minesweeper';
  if (!available) stopGamePreview();
}

function render() {
  if (selectedIndex >= scene.hotspots.length) selectedIndex = 0;
  elements.hotspotSelect.replaceChildren(...scene.hotspots.map((item) => new Option(item.destinationId, item.id)));
  elements.hotspotSelect.value = selected().id;
  const availableDestinations = state.destinations.filter((item) => !scene.hotspots.some((hotspot) => hotspot.destinationId === item.id));
  const previousDestination = elements.destinationSelect.value;
  elements.destinationSelect.replaceChildren(...availableDestinations.map((item) => new Option(item.id, item.id)));
  if (availableDestinations.length === 0) elements.destinationSelect.add(new Option('No available destinations', ''));
  if (availableDestinations.some((item) => item.id === previousDestination)) elements.destinationSelect.value = previousDestination;
  elements.destinationSelect.disabled = availableDestinations.length === 0 || scene.hotspots.length >= 2;
  elements.addSelectedHotspot.disabled = elements.destinationSelect.disabled;
  elements.removeHotspot.disabled = selected().destinationId === 'torrentharbor';
  const background = state.backgrounds.find((item) => item.id === scene.backgroundId);
  const bundle = state.bundles?.[background.bundleId];
  const futureMotion = gameCapable(background);
  elements.frame.style.aspectRatio = background.width + ' / ' + background.height;
  fitFrame();
  resetView();
  elements.background.src = background.url || '/assets/' + background.file;
  elements.background.alt = background.id;
  elements.backgroundSelect.value = scene.backgroundId;
  scene.display ||= { title: 'ZArcade' };
  elements.browserTitle.value = scene.display.title;
  scene.diagnostics ||= { clickDebugger: false };
  elements.clickDebugger.checked = scene.diagnostics.clickDebugger === true;
  elements.backgroundSize.value = 'Selected image: ' + formatBytes(background.bytes) + ' · ' + (background.mediaType === 'image/webp' ? 'WebP' : 'PNG');
  renderGameControls();
  elements.optimizeImage.disabled = background.mediaType !== 'image/png';
  elements.maximumZoom.value = scene.viewport.maximumZoom;
  elements.revision.textContent = 'Active ' + state.active.revisionId;
  scene.motion ||= { enabled: false, effects: {} };
  if (bundle) for (const effect of bundle.effects) scene.motion.effects[effect.id] ??= false;
  elements.motionPanel.hidden = !bundle && !futureMotion;
  elements.motionEnabled.checked = futureMotion || !!scene.motion.enabled;
  elements.motionEnabled.disabled = futureMotion;
  elements.motionOptions.replaceChildren();
  if (bundle) {
    for (const effect of bundle.effects) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!scene.motion.effects[effect.id];
      checkbox.addEventListener('change', () => {
        scene.motion.effects[effect.id] = checkbox.checked;
        updateMotionPreview();
      });
      label.append(checkbox, document.createTextNode(effect.label));
      elements.motionOptions.append(label);
    }
    elements.motionNote.textContent = 'Motion uses this image’s own pixels in selected regions. Your settings are saved with the scene; reduced-motion devices show the still image.';
  }
  if (futureMotion) elements.motionNote.textContent = 'Calibrated motion is bound to this exact table image and its verified optimized copy. Plaques, banners, tower, crystal, portal, armillary and front medallions respond to clicks. Three distinct object clicks create a short resonance; the game and QR interactions remain in place.';
  motionPreview?.destroy();
  motionPreview = null;
  motionFailure = '';
  elements.motionPreview.replaceChildren();
  const version = ++previewVersion;
  if (bundle) {
    const source = new Image();
    source.onload = () => {
      if (version !== previewVersion) return;
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:100%;height:100%;position:absolute;inset:0;object-fit:fill';
      try {
        motionPreview = SceneMotion.create(canvas, source, bundle, selectedMotionEffects());
        if (motionPreview) elements.motionPreview.append(canvas);
        else motionFailure = 'WebGL is unavailable in this browser; the preview is still.';
      } catch (error) { motionFailure = 'Motion preview failed: ' + error.message; }
      updateMotionStatus();
    };
    source.onerror = () => {
      if (version !== previewVersion) return;
      motionFailure = 'Motion artwork could not be loaded.';
      updateMotionStatus();
    };
    source.src = elements.background.src;
  }
  if (futureMotion) {
    const root = document.createElement('div');
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    const source = document.createElement('img');
    source.className = 'future-motion-source';
    source.alt = '';
    source.draggable = false;
    for (const property of ['width', 'height', 'position', 'inset', 'pointerEvents']) {
      source.style[property] = ({ width: '100%', height: '100%', position: 'absolute', inset: '0', pointerEvents: 'none' })[property];
    }
    root.append(source);
    for (const name of ['canvas', 'mask', 'symbol', 'tower', 'feature']) {
      const canvas = document.createElement('canvas');
      canvas.className = 'future-motion-' + name;
      canvas.width = 1672;
      canvas.height = 941;
      canvas.hidden = name === 'mask';
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      if (name === 'symbol' || name === 'tower' || name === 'feature') canvas.style.mixBlendMode = 'screen';
      root.append(canvas);
    }
    elements.motionPreview.append(root);
    elements.motionStatus.textContent = 'Preparing calibrated motion preview…';
    const ambient = FutureMotion.mount(root, { interactionTarget: elements.scenePlane, status: elements.motionStatus });
    const features = FutureFeatureClicks.mount({ image: source,
      canvas: root.querySelector('.future-motion-feature'), target: elements.scenePlane });
    motionPreview = { destroy() { ambient.destroy(); features.destroy(); }, status: () => ambient.status() };
    source.src = elements.background.src;
  }
  updateMotionStatus();
  renderHotspot();
  renderFocusGuide();
}

function selectedMotionEffects() {
  return scene.motion.enabled ? Object.keys(scene.motion.effects).filter((id) => scene.motion.effects[id]) : [];
}

function updateMotionPreview() {
  motionPreview?.setEffects?.(selectedMotionEffects());
  updateMotionStatus();
}

function updateMotionStatus() {
  if (!scene || !state || elements.motionPanel.hidden) return;
  if (gameCapable(state.backgrounds.find((item) => item.id === scene.backgroundId))) return;
  if (!scene.motion.enabled) elements.motionStatus.value = 'Motion is off in this preview.';
  else if (!selectedMotionEffects().length) elements.motionStatus.value = 'Choose at least one effect to preview.';
  else if (motionFailure) elements.motionStatus.value = motionFailure;
  else if (!motionPreview) elements.motionStatus.value = 'Preparing motion preview…';
  else {
    const status = motionPreview.status();
    if (status.reducedMotion) elements.motionStatus.value = 'System reduced-motion is on; the preview is still.';
    else if (status.pageHidden) elements.motionStatus.value = 'Preview paused while this tab is hidden.';
    else if (status.contextLost || status.graphicsError) elements.motionStatus.value = 'Browser graphics stopped this preview; the still image remains.';
    else if (status.framesRendered < 2) elements.motionStatus.value = 'Starting motion preview…';
    else elements.motionStatus.value = 'Motion preview rendering · ' + status.selectedEffects + ' effect' + (status.selectedEffects === 1 ? '' : 's') + ' · ' + status.framesRendered + ' frames';
  }
}

setInterval(updateMotionStatus, 1000);

function coordinate(event) {
  const point = imagePoint(event);
  selectedPoint().x = point.x;
  selectedPoint().y = point.y;
  renderHotspot();
}

function updateFocusDrag(event) {
  const point = imagePoint(event);
  const background = state.backgrounds.find((item) => item.id === scene.backgroundId);
  const profile = elements.framingProfile.value;
  const normalizedRatio = SceneFraming.RATIOS[profile] * background.height / background.width;
  const frame = focusDrag.mode === 'move'
    ? SceneFraming.moveFrame(focusDrag.original, point.x - focusDrag.start.x, point.y - focusDrag.start.y)
    : SceneFraming.frameFromCorners(focusDrag.anchor, point, normalizedRatio);
  if (!frame) return;
  scene.viewport.frames ||= {};
  scene.viewport.frames[profile] = frame;
  focusDrag.changed = true;
  renderFocusGuide();
}

elements.framingProfile.addEventListener('change', () => {
  focusDrawing = false;
  elements.frame.classList.remove('focus-drawing');
  renderFocusGuide();
});
elements.framingPanel.addEventListener('toggle', () => {
  if (!elements.framingPanel.open) {
    focusDrawing = false;
    elements.frame.classList.remove('focus-drawing');
  }
  renderFocusGuide();
});
elements.drawFocus.addEventListener('click', () => {
  focusDrawing = !focusDrawing;
  elements.frame.classList.toggle('focus-drawing', focusDrawing);
  elements.focusStatus.value = focusDrawing
    ? 'Start at one corner, then drag to the opposite corner.' : 'Drawing cancelled.';
});
elements.clearFocus.addEventListener('click', () => {
  scene.viewport.frames ||= {};
  delete scene.viewport.frames[elements.framingProfile.value];
  focusDrawing = false;
  elements.frame.classList.remove('focus-drawing');
  renderFocusGuide();
});
elements.frame.addEventListener('pointerdown', (event) => {
  if (focusDrag) return;
  const profile = elements.framingProfile.value;
  const original = scene.viewport.frames?.[profile];
  const handle = event.target.closest('.focus-handle');
  const guide = event.target.closest('.focus-guide');
  if (!focusDrawing && (!original || !guide)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  elements.frame.setPointerCapture(event.pointerId);
  const start = imagePoint(event);
  let mode = 'draw';
  let anchor = start;
  if (!focusDrawing && handle) {
    mode = 'resize';
    const corner = handle.dataset.corner;
    anchor = { x: original.x + (corner.includes('w') ? original.width : 0),
      y: original.y + (corner.includes('n') ? original.height : 0) };
  } else if (!focusDrawing) mode = 'move';
  focusDrag = { pointerId: event.pointerId, mode, anchor, start,
    original: original && { ...original }, changed: false };
}, true);
elements.frame.addEventListener('pointermove', (event) => {
  if (!focusDrag || focusDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  updateFocusDrag(event);
}, true);
function endFocusDraw(event) {
  if (!focusDrag || focusDrag.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const changed = focusDrag.changed;
  focusDrag = null;
  if (changed) {
    focusDrawing = false;
    elements.frame.classList.remove('focus-drawing');
    elements.status.textContent = 'Focal frame prepared locally. Save draft or Publish to use it.';
  } else if (focusDrawing) elements.focusStatus.value = 'Drag farther from the starting corner to draw a useful frame.';
}
elements.frame.addEventListener('pointerup', endFocusDraw, true);
elements.frame.addEventListener('pointercancel', endFocusDraw, true);

elements.hotspot.addEventListener('pointerdown', (event) => {
  event.stopPropagation();
  dragging = true;
  elements.hotspot.setPointerCapture(event.pointerId);
  coordinate(event);
});
elements.hotspot.addEventListener('pointermove', (event) => { if (dragging) coordinate(event); });
elements.hotspot.addEventListener('pointerup', () => { dragging = false; renderFocusGuide(); });
elements.hotspot.addEventListener('pointercancel', () => { dragging = false; });
elements.frame.addEventListener('wheel', (event) => {
  event.preventDefault();
  zoomAt(view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY);
}, { passive: false });
elements.zoomIn.addEventListener('click', () => { const point = middle(); zoomAt(view.scale * 1.25, point.x, point.y); });
elements.zoomOut.addEventListener('click', () => { const point = middle(); zoomAt(view.scale / 1.25, point.x, point.y); });
elements.zoomReset.addEventListener('click', resetView);
// A native image drag steals pointer movement and pulls a browser drag ghost
// out of the fixed viewport; only the frame's pan gesture should move it.
elements.frame.addEventListener('dragstart', (event) => event.preventDefault());
elements.frame.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.hotspot') || event.target.closest('.game-tile')) return;
  event.preventDefault();
  elements.frame.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  elements.frame.classList.add('panning');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
  }
});
elements.frame.addEventListener('pointermove', (event) => {
  const previous = pointers.get(event.pointerId);
  if (!previous) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt(pinch.scale * distance / Math.max(1, pinch.distance), (a.x + b.x) / 2, (a.y + b.y) / 2);
  } else if (pointers.size === 1) {
    view.x += event.clientX - previous.x;
    view.y += event.clientY - previous.y;
    paintView();
  }
});
function endPan(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) elements.frame.classList.remove('panning');
}
elements.frame.addEventListener('pointerup', endPan);
elements.frame.addEventListener('pointercancel', endPan);
new ResizeObserver(fitFrame).observe(elements.workspace);
new ResizeObserver(renderFocusGuide).observe(elements.focusPreview);
elements.browserTitle.addEventListener('input', () => { scene.display = { title: elements.browserTitle.value }; });
elements.clickDebugger.addEventListener('change', () => {
  scene.diagnostics = { clickDebugger: elements.clickDebugger.checked };
});
elements.backgroundSelect.addEventListener('change', () => {
  stopGamePreview();
  const replacement = state.backgrounds.find((item) => item.id === elements.backgroundSelect.value);
  scene.backgroundId = elements.backgroundSelect.value;
  // Re-selecting the calibrated Future table repairs legacy optimized scenes
  // whose old editor cleared the interaction before provenance was retained.
  scene.interaction = gameCapable(replacement) ? { kind: 'minesweeper' } : { kind: 'none' };
  scene.motion = { enabled: false, effects: {} };
  scene.viewport.frames = {};
  render();
});
elements.gameEnabled.addEventListener('change', () => {
  scene.interaction = { kind: elements.gameEnabled.checked ? 'minesweeper' : 'none' };
});
elements.gameTest.addEventListener('click', () => {
  if (gamePreview) { stopGamePreview(); return; }
  if (!gameCapable(state.backgrounds.find((item) => item.id === scene.backgroundId))) return;
  elements.gamePreview.hidden = false;
  elements.hotspot.hidden = true;
  gamePreview = FutureGameCarousel.mount({svg:elements.gamePreview,target:elements.scenePlane,image:elements.background,title:elements.gamePreviewTitle,detail:elements.gamePreviewDetail,onControl:(action,game)=>{elements.gameStatus.value=`${game.name} · ${action}`;}});
  elements.gameTest.textContent = 'Stop play-test';
  elements.gameReset.disabled = false;
});
elements.gameReset.addEventListener('click', () => gamePreview?.select());
elements.motionEnabled.addEventListener('change', () => {
  scene.motion.enabled = elements.motionEnabled.checked;
  updateMotionPreview();
});
elements.hotspotSelect.addEventListener('change', () => {
  selectedIndex = scene.hotspots.findIndex((item) => item.id === elements.hotspotSelect.value);
  selectedPointIndex = 0;
  elements.removeHotspot.disabled = selected().destinationId === 'torrentharbor';
  renderHotspot();
});
elements.unlockMode.addEventListener('change', () => {
  const hotspot = selected();
  if (elements.unlockMode.value === 'sequence' && !hotspot.sequence) {
    hotspot.sequence = { steps: [offsetPoint(hotspot, 1), offsetPoint(hotspot, 2)],
      maxGapSeconds: 8, totalSeconds: 30 };
  } else if (elements.unlockMode.value === 'single') delete hotspot.sequence;
  selectedPointIndex = 0;
  renderHotspot();
});
elements.sequencePointSelect.addEventListener('change', () => {
  selectedPointIndex = Number(elements.sequencePointSelect.value);
  renderHotspot();
});
elements.addSequencePoint.addEventListener('click', () => {
  const sequence = selected().sequence;
  if (!sequence || sequence.steps.length >= 9) return;
  const last = sequence.steps.at(-1);
  sequence.steps.push({ x: Math.max(0, Math.min(1, last.x + (last.x > 0.7 ? -0.12 : 0.12))),
    y: Math.max(0, Math.min(1, last.y + (last.y > 0.7 ? -0.12 : 0.12))), radius: last.radius });
  selectedPointIndex = sequence.steps.length;
  renderHotspot();
});
elements.removeSequencePoint.addEventListener('click', () => {
  const sequence = selected().sequence;
  if (!sequence || selectedPointIndex === 0 || sequence.steps.length <= 1) return;
  sequence.steps.splice(selectedPointIndex - 1, 1);
  selectedPointIndex = Math.min(selectedPointIndex, sequence.steps.length);
  renderHotspot();
});
for (const field of ['maxGapSeconds', 'totalSeconds']) {
  elements[field].addEventListener('change', () => { if (selected().sequence) selected().sequence[field] = Number(elements[field].value); });
}
elements.addSelectedHotspot.addEventListener('click', () => {
  if (elements.addSelectedHotspot.disabled) return;
  const destinationId = elements.destinationSelect.value;
  if (!state.destinations.some((item) => item.id === destinationId) || scene.hotspots.some((item) => item.destinationId === destinationId)) return;
  scene.hotspots.push({ id:destinationId, shape:'circle', x:0.75, y:0.4, radius:0.04, destinationId, activation:'qr-popup', visible:false, enabled:true });
  selectedIndex = scene.hotspots.length - 1;
  selectedPointIndex = 0;
  render();
});
elements.removeHotspot.addEventListener('click', () => {
  if (selected().destinationId === 'torrentharbor') return;
  scene.hotspots.splice(selectedIndex, 1);
  selectedIndex = 0;
  selectedPointIndex = 0;
  render();
});
for (const name of ['x', 'y', 'radius']) elements[name].addEventListener('change', () => { selectedPoint()[name] = Number(elements[name].value); renderHotspot(); renderFocusGuide(); });
elements.maximumZoom.addEventListener('change', () => { scene.viewport.maximumZoom = Number(elements.maximumZoom.value); });
elements.preview.addEventListener('click', () => {
  elements.qrPreview.src = '/api/qr-preview/' + selected().destinationId;
  elements.qrPreview.classList.toggle('open');
});

async function mutate(url, method) {
  const token = requireCsrf();
  elements.status.textContent = 'Working…';
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': token }, body: JSON.stringify({ scene }) });
  const result = await readWriteResponse(response);
  if (!response.ok) throw new Error(result.error || 'Request failed');
  elements.status.textContent = method === 'PUT' ? 'Draft saved.' : 'Published.';
  await load();
}

elements.save.addEventListener('click', () => mutate('/api/draft', 'PUT').catch((error) => { elements.status.textContent = error.message; }));
elements.publish.addEventListener('click', () => mutate('/api/publish', 'POST').catch((error) => { elements.status.textContent = error.message; }));

elements.imageFile.addEventListener('change', () => {
  elements.selectedUploadSize.value = elements.imageFile.files[0]
    ? 'Selected upload: ' + formatBytes(elements.imageFile.files[0].size) : '';
});

elements.uploadImage.addEventListener('click', async () => {
  const file = elements.imageFile.files[0];
  if (!file || file.size > 15 * 1024 * 1024 || !elements.imageLabel.value.trim()) {
    elements.status.textContent = 'Choose a PNG under 15 MB and enter a label.';
    return;
  }
  try {
    const response = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Image-Label': elements.imageLabel.value.trim(), 'X-Scene-CSRF': requireCsrf() }, body: file });
    const result = await readWriteResponse(response);
    if (!response.ok) throw new Error(result.error || 'Upload failed');
    await load(true);
    stopGamePreview();
    scene.backgroundId = result.id;
    scene.interaction = { kind: 'none' };
    scene.motion = { enabled: false, effects: {} };
    render();
    elements.status.textContent = 'Image uploaded and selected locally. Save draft or Publish to apply it.';
  } catch (error) { elements.status.textContent = error.message; }
});

elements.optimizeImage.addEventListener('click', async () => {
  const original = state.backgrounds.find((item) => item.id === scene.backgroundId);
  if (!original || original.mediaType !== 'image/png') return;
  elements.optimizeImage.disabled = true;
  elements.status.textContent = 'Optimizing image…';
  try {
    const response = await fetch('/api/backgrounds/' + encodeURIComponent(original.id) + '/optimize', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() },
      body: JSON.stringify({ quality: Number(elements.optimizeQuality.value) }),
    });
    const result = await readWriteResponse(response);
    if (!response.ok) throw new Error(result.error || 'Optimization failed');
    if (result.unchanged) {
      elements.status.textContent = 'No copy created: this preset saves less than 10% versus the PNG.';
      return;
    }
    await load(true);
    stopGamePreview();
    scene.backgroundId = result.id;
    if (!gameCapable(original) || !gameCapable(state.backgrounds.find((item) => item.id === result.id))) {
      scene.interaction = { kind: 'none' };
    }
    if (!original.bundleId || original.bundleId !== result.bundleId) scene.motion = { enabled: false, effects: {} };
    render();
    const saved = Math.round((1 - result.bytes / result.sourceBytes) * 100);
    elements.status.textContent = 'Optimized copy selected: ' + formatBytes(result.bytes) + ' · ' + saved + '% smaller. Original retained; Save draft or Publish to apply it.';
  } catch (error) { elements.status.textContent = error.message; }
  finally { elements.optimizeImage.disabled = state.backgrounds.find((item) => item.id === scene.backgroundId)?.mediaType !== 'image/png'; }
});

async function prepareDestination() {
  const response = await fetch('/api/destinations/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() }, body: JSON.stringify({ name: elements.destinationName.value.trim(), upstream: elements.destinationUpstream.value.trim() }) });
  const result = await readWriteResponse(response);
  if (!response.ok) throw new Error(result.error || 'Could not prepare destination');
  elements.destinationPlan.textContent = result.name + ' · ' + result.publicOrigin + ' · ' + result.authentik.group + ' · initial member ' + result.authentik.initialMember + ' · ' + result.approval.method + ' · then ' + result.approval.destinationLogin + ' · existing direct route retained: ' + result.retainedDirectRoute + ' · ' + result.network.join(' · ');
  return result;
}
elements.prepareDestination.addEventListener('click', () => prepareDestination().catch((error) => { elements.status.textContent = error.message; }));
elements.addDestination.addEventListener('click', async () => {
  try {
    const plan = await prepareDestination();
    const response = await fetch('/api/destinations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() }, body: JSON.stringify({ id: plan.id, name: plan.name, route: plan.publicOrigin }) });
    const result = await readWriteResponse(response);
    if (!response.ok) throw new Error(result.error || 'Could not add destination');
    await load(true);
    elements.status.textContent = 'Pending destination added. No public route or access rule was changed.';
  } catch (error) { elements.status.textContent = error.message; }
});
elements.registerFirewallUser.addEventListener('click', async () => {
  elements.firewallRegistrationStatus.textContent = 'Checking account and sending proof…';
  try {
    const response = await fetch('/api/firewall-users', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() },
      body: JSON.stringify({ username: elements.firewallUsername.value.trim(), email: elements.firewallEmail.value.trim() }) });
    const result = await readWriteResponse(response);
    if (!response.ok) throw new Error(result.error || 'Registration unavailable');
    elements.firewallRegistrationStatus.textContent = 'Confirmation sent to the Authentik email. Access stays inactive until confirmed.';
    await load(true);
  } catch (error) { elements.firewallRegistrationStatus.textContent = error.message; }
});

async function imageAction(id, action) {
  const response = await fetch('/api/images/' + id + '/' + action, { method: 'POST', headers: { 'X-Scene-CSRF': requireCsrf() } });
  const result = await readWriteResponse(response);
  if (!response.ok) throw new Error(result.error || 'Image update failed');
  await load(true);
  elements.status.textContent = action === 'archive' ? 'Image removed from selection. Retained revisions can still use it.' : 'Image restored to selection.';
}

async function deleteImage(item) {
  const optimized = Boolean(item.optimizedFrom);
  if (optimized) {
    if (!window.confirm('Permanently delete this optimized copy? This cannot be undone.')) return;
  } else {
    if (!window.confirm('This is an original image, not an optimized copy. Continue to the permanent-delete confirmation?')) return;
    if (!window.confirm('PERMANENT DELETE: this original image and its stored file will be removed. This cannot be undone.')) return;
  }
  const response = await fetch('/api/images/' + item.id + '/purge', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() },
    body: JSON.stringify({ confirmation: optimized ? 'DELETE OPTIMIZED COPY' : 'PERMANENTLY DELETE ORIGINAL' }),
  });
  const result = await readWriteResponse(response);
  if (!response.ok) throw new Error(result.error || 'Image could not be deleted');
  await load(true);
  elements.status.textContent = optimized ? 'Optimized copy permanently deleted.' : 'Original image permanently deleted.';
}

async function rollback(revisionId) {
  const response = await fetch('/api/rollback/' + revisionId, { method: 'POST', headers: { 'X-Scene-CSRF': requireCsrf() } });
  const result = await readWriteResponse(response);
  if (!response.ok) throw new Error(result.error || 'Rollback failed');
  await load();
  elements.status.textContent = result.unchanged ? 'Already active; no new revision was created.' : 'Revision restored.';
}

async function showDestination() {
  const id = elements.managedDestination.value;
  document.getElementById('firewallRegistration').hidden = id !== 'firewall';
  document.getElementById('firewallSetupProfile').hidden = id !== 'firewall';
  elements.destinationSnapshot.textContent = 'Loading live destination settings…';
  try {
    const response = await fetch('/api/destinations/' + encodeURIComponent(id) + '/snapshot');
    const item = await response.json();
    if (!response.ok) throw new Error(item.error || 'Destination unavailable');
    if (elements.managedDestination.value !== id) return;
    const panel = document.createElement('div');
    panel.className = 'destination-details';
    const heading = document.createElement('h3');
    heading.textContent = item.name + ' · destination details';
    panel.append(heading);
    const facts = [
      ['Configured public route', item.publicRoute], ['Configured upstream', item.upstream + ' · TLS ' + item.tlsName],
      ['Access', item.authMode], ['Session', item.sessionMinutes + ' minutes'],
      ['Live Authentik group', item.group],
      ['Authentik application', item.applicationSlug || item.applicationStatus],
      ['Members checked', new Date(item.checkedAt).toLocaleString() + ' from ' + item.source],
    ];
    for (const [label, value] of facts) {
      const row = document.createElement('p');
      row.textContent = label + ': ' + value;
      panel.append(row);
    }
    const members = document.createElement('h4');
    members.textContent = 'Group members · ' + item.users.length;
    panel.append(members);
    if (id === 'torrentharbor') {
      const note = document.createElement('p');
      note.textContent = 'Adding group access does not create a TorrentHarbor app account. Approve requests through the existing TorrentHarbor account workflow. Removing group access blocks future portal approvals; an existing app session may remain until it expires or is revoked there.';
      panel.append(note);
    }
    const assign = document.createElement('div');
    assign.className = 'destination-member-assignment';
    const identifier = document.createElement('input');
    identifier.placeholder = 'Existing Authentik username or email';
    identifier.setAttribute('aria-label', 'Existing Authentik username or email');
    const assignButton = document.createElement('button');
    assignButton.type = 'button'; assignButton.textContent = 'Assign existing user to ' + item.name;
    assignButton.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/destinations/' + encodeURIComponent(id) + '/members',
          { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() },
            body: JSON.stringify({ identifier: identifier.value.trim() }) });
        const result = await readWriteResponse(response);
        if (!response.ok) throw new Error(result.error || 'Member assignment failed');
        await showDestination();
      } catch (error) { elements.status.textContent = error.message; }
    });
    assign.append(identifier, assignButton);
    panel.append(assign);
    for (const user of item.users) {
      const row = document.createElement('p');
      row.textContent = user.username + ' · ' + user.email + (user.active ? '' : ' · inactive') + (user.managed ? ' · created by portal' : '');
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = 'Remove from ' + item.name;
      remove.addEventListener('click', async () => {
        if (!confirm('Remove ' + user.username + ' from ' + item.group + '?')) return;
        try {
          const response = await fetch('/api/destinations/' + encodeURIComponent(id) + '/members/' + user.id + '/remove',
            { method: 'POST', headers: { 'X-Scene-CSRF': requireCsrf() } });
          const result = await readWriteResponse(response);
          if (!response.ok) throw new Error(result.error || 'Removal failed');
          await showDestination();
        } catch (error) { elements.status.textContent = error.message; }
      });
      row.append(' ', remove);
      if (id === 'firewall' && user.managed) {
        const del = document.createElement('button');
        del.type = 'button'; del.textContent = 'Delete portal-created account';
        del.addEventListener('click', async () => {
          const confirmation = prompt('Delete the Authentik account permanently? Type its username: ' + user.username);
          if (confirmation !== user.username) return;
          try {
            const response = await fetch('/api/destinations/firewall/members/' + user.id + '/delete',
              { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() },
                body: JSON.stringify({ confirmation }) });
            const result = await readWriteResponse(response);
            if (!response.ok) throw new Error(result.error || 'Account deletion failed');
            await showDestination();
          } catch (error) { elements.status.textContent = error.message; }
        });
        row.append(' ', del);
      }
      panel.append(row);
    }
    for (const [status, label] of [['pending', 'Pending requests'], ['blocked', 'Blocked requests']]) {
      const list = item.requests[status];
      const title = document.createElement('h4');
      title.textContent = label + ' · ' + list.requests.length;
      panel.append(title);
      for (const request of list.requests) {
        const row = document.createElement('p');
        row.textContent = request.email + ' · ' + new Date(request.requestedAt).toLocaleString();
        const actions = status === 'pending' ? [...(id === 'firewall' ? [['approve', 'Approve member']] : []), ['block', 'Block'], ['dismiss', 'Dismiss']] : [['unblock', 'Unblock']];
        for (const [action, label] of actions) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = label;
          button.addEventListener('click', async () => {
            try {
              const response = await fetch('/api/destinations/' + encodeURIComponent(id) + '/requests/' + request.id + '/' + action,
                { method: 'POST', headers: { 'X-Scene-CSRF': requireCsrf() } });
              const result = await readWriteResponse(response);
              if (!response.ok) throw new Error(result.error || 'Request update failed');
              await showDestination();
            } catch (error) { elements.status.textContent = error.message; }
          });
          row.append(' ', button);
        }
        panel.append(row);
      }
      if (list.nextCursor) {
        const note = document.createElement('p');
        note.textContent = 'Showing the first 100; more requests are available.';
        panel.append(note);
      }
    }
    elements.destinationSnapshot.replaceChildren(panel);
  } catch (error) {
    elements.destinationSnapshot.textContent = error.message;
  }
}
elements.managedDestination.addEventListener('change', showDestination);

function securityMetric(value, label) {
  const item = document.createElement('div');
  item.className = 'security-metric';
  const count = document.createElement('strong');
  count.textContent = String(value);
  const caption = document.createElement('span');
  caption.textContent = label;
  item.append(count, caption);
  return item;
}

const countryNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const securityFilters = Object.fromEntries(['stream', 'severity', 'type', 'category', 'country', 'city', 'source', 'method', 'status', 'disposition']
  .map((kind) => [kind, new Map()]));
let securityMapData = null;
let selectedMapSource = null;
let selectedMapCity = null;
const securityLabels = {
  stream: 'Stream', severity: 'Severity', type: 'Event', category: 'Alert', country: 'Country', city: 'City', source: 'Source',
  method: 'Method', status: 'HTTP status', disposition: 'Disposition',
};

function countryName(code) {
  try { return countryNames?.of(code) || code; } catch (_) { return code; }
}

function readableSecurityValue(value) {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function wafDispositionLabel(disposition, mode = null, statusVerified = false) {
  const labels = {
    observed_passed: statusVerified
      ? 'Origin returned final 2xx/3xx'
      : mode === 'DetectionOnly' ? 'Observed only (DetectionOnly; audit reported 2xx/3xx)'
        : 'Observed only (WAF audit reported 2xx/3xx)',
    origin_rejected: statusVerified ? 'Origin returned final 4xx' : 'WAF audit reported 4xx; final edge status unverified',
    origin_rate_limited: statusVerified ? 'Origin returned final HTTP 429' : 'WAF audit reported 429; final edge status unverified',
    origin_error: statusVerified ? 'Origin returned final 5xx' : 'WAF audit reported 5xx; final edge status unverified',
    waf_blocked: 'Blocked by WAF before the origin',
    edge_rejected: 'Rejected by edge host policy before the application',
    outcome_unknown: 'Final edge and application outcome unverified',
  };
  return labels[disposition] || readableSecurityValue(disposition);
}

function wafOutcomeMeaning(event) {
  if (event.edge?.statusVerified !== true) {
    if (event.edge?.correlationStatus === 'pending') return 'Automatic edge correlation is pending';
    return event.http?.status !== null
      ? `ModSecurity audit reported HTTP ${event.http.status}; exact final-response evidence is unavailable`
      : 'Exact final-response evidence is unavailable';
  }
  if (event.edge?.disposition === 'observed_passed') {
    return null;
  }
  if (event.edge?.disposition === 'origin_rejected') return 'The origin rejected the request';
  if (event.edge?.disposition === 'origin_rate_limited') return 'The origin rate-limited the request';
  if (event.edge?.disposition === 'origin_error') return 'The origin returned a server error';
  if (event.edge?.disposition === 'waf_blocked') return 'The request did not reach the origin';
  if (event.edge?.disposition === 'edge_rejected') {
    return 'The edge returned HTTP 444 without proxying; the application was not reached';
  }
  return null;
}

const adminActionLabels = {
  maxmind_configured: 'MaxMind account connected',
  maxmind_databases_updated: 'GeoIP databases updated',
  maxmind_disconnected: 'MaxMind account removed',
  telegram_bot_configured: 'Telegram bot connected',
  telegram_destination_configured: 'Telegram destination connected',
  telegram_disconnected: 'Telegram integration disconnected',
  telegram_policy_updated: 'Telegram alert policy updated',
  telegram_test_requested: 'Telegram test alert sent',
  access_request_approve: 'Access request approved',
  access_request_block: 'Access request blocked',
  access_request_unblock: 'Access request unblocked',
  access_request_dismiss: 'Access request dismissed',
};

function adminActionLabel(reason) {
  return adminActionLabels[reason] || (reason ? readableSecurityValue(reason) : 'Administrative change completed');
}

const securityToolbar = elements.securitySeverity.closest('.security-toolbar');
const severityField = elements.securitySeverity.closest('.field');
const securityQuickFilters = document.createElement('div');
securityQuickFilters.className = 'security-quick-filters';
securityQuickFilters.append(Object.assign(document.createElement('span'), { textContent: 'Stream:' }));
const streamButtons = new Map();
for (const [value, label] of [['application', 'Application'], ['waf', 'WAF']]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'security-filter-option';
  button.textContent = label;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => toggleSecurityFilter('stream', value, label));
  streamButtons.set(value, button);
  securityQuickFilters.append(button);
}
securityQuickFilters.append(Object.assign(document.createElement('span'), { textContent: 'Severity:' }));
const severityButtons = new Map();
for (const value of ['critical', 'warning', 'info']) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'security-filter-option';
  button.textContent = readableSecurityValue(value);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => toggleSecurityFilter('severity', value, readableSecurityValue(value)));
  severityButtons.set(value, button);
  securityQuickFilters.append(button);
}
securityToolbar.before(securityQuickFilters);
severityField.remove();

const securityWindowField = document.createElement('label');
securityWindowField.className = 'field';
securityWindowField.append('Time range');
elements.securityWindow = document.createElement('select');
elements.securityWindow.id = 'securityWindow';
for (const [value, label] of [['24', 'Last 24 hours'], ['72', 'Last 3 days'], ['168', 'Last 7 days'],
  ['720', 'Last 30 days'], ['all', 'All retained events']]) {
  elements.securityWindow.append(new Option(label, value));
}
securityWindowField.append(elements.securityWindow);
securityToolbar.insertBefore(securityWindowField, elements.securityRefresh);
elements.securityWindow.addEventListener('change', loadSecurity);

function addFilterSelect(labelText, id) {
  const label = document.createElement('label');
  label.className = 'field';
  label.append(labelText);
  const select = document.createElement('select');
  select.id = id;
  select.append(new Option('Choose…', ''));
  label.append(select);
  securityToolbar.insertBefore(label, elements.securityRefresh);
  return select;
}

const securityTypeAdd = addFilterSelect('Add event type', 'securityTypeAdd');
const securityCategoryAdd = addFilterSelect('Add alert type', 'securityCategoryAdd');
const securityCountryAdd = addFilterSelect('Add detected country', 'securityCountryAdd');
const securitySourceField = document.createElement('div');
securitySourceField.className = 'security-source-field';
const securitySourceLabel = document.createElement('label');
securitySourceLabel.className = 'field';
securitySourceLabel.append('Add IP or CIDR range');
const securitySourceInput = document.createElement('input');
securitySourceInput.id = 'securitySourceInput';
securitySourceInput.placeholder = '45.118.10.5 or 45.118.10.0/24';
securitySourceInput.autocomplete = 'off';
securitySourceLabel.append(securitySourceInput);
const securitySourceAdd = document.createElement('button');
securitySourceAdd.type = 'button';
securitySourceAdd.textContent = 'Add source';
securitySourceField.append(securitySourceLabel, securitySourceAdd);
securityToolbar.insertBefore(securitySourceField, elements.securityRefresh);
const securityClear = document.createElement('button');
securityClear.type = 'button';
securityClear.textContent = 'Clear filters';
securityToolbar.insertBefore(securityClear, elements.securityRefresh);
const securityExport = document.createElement('button');
securityExport.type = 'button';
securityExport.textContent = 'Export filtered CSV';
securityToolbar.insertBefore(securityExport, elements.securityRefresh);
const securityFilterChips = document.createElement('div');
securityFilterChips.className = 'security-filter-chips';
securityToolbar.after(securityFilterChips);

const sourceIntelligencePanel = document.createElement('section');
sourceIntelligencePanel.className = 'source-intelligence';
sourceIntelligencePanel.hidden = true;
const sourceIntelligenceHead = document.createElement('div');
sourceIntelligenceHead.className = 'source-intelligence-head';
const sourceIntelligenceHeading = document.createElement('div');
const sourceIntelligenceTitle = document.createElement('h3');
sourceIntelligenceTitle.textContent = 'Source intelligence';
const sourceIntelligenceTarget = document.createElement('p');
sourceIntelligenceTarget.textContent = 'Select one exact public source IP.';
sourceIntelligenceHeading.append(sourceIntelligenceTitle, sourceIntelligenceTarget);
const sourceIntelligenceStatus = document.createElement('span');
sourceIntelligenceStatus.className = 'source-intelligence-status';
sourceIntelligenceStatus.setAttribute('role', 'status');
sourceIntelligenceHead.append(sourceIntelligenceHeading, sourceIntelligenceStatus);
const sourceIntelligenceActions = document.createElement('div');
sourceIntelligenceActions.className = 'source-intelligence-actions';
const sourceInvestigate = document.createElement('button');
sourceInvestigate.type = 'button'; sourceInvestigate.className = 'primary'; sourceInvestigate.textContent = 'Investigate source';
const sourceRecon = document.createElement('button');
sourceRecon.type = 'button'; sourceRecon.textContent = 'Run ethical reconnaissance'; sourceRecon.disabled = true;
sourceRecon.title = 'Run a passive investigation first.';
const sourceExport = document.createElement('button');
sourceExport.type = 'button'; sourceExport.textContent = 'Export sanitized JSON'; sourceExport.disabled = true;
sourceIntelligenceActions.append(sourceInvestigate, sourceRecon, sourceExport);
const sourceIntelligenceWarning = document.createElement('div');
sourceIntelligenceWarning.className = 'source-intelligence-warning';
sourceIntelligenceWarning.textContent = 'Network registration and routing identify infrastructure—not the responsible person. '
  + 'Request headers are attacker-controlled evidence. Active reconnaissance contacts the remote host and requires explicit confirmation.';
const sourceIntelligenceResults = document.createElement('div');
sourceIntelligenceResults.className = 'source-intelligence-grid';
sourceIntelligenceResults.innerHTML = '<p class="source-intelligence-empty">Run a passive investigation to collect ownership, routing, DNS, geolocation, and observed-event evidence.</p>';
sourceIntelligencePanel.append(sourceIntelligenceHead, sourceIntelligenceActions, sourceIntelligenceWarning, sourceIntelligenceResults);
elements.securityStatus.after(sourceIntelligencePanel);
let sourceIntelligenceData = null;
let sourceIntelligenceIp = null;

function exactInvestigationIp() {
  if (selectedMapSource) return selectedMapSource;
  if (securityFilters.source.size !== 1) return null;
  const value = [...securityFilters.source.keys()][0];
  return value.includes('/') ? null : value;
}

function intelValue(value) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (Array.isArray(value)) return value.length ? value.map(intelValue).join(' · ') : 'None observed';
  if (typeof value === 'object') return Object.entries(value)
    .map(([key, item]) => intelLabel(key) + ': ' + intelValue(item)).join(' · ');
  return String(value);
}

function intelLabel(value) {
  const text = String(value ?? '');
  if (/^[A-Z0-9]+$/.test(text)) return text;
  return text.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderIntelValue(detail, value, filterKind = null) {
  if (Array.isArray(value) && value.length && value.every((item) => item && Number.isInteger(item.port)
    && (item.observation === null || typeof item.observation === 'object'))) {
    detail.classList.add('source-intelligence-endpoints');
    for (const endpoint of value) {
      const card = document.createElement('article');
      card.className = 'source-intelligence-endpoint';
      const heading = document.createElement('strong');
      const protocol = endpoint.observation?.protocol ? ' · ' + String(endpoint.observation.protocol).toUpperCase() : '';
      heading.textContent = 'TCP ' + endpoint.port + protocol;
      const observation = document.createElement('span');
      observation.textContent = endpoint.observation
        ? Object.entries(endpoint.observation).filter(([key]) => key !== 'protocol')
          .map(([key, item]) => intelLabel(key) + ': ' + intelValue(item)).join(' · ') || 'Service responded without additional metadata.'
        : 'No protocol metadata returned.';
      card.append(heading, observation);
      detail.append(card);
    }
    return;
  }
  if (Array.isArray(value) && value.length && value.every((item) => item && typeof item === 'object'
    && Object.keys(item).every((key) => ['value', 'count'].includes(key)) && Number.isFinite(item.count))) {
    detail.classList.add('source-intelligence-values');
    for (const item of value) {
      const badge = document.createElement(filterKind ? 'button' : 'span');
      badge.className = 'source-intelligence-value';
      badge.textContent = intelLabel(item.value) + ' · ' + item.count.toLocaleString();
      if (filterKind) {
        const filterValue = String(item.value);
        badge.type = 'button';
        badge.dataset.securityFilterKind = filterKind;
        badge.dataset.securityFilterValue = filterValue;
        badge.title = 'Filter events by ' + securityLabels[filterKind].toLowerCase() + ': ' + intelLabel(filterValue);
        badge.setAttribute('aria-pressed', String(securityFilters[filterKind].has(filterValue)));
        badge.addEventListener('click', () => toggleSecurityFilter(filterKind, filterValue, intelLabel(filterValue)));
      }
      detail.append(badge);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) { detail.textContent = 'None observed'; return; }
    detail.classList.add('source-intelligence-values');
    for (const item of value) {
      const badge = document.createElement('span');
      badge.className = 'source-intelligence-value';
      badge.textContent = intelValue(item);
      detail.append(badge);
    }
    return;
  }
  detail.textContent = intelValue(value);
}

function confirmSourceRecon(ip) {
  elements.sourceReconTarget.textContent = ip;
  elements.sourceReconDialog.returnValue = 'cancel';
  elements.sourceReconDialog.showModal();
  elements.sourceReconCancel.focus();
  return new Promise((resolve) => elements.sourceReconDialog.addEventListener('close', () => {
    resolve(elements.sourceReconDialog.returnValue === 'confirm');
  }, { once: true }));
}

function intelligenceCard(title, entries, wide = false) {
  const card = document.createElement('section');
  card.className = 'source-intelligence-card' + (wide ? ' wide' : '');
  const heading = document.createElement('h4');
  heading.textContent = title;
  const list = document.createElement('dl');
  for (const [label, value, options = {}] of entries) {
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); renderIntelValue(detail, value, options.filterKind || null);
    list.append(term, detail);
  }
  card.append(heading, list);
  return card;
}

function renderSourceIntelligence(result) {
  sourceIntelligenceData = result;
  const item = result?.investigation;
  sourceRecon.disabled = !item || !result.activeEnabled;
  sourceRecon.title = !item ? 'Run a passive investigation first.' : result.activeEnabled
    ? 'Contacts this exact public IP with the displayed bounded TCP profile after confirmation.'
    : 'Disabled by server policy.';
  sourceExport.disabled = !item;
  if (!item) {
    sourceIntelligenceResults.innerHTML = '<p class="source-intelligence-empty">No saved investigation for this source. Run a passive investigation first.</p>';
    sourceIntelligenceStatus.textContent = result?.activeEnabled ? 'Active recon available after passive review' : 'Active recon disabled by server policy';
    return;
  }
  const passive = item.passive || {};
  const rdap = passive.rdap || {};
  const events = passive.events || {};
  const classification = item.classification || {};
  const primaryEntity = rdap.entities?.find((entity) => entity.roles?.includes('registrant')) || rdap.entities?.[0] || {};
  const classificationCard = intelligenceCard('Assessment', [
    ['Likely source type', classification.label], ['Confidence', (classification.confidence || 0) + '%'],
    ['Why', classification.explanation], ['Important', item.safety?.attributionWarning],
  ], true);
  classificationCard.querySelector('dd').className = 'source-intelligence-classification';
  classificationCard.querySelectorAll('dd')[1].className = 'source-intelligence-confidence';
  const ownership = intelligenceCard('Ownership & allocation', [
    ['Network', rdap.name], ['Handle', rdap.handle], ['Range', rdap.startAddress && rdap.endAddress ? rdap.startAddress + ' – ' + rdap.endAddress : null],
    ['Registered entity', primaryEntity.name || primaryEntity.handle], ['Country', rdap.country],
    ['Abuse contacts', (rdap.entities || []).filter((entity) => entity.roles?.includes('abuse')).flatMap((entity) => entity.email || [])],
    ['Evidence source', rdap.source],
  ]);
  const routing = intelligenceCard('Routing & location', [
    ['Origin ASN', passive.routing?.asns?.map((asn) => 'AS' + asn)], ['Announced prefix', passive.routing?.prefix],
    ['Route holder', passive.routing?.holder], ['Route announced', passive.routing?.announced],
    ['GeoLite city', [passive.geo?.city, passive.geo?.region, passive.geo?.country].filter(Boolean).join(', ')],
    ['GeoLite network', [passive.geo?.asn ? 'AS' + passive.geo.asn : null, passive.geo?.organization].filter(Boolean).join(' ')],
  ]);
  const dnsCard = intelligenceCard('DNS identity', [
    ['PTR names', passive.ptr?.names], ['Forward-confirmed PTR', passive.ptr?.forwardConfirmed],
    ['Interpretation', passive.ptr?.forwardConfirmed?.length ? 'Reverse name resolves back to this IP.' : 'No forward-confirmed reverse identity.'],
  ]);
  const evidence = intelligenceCard('Observed request evidence', [
    ['Events retained', events.total], ['First seen', events.firstSeenAt ? new Date(events.firstSeenAt).toLocaleString() : null],
    ['Last seen', events.lastSeenAt ? new Date(events.lastSeenAt).toLocaleString() : null],
    ['Categories', events.categories, { filterKind: 'category' }], ['Severities', events.severity, { filterKind: 'severity' }],
    ['Methods', events.methods, { filterKind: 'method' }], ['Statuses', events.statuses, { filterKind: 'status' }],
    ['Dispositions', events.dispositions, { filterKind: 'disposition' }], ['Distinct agent fingerprints', events.userAgentFingerprints],
    ['Evidence warning', events.note],
  ], true);
  const provider = intelligenceCard('Evidence quality', [
    ['Provider errors', passive.providerErrors], ['Collected', passive.completedAt ? new Date(passive.completedAt).toLocaleString() : null],
    ['Investigation ID', item.investigationId], ['Classification indicators', classification.indicators],
  ]);
  const active = item.active;
  const activeCard = intelligenceCard('Ethical reconnaissance', active ? [
    ['Status', active.status], ['Profile', active.profile], ['Completed', new Date(active.completedAt).toLocaleString()],
    ['Error', active.error],
    ['Open ports', active.ports.filter((port) => port.open).map((port) => port.port)],
    ['Endpoint observations', active.ports.filter((port) => port.open).map((port) => ({ port: port.port, observation: port.observation }))],
    ['Guardrails', item.safety?.activePolicy],
  ] : [['Status', result.activeEnabled ? 'Not run. Review passive evidence, then explicitly confirm.' : 'Disabled by server policy.'],
    ['Fixed ports', result.activeProfile?.ports], ['Permitted probes', result.activeProfile?.probes], ['Prohibited', result.activeProfile?.prohibited]], true);
  sourceIntelligenceResults.replaceChildren(classificationCard, ownership, routing, dnsCard, provider, evidence, activeCard);
  sourceIntelligenceStatus.textContent = 'Updated ' + new Date(item.completedAt).toLocaleString()
    + (result.activeEnabled ? '' : ' · active recon disabled by policy');
}

async function loadSourceIntelligence(ip) {
  sourceIntelligenceStatus.textContent = 'Loading saved evidence…';
  const response = await fetch('/api/security/source-intelligence?ip=' + encodeURIComponent(ip), { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Source intelligence is unavailable');
  if (sourceIntelligenceIp === ip) renderSourceIntelligence(result);
}

function updateSourceIntelligenceTarget() {
  const ip = exactInvestigationIp();
  sourceIntelligencePanel.hidden = !ip;
  if (!ip || ip === sourceIntelligenceIp) return;
  sourceIntelligenceIp = ip;
  sourceIntelligenceData = null;
  sourceIntelligenceTarget.textContent = 'Exact source ' + ip;
  sourceInvestigate.disabled = false; sourceRecon.disabled = true; sourceExport.disabled = true;
  sourceRecon.title = 'Run a passive investigation first.';
  sourceIntelligenceResults.innerHTML = '<p class="source-intelligence-empty">Checking for saved evidence…</p>';
  loadSourceIntelligence(ip).catch((error) => { if (sourceIntelligenceIp === ip) sourceIntelligenceStatus.textContent = error.message; });
}

async function requestSourceInvestigation(active) {
  const ip = exactInvestigationIp();
  if (!ip) return;
  let acknowledgement = '';
  if (active) {
    const accepted = await confirmSourceRecon(ip);
    if (!accepted) return;
    acknowledgement = 'I understand this contacts the remote host';
  }
  sourceInvestigate.disabled = true; sourceRecon.disabled = true;
  sourceIntelligenceStatus.textContent = active ? 'Running bounded ethical reconnaissance…' : 'Collecting passive ownership and routing evidence…';
  try {
    const response = await fetch('/api/security/source-intelligence', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() },
      body: JSON.stringify({ ip, active, acknowledgement }) });
    const result = await readWriteResponse(response);
    if (!response.ok) throw new Error(result.error || 'Source investigation failed');
    if (sourceIntelligenceIp === ip) renderSourceIntelligence(result);
  } catch (error) { sourceIntelligenceStatus.textContent = error.message; }
  finally {
    sourceInvestigate.disabled = false;
    sourceRecon.disabled = !sourceIntelligenceData?.investigation || !sourceIntelligenceData?.activeEnabled;
  }
}

sourceInvestigate.addEventListener('click', () => requestSourceInvestigation(false));
sourceRecon.addEventListener('click', () => requestSourceInvestigation(true));
sourceExport.addEventListener('click', () => {
  if (!sourceIntelligenceData?.investigation) return;
  const blob = new Blob([JSON.stringify(sourceIntelligenceData.investigation, null, 2) + '\n'], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'source-intelligence-' + sourceIntelligenceIp.replaceAll(':', '-') + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
});

function renderSecurityFilters() {
  if (selectedMapSource && !securityFilters.source.has(selectedMapSource)) selectedMapSource = null;
  if (selectedMapCity && !securityFilters.city.has(selectedMapCity)) selectedMapCity = null;
  for (const [value, button] of streamButtons) {
    button.setAttribute('aria-pressed', String(securityFilters.stream.has(value)));
  }
  for (const [value, button] of severityButtons) {
    button.setAttribute('aria-pressed', String(securityFilters.severity.has(value)));
  }
  const chips = [];
  for (const [kind, values] of Object.entries(securityFilters)) {
    for (const [value, label] of values) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'security-filter-chip';
      chip.textContent = securityLabels[kind] + ': ' + label;
      chip.title = 'Remove this filter';
      chip.addEventListener('click', () => {
        securityFilters[kind].delete(value);
        renderSecurityFilters();
        loadSecurity();
      });
      chips.push(chip);
    }
  }
  if (!chips.length) {
    const empty = document.createElement('span');
    empty.className = 'security-filter-empty';
    empty.textContent = 'No filters applied';
    chips.push(empty);
  }
  securityFilterChips.replaceChildren(...chips);
  for (const button of sourceIntelligencePanel.querySelectorAll('[data-security-filter-kind]')) {
    button.setAttribute('aria-pressed', String(securityFilters[button.dataset.securityFilterKind]
      ?.has(button.dataset.securityFilterValue)));
  }
  securityClear.disabled = !Object.values(securityFilters).some((values) => values.size);
  updateSourceIntelligenceTarget();
}

function addSecurityFilter(kind, value, label = readableSecurityValue(value)) {
  if (!value || securityFilters[kind].has(value)) return;
  securityFilters[kind].set(value, label);
  renderSecurityFilters();
  loadSecurity();
}

function toggleSecurityFilter(kind, value, label) {
  if (securityFilters[kind].has(value)) securityFilters[kind].delete(value);
  else securityFilters[kind].set(value, label);
  renderSecurityFilters();
  loadSecurity();
}

function selectAddsFilter(select, kind, label = (value) => readableSecurityValue(value)) {
  select.addEventListener('change', () => {
    const value = select.value;
    select.value = '';
    if (value) addSecurityFilter(kind, value, label(value));
  });
}

selectAddsFilter(securityTypeAdd, 'type');
selectAddsFilter(securityCategoryAdd, 'category');
selectAddsFilter(securityCountryAdd, 'country', countryName);
function addSourceFilter() {
  const value = securitySourceInput.value.trim();
  if (!/^[0-9a-f:.]+(?:\/\d{1,3})?$/i.test(value)) {
    elements.securityStatus.textContent = 'Enter a valid IP address or CIDR range.';
    return;
  }
  securitySourceInput.value = '';
  addSecurityFilter('source', value, value);
}
securitySourceAdd.addEventListener('click', addSourceFilter);
securitySourceInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') addSourceFilter(); });
securityClear.addEventListener('click', () => {
  for (const values of Object.values(securityFilters)) values.clear();
  selectedMapSource = null;
  selectedMapCity = null;
  renderSecurityFilters();
  renderSecurityMap(securityMapData);
  loadSecurity();
});
renderSecurityFilters();

function mapLabel(location) {
  const place = [location.city, location.region, location.country].filter(Boolean).join(', ');
  return place || 'Approximate location unavailable';
}

function clearMapSelection() {
  if (!selectedMapSource && !selectedMapCity && !securityFilters.source.size && !securityFilters.city.size) return;
  securityFilters.source.clear();
  securityFilters.city.clear();
  selectedMapSource = null;
  selectedMapCity = null;
  renderSecurityFilters();
  renderSecurityMap(securityMapData);
  loadSecurity();
}

function toggleMapSource(source) {
  if (selectedMapSource === source.ip) return clearMapSelection();
  securityFilters.source.clear();
  securityFilters.city.clear();
  securityFilters.source.set(source.ip, source.ip);
  selectedMapSource = source.ip;
  selectedMapCity = null;
  renderSecurityFilters();
  renderSecurityMap(securityMapData);
  loadSecurity();
}

function toggleMapCity(city) {
  if (selectedMapCity === city) return clearMapSelection();
  securityFilters.source.clear();
  securityFilters.city.clear();
  securityFilters.city.set(city, city);
  selectedMapSource = null;
  selectedMapCity = city;
  renderSecurityFilters();
  renderSecurityMap(securityMapData);
  const location = securityMapData?.sources?.find((source) => source.city === city);
  if (location) securityGlobe.focusLocation(location, 2.15);
  loadSecurity();
}

function mapNode(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

const mapHeader = mapNode('div', 'security-map-header');
const mapTitle = mapNode('div', 'security-map-title');
mapTitle.append(mapNode('strong', '', 'Threat connection globe'));
elements.securityMapSummary = mapNode('span', '', 'Waiting for security events…');
mapTitle.append(elements.securityMapSummary);
mapHeader.append(mapTitle, mapNode('div', 'security-map-legend', 'Left-drag location · right-drag flight pitch/bank · wheel zoom\nSelect a source to fly destination → attacker, then reveal its location'));
elements.securityGlobe = mapNode('canvas');
elements.securityGlobe.id = 'securityGlobe';
elements.securityGlobe.tabIndex = 0;
elements.securityGlobe.setAttribute('aria-label', 'Interactive three-dimensional globe of security request origins');
const mapStats = mapNode('aside', 'security-map-stats');
elements.securityMapMetrics = mapNode('div', 'security-map-metrics');
const cityGroup = mapNode('section', 'security-map-group');
cityGroup.append(mapNode('strong', '', 'Top cities'));
elements.securityMapCities = mapNode('div', 'security-map-list');
cityGroup.append(elements.securityMapCities);
const sourceGroup = mapNode('section', 'security-map-group');
elements.securityMapSourcesTitle = mapNode('strong', '', 'Top source IPs');
sourceGroup.append(elements.securityMapSourcesTitle);
elements.securityMapSources = mapNode('div', 'security-map-list');
sourceGroup.append(elements.securityMapSources);
mapStats.append(elements.securityMapMetrics, cityGroup, sourceGroup);
const mapControls = mapNode('div', 'security-map-controls');
elements.securityGlobeZoomOut = mapNode('button', '', '−');
elements.securityGlobeZoomOut.type = 'button'; elements.securityGlobeZoomOut.title = 'Zoom out';
elements.securityGlobeZoomIn = mapNode('button', '', '+');
elements.securityGlobeZoomIn.type = 'button'; elements.securityGlobeZoomIn.title = 'Zoom in';
elements.securityGlobeReset = mapNode('button', '', 'Reset view');
elements.securityGlobeReset.type = 'button';
elements.securityGlobeTravel = mapNode('button', '', 'Auto travel: On');
elements.securityGlobeTravel.type = 'button'; elements.securityGlobeTravel.setAttribute('aria-pressed', 'true');
mapControls.append(elements.securityGlobeZoomOut, elements.securityGlobeZoomIn, elements.securityGlobeReset, elements.securityGlobeTravel);
const mapFooter = mapNode('div', 'security-map-footer');
elements.securityMapSelection = mapNode('span', '', 'Select a source to trace its route');
elements.securityMapDestination = mapNode('span', '', 'Destination not configured');
mapFooter.append(elements.securityMapSelection, elements.securityMapDestination);
elements.securityMap.replaceChildren(elements.securityGlobe, mapHeader, mapStats, mapControls, mapFooter);

const securityGlobe = window.SecurityGlobe.create(elements.securityGlobe, {
  onSource: toggleMapSource,
  onBackground: clearMapSelection,
  onError: () => { elements.securityMapSummary.textContent = 'Globe renderer failed; refresh to retry'; },
});
securityGlobe.setActive(elements.securityPanel.open);
elements.securityGlobeZoomOut.addEventListener('click', () => securityGlobe.zoomBy(1 / 1.2));
elements.securityGlobeZoomIn.addEventListener('click', () => securityGlobe.zoomBy(1.2));
elements.securityGlobeReset.addEventListener('click', () => securityGlobe.reset());
elements.securityGlobeTravel.addEventListener('click', () => {
  const enabled = elements.securityGlobeTravel.getAttribute('aria-pressed') !== 'true';
  securityGlobe.setTravelEnabled(enabled);
  elements.securityGlobeTravel.setAttribute('aria-pressed', String(enabled));
  elements.securityGlobeTravel.textContent = 'Auto travel: ' + (enabled ? 'On' : 'Off');
});

function mapMetric(value, label) {
  const item = mapNode('div', 'globe-metric');
  item.append(mapNode('strong', '', String(value)), mapNode('span', '', label));
  return item;
}

function renderSecurityMap(data) {
  securityMapData = data;
  if (!data) return;
  const destination = data.destination;
  const sources = Array.isArray(data.sources) ? data.sources : [];
  elements.securityMapSummary.textContent = data.located + ' of ' + data.total + ' recent event'
    + (data.total === 1 ? '' : 's') + ' located · ' + sources.length + ' source'
    + (sources.length === 1 ? '' : 's');
  elements.securityMapSelection.textContent = selectedMapSource
    ? 'Tracing destination → ' + selectedMapSource + ' · select again or click space to clear'
    : selectedMapCity ? 'Showing alerts from ' + selectedMapCity + ' · select again to clear'
      : 'Select a source to trace from your destination to the attacker';
  elements.securityMapDestination.textContent = destination
    ? 'Destination ' + destination.ip + ' · ' + mapLabel(destination)
      + (data.destinationConfigured ? '' : ' · detected WAF target')
    : 'Set SAG_SECURITY_MAP_DESTINATION_IP and install GeoLite2 City to draw routes';
  const cities = new Map();
  for (const source of sources) if (source.city) cities.set(source.city, (cities.get(source.city) || 0) + source.count);
  elements.securityMapMetrics.replaceChildren(
    mapMetric(data.total, 'connections'), mapMetric(sources.length, 'different IPs'),
    mapMetric(cities.size, 'cities'), mapMetric(data.located, 'mapped events'));
  const cityButtons = [...cities].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([city, count]) => {
    const button = mapNode('button', '', city + ' · ' + count);
    button.type = 'button'; button.setAttribute('aria-pressed', String(city === selectedMapCity));
    button.addEventListener('click', () => toggleMapCity(city));
    return button;
  });
  elements.securityMapCities.replaceChildren(...cityButtons);
  const selectedSource = sources.find((source) => source.ip === selectedMapSource);
  let regionalSources = sources;
  let sourceTitle = 'Top source IPs';
  if (selectedMapCity) {
    regionalSources = sources.filter((source) => source.city === selectedMapCity);
    sourceTitle = 'IPs in ' + selectedMapCity;
  } else if (selectedSource) {
    const sameArea = (source) => selectedSource.city ? source.city === selectedSource.city
      : selectedSource.region ? source.region === selectedSource.region && source.country === selectedSource.country
        : source.country === selectedSource.country;
    regionalSources = sources.filter(sameArea);
    sourceTitle = 'IPs near ' + (selectedSource.city || selectedSource.region || selectedSource.country || 'selected source');
  }
  elements.securityMapSourcesTitle.textContent = sourceTitle;
  const sourceButtons = [...regionalSources].sort((a, b) => b.count - a.count).slice(0, 10).map((source) => {
    const button = mapNode('button', '', source.ip + ' · ' + source.count);
    button.type = 'button'; button.setAttribute('aria-pressed', String(source.ip === selectedMapSource));
    button.addEventListener('click', () => toggleMapSource(source));
    return button;
  });
  elements.securityMapSources.replaceChildren(...sourceButtons);
  securityGlobe.setData(data, { source: selectedMapSource, city: selectedMapCity });
}

function fillSecurityOptions(select, values, label, kind, emptyLabel = 'No matching options') {
  const available = values.filter((value) => !securityFilters[kind].has(value));
  select.replaceChildren(new Option(available.length ? 'Choose…' : emptyLabel, ''),
    ...available.map((value) => new Option(label(value), value)));
  select.disabled = !available.length;
}

function appendSecuritySource(detail, source) {
  const addText = (value) => { if (value) detail.append(' · ' + value); };
  if (!source) return addText('source unavailable');
  if (source.ip && source.ip !== 'unknown') {
    const ip = document.createElement('button');
    ip.type = 'button';
    ip.className = 'security-inline-filter';
    ip.textContent = source.ip;
    ip.title = 'Filter by this IP';
    ip.addEventListener('click', () => toggleMapSource(source));
    detail.append(' · ', ip);
  } else addText(source.ip || 'unknown');
  if (source.city) {
    const city = document.createElement('button');
    city.type = 'button';
    city.className = 'security-inline-filter';
    city.textContent = [source.city, source.region].filter(Boolean).join(', ');
    city.title = 'Filter by this city';
    city.addEventListener('click', () => toggleMapCity(source.city));
    detail.append(' · ', city);
  } else addText(source.region);
  if (source.country) {
    const country = document.createElement('button');
    country.type = 'button';
    country.className = 'security-inline-filter';
    country.textContent = countryName(source.country) + ' (' + source.country + ')';
    country.title = 'Filter by this country';
    country.addEventListener('click', () => addSecurityFilter('country', source.country, countryName(source.country)));
    detail.append(' · ', country);
  } else addText(source.scope);
  if (Number.isFinite(source.accuracyRadiusKm)) addText('approx. ±' + source.accuracyRadiusKm + ' km');
  addText([source.asn ? 'AS' + source.asn : null, source.organization].filter(Boolean).join(' '));
}

function maxMindField(labelText, input) {
  const label = document.createElement('label');
  label.className = 'field';
  label.append(labelText, input);
  return label;
}

const maxMindSection = document.createElement('section');
maxMindSection.className = 'telegram-settings';
maxMindSection.setAttribute('aria-labelledby', 'maxmindTitle');
const maxMindTitle = document.createElement('h3');
maxMindTitle.id = 'maxmindTitle';
maxMindTitle.textContent = 'IP geolocation · MaxMind GeoLite2';
const maxMindDescription = document.createElement('p');
maxMindDescription.textContent = 'Connect a MaxMind account to download City and ASN databases into protected server storage. Visitor IPs are looked up locally and are never sent to MaxMind. Credentials are write-only and never returned to the browser.';
const maxMindGrid = document.createElement('div');
maxMindGrid.className = 'telegram-grid';
const maxMindAccountId = document.createElement('input');
maxMindAccountId.inputMode = 'numeric';
maxMindAccountId.autocomplete = 'off';
maxMindAccountId.spellcheck = false;
maxMindAccountId.placeholder = 'Numeric MaxMind account ID';
const maxMindLicenseKey = document.createElement('input');
maxMindLicenseKey.type = 'password';
maxMindLicenseKey.autocomplete = 'new-password';
maxMindLicenseKey.spellcheck = false;
maxMindLicenseKey.placeholder = 'MaxMind license key';
maxMindGrid.append(maxMindField('Account ID', maxMindAccountId), maxMindField('License key', maxMindLicenseKey));
const maxMindActions = document.createElement('div');
maxMindActions.className = 'telegram-actions';
const maxMindConnect = document.createElement('button');
maxMindConnect.type = 'button';
maxMindConnect.textContent = 'Connect and download';
const maxMindUpdate = document.createElement('button');
maxMindUpdate.type = 'button';
maxMindUpdate.textContent = 'Update databases';
const maxMindDisconnect = document.createElement('button');
maxMindDisconnect.type = 'button';
maxMindDisconnect.textContent = 'Remove saved account';
maxMindActions.append(maxMindConnect, maxMindUpdate, maxMindDisconnect);
const maxMindStatus = document.createElement('p');
maxMindStatus.className = 'security-note';
maxMindStatus.setAttribute('role', 'status');
maxMindStatus.textContent = 'Checking GeoIP configuration…';
maxMindSection.append(maxMindTitle, maxMindDescription, maxMindGrid, maxMindActions, maxMindStatus);
elements.telegramToken.closest('.telegram-settings').before(maxMindSection);

let maxMindState = null;
function showMaxMind(result) {
  maxMindState = result;
  const city = result.database?.city || {};
  const asn = result.database?.asn || {};
  const date = (value) => value ? new Date(value).toLocaleString() : 'not installed';
  maxMindStatus.textContent = result.mode === 'mounted-files'
    ? 'GeoIP is managed by mounted server files · City: ' + date(city.updatedAt) + ' · ASN: ' + date(asn.updatedAt)
    : (result.configured ? 'Connected account ' + result.accountHint : 'No MaxMind account connected')
      + ' · City: ' + date(city.updatedAt) + ' · ASN: ' + date(asn.updatedAt);
  const mounted = result.mode === 'mounted-files';
  maxMindAccountId.disabled = mounted;
  maxMindLicenseKey.disabled = mounted;
  maxMindConnect.disabled = mounted;
  maxMindUpdate.disabled = mounted || !result.configured;
  maxMindDisconnect.disabled = mounted || !result.configured;
}

async function loadMaxMind() {
  const response = await fetch('/api/security/maxmind', { cache: 'no-store' });
  if (!response.ok) throw new Error('MaxMind settings are unavailable');
  showMaxMind(await response.json());
}

async function maxMindRequest(pathname, method, body) {
  const response = await fetch(pathname, { method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'X-Scene-CSRF': requireCsrf() },
    body: body ? JSON.stringify(body) : undefined });
  const result = await readWriteResponse(response);
  if (!response.ok) throw new Error(result.error || 'MaxMind request failed');
  showMaxMind(result);
  return result;
}

maxMindConnect.addEventListener('click', async () => {
  const accountId = maxMindAccountId.value.trim();
  const licenseKey = maxMindLicenseKey.value.trim();
  if (!accountId || !licenseKey) return void (maxMindStatus.textContent = 'Enter the account ID and license key.');
  maxMindConnect.disabled = true;
  maxMindStatus.textContent = 'Verifying account and downloading City and ASN databases…';
  try {
    await maxMindRequest('/api/security/maxmind/setup', 'POST', { accountId, licenseKey });
    maxMindAccountId.value = '';
    maxMindLicenseKey.value = '';
    maxMindStatus.textContent += ' · local lookups are active';
    await loadSecurity();
  } catch (error) { maxMindStatus.textContent = error.message; }
  finally { if (maxMindState) showMaxMind(maxMindState); else maxMindConnect.disabled = false; }
});

maxMindUpdate.addEventListener('click', async () => {
  maxMindUpdate.disabled = true;
  maxMindStatus.textContent = 'Downloading current City and ASN databases…';
  try {
    await maxMindRequest('/api/security/maxmind/update', 'POST');
    await loadSecurity();
  } catch (error) { maxMindStatus.textContent = error.message; }
  finally { if (maxMindState) showMaxMind(maxMindState); else maxMindUpdate.disabled = false; }
});

maxMindDisconnect.addEventListener('click', async () => {
  maxMindDisconnect.disabled = true;
  try {
    await maxMindRequest('/api/security/maxmind/setup', 'DELETE');
    maxMindStatus.textContent += ' · installed databases remain active';
  } catch (error) { maxMindStatus.textContent = error.message; }
  finally { if (maxMindState) showMaxMind(maxMindState); else maxMindDisconnect.disabled = false; }
});

function telegramNumberField(labelText, id, minimum, maximum) {
  const input = document.createElement('input');
  input.id = id;
  input.type = 'number';
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = '1';
  const label = document.createElement('label');
  label.className = 'field';
  label.append(labelText, input);
  return { label, input };
}
const telegramPolicyGrid = elements.telegramCooldown.closest('.telegram-grid');
elements.telegramCooldown.closest('.field').firstChild.textContent = 'Initial dedupe window (seconds)';
const reminderField = telegramNumberField('Persistent reminder (seconds)', 'telegramReminder', 60, 86400);
const quietAfterField = telegramNumberField('Close incident after quiet (seconds)', 'telegramQuietAfter', 60, 604800);
telegramPolicyGrid.insertBefore(reminderField.label, elements.telegramHourlyLimit.closest('.field'));
telegramPolicyGrid.insertBefore(quietAfterField.label, elements.telegramHourlyLimit.closest('.field'));
elements.telegramReminder = reminderField.input;
elements.telegramQuietAfter = quietAfterField.input;

const telegramCategoryGrid = document.querySelector('.telegram-categories');
for (const [category, labelText] of [
  ['cross_site_scripting_probe', 'Cross-site scripting probes'],
  ['application_error_exposure', 'Application 500 responses'],
  ['sensitive_file_enumeration', 'Sensitive-file enumeration'],
  ['backup_file_probe', 'Backup-file probes'],
  ['framework_admin_probe', 'Framework administration probes'],
  ['known_scanner', 'Known scanner signatures'],
  ['service_enumeration', 'Remote-service enumeration'],
  ['protocol_anomaly', 'Protocol anomalies'],
]) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.telegramCategory = category;
  label.append(input, ' ' + labelText);
  telegramCategoryGrid.append(label);
}
const telegramCategories = [...document.querySelectorAll('[data-telegram-category]')];
const telegramIncidentList = document.createElement('div');
telegramIncidentList.className = 'security-events';
elements.telegramStatus.before(telegramIncidentList);

function showTelegram(result) {
  const policy = result.policy;
  const setup = result.setup || { mode: 'not-configured', bot: null, chat: null };
  elements.telegramConfigured.textContent = result.configured
    ? ((setup.chat?.title ? setup.chat.title + ' · ' : '')
      + (result.active ? 'configured and active' : 'configured; delivery disabled'))
    : setup.bot ? 'Bot verified; connect a destination to finish setup'
      : 'Bot not configured; delivery remains disabled';
  elements.telegramBotStatus.textContent = setup.bot
    ? 'Verified @' + setup.bot.username + (setup.bot.name ? ' · ' + setup.bot.name : '')
    : setup.mode === 'mounted-files' ? 'Bot credentials are managed by mounted server files.' : 'No bot verified.';
  if (setup.bot?.username) {
    elements.telegramBotLink.href = 'https://t.me/' + setup.bot.username;
    elements.telegramBotLink.hidden = false;
  } else {
    elements.telegramBotLink.removeAttribute('href');
    elements.telegramBotLink.hidden = true;
  }
  elements.telegramDisconnect.disabled = setup.mode !== 'scene-management';
  elements.telegramEnabled.disabled = !result.configured;
  elements.telegramEnabled.checked = policy.enabled;
  elements.telegramSeverity.value = policy.minimumSeverity;
  elements.telegramRedaction.value = policy.redaction;
  elements.telegramThreshold.value = policy.countThreshold;
  elements.telegramWindow.value = policy.aggregationWindowSeconds;
  elements.telegramCooldown.value = policy.cooldownSeconds;
  elements.telegramReminder.value = policy.persistentReminderSeconds;
  elements.telegramQuietAfter.value = policy.incidentQuietSeconds;
  elements.telegramHourlyLimit.value = policy.globalLimitPerHour;
  elements.telegramQuietEnabled.checked = Boolean(policy.quietHours);
  elements.telegramQuietStart.value = policy.quietHours?.start || '22:00';
  elements.telegramQuietEnd.value = policy.quietHours?.end || '07:00';
  elements.telegramCriticalOverride.checked = policy.criticalOverride;
  for (const input of telegramCategories) input.checked = policy.categories.includes(input.dataset.telegramCategory);
  elements.telegramTest.disabled = !result.configured;
  const delivery = result.delivery;
  elements.telegramStatus.textContent = 'Pending: ' + result.pending
    + ' · active incidents: ' + (result.incidents?.active || 0)
    + (result.incidents?.suppressedByHourlyLimit ? ' · hourly-limit suppressions: ' + result.incidents.suppressedByHourlyLimit : '')
    + (delivery.lastSuccessAt ? ' · last delivered ' + new Date(delivery.lastSuccessAt).toLocaleString() : '')
    + (delivery.lastFailureAt ? ' · last failure ' + new Date(delivery.lastFailureAt).toLocaleString() + ' (' + delivery.lastFailureCode + ')' : '');
  const incidents = (result.incidents?.items || []).map((incident) => {
    const row = document.createElement('div');
    row.className = 'security-event';
    const heading = document.createElement('strong');
    heading.textContent = readableSecurityValue(incident.category) + ' · ' + incident.count + ' observed';
    const detail = document.createElement('div');
    detail.textContent = incident.source + ' · target ' + incident.target + ' · last seen '
      + new Date(incident.lastSeenAt).toLocaleString() + ' · '
      + Object.entries(incident.dispositions).map(([name, count]) => wafDispositionLabel(name) + ' ' + count).join(' · ');
    row.append(heading, detail);
    return row;
  });
  if (!incidents.length) {
    const empty = document.createElement('p');
    empty.className = 'security-note';
    empty.textContent = 'No active alert incidents.';
    incidents.push(empty);
  }
  telegramIncidentList.replaceChildren(...incidents);
}

async function loadTelegram() {
  const response = await fetch('/api/security/telegram', { cache: 'no-store' });
  if (!response.ok) throw new Error('Telegram alert settings are unavailable');
  showTelegram(await response.json());
}

function telegramPolicy() {
  return {
    version: 2,
    enabled: elements.telegramEnabled.checked,
    minimumSeverity: elements.telegramSeverity.value,
    categories: telegramCategories.filter((input) => input.checked).map((input) => input.dataset.telegramCategory),
    countThreshold: Number(elements.telegramThreshold.value),
    aggregationWindowSeconds: Number(elements.telegramWindow.value),
    cooldownSeconds: Number(elements.telegramCooldown.value),
    persistentReminderSeconds: Number(elements.telegramReminder.value),
    incidentQuietSeconds: Number(elements.telegramQuietAfter.value),
    globalLimitPerHour: Number(elements.telegramHourlyLimit.value),
    quietHours: elements.telegramQuietEnabled.checked
      ? { start: elements.telegramQuietStart.value, end: elements.telegramQuietEnd.value } : null,
    criticalOverride: elements.telegramCriticalOverride.checked,
    redaction: elements.telegramRedaction.value,
  };
}

async function telegramSetupRequest(path, method, body) {
  const response = await fetch(path, { method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-Scene-CSRF': requireCsrf() },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await readWriteResponse(response);
  if (!response.ok) throw new Error(result.error || 'Telegram setup failed');
  return result;
}

elements.telegramVerifyBot.addEventListener('click', async () => {
  const token = elements.telegramToken.value.trim();
  if (!token) return elements.telegramBotStatus.textContent = 'Enter the token issued by BotFather.';
  elements.telegramVerifyBot.disabled = true;
  elements.telegramBotStatus.textContent = 'Verifying bot with Telegram…';
  try {
    const result = await telegramSetupRequest('/api/security/telegram/setup/token', 'POST', { token });
    elements.telegramToken.value = '';
    showTelegram(result);
    elements.telegramStatus.textContent = 'Bot verified. Open it, press Start, send a message, then discover chats.';
  } catch (error) { elements.telegramBotStatus.textContent = error.message; }
  finally {
    elements.telegramToken.value = '';
    elements.telegramVerifyBot.disabled = false;
  }
});

elements.telegramDiscoverChats.addEventListener('click', async () => {
  elements.telegramDiscoverChats.disabled = true;
  elements.telegramStatus.textContent = 'Discovering chats that contacted this bot…';
  try {
    const result = await telegramSetupRequest('/api/security/telegram/setup/chats', 'POST');
    elements.telegramChat.replaceChildren();
    for (const chat of result.chats) {
      const option = document.createElement('option');
      option.value = chat.id;
      option.textContent = chat.title + ' · ' + chat.type;
      elements.telegramChat.append(option);
    }
    if (!result.chats.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No chats found — send the bot a message and retry';
      elements.telegramChat.append(option);
    }
    elements.telegramStatus.textContent = result.chats.length
      ? 'Select the destination and connect it.' : 'No chats found. Open the bot, press Start, send a message, and retry.';
  } catch (error) { elements.telegramStatus.textContent = error.message; }
  finally { elements.telegramDiscoverChats.disabled = false; }
});

elements.telegramConnectChat.addEventListener('click', async () => {
  const chatId = elements.telegramChat.value || elements.telegramChatId.value.trim();
  if (!chatId) return elements.telegramStatus.textContent = 'Discover or enter a Telegram destination first.';
  elements.telegramConnectChat.disabled = true;
  elements.telegramStatus.textContent = 'Verifying destination…';
  try {
    const result = await telegramSetupRequest('/api/security/telegram/setup/chat', 'POST', { chatId });
    elements.telegramChatId.value = '';
    showTelegram(result);
    elements.telegramStatus.textContent = 'Destination connected. Send a test alert before enabling delivery.';
  } catch (error) { elements.telegramStatus.textContent = error.message; }
  finally { elements.telegramConnectChat.disabled = false; }
});

elements.telegramDisconnect.addEventListener('click', async () => {
  if (!window.confirm('Disconnect this Telegram bot and disable alert delivery?')) return;
  elements.telegramDisconnect.disabled = true;
  try {
    const result = await telegramSetupRequest('/api/security/telegram/setup', 'DELETE');
    showTelegram(result);
    elements.telegramStatus.textContent = 'Telegram bot disconnected.';
  } catch (error) { elements.telegramStatus.textContent = error.message; }
});

elements.telegramSave.addEventListener('click', async () => {
  elements.telegramStatus.textContent = 'Saving alert policy…';
  try {
    const response = await fetch('/api/security/telegram', { method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Scene-CSRF': requireCsrf() },
      body: JSON.stringify(telegramPolicy()) });
    const result = await readWriteResponse(response);
    if (!response.ok) throw new Error(result.error || 'Telegram policy was not saved');
    showTelegram(result);
  } catch (error) { elements.telegramStatus.textContent = error.message; }
});

elements.telegramTest.addEventListener('click', async () => {
  elements.telegramTest.disabled = true;
  elements.telegramStatus.textContent = 'Sending labeled test alert…';
  try {
    const response = await fetch('/api/security/telegram/test', { method: 'POST',
      headers: { 'X-Scene-CSRF': requireCsrf() } });
    const result = await readWriteResponse(response);
    if (!response.ok) throw new Error(result.error || 'Telegram test failed');
    showTelegram(result);
  } catch (error) { elements.telegramStatus.textContent = error.message; }
  finally { elements.telegramTest.disabled = false; }
});

elements.securityLoadOlder = document.createElement('button');
elements.securityLoadOlder.type = 'button';
elements.securityLoadOlder.textContent = 'Load older events';
elements.securityLoadOlder.hidden = true;
elements.securityEvents.after(elements.securityLoadOlder);
let securityNextBefore = null;
let securityNextBeforeId = null;
let securityLoadedCount = 0;
let securityActiveSince = null;

function securityEventRow(event) {
  const row = document.createElement('div');
  row.className = 'security-event ' + (event.integrityValid === false ? 'critical' : event.severity);
  const heading = document.createElement('strong');
  heading.textContent = (event.type === 'admin_action' ? 'administrator activity' : event.type.replaceAll('_', ' ')) + ' · '
    + (event.integrityValid === false ? 'integrity check failed' : event.severity);
  const detail = document.createElement('div');
  detail.append(new Date(event.at).toLocaleString());
  if (event.type === 'admin_action') detail.append(' · Scene Management · ' + adminActionLabel(event.reason));
  else {
    appendSecuritySource(detail, event.source);
    if (event.outcome && event.type !== 'waf_finding') detail.append(' · ' + event.outcome);
  }
  if (event.category) detail.append(' · ' + readableSecurityValue(event.category));
  if (event.http?.path) detail.append(' · ' + event.http.method + ' ' + event.http.path
    + (event.http.status !== null ? (event.type === 'waf_finding' && event.http.statusSource === 'edge_policy'
      ? ' → Edge HTTP ' + event.http.status
      : event.type === 'waf_finding' && event.http.statusSource === 'edge_access'
        ? ' → Final HTTP ' + event.http.status
      : event.type === 'waf_finding' && event.edge?.statusVerified !== true
        ? ' → WAF audit HTTP ' + event.http.status : ' → HTTP ' + event.http.status) : '')
    + (Number.isInteger(event.http.auditStatus)
      ? ' · audit phase HTTP ' + event.http.auditStatus + ' (not final)' : ''));
  if (event.edge) detail.append(' · target ' + (event.edge.target || 'unknown')
    + ' · ' + wafDispositionLabel(event.edge.disposition, event.edge.mode, event.edge.statusVerified)
    + (event.edge.ruleIds?.length ? ' · matched security rules ' + event.edge.ruleIds.join(', ') : '')
    + (event.edge.ruleSummary ? ' · ' + event.edge.ruleSummary : '')
    + (event.edge.behaviorSummary ? ' · behavior: ' + event.edge.behaviorSummary : '')
    + (event.edge.originReached === false ? ' · origin not reached'
      : event.edge.originReached === true ? ' · origin reached' : ' · origin reach unverified')
    + (event.edge.anomalyScore !== null ? ' · score ' + event.edge.anomalyScore : '')
    + (event.edge.historical ? ' · historical import' : ''));
  if (event.classificationVersion) detail.append(' · classified with ruleset ' + event.classificationVersion);
  const meaning = event.type === 'waf_finding' ? wafOutcomeMeaning(event) : null;
  if (meaning) detail.append(' · ' + meaning);
  if (event.requestId) detail.append(' · request ' + event.requestId);
  row.append(heading, detail);
  return row;
}

function securityEventParameters(before = null, beforeId = null) {
  const parameters = new URLSearchParams({ limit: '250', since: securityActiveSince });
  if (before) parameters.set('before', before);
  if (beforeId) parameters.set('beforeId', beforeId);
  for (const [kind, values] of Object.entries(securityFilters)) {
    for (const value of values.keys()) parameters.append(kind, value);
  }
  return parameters;
}

async function exportSecurityCsv() {
  securityExport.disabled = true;
  elements.securityStatus.textContent = 'Preparing filtered CSV export…';
  try {
    const parameters = securityEventParameters();
    parameters.delete('limit');
    const response = await fetch('/api/security/events.csv?' + parameters, { cache: 'no-store' });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Filtered security export is unavailable');
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = 'scene-access-security-events-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    const count = Number(response.headers.get('X-Event-Count'));
    elements.securityStatus.textContent = 'Exported ' + (Number.isInteger(count) ? count : 'the matching')
      + ' filtered event' + (count === 1 ? '' : 's') + '.';
  } catch (error) { elements.securityStatus.textContent = error.message; }
  finally { securityExport.disabled = false; }
}

function renderSecurityEventPage(result, append = false) {
  const rows = result.events.map(securityEventRow);
  if (append) elements.securityEvents.append(...rows);
  else if (rows.length) elements.securityEvents.replaceChildren(...rows);
  else {
    const empty = document.createElement('div');
    empty.className = 'security-event'; empty.textContent = 'No security events match the active filters.';
    elements.securityEvents.replaceChildren(empty);
  }
  securityLoadedCount = append ? securityLoadedCount + result.events.length : result.events.length;
  securityNextBefore = result.nextBefore || null;
  securityNextBeforeId = result.nextBeforeId || null;
  elements.securityLoadOlder.hidden = !result.hasMore;
}

async function loadSecurity() {
  elements.securityStatus.textContent = 'Loading recent events…';
  elements.securityRefresh.disabled = true;
  try {
    const windowHours = elements.securityWindow.value;
    const since = windowHours === 'all' ? 'all'
      : new Date(Date.now() - Number(windowHours) * 60 * 60 * 1000).toISOString();
    securityActiveSince = since;
    const parameters = securityEventParameters();
    const windowParameters = new URLSearchParams({ since });
    const [summaryResponse, eventsResponse, mapResponse] = await Promise.all([
      fetch('/api/security/summary?' + windowParameters, { cache: 'no-store' }),
      fetch('/api/security/events?' + parameters, { cache: 'no-store' }),
      fetch('/api/security/map?' + windowParameters, { cache: 'no-store' }),
    ]);
    if (!summaryResponse.ok || !eventsResponse.ok || !mapResponse.ok) throw new Error('Security monitoring is unavailable');
    const summary = await summaryResponse.json();
    const result = await eventsResponse.json();
    renderSecurityMap(await mapResponse.json());
    const options = result.filterOptions || { types: [], categories: [] };
    fillSecurityOptions(securityTypeAdd, options.types || [], readableSecurityValue, 'type',
      'No matching event types');
    fillSecurityOptions(securityCategoryAdd, options.categories || [], readableSecurityValue, 'category',
      'No matching alert types');
    const countries = (summary.filterOptions?.countries || []).map((item) => item.country);
    fillSecurityOptions(securityCountryAdd, countries,
      (value) => countryName(value) + ' (' + value + ')', 'country', 'No detected countries');
    await Promise.all([loadTelegram(), loadMaxMind()]);
    elements.securitySummary.replaceChildren(
      securityMetric(summary.total, windowHours === 'all' ? 'events · all retained'
        : 'events · ' + elements.securityWindow.selectedOptions[0].textContent.toLowerCase()),
      securityMetric(summary.uniquePublicIps, 'public source IPs'),
      securityMetric(summary.successfulQr, 'successful QR sessions'),
      securityMetric(summary.failedLogin, 'failed login attempts'),
      securityMetric(summary.warnings, 'warnings'),
      securityMetric(summary.critical, 'critical signals'),
      securityMetric(summary.integrityFailures, 'integrity failures'),
      securityMetric(summary.waf?.total || 0, 'WAF findings'),
      securityMetric(summary.waf?.edgeRejected || 0, 'edge policy rejected · origin not reached'),
      securityMetric(summary.waf?.blocked || 0, 'WAF blocked'),
      securityMetric(summary.waf?.unknown || 0, 'observed · final outcome unverified'),
    );
    renderSecurityEventPage(result);
    const geo = summary.geoip;
    elements.securityStatus.textContent = 'Showing ' + securityLoadedCount + ' of ' + summary.total + ' event'
      + (summary.total === 1 ? '' : 's') + ' for ' + elements.securityWindow.selectedOptions[0].textContent.toLowerCase()
      + (summary.oldestAt ? ' · oldest included: ' + new Date(summary.oldestAt).toLocaleString() : '')
      + ' · retention: ' + summary.retentionDays + ' days · local GeoIP city '
      + (geo.city.loaded ? 'loaded' : 'not configured') + ' · ASN ' + (geo.asn.loaded ? 'loaded' : 'not configured')
      + ' · ledger ' + formatBytes(summary.storage.bytes) + ' / ' + formatBytes(summary.storage.maximumBytes)
      + (summary.storage.limited ? ' · storage limit reached' : '')
      + (summary.storage.suppressedSinceStart ? ' · ' + summary.storage.suppressedSinceStart + ' events suppressed' : '')
      + ' · WAF ' + (summary.waf?.ingestion?.configured
        ? (summary.waf.ingestion.mode || 'mode unknown') + ', telemetry '
          + (summary.waf.ingestion.inputAvailable ? 'connected' : 'waiting for input')
        : 'telemetry not configured')
      + (summary.waf?.ingestion?.lastError ? ' (' + summary.waf.ingestion.lastError + ')' : '')
      + ' · locations are approximate';
  } catch (error) { elements.securityStatus.textContent = error.message; }
  finally { elements.securityRefresh.disabled = false; }
}
elements.securityLoadOlder.addEventListener('click', async () => {
  if (!securityNextBefore) return;
  elements.securityLoadOlder.disabled = true;
  try {
    const response = await fetch('/api/security/events?'
      + securityEventParameters(securityNextBefore, securityNextBeforeId), { cache: 'no-store' });
    if (!response.ok) throw new Error('Older security events are unavailable');
    renderSecurityEventPage(await response.json(), true);
    elements.securityLoadOlder.textContent = securityNextBefore ? 'Load older events' : 'Oldest retained event reached';
  } catch (error) { elements.securityStatus.textContent = error.message; }
  finally { elements.securityLoadOlder.disabled = false; }
});
elements.securityRefresh.addEventListener('click', loadSecurity);
securityExport.addEventListener('click', exportSecurityCsv);
elements.securityPanel.addEventListener('toggle', () => {
  elements.workspace.classList.toggle('security-mode', elements.securityPanel.open);
  elements.securityMap.hidden = !elements.securityPanel.open;
  securityGlobe.setActive(elements.securityPanel.open);
  elements.workspace.setAttribute('aria-label', elements.securityPanel.open
    ? 'Interactive security connection map' : 'Scene preview');
  if (elements.securityPanel.open) loadSecurity();
  else requestAnimationFrame(fitFrame);
});

async function load(preserveScene = false) {
  state = await fetch('/api/state').then((response) => response.json());
  scene = preserveScene && scene ? scene : structuredClone(state.draft?.scene || state.active.scene);
  elements.backgroundSelect.replaceChildren(...state.backgrounds.filter((item) => item.status !== 'archived' || item.id === scene.backgroundId).map((item) => new Option((item.label || item.id) + ' · ' + formatBytes(item.bytes) + (item.bundleId ? ' · effects available' : ''), item.id)));
  const managedId = elements.managedDestination.value || 'torrentharbor';
  elements.managedDestination.replaceChildren(...state.destinations.map((item) => new Option(item.id === 'torrentharbor' ? 'TorrentHarbor' : item.id === 'firewall' ? 'Firewall' : item.id, item.id)));
  elements.managedDestination.value = managedId;
  await showDestination();
  elements.pendingDestinations.replaceChildren(...state.pendingDestinations.map((item) => {
    const row = document.createElement('p');
    row.textContent = item.name + ' · ' + item.route + ' · ' + item.status;
    if (item.id === 'firewall' && item.status === 'pending' && state.firewallProvisioningReady) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Activate verified route';
      button.addEventListener('click', async () => {
        try {
          const response = await fetch('/api/destinations/firewall/activate', { method: 'POST',
            headers: { 'X-Scene-CSRF': requireCsrf() } });
          const result = await readWriteResponse(response);
          if (!response.ok) throw new Error(result.error || 'Activation failed');
          await load(true);
          elements.status.textContent = 'Firewall route active. Add its hotspot to the scene, then publish.';
        } catch (error) { elements.status.textContent = error.message; }
      });
      row.append(' ', button);
    }
    return row;
  }));
  elements.firewallRegistrations.replaceChildren(...(state.firewallRegistrations || []).map((item) => {
    const row = document.createElement('p');
    row.textContent = item.username + ' · ' + item.email + ' · ' + item.status;
    return row;
  }));
  elements.images.replaceChildren(...state.backgrounds.filter((item) => item.id.startsWith('img-')).map((item) => {
    const row = document.createElement('div');
    row.className = 'image-row';
    const thumbnail = document.createElement('img');
    thumbnail.src = item.url;
    thumbnail.alt = '';
    const label = document.createElement('span');
    const used = item.id === state.imageReferences.active ? ' · active' : item.id === state.imageReferences.draft ? ' · draft' : state.imageReferences.history.includes(item.id) ? ' · in history' : '';
    const compatibility = item.mediaType === 'image/webp' && item.width === 1672 && item.height === 941 && !item.optimizedFrom
      ? ' · legacy copy · Future games unavailable' : item.optimizedFrom ? ' · optimized copy' : ' · original';
    label.textContent = (item.label || item.id) + ' · ' + item.width + '×' + item.height + ' · ' + formatBytes(item.bytes) + ' · ' + (item.mediaType === 'image/webp' ? 'WebP' : 'PNG') + compatibility + ' · ' + item.status + (item.bundleId ? ' · motion effects' : '') + used;
    const button = document.createElement('button');
    const action = item.status === 'archived' ? 'restore' : 'archive';
    button.textContent = action === 'archive' ? 'Remove from backgrounds' : 'Restore';
    button.disabled = action === 'archive' && (item.id === state.imageReferences.active || item.id === state.imageReferences.draft);
    button.addEventListener('click', () => imageAction(item.id, action).catch((error) => { elements.status.textContent = error.message; }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete permanently';
    const referenced = item.id === state.imageReferences.active || item.id === state.imageReferences.draft || state.imageReferences.history.includes(item.id);
    remove.disabled = referenced;
    remove.title = referenced ? 'Remove this image from the active scene, draft, and saved revisions before permanent deletion.' : '';
    remove.addEventListener('click', () => deleteImage(item).catch((error) => { elements.status.textContent = error.message; }));
    row.append(thumbnail, label, button, remove);
    return row;
  }));
  elements.history.replaceChildren(...state.history.map((item) => {
    const row = document.createElement('div');
    row.className = 'revision';
    const label = document.createElement('span');
    const destinations = [...new Set(item.scene.hotspots.map((hotspot) => hotspot.destinationId))].join(', ') || 'none';
    label.textContent = item.publishedAt + ' · ' + item.actor + ' · image: ' + item.scene.backgroundId + ' · destinations: ' + destinations;
    const button = document.createElement('button');
    const alreadyActive = JSON.stringify(item.scene) === JSON.stringify(state.active.scene);
    button.textContent = alreadyActive ? 'Current' : 'Restore';
    button.disabled = alreadyActive;
    button.addEventListener('click', () => rollback(item.revisionId).catch((error) => { elements.status.textContent = error.message; }));
    row.append(label, button);
    return row;
  }));
  render();
}

load().catch(() => { elements.status.textContent = 'Management state unavailable.'; });

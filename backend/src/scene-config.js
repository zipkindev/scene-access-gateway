'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const DEFAULT_SCENE = require('./config/default-scene.json');
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const MOTION_EFFECTS = Object.freeze(['clouds', 'fog', 'rain', 'water', 'glow', 'train']);
const SCENE_BUNDLES = Object.freeze(Object.fromEntries([
  'wildlife-preserve-v2', 'orbital-observatory-v2', 'submerged-city-v2',
].map((id) => [id, Object.freeze(require('./assets/scene-bundles/' + id + '/motion.json'))])));

const BACKGROUNDS = Object.freeze({
  'future-minesweeper-v1': Object.freeze({ id: 'future-minesweeper-v1', label: 'Future table puzzle · interactive', file: 'scene-bundles/future-minesweeper-v1/base.png', mediaType: 'image/png', width: 1672, height: 941, sha256: '94070923ff96d7442f917254c58aa41ef43c2d3e038e4fdc14d95bbf2e7e8f93' }),
  'wildlife-preserve-v2': Object.freeze({ id: 'wildlife-preserve-v2', label: 'Wildlife Preserve v2 · motion master', file: 'scene-bundles/wildlife-preserve-v2/base.png', mediaType: 'image/png', width: 1672, height: 941, sha256: '095b0bd66516e9e93fd321e443c52886fc3181523851d94c4f82c5d6614402b5', bundleId: 'wildlife-preserve-v2' }),
  'orbital-observatory-v2': Object.freeze({ id: 'orbital-observatory-v2', label: 'Orbital Observatory v2 · motion master', file: 'scene-bundles/orbital-observatory-v2/base.png', mediaType: 'image/png', width: 1672, height: 941, sha256: '6a6bfb5073a3b3fdc4b71deddf0ab95e3d0e62b9a36e85a02b68721fe666fb70', bundleId: 'orbital-observatory-v2' }),
  'submerged-city-v2': Object.freeze({ id: 'submerged-city-v2', label: 'Submerged City v2 · motion master', file: 'scene-bundles/submerged-city-v2/base.png', mediaType: 'image/png', width: 1672, height: 941, sha256: 'a37c1094351e2ffc045895ca86f958834935d8106e6ba42795787b672b0c1516', bundleId: 'submerged-city-v2' }),
  'immersive-city-candidate-a': Object.freeze({ id: 'immersive-city-candidate-a', file: 'immersive-city-candidate-a.png', mediaType: 'image/png', width: 1672, height: 941, sha256: 'f6700faf1c412dcecd799fcc1e7ae66058940a7c70478071036c8cb97ff1681d' }),
  'immersive-city-candidate-b': Object.freeze({ id: 'immersive-city-candidate-b', file: 'immersive-city-candidate-b.png', mediaType: 'image/png', width: 1672, height: 941, sha256: 'f748f9fb9d17eed6f94be8cc4b0601e6dd6ec7f24be776d9c9b771289ac60137' }),
  'immersive-harbor-candidate-c': Object.freeze({ id: 'immersive-harbor-candidate-c', file: 'immersive-harbor-candidate-c.png', mediaType: 'image/png', width: 1672, height: 941, sha256: '1fb3b1f33e657886637f40dd0a4b5d4b3593a6a77820fc7c74cfb610c21e8ddc' }),
  'rain-city-qr-embossed-v6': Object.freeze({ id: 'rain-city-qr-embossed-v6', file: 'rain-city-qr-embossed-v6.png', mediaType: 'image/png', width: 1672, height: 941, sha256: '6e3f0a87a783c21ed41e95310822a537c0ee237f8a4ea708a62b0747501cd803' }),
  'rain-city-embossed-v5': Object.freeze({ id: 'rain-city-embossed-v5', file: 'rain-city-embossed-v5.png', mediaType: 'image/png', width: 1672, height: 941, sha256: '958cb75bc0d326980fd9214bd71bc8ee7914de2220a3a9a36213bd3a438be909' }),
  'rain-city-widescreen-v4': Object.freeze({ id: 'rain-city-widescreen-v4', file: 'rain-city-widescreen-v4.png', mediaType: 'image/png', width: 1672, height: 941, sha256: '9ab6a2b191c72858cbdea717286cc512253ee7c0110acffc3ce79230e081e897' }),
  'rain-city-wall-v3': Object.freeze({ id: 'rain-city-wall-v3', file: 'rain-city-wall-v3.png', mediaType: 'image/png', width: 1024, height: 1536, sha256: '3ce9874199c68565228625e2c27a549d206ba9959ebe954727f1375a3320dae7' }),
  'rain-city-lightbox-v2': Object.freeze({ id: 'rain-city-lightbox-v2', file: 'rain-city-lightbox-v2.png', mediaType: 'image/png', width: 1024, height: 1536, sha256: '12670d09f465e2e57986e417c0a856e580f3676c16351856af71d394131b6935' }),
  'rain-city-v1': Object.freeze({ id: 'rain-city-v1', file: 'rain-city-v1.png', mediaType: 'image/png', width: 1254, height: 1254, sha256: '67b40bce21bce6347478b72963c400ed1daa846ce24a5cba4833d718434f9b5f' }),
});

const DESTINATIONS = Object.freeze({
  torrentharbor: Object.freeze({
    id: 'torrentharbor',
    route: '/torrentharbor/',
    authentication: 'portal-session-and-ed25519-sso',
  }),
  firewall: Object.freeze({
    id: 'firewall',
    route: process.env.FIREWALL_ORIGIN || 'http://localhost:8080/',
    authentication: 'firewall-email-grant-and-pfsense-login',
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactKeys(value, allowed, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(label + ' must be an object');
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(label + ' contains unsupported fields');
}

function bounded(value, minimum, maximum, label, exclusiveMinimum = false) {
  if (!Number.isFinite(value) || value > maximum || (exclusiveMinimum ? value <= minimum : value < minimum)) throw new Error(label + ' is out of range');
}

function onGameBoard(x, y) {
  const outline = [[542, 384], [1118, 386], [1282, 700], [369, 696]];
  const px = x * 1672;
  const py = y * 941;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, yi] = outline[i];
    const [xj, yj] = outline[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function gameCompatibleBackground(backgrounds, id) {
  const background = backgrounds[id];
  return !!background && (id === 'future-minesweeper-v1' ||
    (background.optimizedFrom === 'future-minesweeper-v1' && background.mediaType === 'image/webp')) &&
    background.width === 1672 && background.height === 941;
}

function validateScene(input, backgrounds = BACKGROUNDS, allowedDestinations = ['torrentharbor']) {
  const scene = clone(input);
  if (scene.motion === undefined) scene.motion = { enabled: false, effects: {} };
  if (scene.interaction === undefined) scene.interaction = { kind: 'none' };
  if (scene.display === undefined) scene.display = { title: 'ZArcade' };
  if (scene.diagnostics === undefined) scene.diagnostics = { clickDebugger: false };
  exactKeys(scene, ['schemaVersion', 'sceneId', 'backgroundId', 'viewport', 'publicText', 'hotspots', 'motion', 'interaction', 'display', 'diagnostics'], 'scene');
  if (scene.schemaVersion !== 1) throw new Error('unsupported scene schema');
  if (!ID.test(scene.sceneId || '')) throw new Error('invalid scene ID');
  if (!Object.hasOwn(backgrounds, scene.backgroundId)) throw new Error('unknown background');
  if (scene.publicText !== false) throw new Error('public scene text must remain disabled');
  exactKeys(scene.display, ['title'], 'display');
  if (typeof scene.display.title !== 'string' || scene.display.title.length < 1 || scene.display.title.length > 60 || scene.display.title !== scene.display.title.trim() || /[\u0000-\u001f\u007f]/.test(scene.display.title)) throw new Error('invalid browser tab title');
  exactKeys(scene.diagnostics, ['clickDebugger'], 'diagnostics');
  if (typeof scene.diagnostics.clickDebugger !== 'boolean') throw new Error('invalid click debugger state');
  exactKeys(scene.interaction, ['kind'], 'interaction');
  if (!['none', 'minesweeper'].includes(scene.interaction.kind)) throw new Error('unsupported interaction');
  if (scene.interaction.kind === 'minesweeper' && !gameCompatibleBackground(backgrounds, scene.backgroundId)) {
    throw new Error('this game requires its calibrated background');
  }

  exactKeys(scene.viewport, ['fit', 'pan', 'zoom', 'minimumZoom', 'maximumZoom', 'zoomIncrement', 'frames'], 'viewport');
  if (!['contain', 'cover'].includes(scene.viewport.fit)) throw new Error('invalid fit mode');
  if (typeof scene.viewport.pan !== 'boolean' || typeof scene.viewport.zoom !== 'boolean') throw new Error('invalid viewport controls');
  bounded(scene.viewport.minimumZoom, 1, 4, 'minimum zoom');
  bounded(scene.viewport.maximumZoom, 1, 8, 'maximum zoom');
  bounded(scene.viewport.zoomIncrement, 0, 1, 'zoom increment', true);
  if (scene.viewport.maximumZoom < scene.viewport.minimumZoom) throw new Error('maximum zoom precedes minimum zoom');
  if (scene.viewport.frames !== undefined) {
    exactKeys(scene.viewport.frames, ['wide', 'portrait'], 'viewport frames');
    for (const [name, ratio] of [['wide', 16 / 9], ['portrait', 9 / 16]]) {
      const frame = scene.viewport.frames[name];
      if (frame === undefined) continue;
      exactKeys(frame, ['x', 'y', 'width', 'height'], name + ' frame');
      bounded(frame.x, 0, 1, name + ' frame x');
      bounded(frame.y, 0, 1, name + ' frame y');
      bounded(frame.width, 0.08, 1, name + ' frame width');
      bounded(frame.height, 0.08, 1, name + ' frame height');
      if (frame.x + frame.width > 1.000001 || frame.y + frame.height > 1.000001 ||
          Math.abs(frame.width * backgrounds[scene.backgroundId].width /
            (frame.height * backgrounds[scene.backgroundId].height) - ratio) > 0.02) {
        throw new Error(name + ' frame must fit image at its device ratio');
      }
    }
  }

  exactKeys(scene.motion, ['enabled', 'effects'], 'motion');
  if (typeof scene.motion.enabled !== 'boolean') throw new Error('invalid motion enabled state');
  if (!scene.motion.effects || Array.isArray(scene.motion.effects) || typeof scene.motion.effects !== 'object') throw new Error('motion effects must be an object');
  const bundleId = backgrounds[scene.backgroundId].bundleId;
  const allowedEffects = bundleId ? SCENE_BUNDLES[bundleId].effects.map((effect) => effect.id) : MOTION_EFFECTS;
  for (const effect of allowedEffects) {
    if (scene.motion.effects[effect] === undefined) scene.motion.effects[effect] = false;
    if (typeof scene.motion.effects[effect] !== 'boolean') throw new Error('invalid motion effect');
  }
  exactKeys(scene.motion.effects, allowedEffects, 'motion effects');
  if (!bundleId && scene.backgroundId !== 'immersive-city-candidate-a' && (scene.motion.enabled || Object.values(scene.motion.effects).some(Boolean))) {
    throw new Error('motion bundle is unavailable for this background');
  }
  if (scene.motion.effects.train) throw new Error('train motion requires its clean scene plate');

  if (!Array.isArray(scene.hotspots) || scene.hotspots.length < 1 || scene.hotspots.length > 2) throw new Error('scene requires one or two hotspots');
  const identifiers = new Set();
  const destinationIds = new Set();
  for (const hotspot of scene.hotspots) {
    exactKeys(hotspot, ['id', 'shape', 'x', 'y', 'radius', 'destinationId', 'activation', 'visible', 'enabled', 'sequence'], 'hotspot');
    if (!ID.test(hotspot.id || '') || identifiers.has(hotspot.id)) throw new Error('invalid or duplicate hotspot ID');
    identifiers.add(hotspot.id);
    if (hotspot.shape !== 'circle') throw new Error('unsupported hotspot shape');
    bounded(hotspot.x, 0, 1, 'hotspot x');
    bounded(hotspot.y, 0, 1, 'hotspot y');
    bounded(hotspot.radius, 0, 0.25, 'hotspot radius', true);
    if (!DESTINATIONS[hotspot.destinationId] || !allowedDestinations.includes(hotspot.destinationId) || destinationIds.has(hotspot.destinationId)) throw new Error('unknown destination, unavailable or duplicate destination');
    destinationIds.add(hotspot.destinationId);
    if (!['qr-popup', 'direct-session-route'].includes(hotspot.activation)) throw new Error('invalid hotspot activation');
    if (hotspot.activation !== 'qr-popup' || hotspot.visible !== false || hotspot.enabled !== true) throw new Error('unsupported hotspot mode');
    if (typeof hotspot.visible !== 'boolean' || typeof hotspot.enabled !== 'boolean') throw new Error('invalid hotspot state');
    if (hotspot.sequence !== undefined) {
      exactKeys(hotspot.sequence, ['steps', 'maxGapSeconds', 'totalSeconds'], 'hotspot sequence');
      if (!Array.isArray(hotspot.sequence.steps) || hotspot.sequence.steps.length < 1 || hotspot.sequence.steps.length > 9) {
        throw new Error('sequence requires two to ten click points');
      }
      for (const step of hotspot.sequence.steps) {
        exactKeys(step, ['x', 'y', 'radius'], 'sequence point');
        bounded(step.x, 0, 1, 'sequence point x');
        bounded(step.y, 0, 1, 'sequence point y');
        bounded(step.radius, 0, 0.25, 'sequence point radius', true);
      }
      const { maxGapSeconds, totalSeconds } = hotspot.sequence;
      if (!Number.isInteger(maxGapSeconds) || maxGapSeconds < 1 || maxGapSeconds > 60 ||
          !Number.isInteger(totalSeconds) || totalSeconds < 2 || totalSeconds > 180 ||
          totalSeconds < maxGapSeconds) throw new Error('invalid sequence timing');
    }
  }
  if (!destinationIds.has('torrentharbor')) throw new Error('TorrentHarbor hotspot is required');
  if (scene.interaction.kind === 'minesweeper') {
    for (const hotspot of scene.hotspots) {
      for (const point of [hotspot, ...(hotspot.sequence?.steps || [])]) {
        if (onGameBoard(point.x, point.y)) throw new Error('move QR click points outside the game board');
      }
    }
  }
  return scene;
}

class SceneStore {
  constructor(directory, backgrounds = () => BACKGROUNDS, allowedDestinations = () => ['torrentharbor']) {
    this.backgrounds = backgrounds;
    this.allowedDestinations = allowedDestinations;
    this.directory = path.join(directory, 'scene-management');
    this.revisions = path.join(this.directory, 'revisions');
    this.activeFile = path.join(this.directory, 'active.json');
    this.draftFile = path.join(this.directory, 'draft.json');
    fs.mkdirSync(this.revisions, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.activeFile)) this._publish(DEFAULT_SCENE, 'bootstrap', null);
  }

  _atomic(file, value) {
    const temporary = [file, process.pid, crypto.randomBytes(8).toString('hex'), 'tmp'].join('.');
    fs.writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  }

  _record(scene, actor, rolledBackFrom) {
    return {
      revisionId: Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex'),
      publishedAt: new Date().toISOString(),
      actor,
      ...(rolledBackFrom ? { rolledBackFrom } : {}),
      scene: validateScene(scene, this.backgrounds(), this.allowedDestinations()),
    };
  }

  _publish(scene, actor, rolledBackFrom) {
    const record = this._record(scene, actor, rolledBackFrom);
    const revisionFile = path.join(this.revisions, record.revisionId + '.json');
    this._atomic(revisionFile, record);
    this._atomic(this.activeFile, record);
    return clone(record);
  }

  active() {
    return clone(JSON.parse(fs.readFileSync(this.activeFile, 'utf8')));
  }

  saveDraft(scene) {
    const draft = { savedAt: new Date().toISOString(), scene: validateScene(scene, this.backgrounds(), this.allowedDestinations()) };
    this._atomic(this.draftFile, draft);
    return clone(draft);
  }

  draft() {
    return fs.existsSync(this.draftFile) ? clone(JSON.parse(fs.readFileSync(this.draftFile, 'utf8'))) : null;
  }

  publish(scene, actor = 'management') {
    if (!ID.test(actor)) throw new Error('invalid actor');
    const record = this._publish(scene, actor, null);
    if (fs.existsSync(this.draftFile)) fs.unlinkSync(this.draftFile);
    return record;
  }

  history() {
    return fs.readdirSync(this.revisions)
      .filter((name) => /^[a-z0-9-]+\.json$/.test(name))
      .map((name) => JSON.parse(fs.readFileSync(path.join(this.revisions, name), 'utf8')))
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .map(clone);
  }

  distinctHistory() {
    const seen = [];
    return this.history().filter((record) => {
      // Older revisions predate optional interaction and motion fields.
      // Treat their implicit defaults as the same scene when listing history.
      const scene = { ...record.scene,
        interaction: record.scene.interaction ?? { kind: 'none' },
        motion: record.scene.motion ?? { enabled: false, effects: {} },
        diagnostics: record.scene.diagnostics ?? { clickDebugger: false } };
      if (seen.some((prior) => isDeepStrictEqual(prior, scene))) return false;
      seen.push(scene);
      return true;
    });
  }

  rollback(revisionId, actor = 'management') {
    if (!/^[a-z0-9-]+$/.test(revisionId || '')) throw new Error('invalid revision ID');
    const source = JSON.parse(fs.readFileSync(path.join(this.revisions, revisionId + '.json'), 'utf8'));
    // Restoring a scene that is already live must not create another revision,
    // replace active.json, or discard an unrelated draft.
    const active = this.active();
    if (isDeepStrictEqual(validateScene(source.scene, this.backgrounds(), this.allowedDestinations()), validateScene(active.scene, this.backgrounds(), this.allowedDestinations()))) {
      return { ...active, unchanged: true };
    }
    // Activate the saved snapshot without publishing a duplicate revision.
    // A new activation also invalidates progress from earlier QR click sequences.
    const record = { ...source, scene: validateScene(source.scene, this.backgrounds(), this.allowedDestinations()),
      actor, activatedAt: new Date().toISOString(),
      activationId: crypto.randomBytes(16).toString('hex'), rolledBackFrom: revisionId };
    this._atomic(this.activeFile, record);
    if (fs.existsSync(this.draftFile)) fs.unlinkSync(this.draftFile);
    return record;
  }
}

module.exports = { BACKGROUNDS, DEFAULT_SCENE, DESTINATIONS, SCENE_BUNDLES, SceneStore, validateScene, gameCompatibleBackground };

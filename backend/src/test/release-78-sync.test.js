'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ArcadeLeaderboard, GAMES } = require('../arcade-leaderboard');
const { landingPage } = require('../landing');
const { DEFAULT_SCENE, validateScene } = require('../scene-config');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const runId = (number) => `release_78_run_${String(number).padStart(4, '0')}`;

test('release 78 leaderboard supports every Arcade board and persists rankings', () => {
  assert.equal(GAMES.size, 13);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sag-release-78-board-'));
  try {
    const board = new ArcadeLeaderboard(directory);
    board.submit({ game: 'lights', initials: 'AAA', timeMs: 5000, moves: 20, runId: runId(1) });
    board.submit({ game: 'lights', initials: 'BBB', timeMs: 4000, moves: 30, runId: runId(2) });
    board.submit({ game: 'wolf3d', initials: 'BJW', score: 55000, assisted: false,
      completed: true, difficulty: 2, runId: runId(3) });
    board.submit({ game: 'spear', initials: 'SOD', score: 42000, assisted: false,
      completed: true, difficulty: 3, runId: runId(4) });
    assert.equal(board.list('lights')[0].initials, 'BBB');
    assert.equal(board.list('wolf3d')[0].completed, true);
    assert.equal(board.list('spear')[0].difficulty, 3);
    assert.deepEqual(new ArcadeLeaderboard(directory).list('lights'), board.list('lights'));
    const beforeRetry = board.list('lights');
    const retry = board.submit({ game: 'lights', initials: 'ZZZ', timeMs: 1,
      moves: 1, runId: runId(1) });
    assert.equal(retry.duplicate, true);
    assert.deepEqual(retry.board, beforeRetry);
    assert.deepEqual(board.list('lights'), beforeRetry);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scene titles remain backward compatible, validated, and HTML escaped', () => {
  const legacy = structuredClone(DEFAULT_SCENE);
  delete legacy.display;
  assert.deepEqual(validateScene(legacy).display, { title: 'ZArcade' });
  const scene = structuredClone(DEFAULT_SCENE);
  scene.display = { title: '<Z & Arcade>' };
  assert.match(landingPage(null, null, 'nonce', scene), /<title>&lt;Z &amp; Arcade&gt;<\/title>/);
  for (const title of ['', ' ZArcade', 'ZArcade ', 'x'.repeat(61), 'Z\nArcade']) {
    const invalid = structuredClone(DEFAULT_SCENE);
    invalid.display = { title };
    assert.throws(() => validateScene(invalid), /invalid browser tab title/);
  }
});

test('release 78 public source retains final challenge, score, and CRT contracts', () => {
  const landing = source('landing.js');
  const server = source('server.js');
  const carousel = source('future-game-carousel.js');
  assert.match(landing, /future-wolf3d-crt\.js\?v=78/);
  assert.match(landing, /future-game-carousel\.js\?v=106/);
  assert.match(landing, /function startPortalPoll\(\)/);
  assert.match(landing, /if \(result\.terminal\) \{ clearInterval\(portalPoll\); portalPoll = null; return; \}/);
  assert.match(landing, /let clickQueue = Promise\.resolve\(\)/);
  assert.match(landing, /clickQueue = clickQueue\.then/);
  assert.match(landing, /function queueSceneHit\(clientX, clientY\)/);
  assert.match(landing, /Click detected by browser · sending to server/);
  assert.match(landing, /Point ' \+ result\.acceptedStep \+ ' confirmed by server/);
  assert.match(landing, /Click reached server · sequence reset/);
  assert.match(landing, /scene\.addEventListener\('pointerup', \(event\) => endPan\(event, true\)\)/);
  assert.doesNotMatch(landing, /scene\.addEventListener\('click', \(event\) => \{\s*if \(suppressClick/);
  assert.doesNotMatch(landing, /if \(checkingClick/);
  assert.match(server, /url\.pathname === '\/api\/arcade\/scores'/);
  assert.match(server, /JSON\.stringify\(\{ terminal: true \}\)/);
  assert.match(server, /portalChallengeCookie\(token\)/);
  assert.match(server, /outcome: 'page_served'/);
  assert.match(server, /security\('qr_challenge_created'/);
  assert.doesNotMatch(server, /store\.createChallenge\(tokenHash\(browserId\)[^\n]+\n\s*const nonce/);
  assert.match(server, /JSON\.stringify\(\{ destination, accepted, acceptedStep \}\)/);
  for (const game of ['fusion', 'classic2048', 'minesweeper', 'memory', 'lights',
    'treasure', 'knight', 'pegs', 'reversi', 'four', 'circuit']) {
    assert.ok(carousel.includes(game), `missing Arcade game contract: ${game}`);
  }
  assert.match(carousel, /finishedGames\.add\(result\.game\)/);
  assert.match(carousel, /if \(finishedGames\.has\(gameId\)\) return/);
  for (const text of [landing, server, source('scene-admin.js'), source('scene-config.js')]) {
    assert.doesNotMatch(text, /zipkin\.dev|192\.168\.|\bmzipkin\b|\bmike\b/i);
  }
});

test('public click receipts number accepted sequence points for humans', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(server, /const acceptedStep = result\.progress \? result\.progress\.next :/);
  assert.doesNotMatch(server, /result\.progress\.next - 1/);
});

test('public click debugger is hidden by default and rendered only when enabled', () => {
  const normal = landingPage(null, null, 'nonce', DEFAULT_SCENE);
  assert.doesNotMatch(normal, /<output class="scene-click-status"/);
  assert.match(normal, /const clickDebugger = false/);

  const debugScene = structuredClone(DEFAULT_SCENE);
  debugScene.diagnostics.clickDebugger = true;
  const debug = landingPage(null, null, 'nonce', debugScene);
  assert.match(debug, /<output class="scene-click-status"/);
  assert.match(debug, /const clickDebugger = true/);
});

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GAMES = new Set([
  'fusion', 'classic2048', 'wolf3d', 'spear', 'minesweeper', 'memory', 'lights', 'treasure',
  'knight', 'pegs', 'reversi', 'four', 'circuit',
]);
const WOLF_GAMES = new Set(['wolf3d', 'spear']);
const TIMED_GAMES = new Set(['lights', 'treasure', 'knight', 'pegs', 'four', 'circuit', 'memory']);
const INITIALS = /^[A-Z]{3}$/;
const RUN_ID = /^[A-Za-z0-9_-]{16,64}$/;
const PLAYER_ID = /^[A-Za-z0-9_-]{16,64}$/;

function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function compare(game, a, b) {
  if (game === 'memory') return b.level - a.level || a.timeMs - b.timeMs || a.recordedAt.localeCompare(b.recordedAt);
  if (game === 'minesweeper') return b.level - a.level || b.tiles - a.tiles || a.recordedAt.localeCompare(b.recordedAt);
  if (game === 'lights') return a.timeMs - b.timeMs || a.moves - b.moves || a.recordedAt.localeCompare(b.recordedAt);
  if (game === 'treasure') return b.level - a.level || a.timeMs - b.timeMs || a.recordedAt.localeCompare(b.recordedAt);
  if (game === 'knight') return b.tiles - a.tiles || a.timeMs - b.timeMs || a.recordedAt.localeCompare(b.recordedAt);
  if (game === 'pegs') return a.timeMs - b.timeMs || a.recordedAt.localeCompare(b.recordedAt);
  if (game === 'reversi') return b.gold - a.gold || b.margin - a.margin || a.recordedAt.localeCompare(b.recordedAt);
  if (game === 'four') return b.wins - a.wins || a.bestTimeMs - b.bestTimeMs || a.recordedAt.localeCompare(b.recordedAt);
  if (game === 'circuit') return a.timeMs - b.timeMs || a.moves - b.moves || a.recordedAt.localeCompare(b.recordedAt);
  return b.score - a.score || a.recordedAt.localeCompare(b.recordedAt);
}

class ArcadeLeaderboard {
  constructor(directory) {
    this.file = path.join(directory, 'arcade-leaderboard.json');
    this.state = this._load();
  }

  _empty() {
    return { version: 1, boards: Object.fromEntries([...GAMES].map((game) => [game, []])), seenRuns: [], players: { four: {} } };
  }

  _load() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (value?.version !== 1 || !value.boards || !Array.isArray(value.seenRuns)) throw new Error('invalid leaderboard');
      for (const game of GAMES) {
        if (value.boards[game] == null) value.boards[game] = [];
        if (!Array.isArray(value.boards[game])) throw new Error('invalid board');
      }
      if (!value.players || typeof value.players !== 'object') value.players = {};
      if (!value.players.four || typeof value.players.four !== 'object') value.players.four = {};
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return this._empty();
      throw error;
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.state) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }

  list(game) {
    if (!GAMES.has(game)) throw new Error('invalid game');
    return this.state.boards[game].map((entry) => {
      const result = { initials: entry.initials };
      for (const key of ['score', 'timeMs', 'moves', 'level', 'tiles', 'gold', 'margin', 'wins', 'bestTimeMs']) {
        if (Number.isSafeInteger(entry[key])) result[key] = entry[key];
      }
      if (WOLF_GAMES.has(game)) Object.assign(result, {
        assisted: !!entry.assisted, completed: !!entry.completed, difficulty: entry.difficulty,
      });
      else if (game === 'fusion' || game === 'classic2048') result.mastered = !!entry.mastered;
      return result;
    });
  }

  _validate(value) {
    const { game, initials, runId } = value || {};
    if (!GAMES.has(game) || !INITIALS.test(initials || '') || !RUN_ID.test(runId || '')) throw new Error('invalid score');
    if (WOLF_GAMES.has(game)) {
      if (!integer(value.score, 0, 999999999999) || typeof value.assisted !== 'boolean' ||
          typeof value.completed !== 'boolean' || !integer(value.difficulty, 0, 3)) throw new Error('invalid score');
    } else if (game === 'fusion' || game === 'classic2048') {
      if (!integer(value.score, 1, 999999999999) || typeof value.mastered !== 'boolean') throw new Error('invalid score');
    } else if (game === 'memory') {
      if (!integer(value.level, 1, 100000) || !integer(value.timeMs, 1, 86400000)) throw new Error('invalid score');
    } else if (game === 'minesweeper') {
      if (!integer(value.level, 1, 100000) || !integer(value.tiles, 0, 1000000000)) throw new Error('invalid score');
    } else if (game === 'lights') {
      if (!integer(value.timeMs, 1, 86400000) || !integer(value.moves, 1, 100000)) throw new Error('invalid score');
    } else if (game === 'treasure') {
      if (!integer(value.level, 1, 100000) || !integer(value.timeMs, 1, 604800000)) throw new Error('invalid score');
    } else if (game === 'knight') {
      if (!integer(value.tiles, 1, 64) || !integer(value.timeMs, 1, 86400000)) throw new Error('invalid score');
    } else if (game === 'pegs') {
      if (!integer(value.timeMs, 1, 86400000)) throw new Error('invalid score');
    } else if (game === 'reversi') {
      if (!integer(value.gold, 1, 64) || !integer(value.margin, 1, 64)) throw new Error('invalid score');
    } else if (game === 'four') {
      if (!PLAYER_ID.test(value.playerId || '') || !integer(value.timeMs, 1, 86400000)) throw new Error('invalid score');
    } else if (game === 'circuit') {
      if (!integer(value.timeMs, 1, 86400000) || !integer(value.moves, 1, 1000000)) throw new Error('invalid score');
    }
  }

  submit(value) {
    this._validate(value);
    if (this.state.seenRuns.includes(value.runId)) throw new Error('run already submitted');
    this.state.seenRuns.push(value.runId);
    if (this.state.seenRuns.length > 4096) this.state.seenRuns.splice(0, this.state.seenRuns.length - 4096);
    const now = new Date().toISOString();
    let entry;
    if (value.game === 'four') {
      const existing = this.state.players.four[value.playerId];
      entry = existing || { playerId: value.playerId, initials: value.initials, wins: 0, bestTimeMs: value.timeMs, recordedAt: now };
      entry.initials = value.initials;
      entry.wins += 1;
      entry.bestTimeMs = Math.min(entry.bestTimeMs, value.timeMs);
      entry.recordedAt = now;
      this.state.players.four[value.playerId] = entry;
      this.state.boards.four = Object.values(this.state.players.four).sort((a, b) => compare('four', a, b)).slice(0, 10);
    } else {
      entry = { initials: value.initials, recordedAt: now };
      for (const key of ['score', 'timeMs', 'moves', 'level', 'tiles', 'gold', 'margin']) {
        if (Number.isSafeInteger(value[key])) entry[key] = value[key];
      }
      if (WOLF_GAMES.has(value.game)) Object.assign(entry, {
        assisted: value.assisted, completed: value.completed, difficulty: value.difficulty,
      });
      else if (value.game === 'fusion' || value.game === 'classic2048') entry.mastered = value.mastered;
      const board = this.state.boards[value.game];
      board.push(entry);
      board.sort((a, b) => compare(value.game, a, b));
      if (board.length > 10) board.length = 10;
    }
    this._save();
    const board = this.state.boards[value.game];
    const rank = board.indexOf(entry);
    return { rank: rank >= 0 ? rank + 1 : null, board: this.list(value.game) };
  }
}

module.exports = { ArcadeLeaderboard, GAMES, WOLF_GAMES, TIMED_GAMES, INITIALS, RUN_ID, PLAYER_ID, compare };

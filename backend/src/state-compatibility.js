'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArcadeLeaderboard, GAMES } = require('./arcade-leaderboard');
const { DestinationRegistry } = require('./scene-destinations');
const { ImageLibrary } = require('./scene-assets');
const { BACKGROUNDS, SceneStore } = require('./scene-config');
const { createSceneAdmin } = require('./scene-admin');
const { PortalStore } = require('./store');

function validateStateClone(directory) {
  if (!path.isAbsolute(directory || '') || directory === '/' || !fs.existsSync(path.join(directory, '.state-compatibility-clone'))) {
    throw new Error('State compatibility checks require a marked disposable clone');
  }
  const destinations = new DestinationRegistry(directory).list();
  const images = new ImageLibrary(directory).catalog();
  const destinationIds = () => ['torrentharbor', ...destinations.filter((item) => item.status === 'active').map((item) => item.id)];
  const backgrounds = () => ({ ...BACKGROUNDS, ...images });
  const scenes = new SceneStore(directory, backgrounds, destinationIds);
  const active = scenes.active();
  const draft = scenes.draft();
  const history = scenes.history();
  const portal = new PortalStore(directory);
  portal.purge(Date.now(), false);
  const leaderboard = new ArcadeLeaderboard(directory);
  for (const game of GAMES) leaderboard.list(game);
  createSceneAdmin(directory);
  return { destinations: destinations.length, images: Object.keys(images).length,
    activeRevision: typeof active.revisionId === 'string', draft: Boolean(draft), revisions: history.length };
}

if (require.main === module) {
  try {
    const result = validateStateClone(process.env.STATE_COMPATIBILITY_DATA_DIR);
    process.stdout.write(JSON.stringify({ compatible: true, ...result }) + '\n');
  } catch (error) {
    process.stderr.write('Persistent state is incompatible with this candidate: ' + error.message + '\n');
    process.exitCode = 1;
  }
}

module.exports = { validateStateClone };

'use strict';

// Resolve a public click against the active scene without sending hotspot
// geometry to the browser. The pixel floor preserves the current touch target.
function validPoint(x, y, width, height) {
  return [x, y, width, height].every(Number.isFinite)
    && x >= 0 && x <= 1 && y >= 0 && y <= 1
    && width >= 1 && width <= 100000 && height >= 1 && height <= 100000;
}

function inside(point, x, y, width, height, destinationId) {
  const dx = x - point.x;
  const dy = y - point.y;
  const pixelDistance = Math.hypot(dx * width, dy * height);
  return destinationId === 'firewall'
    ? pixelDistance <= Math.max(22, point.radius * width)
    : Math.hypot(dx, dy) <= point.radius || pixelDistance <= 22;
}

function available(scene, firewallActive) {
  return scene.hotspots.filter((hotspot) => hotspot.enabled
    && (hotspot.destinationId === 'torrentharbor'
      || (hotspot.destinationId === 'firewall' && firewallActive)))
    // The former Firewall element sat above the TorrentHarbor click target.
    .sort((a, b) => Number(b.destinationId === 'firewall') - Number(a.destinationId === 'firewall'));
}

function sceneHit(scene, x, y, width, height, firewallActive) {
  if (!validPoint(x, y, width, height)) return null;

  for (const hotspot of available(scene, firewallActive))
    if (inside(hotspot, x, y, width, height, hotspot.destinationId)) return hotspot.destinationId;
  return null;
}

// The browser receives only destination/null. An intermediate correct point
// has the same response as a miss, and sequence progress stays server-side.
function advanceSceneClick(scene, x, y, width, height, firewallActive, progress, now) {
  const missed = { destination: null, progress: null };
  if (!validPoint(x, y, width, height) || !Number.isFinite(now)) return missed;
  const hotspots = available(scene, firewallActive);

  // A destination configured for one click remains immediately usable.
  for (const hotspot of hotspots) {
    if (!hotspot.sequence && inside(hotspot, x, y, width, height, hotspot.destinationId)) {
      return { destination: hotspot.destinationId, progress: null };
    }
  }

  if (progress) {
    const hotspot = hotspots.find((item) => item.destinationId === progress.destinationId && item.sequence);
    if (hotspot && now - progress.lastAt <= hotspot.sequence.maxGapSeconds * 1000
      && now - progress.startedAt <= hotspot.sequence.totalSeconds * 1000) {
      const next = hotspot.sequence.steps[progress.next - 1];
      if (next && inside(next, x, y, width, height, hotspot.destinationId)) {
        if (progress.next === hotspot.sequence.steps.length) {
          return { destination: hotspot.destinationId, progress: null };
        }
        return { destination: null, progress: { ...progress, next: progress.next + 1, lastAt: now } };
      }
      // A wrong click resets progress; this click may also start another sequence.
    }
  }

  for (const hotspot of hotspots) {
    if (hotspot.sequence && inside(hotspot, x, y, width, height, hotspot.destinationId)) {
      return { destination: null, progress: {
        destinationId: hotspot.destinationId, next: 1, startedAt: now, lastAt: now,
      } };
    }
  }
  return missed;
}

module.exports = { sceneHit, advanceSceneClick };

'use strict';

// Shared, deterministic geometry for the private guide and public viewer.
(function (root) {
  const RATIOS = Object.freeze({ wide: 16 / 9, portrait: 9 / 16 });

  function profileFor(width, height) {
    const ratio = width / height;
    return ratio <= 0.85 ? 'portrait' : ratio >= 1.4 ? 'wide' : null;
  }

  function frameFits(frame, imageWidth, imageHeight, ratio) {
    return !!frame && Number.isFinite(frame.x) && Number.isFinite(frame.y) &&
      Number.isFinite(frame.width) && Number.isFinite(frame.height) &&
      frame.width > 0 && frame.height > 0 && frame.x >= 0 && frame.y >= 0 &&
      frame.x + frame.width <= 1.000001 && frame.y + frame.height <= 1.000001 &&
      Math.abs(frame.width * imageWidth / (frame.height * imageHeight) - ratio) < 0.02;
  }

  // Points and rectangles are image-relative. The opposite corner stays put
  // while a handle is resized; the pointer can cross it to flip direction.
  function frameFromCorners(anchor, pointer, normalizedRatio, minimum = 0.08) {
    const dx = pointer.x - anchor.x;
    const dy = pointer.y - anchor.y;
    const signX = dx < 0 ? -1 : 1;
    const signY = dy < 0 ? -1 : 1;
    const maxWidth = Math.min(signX > 0 ? 1 - anchor.x : anchor.x,
      (signY > 0 ? 1 - anchor.y : anchor.y) * normalizedRatio);
    const width = Math.min(maxWidth, Math.max(Math.abs(dx), Math.abs(dy) * normalizedRatio));
    const height = width / normalizedRatio;
    if (width < minimum || height < minimum) return null;
    return {
      x: signX > 0 ? anchor.x : anchor.x - width,
      y: signY > 0 ? anchor.y : anchor.y - height,
      width, height,
    };
  }

  function moveFrame(frame, dx, dy) {
    return { ...frame,
      x: Math.max(0, Math.min(1 - frame.width, frame.x + dx)),
      y: Math.max(0, Math.min(1 - frame.height, frame.y + dy)),
    };
  }

  function layout(imageWidth, imageHeight, viewportWidth, viewportHeight, frames = {}) {
    if (![imageWidth, imageHeight, viewportWidth, viewportHeight].every((number) => Number.isFinite(number) && number > 0)) {
      throw new Error('Invalid scene framing dimensions');
    }
    const requested = profileFor(viewportWidth, viewportHeight);
    const candidate = requested && frameFits(frames[requested], imageWidth, imageHeight, RATIOS[requested])
      ? frames[requested] : null;

    function geometry(region, fillViewport) {
      const fit = fillViewport ? Math.max : Math.min;
      const scale = fit(viewportWidth / (region.width * imageWidth), viewportHeight / (region.height * imageHeight));
      const width = imageWidth * scale;
      const height = imageHeight * scale;
      return {
        left: viewportWidth / 2 - width * (region.x + region.width / 2),
        top: viewportHeight / 2 - height * (region.y + region.height / 2),
        width, height,
      };
    }

    return { ...geometry(candidate || { x: 0, y: 0, width: 1, height: 1 }, !!candidate),
      profile: candidate ? requested : 'full' };
  }

  const api = { RATIOS, profileFor, frameFits, frameFromCorners, moveFrame, layout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SceneFraming = api;
})(typeof window !== 'undefined' ? window : globalThis);

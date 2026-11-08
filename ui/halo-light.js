'use strict';
// How much light the Halo deserves for the scene on screen. Dark scenes get none,
// so the wall goes dark with the movie instead of glowing a boosted noise colour.
(function (root) {
  const DARK_FLOOR = 16;   // average edge brightness (0-255) at or below which the Halo is fully off
  const BRIGHT_FULL = 60;  // ...and at or above which it is fully on
  const FALLBACK_AFTER = 150; // ~5 s of black with no picture ever seen: protected video, use the app colour

  function smoothstep(value, low, high) {
    const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  }
  const lightTarget = brightness => smoothstep(brightness, DARK_FLOOR, BRIGHT_FULL);
  // Rise quickly on a bright cut, fade out gently when the scene goes dark.
  function followLight(current, target) {
    const next = current + (target - current) * (target > current ? .35 : .12);
    return Math.abs(target - next) < .005 ? target : next;
  }

  const api = { DARK_FLOOR, BRIGHT_FULL, FALLBACK_AFTER, lightTarget, followLight };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.lumenHaloLight = api;
})(typeof window !== 'undefined' ? window : globalThis);

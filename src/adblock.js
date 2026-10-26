'use strict';
// Built-in ad blocking for the TV browser, no extension needed. It does what uBlock Origin does for YouTube:
// strips the ad data out of YouTube's player responses before the player sees it, hides leftover ad slots,
// skips any ad that still gets through, and blocks the ad servers. Switch it on per tile with "adblock": true.

const BLOCKED_URLS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googleadservices.com/*',
  '*://*.2mdn.net/*',
  '*://*.youtube.com/pagead/*',
  '*://*.youtube.com/api/stats/ads*',
  '*://*.youtube.com/ptracking*',
  '*://*.youtube.com/get_midroll_*',
  // Unsolicited extension-install ads observed on Movy, not its catalog or player API.
  '*://*.amselvex.com/*',
  '*://*.nablescatch.com/*',
  '*://rosesilvers.com/*',
  '*://*.adblockghost.com/*'
];

// Runs inside every page before its own scripts. It only does anything on youtube.com.
const YOUTUBE_SCRIPT = `(() => {
  if (!/(^|\\.)youtube\\.com$/.test(location.hostname) || window.__lumenAdBlock) return;
  const stats = (window.__lumenAdBlock = { pruned: 0, skipped: 0 });
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const FEED_AD_KEYS = ['adSlotRenderer', 'promotedSparklesWebRenderer', 'promotedVideoRenderer', 'compactPromotedVideoRenderer', 'displayAdRenderer', 'inFeedAdLayoutRenderer'];
  const HINTS = ['adPlacements', 'adSlot', 'playerAds', 'promoted', 'displayAd', 'inFeedAd'];

  function prune(o, depth) {
    if (!o || typeof o !== 'object' || depth > 14) return o;
    if (Array.isArray(o)) {
      for (let i = o.length - 1; i >= 0; i--) {
        const it = o[i];
        if (it && typeof it === 'object' && !Array.isArray(it) && FEED_AD_KEYS.some((k) => k in it)) {
          o.splice(i, 1);
          stats.pruned++;
        } else {
          prune(it, depth + 1);
        }
      }
      return o;
    }
    for (const k of AD_KEYS) {
      if (k in o) { delete o[k]; stats.pruned++; }
    }
    for (const k in o) {
      const v = o[k];
      if (v && typeof v === 'object') prune(v, depth + 1);
    }
    return o;
  }

  // 1. responses parsed by the page
  const parse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const result = parse.call(this, text, reviver);
    if (typeof text === 'string' && text.length > 200 && HINTS.some((h) => text.includes(h))) prune(result, 0);
    return result;
  };
  const json = Response.prototype.json;
  Response.prototype.json = function () {
    const promise = json.call(this);
    return /youtubei\\/v1\\//.test(this.url) ? promise.then((r) => prune(r, 0)) : promise;
  };

  // 2. the data YouTube embeds in the page itself
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    let value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: (v) => { value = prune(v, 0); }
      });
    } catch (e) { /* already defined */ }
  }

  // 3. hide ad slots that are still drawn, and skip any ad that gets through anyway
  const css = 'ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-banner-promo-renderer,ytd-statement-banner-renderer,' +
    'ytd-display-ad-renderer,ytd-promoted-video-renderer,ytd-promoted-sparkles-web-renderer,#masthead-ad,#player-ads,.ytp-ad-overlay-container' +
    '{display:none!important}';
  const addStyle = () => {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addStyle); else addStyle();

  setInterval(() => {
    const player = document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting');
    if (!player) return;
    const skip = player.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (skip) { skip.click(); stats.skipped++; }
    const video = player.querySelector('video');
    if (video && isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.2) {
      video.currentTime = video.duration - 0.1;
      stats.skipped++;
    }
  }, 400);
})();`;

module.exports = { BLOCKED_URLS, YOUTUBE_SCRIPT };

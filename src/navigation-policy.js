'use strict';

function allowedOrigins(tile) {
  const urls = [tile?.url, ...(Array.isArray(tile?.allowedNavigationOrigins) ? tile.allowedNavigationOrigins : [])];
  return [...new Set(urls.flatMap(value => {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? [url.origin] : [];
    } catch { return []; }
  }))];
}

// Only the app's top-level document is restricted. Embedded players and API requests are not.
function allowsNavigation(tile, url) {
  if (!tile?.lockNavigation) return true;
  try { return allowedOrigins(tile).includes(new URL(url).origin); } catch { return false; }
}

module.exports = { allowedOrigins, allowsNavigation };

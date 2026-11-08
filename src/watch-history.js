'use strict';
const fs = require('fs');
const path = require('path');

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

function parseMovyUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)movy\.sx$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'movie' && /^\d+$/.test(parts[1])) return { mediaType: 'movie', id: Number(parts[1]), ref: `movie:${Number(parts[1])}`, url: `${url.origin}/movie/${Number(parts[1])}?play=true` };
    if (parts[0] === 'tv' && /^\d+$/.test(parts[1])) {
      const season = /^\d+$/.test(parts[2]) ? Number(parts[2]) : null;
      const episode = /^\d+$/.test(parts[3]) ? Number(parts[3]) : null;
      const suffix = season != null && episode != null ? `/${season}/${episode}` : '';
      return { mediaType: 'tv', id: Number(parts[1]), ref: `tv:${Number(parts[1])}`, season, episode, url: `${url.origin}/tv/${Number(parts[1])}${suffix}?play=true` };
    }
  } catch { /* invalid URL */ }
  return null;
}

function words(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean); }
function scoreTitle(query, item) {
  const q = words(query); if (!q.length) return 0;
  const hay = new Set(words(`${item.title || ''} ${item.series || ''}`));
  return q.reduce((n, word) => n + (hay.has(word) ? 1 : 0), 0) / q.length;
}

/** Identity of the show or movie an entry belongs to, shared by all of its episodes. */
function showKey(item) {
  const series = String(item.series || '').toLowerCase().replace(/\W+/g, '-');
  return item.ref && item.ref.startsWith('jojo:') && series ? `jojo:series:${series}` : item.ref || item.key;
}

class WatchHistory {
  constructor({ root, file, writeIntervalMs = 5000, maxEntries = 80 } = {}) {
    this.file = file || path.join(root || path.join(__dirname, '..'), 'cache', 'watch-history.json');
    this.writeIntervalMs = writeIntervalMs;
    this.maxEntries = maxEntries;
    this.items = [];
    this.lastWrite = 0;
    try { this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')).items || []; } catch { /* first run */ }
  }

  capture({ url, tileId, title, media } = {}) {
    if (!media || !Number.isFinite(Number(media.currentTime)) || Number(media.currentTime) < 15 || !Number.isFinite(Number(media.duration)) || Number(media.duration) < 60) return false;
    const parsed = parseMovyUrl(url);
    if (!parsed && tileId !== 'jojo') return false;
    const ref = parsed?.ref || `jojo:${String(title || media.series || media.title || 'current').toLowerCase().replace(/\W+/g, '-')}`;
    const position = Math.max(0, Number(media.currentTime));
    const duration = Number(media.duration);
    const index = this.items.findIndex(item => item.key === `${ref}:${parsed?.season ?? media.season ?? ''}:${parsed?.episode ?? media.episode ?? ''}`);
    const previous = index >= 0 ? this.items[index] : {};
    const item = {
      ...previous,
      key: `${ref}:${parsed?.season ?? media.season ?? ''}:${parsed?.episode ?? media.episode ?? ''}`,
      ref, mediaType: parsed?.mediaType || 'video', id: parsed?.id || null,
      title: String(media.title || media.series || title || previous.title || 'Continue watching').replace(/\s*[|–-]\s*Movy.*$/i, '').slice(0, 160),
      series: String(media.series || previous.series || '').slice(0, 160),
      season: parsed?.season ?? media.season ?? null, episode: parsed?.episode ?? media.episode ?? null,
      url: parsed?.url || url, position, duration, progress: Math.min(1, position / duration),
      artwork: media.artwork || previous.artwork || '', updatedAt: Date.now()
    };
    if (index >= 0) this.items.splice(index, 1);
    this.items.unshift(item);
    this.items = this.items.slice(0, this.maxEntries);
    if (Date.now() - this.lastWrite >= this.writeIntervalMs) this.flush();
    return true;
  }

  async enrich(catalog) {
    let changed = false;
    for (const item of this.items.slice(0, 20)) {
      if ((!item.artwork || !item.catalogTitle) && /^(movie|tv):/.test(item.ref)) {
        try {
          const detail = await catalog.detail(item.ref);
          if (detail) { item.catalogTitle = detail.title; item.title = item.series || detail.title || item.title; item.artwork = detail.backdrop || detail.poster || item.artwork; changed = true; }
        } catch { /* remain usable offline */ }
      }
    }
    if (changed) this.flush();
  }

  merge(items = []) {
    let changed = false;
    for (const incoming of items) {
      if (!incoming || !incoming.key || !incoming.ref || !incoming.url || !Number.isFinite(Number(incoming.progress))) continue;
      const index = this.items.findIndex(item => item.key === incoming.key);
      const previous = index >= 0 ? this.items[index] : null;
      if (previous && previous.url === incoming.url && previous.position === incoming.position && Math.abs(previous.progress - incoming.progress) < .0001 && previous.artwork === incoming.artwork) continue;
      // Live player telemetry is more exact than the site's rounded rail; the rail
      // still wins when it is newer or this is a first import.
      if (previous && previous.updatedAt > incoming.updatedAt && previous.position > 0) continue;
      if (index >= 0) this.items.splice(index, 1);
      this.items.push({ ...previous, ...incoming, artwork:incoming.artwork || previous?.artwork || '', updatedAt:Number(incoming.updatedAt) || Date.now() });
      changed = true;
    }
    if (changed) {
      this.items.sort((a, b) => b.updatedAt - a.updatedAt);
      this.items = this.items.slice(0, this.maxEntries);
      this.flush();
    }
    return changed;
  }

  flush() { this.lastWrite = Date.now(); atomicWrite(this.file, { version: 1, items: this.items }); }
  // Every episode keeps its own saved position (so it resumes exactly), but the
  // Continue Watching rail shows each show once: its most recently watched
  // unfinished episode.
  publicItems(limit = 12) {
    const seen = new Set();
    return this.items
      .filter(item => item.progress >= 0.01 && item.progress < 0.94)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .filter(item => { const show = showKey(item); if (seen.has(show)) return false; seen.add(show); return true; })
      .slice(0, limit);
  }
  find(query) { return this.publicItems(40).map(item => ({ item, score: scoreTitle(query, item) })).sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)[0]?.score >= 0.45 ? this.publicItems(40).map(item => ({ item, score: scoreTitle(query, item) })).sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)[0].item : null; }
}

module.exports = { WatchHistory, parseMovyUrl, scoreTitle };

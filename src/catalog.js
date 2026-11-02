'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { readSecret } = require('./private-store');

const GENRES = {
  action: 28, animation: 16, comedy: 35, crime: 80, documentary: 99,
  drama: 18, family: 10751, fantasy: 14, horror: 27, mystery: 9648,
  romance: 10749, 'science fiction': 878, 'sci-fi': 878, thriller: 53
};
const COUNTRIES = { indonesia: 'ID', indonesian: 'ID', korea: 'KR', korean: 'KR', japan: 'JP', japanese: 'JP', india: 'IN', indian: 'IN', france: 'FR', french: 'FR' };
const LANGUAGES = { indonesian: 'id', korean: 'ko', japanese: 'ja', hindi: 'hi', french: 'fr', spanish: 'es' };

function imageUrl(file, size = 'w1280') {
  return file ? `https://image.tmdb.org/t/p/${size}${file}` : '';
}

function selectLogo(logos = []) {
  return logos.filter(logo => logo && logo.file_path).sort((left, right) => {
    const score = logo => (logo.iso_639_1 === 'en' ? 1000 : logo.iso_639_1 == null ? 500 : 0)
      + Math.min(250, Number(logo.vote_count || 0) * 8)
      + Number(logo.vote_average || 0) * 10
      + Math.min(120, Number(logo.width || 0) / 20);
    return score(right) - score(left);
  })[0] || null;
}

function normalize(item, fallbackType = 'movie') {
  if (!item || !Number.isFinite(Number(item.id))) return null;
  const mediaType = item.media_type === 'tv' || item.first_air_date || item.name ? 'tv' : item.media_type === 'movie' ? 'movie' : fallbackType;
  const title = String(item.title || item.name || '').trim();
  if (!title) return null;
  const date = item.release_date || item.first_air_date || '';
  return {
    ref: `${mediaType}:${Number(item.id)}`,
    id: Number(item.id), mediaType, title,
    overview: String(item.overview || '').trim().slice(0, 640),
    year: /^\d{4}/.test(date) ? date.slice(0, 4) : '',
    rating: Number(item.vote_average || 0),
    backdrop: imageUrl(item.backdrop_path, 'w1280'),
    poster: imageUrl(item.poster_path, 'w500'),
    logo: '', logoChecked: false,
    popularity: Number(item.popularity || 0),
    url: `https://www.movy.sx/${mediaType}/${Number(item.id)}?play=true`
  };
}

function parseRef(ref) {
  const match = /^(movie|tv):(\d+)$/.exec(String(ref || ''));
  return match ? { mediaType: match[1], id: Number(match[2]) } : null;
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

class Catalog extends EventEmitter {
  constructor({ root, fetchImpl = global.fetch, cacheHours = 6, secretFile, cacheFile } = {}) {
    super();
    this.root = root || path.join(__dirname, '..');
    this.fetch = fetchImpl;
    this.cacheHours = cacheHours;
    this.secretFile = secretFile || path.join(this.root, 'cache', 'private', 'tmdb.json');
    this.cacheFile = cacheFile || path.join(this.root, 'cache', 'catalog', 'home.json');
    this.state = { status: 'loading', error: '', updatedAt: 0, featured: [] };
    this.token = '';
  }

  async init() {
    this._readCache();
    this.token = process.env.TMDB_API_READ_TOKEN || '';
    if (!this.token) {
      try { this.token = String((await readSecret(this.secretFile)).token || ''); } catch { /* configured later */ }
    }
    if (!this.token) {
      this.state.status = this.state.featured.length ? 'cached' : 'unconfigured';
      this.state.error = this.state.featured.length ? '' : 'TMDB is not configured';
      this.emit('change');
      return this.publicState();
    }
    const age = Date.now() - this.state.updatedAt;
    const legacyCache = this.state.featured.some(item => item.logoChecked !== true);
    if (!this.state.featured.length || age > this.cacheHours * 3600000 || legacyCache) await this.refresh().catch(() => {});
    else this.state.status = 'ready';
    this.emit('change');
    return this.publicState();
  }

  _readCache() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      this.state = { status: 'cached', error: '', updatedAt: Number(saved.updatedAt) || 0, featured: Array.isArray(saved.featured) ? saved.featured : [] };
    } catch { /* first run */ }
  }

  publicState() { return { ...this.state, featured: this.state.featured.slice(0, 18) }; }

  async request(route, params = {}) {
    if (!this.token) throw new Error('TMDB is not configured');
    const url = new URL(`https://api.themoviedb.org/3/${route}`);
    const language = Object.hasOwn(params, 'language') ? params.language : 'en-US';
    if (language) url.searchParams.set('language', String(language));
    for (const [key, value] of Object.entries(params)) if (key !== 'language' && value !== '' && value != null) url.searchParams.set(key, String(value));
    const response = await this.fetch(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`TMDB returned ${response.status}`);
    return response.json();
  }

  async enrichLogos(items, concurrency = 4) {
    const queue = items.slice();
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift();
        try {
          const images = await this.request(`${item.mediaType}/${item.id}/images`, { language: '', include_image_language: 'en,null' });
          const selected = selectLogo(images.logos);
          item.logo = selected ? imageUrl(selected.file_path, 'w500') : '';
        } catch { item.logo = ''; }
        item.logoChecked = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, queue.length)) }, worker));
    return items;
  }

  async refresh() {
    this.state.status = 'refreshing'; this.state.error = ''; this.emit('change');
    try {
      const data = await this.request('trending/all/week');
      const seen = new Set();
      const featured = (data.results || []).map(item => normalize(item)).filter(item => item && item.backdrop && !seen.has(item.ref) && seen.add(item.ref)).slice(0, 18);
      if (!featured.length) throw new Error('TMDB returned no usable titles');
      await this.enrichLogos(featured);
      this.state = { status: 'ready', error: '', updatedAt: Date.now(), featured };
      atomicWrite(this.cacheFile, { updatedAt: this.state.updatedAt, featured });
    } catch (error) {
      this.state.status = this.state.featured.length ? 'cached' : 'error';
      this.state.error = error.message;
      throw error;
    } finally { this.emit('change'); }
    return this.publicState();
  }

  async detail(ref) {
    const parsed = parseRef(ref);
    if (!parsed) return null;
    const cached = this.state.featured.find(item => item.ref === ref);
    if (cached) return cached;
    return normalize(await this.request(`${parsed.mediaType}/${parsed.id}`), parsed.mediaType);
  }

  async search(query, mediaType = 'multi') {
    const data = await this.request(`search/${mediaType}`, { query: String(query || '').slice(0, 120), include_adult: false, page: 1 });
    return (data.results || []).map(item => normalize(item, mediaType === 'tv' ? 'tv' : 'movie')).filter(Boolean).slice(0, 18);
  }

  async discover({ genre = '', country = '', language = '', mediaType = 'movie' } = {}) {
    const genreId = GENRES[String(genre).toLowerCase()] || '';
    const countryCode = COUNTRIES[String(country).toLowerCase()] || String(country || '').toUpperCase();
    const languageCode = LANGUAGES[String(language).toLowerCase()] || String(language || '').toLowerCase();
    const data = await this.request(`discover/${mediaType === 'tv' ? 'tv' : 'movie'}`, {
      sort_by: 'popularity.desc', include_adult: false, page: 1,
      with_genres: genreId, with_origin_country: countryCode, with_original_language: languageCode
    });
    return (data.results || []).map(item => normalize(item, mediaType)).filter(Boolean).slice(0, 18);
  }
}

module.exports = { Catalog, normalize, parseRef, selectLogo, GENRES, COUNTRIES, LANGUAGES };

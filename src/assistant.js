'use strict';
const { GENRES, COUNTRIES, LANGUAGES } = require('./catalog');

const WAKE = /^(?:(?:hey|yo|okay)\s+)?(?:jarvis|lumen)[,\s:]*/i;
function stripWake(text) { return String(text || '').trim().replace(WAKE, '').trim(); }
function findKey(text, table) { return Object.keys(table).sort((a, b) => b.length - a.length).find(key => new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) || ''; }

function parseIntent(raw) {
  const text = stripWake(raw);
  const lower = text.toLowerCase();
  if (!text) return { type: 'help' };
  const continueMatch = lower.match(/\b(?:continue|resume|pick up)\b(?:\s+(?:our|my|the))?\s*(.*?)(?:\s+(?:episode|show|movie))?$/i);
  if (continueMatch) return { type: 'continue', query: continueMatch[1].trim() };
  if (/\b(?:youtube|you tube|yt)\b/.test(lower)) {
    const creator = text.replace(/\b(?:did|has|have|please|can you|anything|something|new|latest|recent|upload(?:ed)?|put|post(?:ed)?|on|youtube|you tube|yt|search|find|open|from)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return { type: 'youtube', query: creator || text };
  }
  if (/\b(?:watch|recommend|suggest|feel like|show me|find me|movie|movies|series|show)\b/.test(lower)) {
    const genre = findKey(lower, GENRES);
    const country = findKey(lower, COUNTRIES);
    const language = findKey(lower, LANGUAGES);
    return { type: 'recommend', genre, country, language, mediaType: /\b(series|show|tv)\b/.test(lower) ? 'tv' : 'movie', query: text };
  }
  const app = ['movy', 'jojo', 'netflix', 'youtube', 'prime', 'disney', 'hbo', 'peacock'].find(name => new RegExp(`\\b${name}\\b`, 'i').test(lower));
  if (app && /\b(open|launch|start)\b/.test(lower)) return { type: 'app', app };
  return { type: 'search', query: text };
}

class AssistantEngine {
  // apps: the tiles Lumen actually has, so Jarvis never promises to open one that is not installed.
  constructor({ catalog, history, apps = null }) { this.catalog = catalog; this.history = history; this.apps = apps; }
  async resolve(text) {
    const intent = parseIntent(text);
    if (intent.type === 'continue') {
      const item = this.history.find(intent.query) || (!intent.query ? this.history.publicItems(1)[0] : null);
      return item ? { intent, action: 'resume', item, message: `Continuing ${item.series || item.title}.` } : { intent, message: `I couldn't find ${intent.query || 'anything'} in Continue Watching.` };
    }
    if (intent.type === 'recommend') {
      const items = await this.catalog.discover(intent);
      const description = [intent.genre, intent.country || intent.language].filter(Boolean).join(' ');
      return { intent, action: 'recommend', items, message: items.length ? `Here are ${description || 'some'} ${intent.mediaType === 'tv' ? 'shows' : 'movies'}.` : `I couldn't find a good match.` };
    }
    if (intent.type === 'youtube') {
      const query = intent.query || 'latest videos';
      // The YouTube tile runs the TV layout, which shows a blank page for desktop search links.
      return { intent, action: 'url', url: `https://www.youtube.com/tv#/search?q=${encodeURIComponent(query)}`, tileId: 'youtube', message: `Here are YouTube results for ${query}.` };
    }
    if (intent.type === 'app') {
      const apps = typeof this.apps === 'function' ? this.apps() : this.apps;
      const tile = Array.isArray(apps) ? apps.find(item => item.id === intent.app) : { id: intent.app, name: intent.app };
      if (!tile) return { intent, message: `${intent.app.charAt(0).toUpperCase()}${intent.app.slice(1)} isn't one of your Lumen apps yet.` };
      return { intent, action: 'app', tileId: tile.id, message: `Opening ${tile.name || tile.id}.` };
    }
    if (intent.type === 'search') {
      const items = await this.catalog.search(intent.query);
      return { intent, action: 'recommend', items, message: items.length ? `I found these matches.` : `I couldn't find that title.` };
    }
    return { intent, message: 'Try asking for a genre, a YouTube creator, or something from Continue Watching.' };
  }
}

module.exports = { AssistantEngine, parseIntent, stripWake, WAKE };

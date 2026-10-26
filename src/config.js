'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(ROOT, 'settings.json');
const TILES_PATH = path.join(ROOT, 'tiles.json');

const DEFAULT_SETTINGS = {
  // Phone-first by default: Lumen waits in the tray until the user taps Start on the remote.
  autoTvMode: false,
  // Keep the remote server available after signing in to Windows.
  runAtStartup: true,
  // Text matched (case-insensitive) against the monitor name Windows reports. "Y9" is the projector.
  // Leave empty to treat any non-built-in, non-primary display as the projector.
  projector: { match: 'Y9' },
  // If Windows mirrors the projector, switch to "Extend" so the TV UI only appears on the projector.
  forceExtend: true,
  audio: {
    // Make the projector the default sound output while in TV mode, then restore it on exit.
    switchToProjector: true,
    // Part of the sound device name to use. Empty = try the projector name, then anything HDMI-ish.
    deviceMatch: '',
    volumeAutoHide: true
  },
  // Works from anywhere, including inside a fullscreen movie. Alt+Home is the browser "home" key.
  homeHotkeys: ['Ctrl+Shift+H', 'Alt+Home'],
  remote: { host: '0.0.0.0', port: 4321, token: '', projectorWaitSeconds: 18 },
  browser: { path: '', debugPort: 9333 },
  // When the sleep timer ends: pause, close the app, leave TV mode, and (optionally) cut the signal
  // so the projector can go to standby by itself.
  sleepTimer: { turnOffProjector: true },
  // Download each tile's site icon once (from Google's favicon service) to make the tiles prettier.
  fetchIcons: true
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

function loadSettings() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    // first run, or unreadable file: fall back to defaults
  }
  const settings = merge(DEFAULT_SETTINGS, stored);
  if (!settings.remote.token) {
    settings.remote.token = crypto.randomBytes(9).toString('base64url');
  }
  saveSettings(settings);
  return settings;
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

function loadTiles() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(TILES_PATH, 'utf8'));
  } catch (err) {
    console.error('tiles.json is missing or invalid:', err.message);
    return [];
  }
  const seen = new Set();
  return raw
    .filter((t) => t && t.id && t.name && (t.url || t.exe) && !seen.has(t.id) && seen.add(t.id))
    .map((t) => ({ accent: '#7c8cff', desc: '', ...t }));
}

module.exports = { ROOT, loadSettings, saveSettings, loadTiles, DEFAULT_SETTINGS };

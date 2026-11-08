'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { paletteFromPixels } = require('../ui/ambience');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('home exposes only the intentional apps', () => {
  const tiles = JSON.parse(read('tiles.json'));
  assert.deepEqual(tiles.map(tile => tile.id), ['jojo', 'movy', 'youtube', 'peacock']);
});

test('home uses a calm hearth layer without the superhero HUD', () => {
  const html = read('ui/index.html');
  const css = read('ui/style.css');
  const remote = read('remote/index.html');
  assert.match(html, /<canvas class="hearth" id="hearth"/);
  assert.match(html, /class="projector-surface" id="projectorSurface"/);
  assert.match(html, /<button[^>]+class="status-chip"[^>]+id="chip"/);
  assert.match(html, /id="pairing" role="dialog" aria-modal="true"/);
  assert.match(html, /id="heroLogo"/);
  assert.ok(html.indexOf('ambience.js') < html.indexOf('app.js'), 'ambience must load before the launcher');
  assert.doesNotMatch(html, /<footer/);
  for (const obsolete of ['class="hud"', 'class="reactor"', 'ARC LINK', 'id="systemLine"']) assert.doesNotMatch(html, new RegExp(obsolete));
  assert.doesNotMatch(remote, /class="reactor"/);
  assert.doesNotMatch(css, /\.hud|\.reactor|\.dock:after|jet-active/);
  assert.match(css, /\.hearth/);
});

test('movie art drives both the hero and its fireplace palette', () => {
  const source = read('ui/app.js');
  assert.match(source, /data\.backdrop\|\|data\.artwork\|\|data\.poster/);
  assert.match(source, /const title=data\.title\|\|data\.series\|\|fallbackHero\.title/);
  assert.match(source, /lumenHearth\?\.setArtwork\(next\)/);
  assert.match(source, /logoUrl=data\.logo\|\|''/);
  assert.match(source, /image:tile\.icon/);
  assert.match(source, /rowKind==='dock'.*app-icon/);
  assert.match(source, /applyProjectorLayout\(state\.halo\)/);
  assert.match(source, /surface\.style\.transform=css/);
  assert.match(source, /\$\('chip'\)\.addEventListener\('click',openPairing\)/);
  assert.match(read('ui/halo.js'), /state\.maskOutside/);
  assert.match(read('src/browser.js'), /clip-path:inset\(0\).*contain:paint/);
  assert.doesNotMatch(source, /jet-active|systemLine/);

  const blue = new Uint8ClampedArray(8 * 4);
  const amber = new Uint8ClampedArray(8 * 4);
  for (let index = 0; index < 8; index += 1) {
    blue.set([25, 95, 220, 255], index * 4);
    amber.set([218, 78, 24, 255], index * 4);
  }
  assert.notDeepEqual(paletteFromPixels(blue, 4, 2), paletteFromPixels(amber, 4, 2));
});

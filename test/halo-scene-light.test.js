'use strict';
// Runs the real ui/halo.js renderer against a scripted screen capture. Synthetic only: no window, no display.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const lightApi = require('../ui/halo-light');

const ACCENT = '#f5b82e';
const POINTS = [{ x: 150, y: 90 }, { x: 1770, y: 90 }, { x: 1770, y: 990 }, { x: 150, y: 990 }];

async function loadHalo() {
  const drawn = { stroke: 0, drawImage: 0 };
  const statuses = [];
  let frame = [0, 0, 0];
  let handler = null;
  let next = null;
  let clock = 1000;
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({ drawImage: () => { drawn.drawImage++; }, stroke: () => { drawn.stroke++; }, createLinearGradient: () => gradient,
    getImageData: () => { const data = new Uint8ClampedArray(192 * 108 * 4); for (let i = 0; i < data.length; i += 4) { data[i] = frame[0]; data[i + 1] = frame[1]; data[i + 2] = frame[2]; data[i + 3] = 255; } return { data }; } },
  { get: (target, key) => (key in target ? target[key] : () => {}), set: (target, key, value) => { target[key] = value; return true; } });
  const canvasStub = () => ({ width: 0, height: 0, getContext: () => ctx });
  const video = { readyState: 4, play: async () => {}, pause() {}, requestVideoFrameCallback: callback => { next = callback; } };
  const sandbox = {
    document: { getElementById: canvasStub, createElement: tag => (tag === 'video' ? video : canvasStub()) },
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1, performance: { now: () => clock },
    setTimeout, console, Uint8ClampedArray
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.lumenHaloLight = lightApi;
  sandbox.lumenHalo = { onState: fn => { handler = fn; }, onStop() {}, publishStatus: status => statuses.push(status) };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui', 'halo.js'), 'utf8'), sandbox, { filename: 'ui/halo.js' });
  handler({ enabled: true, guide: false, intensity: .5, color: ACCENT, points: POINTS, zones: [], captureSourceId: 'screen:1', maskOutside: true });
  await new Promise(resolve => setImmediate(resolve));
  const read = expression => vm.runInContext(expression, sandbox);
  async function play(rgb, frames) {
    frame = rgb;
    for (let i = 0; i < frames; i++) { clock += 40; const callback = next; next = null; callback?.(clock); }
  }
  return { play, read, drawn, statuses };
}

const BRIGHT = [190, 170, 150];
const BLACK = [4, 4, 6];
const DIM_PURPLE_NOISE = [20, 10, 30];

test('light follows scene brightness: quick to rise, off at dark', () => {
  assert.equal(lightApi.lightTarget(0), 0);
  assert.equal(lightApi.lightTarget(lightApi.DARK_FLOOR), 0);
  assert.equal(lightApi.lightTarget(lightApi.BRIGHT_FULL), 1);
  assert.ok(lightApi.lightTarget(38) > .3 && lightApi.lightTarget(38) < .7);
  assert.ok(lightApi.followLight(0, 1) - 0 > 1 - lightApi.followLight(1, 0), 'rises faster than it falls');
  assert.ok(lightApi.followLight(1, 0) > .8, 'falls gently, one step at a time');
});

test('a dark scene fades the Halo out instead of switching to the app colour', async () => {
  const halo = await loadHalo();
  await halo.play(BRIGHT, 20);
  assert.ok(halo.read('sceneLight') > .95, 'bright scene shows the full Halo');
  assert.ok(halo.drawn.stroke > 0);
  await halo.play(BLACK, 60);
  assert.ok(halo.read('sceneLight') < .02, 'dark scene removes the Halo');
  assert.ok(!halo.statuses.some(status => status.status === 'fallback'), 'never falls back to the accent colour');
  assert.equal(halo.read('liveZones').length, 36, 'keeps the last picture colours, not the accent');
  const before = halo.drawn.stroke;
  await halo.play(BLACK, 5);
  assert.equal(halo.drawn.stroke, before, 'nothing is drawn while the scene is dark');
  await halo.play(BRIGHT, 20);
  assert.ok(halo.read('sceneLight') > .95, 'the Halo returns on the next bright scene');
});

test('a dim, noisy scene with a colour cast stays dark rather than glowing pink or purple', async () => {
  const halo = await loadHalo();
  await halo.play(BRIGHT, 20);
  await halo.play(DIM_PURPLE_NOISE, 60);
  assert.ok(halo.read('sceneLight') < .02);
});

test('protected video that never shows a picture still gets the app colour, after a few seconds', async () => {
  const halo = await loadHalo();
  await halo.play(BLACK, lightApi.FALLBACK_AFTER - 10);
  assert.ok(!halo.statuses.some(status => status.status === 'fallback'), 'an opening black is not mistaken for protected video');
  assert.ok(halo.read('sceneLight') < .02);
  await halo.play(BLACK, 80);
  assert.ok(halo.statuses.some(status => status.status === 'fallback'));
  assert.ok(halo.read('sceneLight') > .9, 'the app colour is shown for protected video');
});

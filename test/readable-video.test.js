'use strict';
// Real headless Edge: a tile with readableVideo plays DRM through the software Widevine path (which the Halo can
// capture); every other tile keeps hardware PlayReady. Switching tiles restarts Edge so each gets its own setting.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { TvBrowser, findEdge } = require('../src/browser');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
// evaluate() does not wait for promises, so the page stores its answer and the test polls for it.
const KEY_SYSTEMS = `window.__keys = null; (async () => {
  const cfg = [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"' }], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }];
  const has = async key => { try { await navigator.requestMediaKeySystemAccess(key, cfg); return true; } catch { return false; } };
  window.__keys = { widevine: await has('com.widevine.alpha'), playready: await has('com.microsoft.playready') };
})(); 0`;

test('readableVideo tiles get software DRM and other tiles keep hardware PlayReady', { skip: !findEdge(), timeout: 120000 }, async t => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>DRM fixture</title><body>fixture</body>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-browser-test-'));
  const browser = new TvBrowser({ debugPort: await freePort(), profileDir: root, headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const plain = { id: 'plain', name: 'Plain', url };
  const readable = { id: 'readable', name: 'Readable', url, readableVideo: true };
  async function keySystems(tile) {
    await browser.open(tile);
    for (let i = 0; i < 60 && (await browser.evaluate('document.readyState')) !== 'complete'; i++) await delay(100);
    // A fresh profile can answer before Widevine has registered (slow under load), so ask again until it is there.
    let keys = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      await browser.evaluate(KEY_SYSTEMS);
      for (let i = 0; i < 50 && !(keys = await browser.evaluate('window.__keys')); i++) await delay(100);
      if (keys && keys.widevine) return keys;
      await delay(500);
    }
    return keys;
  }

  const before = await keySystems(plain);
  assert.equal(before.widevine, true);
  assert.equal(before.playready, true, 'an ordinary tile keeps PlayReady');
  assert.equal(browser.edgeReadable, false);

  const during = await keySystems(readable);
  assert.equal(during.widevine, true, 'Widevine still plays the service');
  assert.equal(during.playready, false, 'PlayReady is off so the picture is not hardware-protected');
  assert.equal(browser.edgeReadable, true);

  const edgePid = await browser.pid();
  assert.ok(edgePid);
  const again = await keySystems(readable);
  assert.equal(again.playready, false);
  assert.equal(await browser.pid(), edgePid, 'reopening the same tile keeps the running Edge');

  const after = await keySystems(plain);
  assert.equal(after.playready, true, 'leaving a readable tile restores PlayReady for the next one');
});

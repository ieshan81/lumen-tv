'use strict';
// Real headless Edge: a website fitted into the calibrated screen frame must stay inside it through page loads,
// scrolling and fullscreen. Each of these used to let the picture spill under the Halo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { TvBrowser, findEdge } = require('../src/browser');
const { layoutBox, projectorLayoutScript } = require('../src/projector-layout');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const FRAME = { enabled: true, points: [{ x: .13, y: .125 }, { x: .875, y: .135 }, { x: .875, y: .8725 }, { x: .12, y: .8675 }] };
const rectOf = selector => `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`;

test('layout helpers describe the frame', () => {
  assert.deepEqual(layoutBox(null, 1000, 500), { left: 0, top: 0, right: 1000, bottom: 500 });
  const box = layoutBox(FRAME, 1000, 1000);
  assert.deepEqual([box.left, box.top, box.right, box.bottom].map(Math.round), [120, 125, 875, 873]);
  assert.match(projectorLayoutScript(null), /\)\(null\)$/);
  assert.match(projectorLayoutScript({ enabled: false, points: FRAME.points }), /\)\(null\)$/, 'a disabled Halo releases the page');
});

test('a fitted website stays inside the screen frame', { skip: !findEdge(), timeout: 120000 }, async t => {
  const server = http.createServer((req, res) => {
    const headers = { 'content-type': 'text/html' };
    // A strict style policy must not be able to switch the fit off.
    if (req.url.startsWith('/strict')) headers['content-security-policy'] = "default-src 'self'; style-src 'self'";
    res.writeHead(200, headers);
    if (req.url.startsWith('/frame')) return res.end('<!doctype html><body style="margin:0;background:#024"><div id="inner" style="height:100vh;background:#0a0">player</div></body>');
    res.end(`<!doctype html><title>${req.url}</title><body>
      <div id="header" style="position:fixed;top:0;left:0;right:0;height:40px;background:blue">header</div>
      <div id="player" style="width:640px;height:360px;background:red">player</div>
      <iframe id="same" src="/frame" style="width:320px;height:180px;border:0"></iframe>
      <iframe id="embed" allowfullscreen src="http://localhost:${server.address().port}/frame" style="width:320px;height:180px;border:0"></iframe>
      <div style="height:4000px">tall page</div></body>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-browser-test-'));
  const browser = new TvBrowser({ debugPort: await freePort(), profileDir: root, headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = (expression, session = browser.pageSession) => browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, session).then(r => r.result?.value);
  const loaded = async () => { for (let i = 0; i < 80 && (await run('document.readyState')) !== 'complete'; i++) await delay(100); };
  const inside = (rect, box, label) => {
    for (const [side, sign] of [['left', 1], ['top', 1], ['right', -1], ['bottom', -1]]) {
      assert.ok((rect[side] - box[side]) * sign > -2, `${label}: ${side} edge ${rect[side].toFixed(1)} leaves the frame (${box[side].toFixed(1)})`);
    }
  };

  await browser.open({ id: 'plain', name: 'Plain', url: `${base}/one` }, null, { layout: FRAME });
  await loaded();
  const view = await run('({ w: innerWidth, h: innerHeight })');
  const box = layoutBox(FRAME, view.w, view.h);

  await t.test('the page is warped onto the frame', async () => {
    const html = await run(rectOf('html'));
    inside(html, box, 'page');
    assert.ok(Math.abs(html.left - box.left) < 2 && Math.abs(html.bottom - box.bottom) < 2, 'the page fills the frame');
    assert.equal(await run('document.elementFromPoint(3, 3) === document.documentElement'), true, 'nothing is drawn outside the frame');
  });

  await t.test('the fit survives loading another page', async () => {
    await browser.cdp.send('Page.navigate', { url: `${base}/two` }, browser.pageSession);
    await delay(300);
    await loaded();
    assert.equal(await run('document.title'), '/two');
    inside(await run(rectOf('html')), box, 'page after navigation');
    assert.ok((await run(rectOf('#player'))).left >= box.left - 2);
  });

  await t.test('a strict style policy cannot switch the fit off', async () => {
    await browser.cdp.send('Page.navigate', { url: `${base}/strict` }, browser.pageSession);
    await delay(300);
    await loaded();
    inside(await run(rectOf('html')), box, 'page with a style CSP');
    await browser.cdp.send('Page.navigate', { url: `${base}/two` }, browser.pageSession);
    await delay(300);
    await loaded();
  });

  await t.test('frames inside the page are not shrunk a second time', async () => {
    assert.equal(await run('getComputedStyle(document.querySelector("#same").contentDocument.documentElement).transform'), 'none');
  });

  await t.test('the page scrolls, and scripts that watch the window still see it', async () => {
    await run('window.__scrolls = 0; window.addEventListener("scroll", () => window.__scrolls++); 0');
    await browser.scroll(5);
    await delay(500);
    const wheel = await run('({ y: scrollY, page: pageYOffset, root: document.documentElement.scrollTop, events: window.__scrolls, scroller: document.scrollingElement === document.body })');
    assert.ok(wheel.y > 300, `the wheel moved the page (${wheel.y})`);
    assert.equal(wheel.page, wheel.y);
    assert.equal(wheel.root, wheel.y);
    assert.ok(wheel.events > 0, 'window scroll listeners fire');
    assert.equal(wheel.scroller, true);
    const header = await run(rectOf('#header'));
    assert.ok(Math.abs(header.top - (await run(rectOf('html'))).top) < 2, 'a fixed header stays at the top of the frame');
    await run('window.scrollTo(0, 0); 0');
    assert.equal(await run('scrollY'), 0);
    await browser.key('PageDown');
    await delay(700);
    assert.ok(await run('scrollY') > 100, 'keyboard scrolling works with nothing focused');
    await run('window.scrollTo(0, 0); 0');
  });

  await t.test('a fullscreen player lands inside the frame', async () => {
    assert.equal(await run('document.querySelector("#player").requestFullscreen().then(() => "ok", e => String(e))'), 'ok');
    await delay(400);
    const player = await run(rectOf('#player'));
    inside(player, box, 'fullscreen player');
    assert.ok(player.right - player.left > (box.right - box.left) - 4, 'and fills it');
    await run('document.exitFullscreen()');
    await delay(300);
  });

  await t.test('a player that goes fullscreen from inside an embedded frame lands inside the frame', async () => {
    for (let i = 0; i < 50 && !browser.frameSessions.size; i++) await delay(100);
    const frame = [...browser.frameSessions][0];
    assert.ok(frame, 'the embedded frame has its own session');
    assert.equal(await run('document.querySelector("#inner").requestFullscreen().then(() => "ok", e => String(e))', frame), 'ok');
    await delay(400);
    assert.equal(await run('document.fullscreenElement && document.fullscreenElement.id'), 'embed');
    inside(await run(rectOf('#embed')), box, 'fullscreen embed');
    await run('document.exitFullscreen()', frame);
    await delay(300);
  });

  await t.test('the virtual mouse stays in the frame and its dot is drawn where the click lands', async () => {
    browser.pointerMove(-5000, -5000);
    await delay(400);
    assert.ok(browser.pointer.x >= box.left && browser.pointer.y >= box.top, 'the pointer cannot leave the frame');
    assert.ok(browser.pointer.x < box.left + 2 && browser.pointer.y < box.top + 2);
    browser.pointerMove(200, 150);
    await delay(400);
    const dot = await run('(() => { const r = document.querySelector("#__lumen_cursor").getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; })()');
    assert.ok(Math.abs(dot.x - browser.pointer.x) < 1.5 && Math.abs(dot.y - browser.pointer.y) < 1.5, `dot ${JSON.stringify(dot)} vs pointer ${JSON.stringify(browser.pointer)}`);
    await run('window.__hit = null; document.addEventListener("mousedown", e => { window.__hit = { x: e.clientX, y: e.clientY }; }, true); 0');
    await browser.click();
    const hit = await run('window.__hit');
    assert.ok(hit && Math.abs(hit.x - dot.x) < 1.5 && Math.abs(hit.y - dot.y) < 1.5, 'the click lands under the dot');
  });

  await t.test('turning the Halo off gives the page the whole projector back', async () => {
    await browser.setProjectorLayout(null);
    const html = await run(rectOf('html'));
    // The window's own scrollbar is back, so the page is a scrollbar narrower than the viewport.
    assert.ok(html.left === 0 && html.top === 0 && view.w - html.right < 30, JSON.stringify(html));
    await run('window.scrollTo(0, 240); 0');
    assert.equal(await run('document.body.scrollTop'), 0, 'the window scrolls natively again');
    assert.equal(await run('scrollY'), 240);
  });
});

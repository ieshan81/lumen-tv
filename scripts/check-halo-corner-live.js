'use strict';
// Live acceptance check: a real four-corner nudge must update and restore the
// saved point without ever taking the projector browser out of fullscreen.
const fs = require('fs');
const WebSocket = require('ws');
const { Cdp } = require('../src/browser');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const settings = JSON.parse(fs.readFileSync(require.resolve('../settings.json'), 'utf8'));
  const [version, targets] = await Promise.all([
    fetch('http://127.0.0.1:9333/json/version').then(response => response.json()),
    fetch('http://127.0.0.1:9333/json/list').then(response => response.json())
  ]);
  const target = targets.find(item => item.type === 'page' && !item.url.startsWith('edge://'));
  if (!target) throw new Error('No active Lumen browser page is available.');
  const browser = new Cdp(version.webSocketDebuggerUrl);
  await browser.connect();
  const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: target.id });
  const socket = new WebSocket(`ws://127.0.0.1:${settings.remote.port}/ws?t=${encodeURIComponent(settings.remote.token)}`);
  let latest = null;
  const waiters = [];
  socket.on('message', data => {
    let value;
    try { value = JSON.parse(data); } catch { return; }
    if (value.t !== 'state') return;
    latest = value;
    for (const waiter of [...waiters]) if (waiter.predicate(value)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(value); }
  });
  const state = (predicate, timeout = 5000) => new Promise((resolve, reject) => {
    if (latest && predicate(latest)) return resolve(latest);
    const waiter = { predicate, resolve };
    waiters.push(waiter);
    setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error('Lumen did not confirm the corner adjustment.'));
    }, timeout);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const initial = await state(value => value.mode === 'app' && value.halo?.enabled && value.halo.points?.length === 4);
  const original = initial.halo.points[0];
  const originalGuide = initial.halo.guide;
  const observed = [];
  let polling = true;
  const poll = (async () => {
    while (polling) {
      observed.push((await browser.send('Browser.getWindowBounds', { windowId })).bounds.windowState);
      await wait(12);
    }
  })();
  try {
    socket.send(JSON.stringify({ t:'halo', action:'nudge', point:0, dx:.0025, dy:0 }));
    await state(value => Math.abs(value.halo?.points?.[0]?.x - (original.x + .0025)) < 1e-9);
    socket.send(JSON.stringify({ t:'halo', action:'nudge', point:0, dx:-.0025, dy:0 }));
    await state(value => Math.abs(value.halo?.points?.[0]?.x - original.x) < 1e-9);
    if (!originalGuide) {
      socket.send(JSON.stringify({ t:'halo', action:'guide' }));
      await state(value => value.halo?.guide === false);
    }
    await wait(300);
  } finally {
    polling = false;
    await poll;
    socket.close();
    browser.close();
  }
  const bad = observed.filter(value => value !== 'fullscreen');
  const result = { samples: observed.length, states: [...new Set(observed)], pointRestored: Math.abs(latest.halo.points[0].x - original.x) < 1e-9, guideRestored: latest.halo.guide === originalGuide };
  console.log(JSON.stringify(result, null, 2));
  if (bad.length || !result.pointRestored || !result.guideRestored) throw new Error('Corner adjustment interrupted projector fullscreen or failed to restore test state.');
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });

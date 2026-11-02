'use strict';
// Live diagnostic: changes a fullscreen test page from red to blue and measures
// how quickly the real Y9 Halo renderer follows it. Start Lumen for this
// diagnostic with: electron . --remote-debugging-port=9334
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const { Cdp } = require('../src/browser');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function openWebTile() {
  const settings = JSON.parse(fs.readFileSync(require.resolve('../settings.json'), 'utf8'));
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${settings.remote.port}/ws?t=${encodeURIComponent(settings.remote.token)}`);
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('Lumen remote did not open the diagnostic Web tile.')); }, 5000);
    socket.once('open', () => socket.send(JSON.stringify({ t: 'launch', id: 'web' })));
    socket.on('message', data => {
      const state = JSON.parse(data);
      if (state.t !== 'state' || state.mode !== 'app' || state.running?.tileId !== 'web') return;
      clearTimeout(timer); socket.close(); resolve();
    });
    socket.once('error', reject);
  });
}

async function pixel(halo, x, y) {
  const result = await halo.send('Runtime.evaluate', {
    expression:`(() => {const c=document.querySelector('#halo'),d=c.getContext('2d').getImageData(${x},${y},1,1).data;return{r:d[0],g:d[1],b:d[2],a:d[3]}})()`,
    returnByValue:true
  });
  return result.result.value;
}

async function run() {
  // Put Lumen into its unrestricted Web tile before navigating to the local
  // fixture. Opening the tile after navigation would replace the fixture with
  // the tile's home URL and invalidate every latency sample.
  await openWebTile();
  const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const target = targets.find(item => item.type === 'page' && !item.url.startsWith('edge://'));
  if (!target) throw new Error('Open a Lumen web app before measuring Halo latency.');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.connect();
  let haloTargets;
  try { haloTargets = await (await fetch('http://127.0.0.1:9334/json/list')).json(); }
  catch { throw new Error('Start Lumen with --remote-debugging-port=9334 for the protected Halo diagnostic.'); }
  const haloTarget = haloTargets.find(item => item.title === 'Lumen halo');
  if (!haloTarget) throw new Error('The live Halo renderer is not available on diagnostic port 9334.');
  const halo = new Cdp(haloTarget.webSocketDebuggerUrl);
  await halo.connect();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html><html><head><title>Halo latency fixture</title></head><body style="width:100vw;height:100vh;margin:0;background:#ff0000;overflow:hidden"></body></html>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const samples = [
    { name: 'top', x: 960, y: 105 }, { name: 'right', x: 1810, y: 540 },
    { name: 'bottom', x: 960, y: 970 }, { name: 'left', x: 110, y: 540 }
  ];
  try {
    const page = `http://127.0.0.1:${server.address().port}/`;
    await cdp.send('Page.navigate', { url: page });
    for (let i = 0; i < 80; i++) {
      const ready = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (ready.result?.value === 'complete') break;
      await wait(25);
    }
    // The owning Lumen controller registered the homography at document start,
    // so this local navigation keeps the exact production projector layout.
    await wait(250);
    let chosen = samples[0];
    for (let i = 0; i < 80; i++) {
      await wait(25);
      chosen = await Promise.all(samples.map(async point => ({ ...point, color: await pixel(halo, point.x, point.y) })));
      chosen = chosen
        .sort((a, b) => (b.color.r - Math.max(b.color.g, b.color.b)) - (a.color.r - Math.max(a.color.g, a.color.b)))[0];
      if (chosen.color.r > chosen.color.b + 18) break;
    }
    if (chosen.color.r <= chosen.color.b + 18) throw new Error(`The live red Halo was not visible at the diagnostic points: ${JSON.stringify(chosen)}`);
    const latencies = [], warmup = [];
    let after = chosen.color;
    for (let transition = 0; transition < 12; transition++) {
      const blueTurn = transition % 2 === 0;
      const color = blueTurn ? '#0000ff' : '#ff0000';
      await cdp.send('Runtime.evaluate', { expression: `document.documentElement.style.background='${color}';document.body.style.background='${color}'` });
      const changedAt = performance.now();
      let latency = null;
      for (let i = 0; i < 100; i++) {
        after = await pixel(halo, chosen.x, chosen.y);
        const followed = blueTurn ? after.b > after.r + 12 : after.r > after.b + 12;
        if (followed) { latency = performance.now() - changedAt; break; }
        await wait(10);
      }
      if (latency === null) throw new Error(`Halo missed transition ${transition + 1}: ${JSON.stringify(after)}`);
      (transition < 2 ? warmup : latencies).push(Math.round(latency));
      await wait(80);
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    const rasterEdge = await pixel(halo, 1919, 540);
    if (Math.max(rasterEdge.r, rasterEdge.g, rasterEdge.b) > 16) throw new Error(`Outer feather still reaches the projector edge: ${JSON.stringify(rasterEdge)}`);
    console.log(JSON.stringify({ zone: chosen.name, latencyMs: { warmup, samples: latencies, median: sorted[4], p95: sorted[9] }, before: chosen.color, after, rasterEdge }, null, 2));
  } finally {
    cdp.close();
    halo.close();
    server.close();
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });

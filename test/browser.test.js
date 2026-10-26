'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { TvBrowser, findEdge } = require('../src/browser');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await delay(100); }
  throw new Error(message);
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function wave() {
  const samples = 16000 * 20;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length - 8,4);buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(16000,24);buffer.writeUInt32LE(32000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);
  buffer.write('data',36);buffer.writeUInt32LE(samples * 2,40);
  return buffer;
}

test('play/pause uses exactly one headset media key without sending Space', async () => {
  let keys = 0;
  const browser = new TvBrowser({ debugPort:0, profileDir:os.tmpdir(), mediaKey:() => keys++ });
  browser.mainTargetId = 'fixture';
  browser.bringToFront = async () => {};
  browser.key = async () => { throw new Error('Must not send a text key'); };
  assert.equal(await browser.togglePlay(), 'system-media-key');
  assert.equal(keys,1);
});

test('Edge retains login storage and reports typing and media inside another origin', { skip:!findEdge(), timeout:60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'lumen-browser-test-'));
  const clip = wave();
  const server = http.createServer((req,res) => {
    if (req.url === '/clip.wav') {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]),clip.length-1) : clip.length-1;
      res.writeHead(range?206:200,{'content-type':'audio/wav','accept-ranges':'bytes','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${clip.length}`}:{})});
      res.end(clip.subarray(start,end+1));return;
    }
    res.writeHead(200,{'content-type':'text/html','set-cookie':'lumen_fixture=remembered; Max-Age=3600; HttpOnly; SameSite=Lax'});
    if (req.url.startsWith('/frame')) res.end('<!doctype html><title>Frame</title><label>Password<input type="password" id="secret"></label><video controls muted width="640" height="360" src="/clip.wav"></video>');
    else res.end(`<!doctype html><title>Integration fixture</title><button id="one">One</button><button id="two">Two</button><iframe style="width:700px;height:450px" src="http://localhost:${server.address().port}/frame"></iframe>`);
  });
  await new Promise(resolve => server.listen(0,'0.0.0.0',resolve));
  const browser = new TvBrowser({ debugPort:await freePort(), profileDir:root, headless:true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    // Edge may still flush its profile after its debugging socket closes on Windows.
    // Async retries leave the event loop available while its owned children finish exiting.
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('lumen-browser-test-')) {
      await fs.promises.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});
    }
  });
  const tile = {id:'movy',tvShell:true,lockNavigation:true,name:'Fixture',url:`http://127.0.0.1:${server.address().port}/`,blockPopups:false};
  await browser.open(tile);
  await until(async () => (await browser.evaluate('document.readyState')) === 'complete', 'Fixture did not load');
  // A parent hook that cannot see its embedded player must not swallow media commands.
  await browser.evaluate('window.LumenTV={getState:()=>({page:"browse",duration:0}),togglePlay(){},seekBy(){}}');
  assert.equal(await browser.evaluate('document.documentElement.classList.contains("lumen-tv")'),true);
  assert.equal((await browser.interactionState()).navigation,'dpad');
  await browser.evaluate('localStorage.setItem("login-fixture","retained")');
  await until(async () => browser.contexts.size >= 2, 'Iframe execution context was not discovered');
  assert.ok((await browser.evaluateContexts('window.top!==window && document.documentElement.classList.contains("lumen-tv")')).every(item=>!item.value), 'TV shell must not alter embedded players');
  await until(async () => (await browser.evaluateContexts(`(() => {const field=document.querySelector('#secret'); if(field){field.focus();return true}return false})()`)).some(item=>item.value), 'Iframe form did not load');
  const focused = await until(async () => { const s=await browser.interactionState();return s.input?.type==='password' && s; }, 'Password focus did not reach the remote').catch(async error => {
    console.log('Fixture focus diagnostic:',await browser.evaluateContexts(`({origin:location.origin,focused:document.hasFocus(),active:document.activeElement?.tagName,id:document.activeElement?.id,hasField:!!document.querySelector('#secret'),shell:!!window.__lumenTVNavigation})`));
    throw error;
  });
  assert.equal('value' in focused.input,false);
  assert.equal(await browser.replaceText(focused.input.fieldId,'synthetic-test-password'),true);
  const snapshots = await browser.evaluateContexts(`document.querySelector('#secret')?.value || null`);
  assert.ok(snapshots.some(s=>s.value==='synthetic-test-password'));
  assert.equal(JSON.stringify(await browser.interactionState()).includes('synthetic-test-password'),false);
  assert.equal(await browser.replaceText('stale-field','wrong'),false);
  await browser.evaluateContexts(`(() => {const f=document.querySelector('#secret');if(f)f.addEventListener('keydown',e=>{if(e.key==='Enter')f.dataset.submitted='yes'});})()`);
  await browser.key('Enter');
  assert.ok((await browser.evaluateContexts(`document.querySelector('#secret')?.dataset.submitted`)).some(item=>item.value==='yes'));
  await browser.evaluate('document.querySelector("#one").focus()');
  assert.equal(await browser.replaceText(focused.input.fieldId,'must-not-reach-an-inactive-frame'),false);
  assert.equal((await browser.interactionState()).input,null,'An inactive frame must not keep the phone keyboard open');
  await browser.evaluateContexts(`(() => {const v=document.querySelector('video');if(v){v.play();return true}return false})()`);
  const playing=await until(async()=>{const s=await browser.mediaState();return s?.playing&&s.duration>=19&&s;},'Iframe playback metadata was not detected').catch(async error => {
    console.log('Fixture media diagnostic:', await browser.evaluateContexts(`(() => { const v=document.querySelector('video'); return v?{duration:String(v.duration),time:v.currentTime,ready:v.readyState,network:v.networkState,error:v.error?.message,src:v.currentSrc}:null })()`));
    throw error;
  });
  assert.ok(playing.duration>=19);
  await browser.togglePlay();
  await until(async()=>{const s=await browser.mediaState();return s&&!s.playing;},'Iframe did not pause');
  await browser.seekBy(8);
  assert.ok((await browser.mediaState()).currentTime>=7);
  await browser.open(tile);
  assert.equal(await browser.evaluate('localStorage.getItem("login-fixture")'),'retained');
  await browser.close();
  await browser.open(tile);
  await until(async()=>await browser.evaluate('localStorage.getItem("login-fixture")==="retained"'),'Login storage did not survive browser restart');
  const cookies=await browser.cdp.send('Storage.getCookies');
  assert.ok(cookies.cookies.some(c=>c.name==='lumen_fixture'&&c.value==='remembered'));
});

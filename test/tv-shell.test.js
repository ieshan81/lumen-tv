'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { TvBrowser, findEdge } = require('../src/browser');
const { usesTvShell } = require('../src/tv-shell');
const { allowsNavigation } = require('../src/navigation-policy');
const { loadTiles } = require('../src/config');

async function until(fn, message) {
  const end = Date.now()+10000;
  while (Date.now()<end) { if (await fn()) return; await new Promise(resolve=>setTimeout(resolve,50)); }
  throw new Error(message);
}
async function freePort() {
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

test('Movy and JoJo share opt-in TV navigation; other apps remain unchanged',()=>{
  const tiles=loadTiles();
  const movy=tiles.find(tile=>tile.id==='movy');
  assert.equal(tiles[tiles.findIndex(tile=>tile.id==='jojo')+1].id,'movy');
  assert.equal(movy.url,'https://www.movy.sx/');
  assert.equal(usesTvShell(movy),true);
  assert.equal(usesTvShell(tiles.find(tile=>tile.id==='jojo')),true);
  assert.equal(usesTvShell(tiles.find(tile=>tile.id==='netflix')),false);
  assert.equal(allowsNavigation(movy,'https://movy.sx/browse/movie'),true);
  assert.equal(allowsNavigation(movy,'https://www.movy.sx/tv/123'),true);
  for (const url of ['https://www.movy.sx.evil.example/','https://unrelated.example/?next=https://www.movy.sx/','http://www.movy.sx/','javascript:alert(1)']) assert.equal(allowsNavigation(movy,url),false,url);
  assert.equal(allowsNavigation({url:'https://www.google.com/'},'https://unrelated.example/'),true);
});

test('TV rails, modal focus, search Back, remote focus labels and redirect guard work in Edge', {skip:!findEdge(),timeout:60000},async t=>{
  let externalRequests=0;
  const server=http.createServer((req,res)=>{
    if(req.headers.host.startsWith('localhost')) externalRequests++;
    res.writeHead(200,{'content-type':'text/html'});
    res.end(`<!doctype html><title>TV navigation fixture</title>
      <style>body{margin:30px}.rail{display:flex;gap:30px;overflow:auto;width:430px;padding:15px}.media-card{flex:none;width:190px;height:170px}a{height:150px}nav{display:flex;gap:30px;margin-bottom:40px}#dialog{position:fixed;inset:100px;background:#202030;padding:35px}#dialog button{margin:20px}</style>
      <nav><button id="home">Home</button><button id="search" onclick="document.querySelector('#searchPanel').hidden=false;document.querySelector('#query').focus()">Search</button><button id="open" onclick="document.querySelector('#dialog').hidden=false">Open dialog</button></nav>
      <section id="searchPanel" hidden><input id="query" aria-label="Search movies"><button aria-label="Close search" onclick="document.querySelector('#searchPanel').hidden=true;document.querySelector('#search').focus()">Close</button></section>
      <div class="rail"><div class="media-card"><a id="a" href="/details/a"><h3>First title</h3></a></div><div class="media-card"><a id="b" href="/details/b"><h3>Second title</h3></a></div><div class="media-card"><a id="c" href="/details/c"><h3>Third title</h3></a></div></div>
      <button id="hidden" style="opacity:0;position:absolute;left:250px;top:160px">Invisible</button><button disabled>Disabled</button><button tabindex="-1">Inactive slide</button>
      <div id="dialog" role="dialog" aria-modal="true" hidden><button id="confirm">Confirm</button><button id="cancel" onclick="document.querySelector('#dialog').hidden=true">Cancel</button></div>
      <script>document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('#dialog').hidden=true})</script>`);
  });
  await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-tv-shell-test-'));
  const browser=new TvBrowser({debugPort:await freePort(),profileDir:profile,headless:true});
  t.after(async()=>{
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
    if(path.dirname(profile)===os.tmpdir() && path.basename(profile).startsWith('lumen-tv-shell-test-')) await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  });
  const url=`http://127.0.0.1:${server.address().port}/`;
  await browser.open({id:'movy',name:'Movy fixture',url,tvShell:true,lockNavigation:true});
  await until(()=>browser.evaluate('!!window.__lumenTVNavigation'),'TV shell was not installed');
  await browser.evaluate('document.querySelector("#a").focus()');
  assert.equal((await browser.interactionState()).focus.label,'First title');
  await browser.key('Right');
  assert.equal(await browser.evaluate('document.activeElement.id'),'b');
  await browser.key('Right');
  assert.equal(await browser.evaluate('document.activeElement.id'),'c');
  assert.ok(await browser.evaluate('document.querySelector(".rail").scrollLeft>0'));
  await browser.key('Right');
  assert.equal(await browser.evaluate('document.activeElement.id'),'c','Right at a rail edge must not jump rows');
  await browser.key('Left');
  assert.equal(await browser.evaluate('document.activeElement.id'),'b');
  await browser.evaluate('document.querySelector("#open").focus()');
  await browser.key('Enter');
  await until(()=>browser.evaluate('document.activeElement.id==="confirm"'),'Focus did not enter modal');
  await browser.key('Right');
  assert.equal(await browser.evaluate('document.activeElement.id'),'cancel');
  await browser.back();
  await until(()=>browser.evaluate('document.querySelector("#dialog").hidden && document.activeElement.id==="open"'),'Back did not close modal and restore focus');
  await browser.evaluate('document.querySelector("#search").focus()');
  await browser.key('Enter');
  const input=(await browser.interactionState()).input;
  assert.equal(input.label,'Search movies');
  assert.equal(await browser.replaceText(input.fieldId,'synthetic search'),true);
  await browser.back();
  assert.equal(await browser.evaluate('document.querySelector("#searchPanel").hidden'),true);
  assert.equal(await browser.evaluate('location.href'),url,'Back must close search without leaving the catalog');
  await browser.evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const video=document.createElement('video');video.id='movie';video.muted=true;
    video.style='position:fixed;inset:0;width:100vw;height:100vh';
    video.srcObject=canvas.captureStream(10);document.body.appendChild(video);
    window.movieTimer=setInterval(()=>canvas.getContext('2d').fillRect(0,0,640,360),50);
    await video.play();document.body.tabIndex=-1;document.body.focus();
    document.querySelector('#a h3').textContent='Subtitle-like mutation';
  })()`);
  await until(()=>browser.evaluate('document.documentElement.classList.contains("lumen-cinema")'),'Cinema presentation was not enabled');
  assert.equal(await browser.evaluate('document.activeElement===document.body'),true,'Player mutations must not steal focus back to catalog controls');
  await browser.evaluate('clearInterval(window.movieTimer);document.querySelector("#movie").srcObject.getTracks().forEach(t=>t.stop());document.querySelector("#movie").remove()');
  await until(()=>browser.evaluate('!document.documentElement.classList.contains("lumen-cinema") && document.activeElement!==document.body'),'Catalog focus was not restored after leaving playback');
  let blocks=0;
  browser.on('navigation-blocked',()=>blocks++);
  await browser.cdp.send('Page.navigate',{url:`http://localhost:${server.address().port}/unsolicited`},browser.pageSession);
  await until(()=>blocks===1,'External top-level redirect was not blocked');
  assert.equal(externalRequests,0,'Blocked page must not be requested');
  assert.equal(await browser.evaluate('location.href'),url,'Blocked redirect must keep the current page');
  await browser.cdp.send('Page.navigate',{url:`${url}details/a`},browser.pageSession);
  await until(()=>browser.evaluate('location.pathname==="/details/a" && !!window.__lumenTVNavigation'),'Internal page lost the TV shell');
  await browser.back();
  await until(()=>browser.evaluate('location.pathname==="/"'),'Back did not return to the catalog');
  let home=0;
  browser.on('home-requested',()=>home++);
  await browser.back();
  assert.equal(home,1,'Back from the catalog root must return to Lumen home');
});

'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const http=require('node:http');
const {TvBrowser,findEdge}=require('../src/browser');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function until(fn,message){const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error(message);}
const fixture=`<!doctype html><title>Player controls fixture</title><style>body{margin:25px;background:#111;color:white}#player{position:relative;width:900px}button,a{min-width:100px;min-height:45px;display:inline-block}.relative{position:relative;display:inline-block}.menu{position:absolute;z-index:20;top:50px;left:0;background:#333;padding:15px;width:220px;opacity:0;pointer-events:none}.menu button{display:block;margin:8px}video{display:block}</style>
<section id="player"><h1>Fixture series</h1><video muted width="640" height="240"></video>
<div id="autoHiddenControls" style="opacity:0">
 <div class="relative"><button class="tabbable" id="qualityTrigger" onclick="const p=document.querySelector('#qualityMenu');const open=p.style.opacity==='1';p.style.opacity=open?'0':'1';p.style.pointerEvents=open?'none':'auto';document.querySelector('#autoHiddenControls').style.opacity='1'">Quality<span>1080p</span></button><div class="menu" id="qualityMenu"><button id="hd">1080p Full HD</button><button>720p HD</button></div></div>
 <div class="relative"><button class="tabbable" id="audioTrigger">Audio &amp; Subtitles</button><div class="menu"><button>Off</button><button>English</button></div></div>
 <a id="nextLink" href="/tv/123/1/2?play=true" onclick="event.preventDefault();document.body.dataset.nextClicks=Number(document.body.dataset.nextClicks||0)+1"><button class="tabbable" id="nextNative">Next Episode</button></a>
</div>
<button id="ButtonPlay">Play</button><button class="tabbable" id="episodesTrigger" onclick="document.body.dataset.episodesOpened='yes'">Episodes</button><button id="skipIntro" onclick="document.body.dataset.introSkipped='yes'">Skip intro</button></section>
<button id="outsidePlayer">Next Episode</button>`;
async function setup(t){
  const server=http.createServer((req,res)=>{
    res.writeHead(200,{'content-type':'text/html'});
    if(req.url.startsWith('/frame'))return res.end('<!doctype html><video muted width="640" height="240"></video><button aria-label="Next episode" id="frameNext" onclick="document.body.dataset.nextClicks=Number(document.body.dataset.nextClicks||0)+1">Next episode</button>');
    if(req.url.startsWith('/embedded'))return res.end(`<!doctype html><title>Embedded fixture</title><iframe width="800" height="400" src="http://localhost:${server.address().port}/frame"></iframe>`);
    res.end(fixture);
  });
  await new Promise(r=>server.listen(0,'0.0.0.0',r));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-site-controls-test-'));
  const browser=new TvBrowser({debugPort:await freePort(),profileDir:profile,headless:true});
  t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('lumen-site-controls-test-'))await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
  return {browser,url:`http://127.0.0.1:${server.address().port}`};
}
test('Movy-shaped native controls work without hooks, including auto-hidden controls and safe menu Back',{skip:!findEdge(),timeout:30000},async t=>{
  const {browser,url}=await setup(t);
  await browser.open({id:'movy',tvShell:true,url:`${url}/tv/123/1/1?play=true`});
  await until(()=>browser.evaluate('!!document.querySelector("#ButtonPlay")'),'Fixture not loaded');
  let state=await browser.interactionState();
  assert.equal(state.controls.nextEpisode,true);assert.equal(state.controls.previousEpisode,false);
  assert.equal(state.controls.showEpisodes,true);assert.equal(state.controls.audioSubtitles,true);assert.equal(state.controls.quality,true);assert.equal(state.controls.skipIntro,true);assert.equal(state.controls.skipRecap,false);
  assert.equal(state.media.season,1);assert.equal(state.media.episode,1);assert.equal(state.media.title,'Fixture series');
  assert.equal(await browser.siteCommand('nextEpisode'),true);
  assert.equal(await browser.evaluate('document.body.dataset.nextClicks'),'1');
  assert.equal(await browser.siteCommand('showEpisodes'),true);assert.equal(await browser.evaluate('document.body.dataset.episodesOpened'),'yes');
  assert.equal(await browser.siteCommand('skipIntro'),true);assert.equal(await browser.evaluate('document.body.dataset.introSkipped'),'yes');
  assert.equal(await browser.siteCommand('quality'),true);
  await until(()=>browser.evaluate('document.activeElement.id==="hd"'),'Menu did not focus its first choice');
  assert.equal(await browser.evaluate('document.querySelector("#qualityMenu").getAttribute("data-lumen-site-menu")'),'true');
  await browser.back();assert.equal(await browser.evaluate('document.querySelector("#qualityMenu").style.opacity'),'0');assert.equal(await browser.evaluate('document.activeElement.id'),'qualityTrigger');
  await browser.evaluate('document.body.dataset.episodesOpened="no"');
  assert.equal(await browser.siteCommand('showEpisodes'),true);assert.equal(await browser.evaluate('document.body.dataset.episodesOpened'),'yes','Unrelated sibling controls must not be mistaken for an episode menu');
  await browser.evaluate('document.querySelector("#nextNative").disabled=true');
  assert.equal(await browser.siteCommand('nextEpisode'),false,'Disabled DOM targets must be rechecked at click time');
  assert.equal((await browser.interactionState()).controls.nextEpisode,false);
  await browser.evaluate('document.querySelector("#nextNative").disabled=false');await browser.interactionState();
  await browser.evaluate('history.pushState({},"","/tv/123/1/2?play=true")');
  assert.equal(await browser.siteCommand('nextEpisode'),false,'An action from the old episode must not target the new page');
  assert.equal(await browser.evaluate('document.body.dataset.nextClicks'),'1');
  assert.equal(await browser.siteCommand('deleteData'),false);
});
test('native episode controls reject wrong destinations and duplicate labels; site hooks retain priority',{skip:!findEdge(),timeout:30000},async t=>{
  const {browser,url}=await setup(t);await browser.open({id:'movy',tvShell:true,url:`${url}/tv/123/1/1?play=true`});
  await until(()=>browser.evaluate('!!document.querySelector("#ButtonPlay")'),'Fixture not loaded');
  await browser.evaluate('document.querySelector("#nextLink").href="https://unrelated.example/"');
  assert.equal((await browser.interactionState()).controls.nextEpisode,false);
  await browser.evaluate('document.querySelector("#nextLink").href="/tv/999/1/2?play=true"');
  assert.equal((await browser.interactionState()).controls.nextEpisode,false);
  await browser.evaluate('document.querySelector("#nextLink").href="/tv/123/1/2?play=true";const b=document.createElement("button");b.textContent="Next Episode";document.querySelector("#player").appendChild(b)');
  assert.equal((await browser.interactionState()).controls.nextEpisode,false,'Ambiguous controls must not be picked by order');
  await browser.evaluate('window.LumenTV={getState:()=>({page:"player"}),nextEpisode:()=>{document.body.dataset.hookClicks=Number(document.body.dataset.hookClicks||0)+1}}');
  assert.equal((await browser.interactionState()).controls.nextEpisode,true);assert.equal(await browser.siteCommand('nextEpisode'),true);
  assert.equal(await browser.evaluate('document.body.dataset.hookClicks'),'1');
  assert.equal(await browser.evaluate('document.body.dataset.nextClicks'),undefined);
  await browser.evaluate('window.LumenTV.getState=()=>({page:"browse"})');
  assert.equal((await browser.interactionState()).controls.nextEpisode,false,'Browse pages must not advertise always-defined episode hooks');
});
test('episode actions target the media iframe instead of an empty parent hook',{skip:!findEdge(),timeout:30000},async t=>{
  const {browser,url}=await setup(t);await browser.open({id:'jojo',tvShell:true,url:`${url}/embedded`});
  await until(async()=>{const state=await browser.interactionState();return state.controls.nextEpisode;},'Frame episode control not discovered');
  await browser.evaluate('window.LumenTV={getState:()=>({page:"browse"}),nextEpisode:()=>{document.body.dataset.wrongParent="yes"}}');
  assert.equal((await browser.interactionState()).controls.nextEpisode,true);assert.equal(await browser.siteCommand('nextEpisode'),true);
  assert.ok((await browser.evaluateContexts('document.body.dataset.nextClicks')).some(item=>item.value==='1'));
  assert.equal(await browser.evaluate('document.body.dataset.wrongParent'),undefined);
});

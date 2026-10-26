'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const http=require('node:http');const net=require('node:net');
const {TvBrowser,findEdge}=require('../src/browser');
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('volume renderer shows actual values, mute and unavailable state',{skip:!findEdge(),timeout:30000},async t=>{
  const ui=path.join(__dirname,'..','ui');
  const server=http.createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end('window.volumeOverlay={onVolume:callback=>{window.renderFixtureVolume=callback}};');}
    const files={'/':'volume.html','/volume.css':'volume.css','/volume.js':'volume.js','/fonts/outfit-latin-wght-normal.woff2':'fonts/outfit-latin-wght-normal.woff2'};
    const file=files[req.url];if(!file){res.writeHead(404);return res.end();}
    res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html'});
    const body=fs.readFileSync(path.join(ui,file));res.end(file==='volume.html'?body.toString().replace('<script src="volume.js">','<script src="fixture.js"></script><script src="volume.js">'):body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-volume-ui-test-'));
  const browser=new TvBrowser({debugPort:await freePort(),profileDir:profile,headless:true});
  t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('lumen-volume-ui-test-'))await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
  await browser.open({id:'volume-fixture',name:'Volume preview fixture',url:`http://127.0.0.1:${server.address().port}/`});
  await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:480,height:110,deviceScaleFactor:1,mobile:false},browser.pageSession);
  await browser.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},browser.pageSession);
  const deadline=Date.now()+10000;while(!await browser.evaluate('typeof window.renderFixtureVolume==="function"')){if(Date.now()>deadline)throw Error('Volume renderer did not load');await new Promise(resolve=>setTimeout(resolve,50));}
  await browser.evaluate('window.renderFixtureVolume({percent:72,muted:false,name:"Y9 · synthetic preview"})');
  assert.equal(await browser.evaluate('document.querySelector("#value").textContent'),'72%');
  assert.equal(await browser.evaluate('document.querySelector("#track").getAttribute("aria-valuenow")'),'72');
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  const shot=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},browser.pageSession);
  const output=path.join(__dirname,'..','cache','verification');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'volume-overlay.png'),Buffer.from(shot.data,'base64'));
  await browser.evaluate('window.renderFixtureVolume({percent:72,muted:true,name:"Fixture HDMI"})');
  assert.equal(await browser.evaluate('document.querySelector("#value").textContent'),'Muted');
  assert.equal(await browser.evaluate('document.querySelector("#fill").style.width'),'0%');
  await browser.evaluate('window.renderFixtureVolume(null)');
  assert.equal(await browser.evaluate('document.querySelector("#value").textContent'),'Audio unavailable');
  assert.equal(await browser.evaluate('document.querySelector("#track").hidden'),true);
});

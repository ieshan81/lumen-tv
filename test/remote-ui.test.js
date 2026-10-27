'use strict';
// Synthetic phone UI only. Never connects to the production remote or controls a real display.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {RemoteServer}=require('../src/remote');
const {TvBrowser,findEdge}=require('../src/browser');
const {loadTiles}=require('../src/config');
const {usesTvShell}=require('../src/tv-shell');

async function until(fn,message) {
  const end=Date.now()+10000;
  while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,50));}
  throw new Error(message);
}
async function freePort(){
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

test('phone renders Movy, adaptive controls, typing and playback without narrow-screen overflow',{skip:!findEdge(),timeout:60000},async t=>{
  const tiles=loadTiles();
  const messages=[];
  let connections=0;
  const remote=new RemoteServer({host:'127.0.0.1',port:await freePort(),token:'fixture'});
  let state={t:'state',preview:true,mode:'home',tiles:tiles.map(({id,name,accent})=>({id,name,accent})),running:null,media:null,input:null,focus:null,navigation:'dpad',projector:{connected:true,label:'Synthetic display',reason:'Remembered projector hardware',options:[{id:2,label:'Fixture projector',width:1920,height:1080,selected:true}]},volume:{percent:42,muted:false,name:'Fixture audio'},audio:{status:'idle'},audioDevices:[{id:'hdmi',name:'Fixture HDMI',isDefault:true},{id:'headphones',name:'Fixture headphones',isDefault:false}],volumeAutoHide:true,volumeOverlayVisible:false,sleepAt:null};
  remote.on('connected',ws=>{connections++;remote.send(ws,state);});
  remote.on('message',msg=>{
    messages.push(msg);
    if(msg.t==='launch'){
      const tile=tiles.find(item=>item.id===msg.id);
      state={...state,mode:'app',running:{name:tile.name,tileId:tile.id,accent:tile.accent},navigation:usesTvShell(tile)?'dpad':'touch',focus:{label:'A selected title on your TV'},controls:{nextEpisode:true,previousEpisode:false,showEpisodes:true,audioSubtitles:true,quality:true,skipIntro:true,skipRecap:false}};
    }
    if(msg.t==='media'&&msg.a==='playpause')state.media.playing=!state.media.playing;
    if(msg.t==='audio'&&msg.action==='select')state.audioDevices=state.audioDevices.map(device=>({...device,isDefault:device.id===msg.id}));
    if(msg.t==='volume-preferences')state.volumeAutoHide=msg.autoHide;
    remote.broadcast(state);
  });
  await remote.start();
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-remote-ui-test-'));
  const browser=new TvBrowser({debugPort:await freePort(),profileDir:profile,headless:true});
  t.after(async()=>{
    await browser.close();remote.stop();
    if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('lumen-remote-ui-test-'))await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  });
  await browser.open({id:'remote-fixture',name:'Remote fixture',url:`http://127.0.0.1:${remote.port}/?t=fixture`});
  await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},browser.pageSession);
  await until(()=>browser.evaluate('!!Array.from(document.querySelectorAll("#apps button")).find(n=>n.textContent==="Movy")'),'Movy did not appear on the phone');
  await browser.evaluate('document.querySelector("[data-tab=apps]").click();Array.from(document.querySelectorAll("#apps button")).find(n=>n.textContent==="Movy").click()');
  await until(()=>browser.evaluate('document.querySelector("#nowEyebrow").textContent==="MOVY"'),'Movy did not become the current app');
  assert.equal(await browser.evaluate('document.querySelector("#dpad").hidden'),false);
  assert.equal(await browser.evaluate('document.querySelector("[data-pad=auto]").getAttribute("aria-pressed")'),'true');
  assert.match(await browser.evaluate('document.querySelector("#controlHint").textContent'),/A selected title/);
  assert.equal(await browser.evaluate('document.querySelector("[data-site=nextEpisode]").hidden'),false);
  assert.equal(await browser.evaluate('document.querySelector("[data-site=previousEpisode]").hidden'),true);
  assert.equal(await browser.evaluate('document.querySelector("[data-site=audioSubtitles]").hidden'),false);
  assert.equal(await browser.evaluate('document.querySelector("[data-site=skipRecap]").hidden'),true);
  await browser.evaluate('document.querySelector("[data-site=nextEpisode]").click();document.querySelector("[data-site=showEpisodes]").click();document.querySelector("[data-site=audioSubtitles]").click()');
  await until(()=>messages.some(msg=>msg.t==='site'&&msg.action==='audioSubtitles'),'Native player action was not sent');
  assert.equal(messages.filter(msg=>msg.t==='site'&&msg.action==='nextEpisode').length,1);
  assert.equal(messages.filter(msg=>msg.t==='site'&&msg.action==='showEpisodes').length,1);
  assert.equal(await browser.evaluate('document.querySelector("#volumeReadout").textContent'),'Volume 42%');
  await browser.evaluate('document.querySelector("[data-tab=more]").click();document.querySelector("#rememberProjector").click();document.querySelector("[data-media=showvolume]").click()');
  await until(()=>messages.some(msg=>msg.t==='projector'&&msg.id===2),'Projector selection was not delivered');
  assert.ok(messages.some(msg=>msg.t==='media'&&msg.a==='showvolume'));
  assert.equal(await browser.evaluate('document.querySelector("#displayRecognition").textContent'),'Remembered projector hardware');
  assert.equal(await browser.evaluate('document.querySelector("#audioOutput").value'),'hdmi');
  await browser.evaluate('document.querySelector("#audioOutput").value="headphones";document.querySelector("#audioOutput").dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#volumeAutoHide").click()');
  await until(()=>messages.some(msg=>msg.t==='audio'&&msg.action==='select'&&msg.id==='headphones')&&messages.some(msg=>msg.t==='volume-preferences'&&msg.autoHide===false),'Audio settings were not delivered');
  await until(()=>browser.evaluate('document.querySelector("#audioOutput").value==="headphones" && !document.querySelector("#volumeAutoHide").checked'),'Confirmed audio settings did not reach the phone');
  for(const [width,height] of [[320,568],[844,390],[390,844]]){
    await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},browser.pageSession);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`Audio settings overflowed ${width}x${height}`);
  }
  await browser.evaluate('document.querySelector("[data-tab=control]").click()');
  await browser.evaluate('document.querySelector("[data-pad=touch]").click()');
  remote.broadcast(state);
  assert.equal(await browser.evaluate('document.querySelector("#touchpad").hidden'),false);
  await browser.evaluate('document.querySelector("[data-pad=auto]").click()');
  assert.equal(await browser.evaluate('document.querySelector("#dpad").hidden'),false);

  for(const [width,height] of [[320,568],[844,390],[390,844]]){
    await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},browser.pageSession);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`${width}x${height} overflowed`);
  }
  state.input={fieldId:'synthetic-search',type:'search',label:'Search movies',multiline:false};
  remote.broadcast(state);
  await until(()=>browser.evaluate('!document.querySelector("#keyboardContext").hidden'),'Phone keyboard panel did not appear');
  await browser.evaluate('document.querySelector("#liveText").value="synthetic query";document.querySelector("#liveText").dispatchEvent(new Event("input",{bubbles:true}))');
  await until(()=>messages.some(msg=>msg.t==='edit'&&msg.fieldId==='synthetic-search'&&msg.s==='synthetic query'),'Live typing was not sent to the correct field');
  state.input=null;
  state.media={title:'Synthetic playback sample',playing:true,currentTime:25,duration:120,width:1920,height:1080,bufferedSeconds:30,actions:{seek:true}};
  remote.broadcast(state);
  await until(()=>browser.evaluate('document.querySelector("#playPause").getAttribute("aria-label")==="Pause"'),'Playback state did not reach the phone');
  await browser.evaluate('document.querySelector("#playPause").click()');
  await until(()=>browser.evaluate('document.querySelector("#playPause").getAttribute("aria-label")==="Play"'),'Phone play/pause did not send exactly one command');
  assert.equal(messages.filter(msg=>msg.t==='media'&&msg.a==='playpause').length,1);
  assert.match(await browser.evaluate('document.querySelector("#playbackQuality").textContent'),/1920 × 1080/);
  const episodeShot=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},browser.pageSession);
  const episodeOutput=path.join(__dirname,'..','cache','verification');fs.mkdirSync(episodeOutput,{recursive:true});fs.writeFileSync(path.join(episodeOutput,'episode-remote.png'),Buffer.from(episodeShot.data,'base64'));
  const savedControls=state.controls;state.controls={nextEpisode:false,previousEpisode:false,showEpisodes:false,audioSubtitles:false,quality:false,skipIntro:false,skipRecap:false};state.media.actions={};remote.broadcast(state);
  await until(()=>browser.evaluate('document.querySelector("#episodeRow").hidden&&document.querySelector("#playerTools").hidden'),'Unavailable controls did not disappear');
  state.controls=savedControls;remote.broadcast(state);

  await browser.evaluate('window.__testPulses=[];Object.defineProperty(navigator,"vibrate",{configurable:true,value:pattern=>{window.__testPulses.push(pattern);return true;}});document.querySelector("[data-tab=more]").click();window.__testPulses.length=0;document.querySelector("#testHaptics").click()');
  assert.deepEqual(await browser.evaluate('window.__testPulses'),[[12,40,12]],'Test button must request exactly one pulse pattern');
  await browser.evaluate('document.querySelector("#hapticsEnabled").checked=false;document.querySelector("#hapticsEnabled").dispatchEvent(new Event("change",{bubbles:true}))');
  assert.equal(await browser.evaluate('document.querySelector("#testHaptics").disabled'),true);
  assert.equal(await browser.evaluate('localStorage.getItem("lumen-haptics")'),'off');
  const count=await browser.evaluate('window.__testPulses.length');
  await browser.evaluate('document.querySelector("[data-tab=control]").click()');
  assert.equal(await browser.evaluate('window.__testPulses.length'),count,'Off must suppress button haptics');
  await browser.cdp.send('Page.reload',{},browser.pageSession);
  await until(()=>browser.evaluate('document.querySelector("#hapticsEnabled")?.checked===false && document.querySelector("#nowEyebrow")?.textContent==="MOVY"'),'Haptic preference did not survive reload');
  assert.equal(await browser.evaluate('document.querySelector("#volumeAutoHide").checked'),false,'Room auto-hide preference must survive phone reload');
  assert.equal(await browser.evaluate('document.querySelector("#audioOutput").value'),'headphones');

  const beforeRestore=connections;
  await browser.evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');
  await until(()=>connections===beforeRestore+1&&remote.clients.size===1,'Restoring the phone page did not replace its stale connection');
  const beforeOnline=connections;
  await browser.evaluate('window.dispatchEvent(new Event("online"))');
  await until(()=>connections===beforeOnline+1&&remote.clients.size===1,'Returning online did not replace the connection');
  const beforeTap=messages.filter(msg=>msg.t==='media'&&msg.a==='showvolume').length;
  await browser.evaluate('document.querySelector("[data-media=showvolume]").click()');
  await until(()=>messages.filter(msg=>msg.t==='media'&&msg.a==='showvolume').length===beforeTap+1,'Reconnected phone tap was not delivered once');

  // Generated evidence is explicitly labeled Design preview in the page itself.
  state.media=null;remote.broadcast(state);
  await until(()=>browser.evaluate('document.body.dataset.mode==="app"'),'Browse controls did not return');
  const screenshot=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},browser.pageSession);
  const output=path.join(__dirname,'..','cache','verification');
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'movy-phone.png'),Buffer.from(screenshot.data,'base64'));

  await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(window,"localStorage",{get(){throw new DOMException("Storage denied","SecurityError")}})'} ,browser.pageSession);
  await browser.cdp.send('Page.reload',{},browser.pageSession);
  await until(()=>browser.evaluate('document.querySelector("#connectionText")?.textContent==="Connected" && document.body.dataset.mode==="app"'),'Denied phone storage prevented the remote from loading');
  await browser.evaluate('document.querySelector("[data-pad=touch]").click()');
  assert.equal(await browser.evaluate('document.querySelector("#touchpad").hidden'),false,'Storage-denied phones must still allow control changes');
});

'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');const net=require('net');
const {RemoteServer}=require('../src/remote');const {TvBrowser,findEdge}=require('../src/browser');const {Calibration}=require('../src/calibration');const {IDENTITY}=require('../remote/picture-math');
async function port(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const p=server.address().port;await new Promise(resolve=>server.close(resolve));return p;}
async function until(fn,message){const end=Date.now()+10000;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error(message);}
test('phone calibration captures locally, samples chart corners, previews, compares and saves',{skip:!findEdge(),timeout:60000},async t=>{
  const messages=[],changes=[];
  const picture={adjustment:{...IDENTITY},saved:null,hasProfiles:false,async open(){},async preview(value){this.adjustment={...value};changes.push({...value});},save(value){this.saved={adjustment:value};},async close(){},async reset(){this.saved=null;}};
  const chart={visible:false,async show(){this.visible=true;},hide(){this.visible=false;},close(){this.visible=false;}};
  const calibration=new Calibration({picture,window:chart});
  const remote=new RemoteServer({host:'127.0.0.1',port:await port(),token:'picture-fixture'});
  const getState=()=>({t:'state',preview:true,mode:'home',tiles:[],running:null,projector:{connected:true,label:'Fixture projector',options:[]},audio:{status:'idle'},calibration:{...calibration.state}});
  calibration.on('change',()=>remote.broadcast(getState()));remote.on('connected',ws=>remote.send(ws,getState()));
  remote.on('message',message=>{messages.push(message);if(message.t!=='calibration')return;(async()=>{if(message.action==='start')await calibration.start({label:'Fixture projector',bounds:{x:1920,y:0,width:1920,height:1080}},{});else if(message.action==='cancel')await calibration.cancel();else await calibration.handle(message);})().catch(()=>{});});
  await remote.start();const profile=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-picture-ui-'));const browser=new TvBrowser({debugPort:await port(),profileDir:profile,headless:true});
  t.after(async()=>{await calibration.detach();await browser.close();remote.stop();if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('lumen-picture-ui-'))await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
  await browser.open({id:'fixture',name:'Picture UI',url:`http://127.0.0.1:${remote.port}/?t=picture-fixture`});
  await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},browser.pageSession);
  await until(()=>browser.evaluate('!document.querySelector("#calibratePicture").disabled'),'Picture setup did not load');
  await browser.evaluate('document.querySelector("[data-tab=more]").click();document.querySelector("#calibratePicture").click()');
  assert.equal(await browser.evaluate('document.querySelector("#calibrationDialog").hidden'),false);
  assert.equal(await browser.evaluate('document.querySelector("#calFile").getAttribute("capture")'),'environment');
  assert.equal(await browser.evaluate('document.querySelector("#calFile").accept'),'image/*');
  const directory=path.join(__dirname,'..','cache','verification');fs.mkdirSync(directory,{recursive:true});
  let screenshot=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},browser.pageSession);fs.writeFileSync(path.join(directory,'picture-setup-phone.png'),Buffer.from(screenshot.data,'base64'));
  await browser.evaluate('document.querySelector("#calBegin").click()');await until(()=>calibration.active&&!calibration.state.busy,'Calibration did not start');
  await until(()=>browser.evaluate('!document.querySelector("#calWorking").hidden&&!document.querySelector("#calCamera").disabled'),'Phone did not receive the active session');
  await browser.evaluate(`(async()=>{
    const image=document.createElement('canvas');image.width=1000;image.height=600;const ctx=image.getContext('2d');ctx.fillStyle='#101018';ctx.fillRect(0,0,1000,600);
    for(const patch of window.LumenPictureMath.patches()){ctx.fillStyle='rgb('+patch.rgb.map(value=>Math.round(12+value*.88)).join(',')+')';ctx.fillRect((patch.x-patch.w/2)*1000,(patch.y-patch.h/2)*600,patch.w*1000,patch.h*600);}
    const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic-chart.png',{type:'image/png'}));const input=document.querySelector('#calFile');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await until(()=>browser.evaluate('!document.querySelector("#calPhotoWrap").hidden'),'Chart photo was not decoded');
  await browser.evaluate(`(()=>{const canvas=document.querySelector('#calPhoto'),box=canvas.getBoundingClientRect();for(const [x,y] of [[0,0],[.999,0],[.999,.998],[0,.998]])canvas.dispatchEvent(new MouseEvent('click',{clientX:box.left+x*box.width,clientY:box.top+y*box.height,bubbles:true}));document.querySelector('#calAnalyze').click();})()`);
  await until(()=>calibration.state.analysis?.usable,'Valid synthetic camera chart was rejected');
  await until(()=>browser.evaluate('!document.querySelector("#calAnalysis").hidden&&document.querySelector("#calAnalysisTitle").textContent==="Photo checks passed"'),'Phone did not receive the analysis result');
  assert.ok(messages.filter(message=>message.action==='analyze').every(message=>Array.isArray(message.samples)&&message.samples.length===16&&!('photo'in message)&&JSON.stringify(message).length<8192));
  assert.equal(await browser.evaluate('document.querySelector("#calAnalysisTitle").textContent'),'Photo checks passed');
  await browser.evaluate('document.querySelector("#calblue").value="0.97";document.querySelector("#calblue").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#calPreview").click()');
  await until(()=>calibration.state.phase==='preview'&&!calibration.state.busy,'Preview did not apply');assert.equal(picture.adjustment.blue,.97);assert.equal(chart.visible,false);
  await until(()=>browser.evaluate('!document.querySelector("#calOriginal").disabled&&!document.querySelector("#calCompare").hidden'),'Original comparison was not enabled');
  await browser.evaluate('document.querySelector("#calOriginal").click()');await until(()=>calibration.state.view==='original'&&!calibration.state.busy,'Original comparison did not apply');assert.equal(picture.adjustment.blue,1);
  await until(()=>browser.evaluate('document.querySelector("#calOriginal").getAttribute("aria-pressed")==="true"&&!document.querySelector("#calAdjusted").disabled'),'Adjusted comparison was not enabled');
  await browser.evaluate('document.querySelector("#calAdjusted").click()');await until(()=>calibration.state.view==='adjusted'&&!calibration.state.busy,'Adjusted comparison did not apply');assert.equal(picture.adjustment.blue,.97);
  await until(()=>browser.evaluate('document.querySelector("#calAdjusted").getAttribute("aria-pressed")==="true"&&!document.querySelector("#calSave").disabled'),'Phone did not receive the adjusted comparison');
  for(const [width,height]of[[320,568],[844,390],[390,844]]){await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},browser.pageSession);assert.equal(await browser.evaluate('document.querySelector("#calibrationDialog").scrollWidth<=document.querySelector("#calibrationDialog").clientWidth'),true,`Picture setup overflowed ${width}x${height}`);}
  await until(()=>browser.evaluate('!document.querySelector("#calSave").disabled'),'Save was not enabled');
  await browser.evaluate('document.querySelector("#calSave").click()');await until(()=>!calibration.active&&calibration.state.profileSaved,'Profile was not saved');assert.equal(picture.saved.adjustment.blue,.97);
  await until(()=>browser.evaluate('document.querySelector("#calibrationDialog").hidden'),'Saved wizard did not close');assert.equal(await browser.evaluate('document.querySelector("#calPhoto").width'),1,'Photo must be discarded when setup closes');
});

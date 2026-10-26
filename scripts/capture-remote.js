'use strict';
// Capture the synthetic localhost development fixture, never a signed-in user profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { TvBrowser } = require('../src/browser');
const WebSocket = require('ws');

(async()=>{
  const probe=net.createServer();
  await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const debugPort=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-capture-'));
  const browser=new TvBrowser({debugPort,profileDir:profile,headless:true});
  const out=path.join(__dirname,'..','cache','verification');
  fs.mkdirSync(out,{recursive:true});
  try{
    const socket=new WebSocket('ws://127.0.0.1:14321/ws?t=preview');
    await new Promise(resolve=>socket.once('open',resolve));
    socket.send(JSON.stringify({t:'key',k:'Back'}));
    socket.close();
    await browser.open({id:'preview',name:'Remote preview',url:'http://127.0.0.1:14321/?t=preview'});
    await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},browser.pageSession);
    await new Promise(resolve=>setTimeout(resolve,500));
    const result=await browser.cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},browser.pageSession);
    const file=path.join(out,'remote-phone.png');
    fs.writeFileSync(file,Buffer.from(result.data,'base64'));
    console.log(file);
  }finally{
    await browser.close();
    if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('lumen-capture-'))fs.rmSync(profile,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});

'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter}=require('events');const {PassThrough,Writable}=require('stream');
const {VolumeMonitor}=require('../src/volume');
const {VolumeOverlay,overlayBounds}=require('../src/volume-overlay');
function mockWorker(){
  const worker=new EventEmitter();worker.stdout=new PassThrough();worker.stderr=new PassThrough();worker.commands=[];worker.level=42;worker.muted=false;
  worker.stdin=new Writable({write(chunk,_encoding,callback){
    const request=JSON.parse(chunk.toString());worker.commands.push(request.cmd);
    if(request.cmd==='up')worker.level=Math.min(100,worker.level+2);
    if(request.cmd==='down')worker.level=Math.max(0,worker.level-2);
    if(request.cmd==='mute')worker.muted=!worker.muted;
    setImmediate(()=>worker.stdout.write(JSON.stringify({id:request.id,state:{percent:worker.level,muted:worker.muted,name:'Fixture HDMI',deviceId:'fixture'}})+'\n'));callback();
  }});
  worker.kill=()=>setImmediate(()=>worker.emit('exit',0));
  setImmediate(()=>worker.stdout.write('{"ready":true}\n'));
  return worker;
}
test('volume reads coalesce while commands retain order and return measured state',async t=>{
  const worker=mockWorker();const monitor=new VolumeMonitor({spawnWorker:()=>worker});t.after(()=>monitor.stop());
  const first=monitor.read();assert.equal(monitor.read(),first);assert.equal((await first).percent,42);
  await Promise.all([monitor.command('up'),monitor.command('up'),monitor.command('down')]);
  assert.deepEqual(worker.commands,['read','up','up','down']);assert.equal(monitor.state.percent,44);
  assert.equal((await monitor.command('mute')).muted,true);
  worker.level=101;await assert.rejects(monitor.read(),/Invalid Windows volume/);
  assert.equal(monitor.state.percent,44,'Invalid snapshots must not become UI percentages');
  await assert.rejects(monitor.command('untrusted'),/Invalid volume command/);
});
test('volume worker failure rejects pending requests and can restart',async t=>{
  let worker=mockWorker();const monitor=new VolumeMonitor({spawnWorker:()=>worker});t.after(()=>monitor.stop());
  await monitor.read();
  worker.emit('exit',1);worker=mockWorker();assert.equal((await monitor.read()).percent,42);
});
test('volume overlay stays on the chosen display, never takes focus and hides automatically',async()=>{
  const display={bounds:{x:1920,y:0,width:1920,height:1080}};
  assert.deepEqual(overlayBounds(display.bounds),{x:2640,y:914,width:480,height:110});
  let options;const calls=[];
  class FakeWindow extends EventEmitter {
    constructor(){super();this.webContents=new EventEmitter();this.webContents.send=(...args)=>calls.push(['send',...args]);this.webContents.setWindowOpenHandler=()=>{};this.visible=false;}
    setIgnoreMouseEvents(...args){calls.push(['ignore',...args]);}setAlwaysOnTop(...args){calls.push(['top',...args]);}
    loadFile(){}setBounds(bounds){calls.push(['bounds',bounds]);}showInactive(){this.visible=true;calls.push(['inactive']);}
    moveTop(){calls.push(['moveTop']);}
    isVisible(){return this.visible;}isDestroyed(){return false;}hide(){this.visible=false;}destroy(){this.emit('closed');}
  }
  const overlay=new VolumeOverlay({createWindow:value=>{options=value;return new FakeWindow();},timeout:20});
  overlay.show(display,{percent:72,muted:false,name:'Fixture HDMI'});
  assert.equal(options.focusable,false);assert.equal(options.skipTaskbar,true);assert.equal(options.transparent,true);
  overlay.win.webContents.emit('did-finish-load');assert.equal(overlay.visible,true);
  assert.ok(calls.some(call=>call[0]==='ignore'&&call[1]===true));assert.ok(calls.some(call=>call[0]==='inactive'));
  overlay.show(display,null);assert.ok(calls.some(call=>call[0]==='send'&&call[2].available===false),'Failure must display an unavailable state, not a fake percentage');
  overlay.setAutoHide(false);
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(overlay.visible,true,'Disabling auto-hide must cancel an already armed timer');
  overlay.setAutoHide(true);
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(overlay.visible,false);
  overlay.setAutoHide(false);overlay.show(display,{percent:72,muted:false,name:'Fixture HDMI'});
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(overlay.visible,true,'Pinned volume must remain visible');
  overlay.hide();assert.equal(overlay.visible,false);overlay.close();
});

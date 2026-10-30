'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const os=require('os');
const math=require('../remote/picture-math');const {PictureController}=require('../src/picture');const {Calibration}=require('../src/calibration');
const baseline=Array.from({length:768},(_,i)=>(i%256)*257);
const display={label:'Fixture projector',bounds:{x:1920,y:0,width:1920,height:1080}};
function readings(){return math.patches().map(p=>({id:p.id,rgb:p.rgb.map(v=>Math.round(12+v*.88)),spread:1,clipped:0}));}
function fixture(){
  const calls=[];const picture={adjustment:{red:1,green:1,blue:.98,gamma:1},saved:{},hasProfiles:true,async open(){calls.push('open');},async preview(value){this.adjustment={...value};calls.push({...value});},save(value){calls.push('save');this.saved={adjustment:value};},async reset(){calls.push('reset');},async close(){calls.push('close');}};
  const window={async show(){calls.push('show');},hide(){calls.push('hide');},close(){calls.push('window-close');}};
  const calibration=new Calibration({picture,window,pause:async()=>calls.push('pause')});
  return {calls,picture,window,calibration};
}
test('picture curves preserve baseline, remain monotonic and reject unsafe settings',()=>{
  assert.deepEqual(math.ramp(baseline,math.IDENTITY),baseline);
  const adjusted=math.ramp(baseline,{red:.94,green:1,blue:1.04,gamma:1.1});
  for(let c=0;c<3;c++)for(let i=1;i<256;i++)assert.ok(adjusted[c*256+i]>=adjusted[c*256+i-1]);
  assert.throws(()=>math.settings({red:0,green:1,blue:1,gamma:1}),/supported range/);
  assert.throws(()=>math.settings({red:1,green:1,blue:1,gamma:NaN}),/supported range/);
  assert.throws(()=>math.ramp([0],math.IDENTITY),/baseline/);
});
test('perspective sampling reads known chart regions and rejects wrong corner order',()=>{
  const width=1000,height=600,data=new Uint8ClampedArray(width*height*4);data.fill(12);
  for(const patch of math.patches())for(let y=Math.floor((patch.y-patch.h/2)*height);y<(patch.y+patch.h/2)*height;y++)for(let x=Math.floor((patch.x-patch.w/2)*width);x<(patch.x+patch.w/2)*width;x++){const i=(y*width+x)*4;data.set([...patch.rgb.map(v=>Math.round(12+v*.88)),255],i);}
  const corners=[{x:0,y:0},{x:999,y:0},{x:999,y:599},{x:0,y:599}];
  const samples=math.samples({width,height,data},corners);assert.deepEqual(samples.map(v=>v.rgb),readings().map(v=>v.rgb));assert.equal(math.analyze(samples).usable,true);
  const project=math.homography([{x:10,y:20},{x:900,y:30},{x:800,y:500},{x:100,y:520}]);assert.deepEqual(project(0,0),{x:10,y:20});const end=project(1,1);assert.ok(Math.abs(end.x-800)<1e-8&&Math.abs(end.y-500)<1e-8);
  assert.throws(()=>math.samples({width,height,data},[corners[0],corners[3],corners[2],corners[1]]),/top left/);
});
test('camera checks reject clipping, misalignment, dim photos and invalid data; estimates stay conservative',()=>{
  const good=readings();for(const sample of good.slice(3,8))sample.rgb[0]*=1.03;
  const result=math.analyze(good);assert.equal(result.usable,true);assert.ok(result.suggestion.red<1&&result.suggestion.red>=.94);assert.equal(result.suggestion.gamma,1);assert.equal(result.measurement,'Unverified phone camera');
  const clipped=readings();clipped[8].clipped=.9;assert.equal(math.analyze(clipped).usable,false);
  const wrong=readings();wrong[10].rgb=[10,20,180];assert.equal(math.analyze(wrong).usable,false);
  const dim=readings().map(v=>({...v,rgb:v.rgb.map(n=>n*.1)}));assert.equal(math.analyze(dim).usable,false);
  assert.throws(()=>math.analyze(good.slice(1)),/incomplete/);
});
test('picture profile persistence uses hardware identity and journals baseline before each native write',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lumen-picture-test-'));const calls=[];
  const driver={async command(cmd,payload){calls.push(cmd);if(cmd==='capture')return {device:'fixture',hardwareId:'fixture-monitor',ramp:baseline};if(cmd==='apply'){const journal=JSON.parse(fs.readFileSync(path.join(root,'cache','picture-recovery.json')));assert.deepEqual(journal.applied,payload.ramp);assert.equal(journal.previousApplied.length,768);}return true;},stop(){}};
  t.after(async()=>{if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('lumen-picture-test-'))await fs.promises.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:100});});
  const picture=new PictureController({root,driver});await picture.open(display.bounds);await picture.preview({red:.98,green:1,blue:1,gamma:1});picture.save(picture.adjustment,'Fixture');await picture.close();assert.equal(fs.existsSync(picture.recovery),false);
  const second=new PictureController({root,driver});await second.open(display.bounds);assert.equal(second.adjustment.red,.98);assert.equal(second.saved.label,'Fixture');await second.reset();assert.equal(second.saved,null);await second.close();
  fs.writeFileSync(path.join(root,'cache','picture-recovery.json'),JSON.stringify({device:'fixture',hardwareId:'fixture-monitor',ramp:baseline,applied:baseline}));
  await second.recover();assert.ok(calls.includes('recover'));assert.equal(fs.existsSync(second.recovery),false);
});
test('calibration requires fresh sessions and preview before save; comparison and cancellation restore the prior profile',async()=>{
  const {calibration,picture,calls}=fixture();await calibration.start(display,display.bounds);const id=calibration.state.sessionId;
  assert.deepEqual(picture.adjustment,math.IDENTITY,'Chart capture starts from the original output');
  await assert.rejects(calibration.handle({action:'preview',sessionId:'stale',adjustment:math.IDENTITY}),/expired/);
  await assert.rejects(calibration.handle({action:'save',sessionId:id}),/Preview/);
  await calibration.handle({action:'preview',sessionId:id,adjustment:{red:.97,green:1,blue:1,gamma:1}});
  assert.equal(calibration.state.phase,'preview');assert.ok(calls.includes('hide'));
  await calibration.handle({action:'compare',sessionId:id,view:'original'});assert.equal(picture.adjustment.red,1);
  await calibration.handle({action:'compare',sessionId:id,view:'adjusted'});assert.equal(picture.adjustment.red,.97);
  await calibration.cancel();assert.equal(picture.adjustment.blue,.98);assert.equal(calibration.active,false);
});
test('automatic preview expires and unsupported native outputs retain a usable manual chart',async()=>{
  const {calibration,picture,window}=fixture();calibration.previewMs=20;await calibration.start(display,display.bounds);await calibration.handle({action:'preview',sessionId:calibration.state.sessionId,adjustment:{red:.97,green:1,blue:1,gamma:1}});
  await new Promise(resolve=>setTimeout(resolve,45));await calibration.queue;assert.equal(calibration.active,false);assert.equal(picture.adjustment.blue,.98);assert.match(calibration.state.error,/expired/);
  picture.open=async()=>{throw new Error('HDR unsupported');};await calibration.start(display,display.bounds);assert.equal(calibration.active,true);assert.equal(calibration.state.supported,false);assert.match(calibration.state.error,/HDR/);await assert.rejects(calibration.handle({action:'preview',sessionId:calibration.state.sessionId,adjustment:math.IDENTITY}),/unavailable/);await calibration.cancel();
});
test('saving a camera estimate requires valid readings and the server-derived bounded adjustment',async()=>{
  const {calibration,picture}=fixture();await calibration.start(display,display.bounds);const sessionId=calibration.state.sessionId;
  await assert.rejects(calibration.handle({action:'preview',sessionId,source:'camera-estimate',adjustment:math.IDENTITY}),/Retake/);
  await calibration.handle({action:'analyze',sessionId,samples:readings()});
  await assert.rejects(calibration.handle({action:'preview',sessionId,source:'camera-estimate',adjustment:{red:.9,green:1,blue:1,gamma:1}}),/estimate changed/);
  await calibration.handle({action:'preview',sessionId,source:'camera-estimate',adjustment:calibration.state.analysis.suggestion});await calibration.handle({action:'save',sessionId});assert.equal(calibration.active,false);assert.equal(calibration.state.profileSaved,true);assert.ok(picture.saved);
});

test('preview rollback cannot be dropped when a slow comparison fills the command queue',async()=>{
  const {calibration,picture}=fixture();calibration.previewMs=15;await calibration.start(display,display.bounds);const sessionId=calibration.state.sessionId;
  await calibration.handle({action:'preview',sessionId,adjustment:{red:.97,green:1,blue:1,gamma:1}});
  const original=picture.preview.bind(picture);let release;const gate=new Promise(resolve=>{release=resolve;});let waiting=false;
  picture.preview=async value=>{if(!waiting&&value.red===1&&value.blue===1){waiting=true;await gate;}return original(value);};
  const operations=[calibration.handle({action:'compare',sessionId,view:'original'})];
  for(let i=0;i<7;i++)operations.push(calibration.handle({action:'compare',sessionId,view:'adjusted'}));
  const settled=Promise.allSettled(operations);await new Promise(resolve=>setTimeout(resolve,35));release();await settled;await calibration.queue;
  assert.equal(calibration.active,false);assert.equal(picture.adjustment.blue,.98);assert.match(calibration.state.error,/expired/);
});

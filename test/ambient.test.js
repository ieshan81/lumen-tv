'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sampleZones,mixHex,AmbientSampler}=require('../src/ambient');
const points=[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
function picture(width=120,height=80,black=false){
  const bitmap=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(!black){bitmap[i]=Math.round(255*x/width);bitmap[i+1]=Math.round(255*y/height);bitmap[i+2]=Math.round(255*(1-x/width));}bitmap[i+3]=255;}
  return{bitmap,width,height};
}
test('dynamic Halo samples twelve independent sRGB edge zones and rejects black capture',()=>{
  const zones=sampleZones(picture().bitmap,120,80,points);
  assert.equal(zones.length,12);assert.equal(new Set(zones.map(zone=>zone.color)).size>4,true);assert.equal(zones.every(zone=>/^#[0-9a-f]{6}$/i.test(zone.color)),true);
  assert.equal(sampleZones(picture(120,80,true).bitmap,120,80,points),null);
  assert.equal(mixHex('#000000','#ffffff',.5),'#808080');
});
test('ambient sampler publishes live colors and reports a protected-video fallback without throwing',async()=>{
  let image=picture();const sampler=new AmbientSampler({capture:async()=>image,interval:10});
  const live=new Promise(resolve=>sampler.once('zones',resolve));sampler.start({id:2},points);assert.equal((await live).length,12);assert.equal(sampler.status,'live');
  image=picture(120,80,true);const fallback=new Promise(resolve=>sampler.once('status',resolve));const state=await fallback;assert.equal(state.status,'fallback');assert.match(state.error,/black video/);sampler.stop();assert.equal(sampler.status,'off');
});
test('continuous capture state changes are accepted without restarting a screenshot timer',()=>{
  const sampler=new AmbientSampler({capture:async()=>{throw new Error('polling must not run');}}),events=[];
  sampler.on('status',state=>events.push(state.status));
  sampler.startStream({id:7},points);
  assert.equal(sampler.timer,null);assert.equal(sampler.status,'starting');
  assert.equal(sampler.acceptStreamState({status:'live'}),true);assert.equal(sampler.status,'live');
  assert.equal(sampler.acceptStreamState({status:'live'}),false);
  assert.equal(sampler.acceptStreamState({status:'fallback',error:'Protected frame'}),true);assert.equal(sampler.error,'Protected frame');
  sampler.stop();assert.equal(sampler.acceptStreamState({status:'live'}),false);assert.deepEqual(events,['starting','live','fallback']);
});

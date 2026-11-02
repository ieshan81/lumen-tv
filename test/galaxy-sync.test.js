'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {GalaxySync,isNightAt}=require('../src/galaxy-sync');

test('night window crosses midnight and excludes daytime',()=>{
  assert.equal(isNightAt(new Date(2026,0,1,23,0),'20:00','08:00'),true);
  assert.equal(isNightAt(new Date(2026,0,2,7,59),'20:00','08:00'),true);
  assert.equal(isNightAt(new Date(2026,0,2,12,0),'20:00','08:00'),false);
});

test('keeps Galaxy opposite Y9, debounces HDMI loss and avoids duplicate IR',async()=>{
  let now=new Date(2026,0,1,23,0).getTime();const calls=[];
  const sync=new GalaxySync({ir:{pressNamed:async(...args)=>calls.push(args)},now:()=>now,missingGraceMs:20000,reassertMs:1800000});
  const config={enabled:true,start:'20:00',end:'08:00'};
  await sync.reconcile(true,config);assert.deepEqual(calls,[['Galaxy Projector','powerOff']]);assert.equal(sync.state.desired,'off');
  await sync.reconcile(true,config);assert.equal(calls.length,1);
  now+=1000;await sync.reconcile(false,config);assert.equal(sync.state.status,'waiting');assert.equal(calls.length,1);
  now+=21000;await sync.reconcile(false,config);assert.deepEqual(calls.at(-1),['Galaxy Projector','power']);assert.equal(sync.state.desired,'on');
});

test('does nothing outside the configured night window or when disabled',async()=>{
  const calls=[];const now=new Date(2026,0,1,12,0).getTime();const sync=new GalaxySync({ir:{pressNamed:async(...args)=>calls.push(args)},now:()=>now,missingGraceMs:0});
  await sync.reconcile(true,{enabled:true,start:'20:00',end:'08:00'});await sync.reconcile(false,{enabled:false,start:'00:00',end:'23:59'});
  assert.deepEqual(calls,[]);assert.equal(sync.state.status,'idle');
});

test('manual Galaxy control pauses automatic inversion for thirty minutes',async()=>{
  let now=new Date(2026,0,1,23,0).getTime();const calls=[];const sync=new GalaxySync({ir:{pressNamed:async(...args)=>calls.push(args)},now:()=>now,missingGraceMs:0});
  sync.manual('on');await sync.reconcile(true,{enabled:true,start:'20:00',end:'08:00'});
  assert.equal(sync.state.status,'manual');assert.equal(sync.state.desired,'on');assert.equal(calls.length,0);
  now+=31*60000;await sync.reconcile(true,{enabled:true,start:'20:00',end:'08:00'});
  assert.deepEqual(calls,[['Galaxy Projector','powerOff']]);
});

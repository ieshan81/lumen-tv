'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ProjectorIr,mapKeys,scoreRemote,shouldUseIrVolume}=require('../src/projector-ir');

const projectorKeys=['On','Source','Home','Settings','Left','Right','Up','Down','Ok','Back','Focus','Vol down','Vol up','Mute'].map((key_name,index)=>({key_name,key:String(1000+index),key_id:2000+index}));

test('maps only known projector buttons and ignores arbitrary learned keys',()=>{
  const buttons=mapKeys([...projectorKeys,{key_name:'Factory reset',key:'999',key_id:999}]);
  assert.deepEqual(buttons.map(button=>button.id),['power','source','home','settings','up','down','left','right','ok','back','focus','volumeDown','volumeUp','mute']);
  assert.equal(buttons.some(button=>button.id==='Factory reset'),false);
});

test('projector layout outranks a decorative galaxy lamp',()=>{
  const projector=mapKeys(projectorKeys);
  const lamp=mapKeys([{key_name:'On',key:'1',key_id:1}]);
  assert.ok(scoreRemote({remote_name:'Other'},projector)>scoreRemote({remote_name:'Galaxy Projector',brand_name:'Other'},lamp));
});

test('volume follows the projector only when the active Windows output is HDMI/projector audio',()=>{
  const devices=[{id:'y9',name:'Y9 (NVIDIA High Definition Audio)'},{id:'headphones',name:'soundcore Life Q20'}];
  assert.equal(shouldUseIrVolume({volume:{deviceId:'y9'},audioDevices:devices,projector:{match:'Y9'}}),true);
  assert.equal(shouldUseIrVolume({volume:{deviceId:'headphones'},audioDevices:devices,projector:{match:'Y9'}}),false);
  assert.equal(shouldUseIrVolume({volume:{deviceId:'hdmi'},audioDevices:[{id:'hdmi',name:'Digital Audio (HDMI)'}],projector:{match:'Y9'}}),true);
  assert.equal(shouldUseIrVolume({volume:{deviceId:'speakers'},audioDevices:[{id:'speakers',name:'Laptop Speakers (High Definition Audio)'}],projector:{match:'Y9'}}),false);
});

test('selects the projector remote, exposes no raw codes, and sends only a mapped command',async()=>{
  const calls=[];let saved;
  const api={
    remotes:async()=>[
      {remote_id:'projector',remote_name:'Other',category_id:13,brand_name:'Ownknew'},
      {remote_id:'lamp',remote_name:'Galaxy Projector',category_id:13,brand_name:'Other'}
    ],
    keys:async(_hub,id)=>({key_list:id==='projector'?projectorKeys:[{key_name:'On',key:'1',key_id:1}]}),
    rawCommand:async(...args)=>{calls.push(args);return true;}
  };
  const ir=new ProjectorIr({read:async()=>({clientId:'secret-id',clientSecret:'secret-key',region:'EU',hubId:'hub',hubName:'Room hub'}),write:async(_file,value)=>{saved=value;},clientFactory:()=>api});
  const state=await ir.refresh();
  assert.equal(state.remoteName,'Other');assert.equal(state.configured,true);assert.equal(saved.remoteId,'projector');
  assert.equal(JSON.stringify(state).includes('secret-key'),false);assert.equal(JSON.stringify(state).includes('1000'),false);
  await assert.rejects(()=>ir.press('factory-reset'),/unavailable/);
  await ir.press('source');
  assert.deepEqual(calls,[['hub','projector',{category_id:13,key_id:2001,key:'1001'}]]);
  assert.equal(ir.publicState().lastButton,'Input');
});

test('can address the hidden Galaxy remote by exact name without exposing it as the projector',async()=>{
  const calls=[];const api={remotes:async()=>[{remote_id:'projector',remote_name:'Other',category_id:13},{remote_id:'galaxy',remote_name:'Galaxy Projector',category_id:13}],keys:async(_hub,id)=>({key_list:id==='projector'?projectorKeys:[{key_name:'On',key:'on-code',key_id:1},{key_name:'Off',key:'off-code',key_id:2}]}),rawCommand:async(...args)=>{calls.push(args);return true;}};
  const ir=new ProjectorIr({read:async()=>({clientId:'id',clientSecret:'secret',region:'EU',hubId:'hub'}),write:async()=>{},clientFactory:()=>api});
  await ir.refresh();await ir.pressNamed('Galaxy Projector','powerOff');
  assert.deepEqual(calls,[['hub','galaxy',{category_id:13,key_id:2,key:'off-code'}]]);
  assert.equal(ir.publicState().remotes.some(remote=>remote.name==='Galaxy Projector'),false);
});

'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {selectProjector}=require('../src/display-selection');
const laptop={id:1,label:'Laptop',internal:true,bounds:{x:0,y:0,width:1920,height:1080}};
const y9={id:2,label:'Y9',internal:false,bounds:{x:1920,y:0,width:1920,height:1080}};
const dell={id:3,label:'DELL',internal:false,bounds:{x:3840,y:0,width:1920,height:1080}};
const settings={projector:{match:'Y9'}};
test('recognition uses monitor name and refuses ambiguous external screens',()=>{
  assert.equal(selectProjector([laptop,y9,dell],1,settings).display.id,2);
  assert.equal(selectProjector([laptop,dell],1,settings).display,null);
  assert.equal(selectProjector([laptop,y9,dell],1,{projector:{match:''}}).status,'ambiguous');
  assert.equal(selectProjector([laptop,y9,{...y9,id:4}],1,settings).status,'ambiguous');
  assert.equal(selectProjector([laptop,{...y9,detected:false}],1,settings).display,null);
});
test('Windows hardware identity survives renamed displays and changed screen IDs',()=>{
  const renamed={...y9,id:99,label:'Generic PnP Monitor'};
  const inventory=[{name:'Y9',hardwareId:'PROJECTOR',active:true,bounds:y9.bounds}];
  assert.equal(selectProjector([laptop,renamed,dell],1,settings,null,inventory).display.id,99);
  assert.equal(selectProjector([laptop,renamed,dell],1,settings,{hardwareId:'PROJECTOR'},[{...inventory[0],name:'Unknown'}]).display.id,99);
  assert.equal(selectProjector([laptop,renamed,dell],1,settings,{hardwareId:'PROJECTOR'},[{...inventory[0],hardwareId:'OTHER',name:'DELL'}]).display,null);
});
test('remembered ID fallback is conservative and manual hardware selection takes priority',()=>{
  assert.equal(selectProjector([laptop,{...y9,label:'Generic PnP Monitor'}],1,settings,{displayId:2,label:'Y9'}).display.id,2);
  assert.equal(selectProjector([laptop,{...y9,label:'DELL'}],1,settings,{displayId:2,label:'Y9'}).display,null);
  const inventory=[{name:'DELL',hardwareId:'CHOSEN',active:true,bounds:dell.bounds}];
  assert.equal(selectProjector([laptop,y9,dell],1,settings,{manual:true,hardwareId:'CHOSEN'},inventory).display.id,3);
  assert.equal(selectProjector([laptop,y9,dell],1,settings,{manual:true,hardwareId:'MISSING'},inventory).display,null,'A missing manually selected display must not be replaced by an unrelated screen');
});

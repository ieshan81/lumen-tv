'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {DEFAULT_HALO,normalizeHalo,parseHalo,validQuad,quadBounds,nudgePoint,haloColor,projectiveMatrix,HaloController}=require('../src/halo');
const {migrateStoredSettings}=require('../src/config');

test('stored rectangular alignments migrate before default corner settings can mask them',()=>{
  const stored={halo:{enabled:true,frame:{left:.115,top:.125,right:.1225,bottom:.125}}};
  const migrated=migrateStoredSettings(stored);
  assert.deepEqual(migrated.halo.points,[{x:.115,y:.125},{x:.8775,y:.125},{x:.8775,y:.875},{x:.115,y:.875}]);
  assert.equal('frame' in migrated.halo,false);
});

test('old Y9 labels migrate to the product name while retaining the EDID alias',()=>{
  const migrated=migrateStoredSettings({projector:{match:'Y9'}});
  assert.equal(migrated.projector.match,'OWNKNEW');
  assert.deepEqual(migrated.projector.aliases,['Y9']);
});

test('four-point settings migrate old edges and reject folded or collapsed geometry',()=>{
  assert.deepEqual(normalizeHalo(null),DEFAULT_HALO);
  assert.equal(normalizeHalo({}).alwaysOn,true);
  assert.equal(normalizeHalo({alwaysOn:false}).alwaysOn,false);
  assert.deepEqual(normalizeHalo({enabled:true,frame:{left:.1,top:.06,right:.12,bottom:.09}}).points,[{x:.1,y:.06},{x:.88,y:.06},{x:.88,y:.91},{x:.1,y:.91}]);
  assert.equal(validQuad([{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]),true);
  assert.equal(validQuad([{x:.1,y:.1},{x:.9,y:.9},{x:.9,y:.1},{x:.1,y:.9}]),false);
  assert.throws(()=>parseHalo({enabled:true,mode:'app',intensity:.2,points:[{x:.1,y:.1},{x:.9,y:.9},{x:.9,y:.1},{x:.1,y:.9}]}),/four screen corners/);
  assert.throws(()=>parseHalo({enabled:'yes',mode:'app',intensity:.2,points:DEFAULT_HALO.points}),/valid Halo settings/);
  assert.equal(parseHalo({enabled:true,mode:'app',intensity:1,points:DEFAULT_HALO.points}).intensity,1);
  assert.throws(()=>parseHalo({enabled:true,mode:'app',intensity:1.01,points:DEFAULT_HALO.points}),/valid Halo settings/);
});

test('corner nudging preserves order and the bounding rectangle follows all four points',()=>{
  const value={enabled:true,mode:'app',intensity:.2,points:[{x:.1,y:.08},{x:.9,y:.12},{x:.88,y:.9},{x:.12,y:.86}]};
  const moved=nudgePoint(value,0,.005,-.005);
  assert.ok(Math.abs(moved.points[0].x-.105)<1e-12);assert.ok(Math.abs(moved.points[0].y-.075)<1e-12);
  assert.deepEqual(quadBounds({x:1920,y:0,width:1920,height:1080},value),{x:2112,y:86,width:1536,height:886});
  assert.throws(()=>nudgePoint(value,0,1,0),/Invalid corner movement/);
});

test('projective matrix maps the full source raster onto every saved corner',()=>{
  const value={enabled:true,mode:'app',intensity:.2,points:[{x:.1,y:.08},{x:.9,y:.12},{x:.88,y:.9},{x:.12,y:.86}]},width=1920,height=1080,{matrix}=projectiveMatrix(value,width,height);
  const map=(x,y)=>{const den=matrix[3]*x+matrix[7]*y+matrix[15];return{x:(matrix[0]*x+matrix[4]*y+matrix[12])/den,y:(matrix[1]*x+matrix[5]*y+matrix[13])/den};};
  const actual=[map(0,0),map(width,0),map(width,height),map(0,height)];
  actual.forEach((point,index)=>{assert.ok(Math.abs(point.x-value.points[index].x*width)<.001);assert.ok(Math.abs(point.y-value.points[index].y*height)<.001);});
  assert.equal(haloColor(value,'#12abef'),'#12abef');
});

test('transparent Halo overlay never takes focus, resolves one continuous capture source and stays above content',async()=>{
  let options;const calls=[];
  class FakeWindow extends EventEmitter{
    constructor(){super();this.visible=false;this.destroyed=false;this.webContents=new EventEmitter();this.webContents.send=(...args)=>calls.push(['send',...args]);this.webContents.setWindowOpenHandler=()=>{};}
    setIgnoreMouseEvents(...args){calls.push(['ignore',...args]);}setMenuBarVisibility(value){calls.push(['menu',value]);}setContentProtection(value){calls.push(['contentProtection',value]);}loadFile(file){calls.push(['load',file]);}setBounds(bounds){calls.push(['bounds',bounds]);}showInactive(){this.visible=true;calls.push(['inactive']);}setAlwaysOnTop(...args){calls.push(['top',...args]);}moveTop(){calls.push(['moveTop']);}isVisible(){return this.visible;}isDestroyed(){return this.destroyed;}hide(){this.visible=false;}destroy(){this.destroyed=true;this.emit('closed');}
  }
  let sourceRequests=0;const controller=new HaloController({createWindow:value=>{options=value;return new FakeWindow();},getSources:async()=>{sourceRequests++;return[{id:'screen:y9:0',display_id:'77'}];}}),display={id:77,bounds:{x:1920,y:0,width:1920,height:1080}},zones=Array.from({length:12},(_,i)=>({edge:Math.floor(i/3),t:[.18,.5,.82][i%3],color:'#123456'}));
  controller.show(display,{...DEFAULT_HALO,enabled:true},{accent:'#abcdef',zones,dynamic:'live',guide:true,selected:2});
  assert.equal(options.focusable,false);assert.equal(options.transparent,true);assert.equal(options.alwaysOnTop,true);assert.equal(options.skipTaskbar,true);assert.ok(calls.some(call=>call[0]==='contentProtection'&&call[1]===true));
  controller.win.webContents.emit('did-finish-load');
  assert.equal(controller.visible,true);assert.ok(calls.some(call=>call[0]==='ignore'&&call[1]===true));assert.ok(calls.some(call=>call[0]==='moveTop'));
  await new Promise(resolve=>setImmediate(resolve));
  const states=calls.filter(call=>call[0]==='send'&&call[1]==='halo'),state=states.at(-1)[2];assert.equal(state.points.length,4);assert.equal(state.zones.length,12);assert.equal(state.dynamic,'live');assert.equal(state.selected,2);assert.equal(state.maskOutside,true);assert.equal(state.captureSourceId,'screen:y9:0');assert.equal(sourceRequests,1);
  controller.close();assert.equal(controller.win,null);
});

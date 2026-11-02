'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {isProtectedUrl,onTargetCreated,onDialogOpening,armPopupCloser,DIALOG_SCRIPT,POPUP_SCRIPT}=require('../src/popup-closer');

test('HBO Max windows are protected from popup cleanup',()=>{
  assert.equal(isProtectedUrl('https://play.hbomax.com/'),true);
  assert.equal(isProtectedUrl('https://www.netflix.com/'),true);
  assert.equal(isProtectedUrl('https://unrelated.example/'),false);
});

test('a user-opened sign-in window survives JoJo popup cleanup',()=>{
  const calls=[];
  onTargetCreated({setupMode:true,tile:{blockPopups:true},cdp:{send:(...args)=>calls.push(args)},mainTargetId:'main'}, {type:'page',targetId:'account',url:'https://watch-jojo.netlify.app/'});
  assert.equal(calls.length,0);
});

test('leaving a popup-blocked tile removes its future-page scripts',async()=>{
  const calls=[];
  const browser={tile:{id:'netflix',url:'https://www.netflix.com/'},pageSession:'page',_popupScripts:new Map([['page','script-1']]),cdp:{send:async(...args)=>{calls.push(args);return {};}}};
  await armPopupCloser(browser);
  assert.equal(browser._popupScripts.size,0);
  assert.deepEqual(calls,[['Page.removeScriptToEvaluateOnNewDocument',{identifier:'script-1'},'page']]);
});

test('Movy native dialogs are dismissed while ordinary app dialogs remain untouched',()=>{
  const calls=[];const cdp={send:(...args)=>{calls.push(args);return Promise.resolve({});}};
  onDialogOpening({tile:{id:'movy',blockDialogs:true},cdp,pageSession:'page',frameSessions:new Set()},'page');
  onDialogOpening({tile:{id:'netflix'},cdp,pageSession:'page',frameSessions:new Set()},'page');
  assert.deepEqual(calls,[['Page.handleJavaScriptDialog',{accept:false},'page']]);
  assert.match(DIALOG_SCRIPT,/Object\.defineProperty\(window, name/);
  assert.match(DIALOG_SCRIPT,/confirm: function \(\) \{ return false; \}/);
});

test('Movy cannot restore dialog or popup APIs after the document-start guard',()=>{
  const window={};window.window=window;window.document={addEventListener(){}};window.setInterval=()=>1;
  vm.runInNewContext(`${POPUP_SCRIPT}\n${DIALOG_SCRIPT}`,window);
  const hostile=()=>true;
  window.alert=hostile;window.confirm=hostile;window.prompt=hostile;window.open=hostile;
  assert.equal(window.alert('install Opera GX'),undefined);
  assert.equal(window.confirm('install Opera GX'),false);
  assert.equal(window.prompt('install Opera GX'),null);
  assert.notEqual(window.open,hostile);
  assert.throws(()=>Object.defineProperty(window,'alert',{value:hostile}),/redefine property/i);
});

test('Opera-GX srcdoc ad frames are rejected before they can render or open anything',()=>{
  class FakeFrame{
    constructor(){this.tagName='IFRAME';this._srcdoc='';this.removed=false;this.style={setProperty:()=>{this.hidden=true;}};}
    get srcdoc(){return this._srcdoc;}set srcdoc(value){this._srcdoc=value;}
    getAttribute(name){return name==='srcdoc'?this._srcdoc:'';}remove(){this.removed=true;}querySelectorAll(){return[];}
  }
  class Observer{constructor(callback){this.callback=callback;}observe(){} }
  const document={addEventListener(){},querySelectorAll(){return[];}};
  const window={document,setInterval:()=>1,HTMLIFrameElement:FakeFrame,MutationObserver:Observer};window.window=window;
  vm.runInNewContext(POPUP_SCRIPT,window);
  const blocked=new FakeFrame();blocked.srcdoc='<p>Please install <strong>Opera GX</strong> to unlock the content.</p><script>top.postMessage({$G$:1},"*")<\/script>';
  assert.equal(blocked.srcdoc,'');assert.equal(blocked.hidden,true);assert.equal(window.__lumenRemovedAdFrames,1);
  const legitimate=new FakeFrame();legitimate.srcdoc='<p>Episode player</p>';
  assert.equal(legitimate.srcdoc,'<p>Episode player</p>');assert.notEqual(legitimate.hidden,true);
});

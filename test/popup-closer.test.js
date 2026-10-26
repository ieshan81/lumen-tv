'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {isProtectedUrl,onTargetCreated,armPopupCloser}=require('../src/popup-closer');

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

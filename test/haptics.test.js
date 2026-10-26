'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const createHaptics=require('../remote/haptics');

test('haptics use distinct bounded patterns, throttle duplicates and preserve the phone preference',()=>{
  const pulses=[];const saved=new Map();let time=0;
  const options={navigator:{vibrate:p=>{pulses.push(p);return true;}},storage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},now:()=>time};
  const h=createHaptics(options);
  assert.equal(h.trigger('selection'),true);assert.equal(h.trigger('impact'),false);
  time=100;assert.equal(h.trigger('impact'),true);
  time=200;assert.equal(h.trigger('primary'),true);
  assert.deepEqual(pulses,[10,18,[12,40,12]]);
  h.setEnabled(false);time=300;assert.equal(h.trigger(),false);
  assert.equal(saved.get('lumen-haptics'),'off');assert.equal(pulses.at(-1),0);
  assert.equal(createHaptics(options).enabled,false);
  h.setEnabled(true);assert.equal(h.trigger('primary',true),true);
});

test('unsupported, hidden or denied haptics never break remote actions',()=>{
  const unsupported=createHaptics({navigator:{},storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});
  assert.equal(unsupported.supported,false);assert.equal(unsupported.trigger(),false);
  assert.doesNotThrow(()=>unsupported.setEnabled(false));assert.doesNotThrow(()=>unsupported.cancel());
  const hidden=createHaptics({navigator:{vibrate(){throw Error('must not run');}},visible:()=>false});
  assert.equal(hidden.trigger(),false);
  const denied=createHaptics({navigator:{vibrate:()=>false}});
  assert.equal(denied.trigger(),false);
  const throws=createHaptics({navigator:{vibrate(){throw Error('unsupported hardware');}}});
  assert.equal(throws.trigger(),false);assert.doesNotThrow(()=>throws.cancel());
});

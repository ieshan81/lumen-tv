'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectProjectorDevice, switchToDevice } = require('../src/audio');

const devices = [
  { id: 'speakers', name: 'Speakers (Realtek Audio)', isDefault: true },
  { id: 'projector', name: 'Y9 (NVIDIA High Definition Audio)', isDefault: false }
];

test('prefers an explicit audio device match', () => {
  const result = selectProjectorDevice(devices, { audio: { deviceMatch: 'nvidia' }, projector: { match: 'other' } });
  assert.equal(result.id, 'projector');
});

test('matches the projector name when no explicit audio name is configured', () => {
  const result = selectProjectorDevice(devices, { audio: { deviceMatch: '' }, projector: { match: 'y9' } });
  assert.equal(result.id, 'projector');
});

test('uses an unambiguous HDMI fallback and refuses ambiguous outputs', () => {
  const one = selectProjectorDevice([{ id: 'hdmi', name: 'Digital Audio (HDMI)' }], { audio: {}, projector: {} });
  assert.equal(one.id, 'hdmi');
  const ambiguous = selectProjectorDevice([
    { id: 'one', name: 'Display Audio HDMI 1' },
    { id: 'two', name: 'Display Audio HDMI 2' }
  ], { audio: {}, projector: {} });
  assert.equal(ambiguous, null);
});

test('saved device identity takes priority and disconnected outputs do not silently fall back', () => {
  assert.equal(selectProjectorDevice(devices,{audio:{deviceId:'speakers'},projector:{match:'Y9'}}).id,'speakers');
  assert.equal(selectProjectorDevice(devices,{audio:{deviceId:'disconnected'},projector:{match:'Y9'}}),null);
});

test('device selection verifies Windows output, rejects stale choices and rolls back failures', async () => {
  let selected='speakers';const calls=[];
  const list=async()=>devices.map(device=>({...device,isDefault:device.id===selected}));
  const set=async id=>{calls.push(id);selected=id;};
  const changed=await switchToDevice('projector',{list,set});
  assert.equal(changed.previousId,'speakers');assert.equal(changed.id,'projector');assert.equal(changed.changed,true);
  assert.equal((await switchToDevice('projector',{list,set})).changed,false);
  await assert.rejects(switchToDevice('disconnected',{list,set}),/disconnected/);
  assert.deepEqual(calls,['projector']);
  await assert.rejects(switchToDevice('speakers',{list,set:async id=>calls.push(id)}),/did not confirm/);
  assert.deepEqual(calls,['projector','speakers','projector']);
});

'use strict';
const { execFile } = require('child_process');
const path = require('path');
const { ROOT } = require('./config');

const SCRIPT = path.join(ROOT, 'scripts', 'audio.ps1');

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
      { windowsHide: true, timeout: 20000 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()))
    );
  });
}

async function listDevices() {
  const out = await run(['list']);
  return JSON.parse(out || '[]');
}

function selectProjectorDevice(devices, settings) {
  if (settings.audio?.deviceId) return devices.find(device => device.id === settings.audio.deviceId) || null;
  const explicit = ((settings.audio && settings.audio.deviceMatch) || '').trim().toLowerCase();
  const projector = ((settings.projector && settings.projector.match) || '').trim().toLowerCase();
  const byName = (needle) => needle && devices.find((device) => device.name.toLowerCase().includes(needle));
  if (explicit) return byName(explicit) || null;
  if (projector) {
    const matched = byName(projector);
    if (matched) return matched;
  }
  const hdmi = devices.filter((device) => /hdmi|display audio|digital audio.*\(hdmi\)/i.test(device.name));
  return hdmi.length === 1 ? hdmi[0] : null;
}

/**
 * Make the projector (or the device named in settings) the default output.
 * Returns what to restore later, or null if nothing was changed.
 */
async function switchToProjector(settings) {
  const devices = await listDevices();
  const wanted = (settings.audio?.deviceName || settings.audio?.deviceMatch || settings.projector?.match || 'HDMI').trim();
  const target = selectProjectorDevice(devices, settings);
  if (!target) throw new Error(`sound device "${wanted}" is not available yet`);
  return switchToDevice(target.id);
}

async function switchToDevice(id, {list = listDevices, set = id => run(['set', id])} = {}) {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Choose an available audio output.');
  const devices = await list();
  const target = devices.find(device => device.id === id);
  if (!target) throw new Error('That audio output disconnected. Refresh the device list.');
  const current = devices.find(device => device.isDefault);
  if (target.isDefault) return {previousId:null, previousName:null, id, name:target.name, changed:false};
  try {
    await set(id);
    const confirmed = (await list()).find(device => device.id === id && device.isDefault);
    if (!confirmed) throw new Error('Windows did not confirm the selected audio output.');
    return {previousId:current?.id, previousName:current?.name, id, name:confirmed.name, changed:true};
  } catch (error) {
    if (current) await set(current.id).catch(() => {});
    throw error;
  }
}

async function restore(change) {
  if (!change || !change.previousId) return;
  const devices = await listDevices();
  if (devices.some((d) => d.id === change.previousId)) await run(['set', change.previousId]);
}

module.exports = { listDevices, selectProjectorDevice, switchToProjector, switchToDevice, restore };

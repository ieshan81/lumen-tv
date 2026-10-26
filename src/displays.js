'use strict';
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { screen } = require('electron');
const { ROOT } = require('./config');
const { selectProjector,hardwareFor,usable } = require('./display-selection');

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

const IDENTITY_FILE=path.join(ROOT,'cache','projector-identity.json');
let inventory=[];
let refreshedAt=0;
let refreshing=null;
let remembered=null;
try { remembered=JSON.parse(fs.readFileSync(IDENTITY_FILE,'utf8')); } catch { /* first recognition */ }
function activeDisplays(){return screen.getAllDisplays().map(d=>({...d,physicalBounds:screen.dipToScreenRect(null,d.bounds)}));}
function recognition(settings){return selectProjector(activeDisplays(),screen.getPrimaryDisplay().id,settings,remembered,inventory);}
function findProjector(settings){return recognition(settings).display;}
function rememberProjector(display,{manual=false}={}){
  if(!usable(display))throw new Error('Choose an active external display.');
  const hardware=hardwareFor({...display,physicalBounds:screen.dipToScreenRect(null,display.bounds)},inventory);
  const next={displayId:display.id,label:display.label||hardware?.name||'Projector',hardwareId:hardware?.hardwareId||null,manual};
  if(remembered?.manual&&!manual)return;
  if(JSON.stringify(next)===JSON.stringify(remembered))return;
  fs.mkdirSync(path.dirname(IDENTITY_FILE),{recursive:true});
  fs.writeFileSync(IDENTITY_FILE,JSON.stringify(next,null,2)+'\n');
  remembered=next;
}
function recognitionState(settings){
  const found=recognition(settings);
  return {status:found.status,reason:found.reason,rememberedLabel:remembered?.label||'',options:activeDisplays().filter(usable).map(d=>({id:d.id,label:d.label||hardwareFor(d,inventory)?.name||'External display',width:d.bounds.width,height:d.bounds.height,selected:d.id===found.display?.id}))};
}
async function refreshInventory(force=false){
  if(refreshing)return refreshing;
  if(!force&&Date.now()-refreshedAt<15000)return inventory;
  refreshing=new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','monitors.ps1')],{windowsHide:true,timeout:12000},(err,stdout)=>{
    if(!err)try{const result=JSON.parse(stdout);if(Array.isArray(result))inventory=result;}catch{/* retain last successful snapshot */}
    refreshedAt=Date.now();resolve(inventory);
  })).finally(()=>{refreshing=null;});
  return refreshing;
}

/**
 * Names of every monitor Windows says is plugged in and working right now, whether or not it is switched on
 * (extended), mirrored, or left off. Electron only sees monitors that are part of the desktop.
 */
function connectedMonitorNames() {
  return refreshInventory().then(items=>items.length?items.map(item=>item.name||''):null);
}

/**
 * True when the projector is plugged in but Windows is not showing the desktop on it separately:
 * mirrored onto another screen, or not switched on at all ("PC screen only"). Returns null if unsure.
 */
async function projectorNeedsExtending(settings) {
  const match = ((settings.projector && settings.projector.match) || '').trim().toLowerCase();
  if (!match || findProjector(settings)) return false;
  const names = await connectedMonitorNames();
  if (!names) return null;
  if(remembered?.manual&&remembered.hardwareId)return inventory.some(item=>item.hardwareId===remembered.hardwareId);
  return names.some((n) => n.toLowerCase().includes(match));
}

function extendDisplays() {
  return new Promise((resolve) => {
    execFile(path.join(SYSTEM32, 'DisplaySwitch.exe'), ['/extend'], { windowsHide: true }, () => resolve());
  });
}

/** Stop sending a picture to the projector so it can drop into standby. */
function internalOnly() {
  return new Promise((resolve) => {
    execFile(path.join(SYSTEM32, 'DisplaySwitch.exe'), ['/internal'], { windowsHide: true }, () => resolve());
  });
}

function audioMatchFor(display){return hardwareFor({...display,physicalBounds:screen.dipToScreenRect(null,display.bounds)},inventory)?.name||display.label||'';}
module.exports = { findProjector, projectorNeedsExtending, extendDisplays, internalOnly, connectedMonitorNames,refreshInventory,rememberProjector,recognitionState,audioMatchFor,invalidateInventory:()=>{refreshedAt=0;} };

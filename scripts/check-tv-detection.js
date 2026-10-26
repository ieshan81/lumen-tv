'use strict';
// Read-only Electron/Windows recognition probe. Does not create a window or alter audio/displays.
const {app,screen}=require('electron');
const fs=require('fs');const path=require('path');
const displays=require('../src/displays');
const {hardwareFor,selectProjector}=require('../src/display-selection');
app.whenReady().then(async()=>{
  try{
    const settings=JSON.parse(fs.readFileSync(path.join(__dirname,'..','settings.json'),'utf8'));
    const inventory=await displays.refreshInventory(true);
    const active=screen.getAllDisplays().map(display=>({...display,physicalBounds:screen.dipToScreenRect(null,display.bounds)}));
    const selected=displays.findProjector(settings);
    const hardware=selected&&hardwareFor({...selected,physicalBounds:screen.dipToScreenRect(null,selected.bounds)},inventory);
    const renamed=selected&&selectProjector(active.map(display=>display.id===selected.id?{...display,id:99999,label:'Generic PnP Monitor'}:display),screen.getPrimaryDisplay().id,settings,null,inventory);
    console.log(JSON.stringify({selected:selected&&{id:selected.id,label:selected.label,displayFrequency:selected.displayFrequency,bounds:selected.bounds,scaleFactor:selected.scaleFactor},nativeIdentityMapped:!!hardware,monitorName:hardware?.name,recognizesGenericLabelWithChangedId:renamed?.display?.id===99999,recognition:displays.recognitionState(settings)}));
  }catch(error){console.error(error.message);process.exitCode=1;}finally{app.quit();}
});

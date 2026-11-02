'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lumenHalo',{
  onState:callback=>ipcRenderer.on('halo',(_event,state)=>callback(state)),
  onStop:callback=>ipcRenderer.on('halo-stop',callback),
  publishStatus:value=>ipcRenderer.send('halo-ambient',value)
});

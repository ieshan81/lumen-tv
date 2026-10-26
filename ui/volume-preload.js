'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('volumeOverlay',{onVolume:callback=>ipcRenderer.on('volume',(_event,state)=>callback(state))});

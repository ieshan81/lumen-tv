'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('lumenPicture',{onPattern:callback=>ipcRenderer.on('picture',(_event,state)=>callback(state))});

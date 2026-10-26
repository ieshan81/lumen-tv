'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumen', {
  ready: () => ipcRenderer.send('ui-ready'),
  launch: (id) => ipcRenderer.send('launch', id),
  action: (name, arg) => ipcRenderer.send('action', name, arg),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onNav: (cb) => ipcRenderer.on('nav', (_e, key) => cb(key)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, text) => cb(text))
});

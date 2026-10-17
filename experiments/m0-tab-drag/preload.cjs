'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('m0', Object.freeze({
  snapshot: () => ipcRenderer.invoke('m0:request', { kind: 'snapshot' }),
  reset: () => ipcRenderer.invoke('m0:request', { kind: 'reset' }),
  showWindowA: () => ipcRenderer.invoke('m0:request', { kind: 'show-a' }),
  mode: mode => ipcRenderer.invoke('m0:request', { kind: 'mode', mode }),
  closeSelfLater: () => ipcRenderer.invoke('m0:request', { kind: 'schedule', action: 'close-self' }),
  closePeerLater: () => ipcRenderer.invoke('m0:request', { kind: 'schedule', action: 'close-peer' }),
  minimizePeerLater: () => ipcRenderer.invoke('m0:request', { kind: 'schedule', action: 'minimize-peer' }),
  prepare: tab => ipcRenderer.invoke('m0:request', { kind: 'prepare', tab }),
  start: (token, distance) => ipcRenderer.invoke('m0:request', { kind: 'start', token, distance }),
  release: (token, button, buttons, trusted) => ipcRenderer.invoke('m0:request', { kind: 'release', token, button, buttons, trusted }),
  drop: (token, slot, local, trusted) => ipcRenderer.invoke('m0:request', { kind: 'drop', token, slot, local, trusted }),
  end: (token, reason) => ipcRenderer.invoke('m0:request', { kind: 'end', token, reason }),
  layout: (rect, mids, zoom, dpr) => ipcRenderer.invoke('m0:request', { kind: 'layout', rect, mids, zoom, dpr }),
  signal: (type, local, screen, button, buttons, trusted, detail) => ipcRenderer.invoke('m0:request', { kind: 'signal', type, local, screen, button, buttons, trusted, detail }),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('m0:state', listener);
    return () => ipcRenderer.removeListener('m0:state', listener);
  },
}));

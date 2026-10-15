import { acquisitionProgressChannel } from './shared/acquisition';
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { createReaderBridge } from './preload/reader-bridge';

contextBridge.exposeInMainWorld('reader', createReaderBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args), listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(acquisitionProgressChannel, receive);
  return () => { ipcRenderer.removeListener(acquisitionProgressChannel, receive); };
}));

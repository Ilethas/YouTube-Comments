import { sharedCommitChannel } from './shared/reader-sync';
import { profileChannels } from './shared/profile-operation';
import { acquisitionProgressChannel } from './shared/acquisition';
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { createReaderBridge } from './preload/reader-bridge';

contextBridge.exposeInMainWorld('reader', createReaderBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args), listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(acquisitionProgressChannel, receive);
  return () => { ipcRenderer.removeListener(acquisitionProgressChannel, receive); };
}, listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(sharedCommitChannel, receive);
  return () => { ipcRenderer.removeListener(sharedCommitChannel, receive); };
}, listener => {
  const receive = (_event: Electron.IpcRendererEvent, value: unknown) => listener(value);
  ipcRenderer.on(profileChannels.event, receive);
  return () => { ipcRenderer.removeListener(profileChannels.event, receive); };
}));

// A fixed main-world adapter, never a renderer evaluation capability. Chromium's
// direct close may destroy WebContents without the native cancellable event;
// route the ordinary affordance through the same authenticated native/M3 path.
contextBridge.executeInMainWorld({ func: () => {
  window.close = () => { void window.reader.closeWindow?.().catch(() => undefined); };
} });

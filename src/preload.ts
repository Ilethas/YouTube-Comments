// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import { createReaderBridge } from './preload/reader-bridge';

contextBridge.exposeInMainWorld('reader', createReaderBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args)));

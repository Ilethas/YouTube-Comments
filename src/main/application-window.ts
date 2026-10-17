import { BrowserWindow } from 'electron';

/** The sole production reader-window factory. The caller registers lifetime
 * listeners before loading the exact trusted document. No renderer options. */
export function createApplicationWindow(preloadPath: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240, height: 900, minWidth: 720, minHeight: 520,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath, nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-redirect', event => event.preventDefault());
  return window;
}

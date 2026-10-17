import { EventEmitter } from 'node:events';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

/** Deterministic native lifetime stand-in; real Electron coverage is separate. */
export function windowFixture(url = 'file:///app/index.html') {
  const frame = () => ({ url, detached: false, isDestroyed: () => false });
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame(), isDestroyed: (): boolean => false });
  const native = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: (): boolean => false });
  const window = native as unknown as BrowserWindow;
  const commit = () => contents.emit('did-frame-navigate', {}, contents.mainFrame.url, 200, 'OK', true);
  const event = () => ({ sender: contents, senderFrame: contents.mainFrame }) as unknown as IpcMainInvokeEvent;
  const reload = () => {
    contents.emit('did-start-navigation', { isMainFrame: true });
    contents.mainFrame = frame(); commit();
  };
  return { window, native, contents, commit, event, reload };
}

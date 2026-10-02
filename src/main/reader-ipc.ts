import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { readerChannels } from '../shared/reader-api';
import type { ReaderOperation } from '../shared/reader-api';
import type { ReaderService } from './reader-service';

/** Only this window's top-level, exact application document may invoke services;
 * reject subframes and other WebContents, even if they know channel names. */
export function registerReaderIpc(service: ReaderService, window: () => BrowserWindow | undefined, documentUrl: string): void {
  for (const operation of Object.keys(readerChannels) as ReaderOperation[]) {
    ipcMain.handle(readerChannels[operation], (event, ...args: unknown[]) => {
      const contents = window()?.webContents;
      if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame
        || event.senderFrame.url !== documentUrl) return { ok: false, error: { code: 'FORBIDDEN' } };
      return service.dispatch(operation, args);
    });
  }
}

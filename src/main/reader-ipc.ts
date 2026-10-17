import { ipcMain } from 'electron';
import type { WindowCoordinator } from './window-coordinator';
import { readerChannels } from '../shared/reader-api';
import type { ReaderOperation } from '../shared/reader-api';
import type { ReaderService } from './reader-service';

/** Register once for the application, independently of window creation. Every
 * invocation requires a registered top-level exact document and current lease. */
export function registerReaderIpc(service: ReaderService, windows: WindowCoordinator): void {
  service.onSharedCommit?.(commit => windows.sendSharedCommit(commit));
  for (const operation of Object.keys(readerChannels) as ReaderOperation[]) {
    ipcMain.handle(readerChannels[operation], (event, ...args: unknown[]) => {
      const caller = windows.resolveCaller(event);
      if (!caller) return { ok: false, error: { code: 'FORBIDDEN' } };
      return service.dispatch(operation, args, caller);
    });
  }
}

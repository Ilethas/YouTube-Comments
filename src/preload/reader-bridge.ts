import { readerChannels } from '../shared/reader-api';
import type { ReaderApi } from '../shared/reader-api';

/** The transport stays private to preload. Renderer receives intent methods only. */
export function createReaderBridge(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): ReaderApi {
  return Object.freeze({
    bootstrap: () => invoke(readerChannels.bootstrap) as ReturnType<ReaderApi['bootstrap']>,
    toggleSeen: request => invoke(readerChannels.toggleSeen, request) as ReturnType<ReaderApi['toggleSeen']>,
    updatePreferences: change => invoke(readerChannels.updatePreferences, change) as ReturnType<ReaderApi['updatePreferences']>,
    acquire: request => invoke(readerChannels.acquire, request) as ReturnType<ReaderApi['acquire']>,
    refresh: request => invoke(readerChannels.refresh, request) as ReturnType<ReaderApi['refresh']>,
  } satisfies ReaderApi);
}

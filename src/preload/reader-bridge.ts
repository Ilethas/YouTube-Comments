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
    openStoredItem: request => invoke(readerChannels.openStoredItem, request) as ReturnType<ReaderApi['openStoredItem']>,
    activateTab: request => invoke(readerChannels.activateTab, request) as ReturnType<ReaderApi['activateTab']>,
    closeTab: request => invoke(readerChannels.closeTab, request) as ReturnType<ReaderApi['closeTab']>,
  } satisfies ReaderApi);
}

import { readerChannels } from '../shared/reader-api';
import type { ReaderApi } from '../shared/reader-api';

/** The transport stays private to preload. Renderer receives these three methods. */
export function createReaderBridge(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): ReaderApi {
  return Object.freeze({
    bootstrap: () => invoke(readerChannels.bootstrap) as ReturnType<ReaderApi['bootstrap']>,
    toggleSeen: request => invoke(readerChannels.toggleSeen, request) as ReturnType<ReaderApi['toggleSeen']>,
    updatePreferences: change => invoke(readerChannels.updatePreferences, change) as ReturnType<ReaderApi['updatePreferences']>,
  } satisfies ReaderApi);
}

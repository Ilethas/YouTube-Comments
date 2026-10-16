import { isAcquisitionNotification } from '../shared/acquisition';
import { readerChannels } from '../shared/reader-api';
import type { ReaderApi } from '../shared/reader-api';

/** The transport stays private to preload. Renderer receives intent methods only. */
export function createReaderBridge(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribe: (listener: (value: unknown) => void) => () => void = () => () => undefined): ReaderApi {
  return Object.freeze({
    openCommentAction: request => invoke(readerChannels.openCommentAction, request) as ReturnType<ReaderApi['openCommentAction']>,
    createBackup: () => invoke(readerChannels.createBackup) as ReturnType<ReaderApi['createBackup']>,
    restoreBackup: () => invoke(readerChannels.restoreBackup) as ReturnType<ReaderApi['restoreBackup']>,
    onAcquisitionProgress: listener => subscribe(value => { if (isAcquisitionNotification(value)) listener(value); }),
    getAcquisitionProgress: () => invoke(readerChannels.getAcquisitionProgress) as ReturnType<ReaderApi['getAcquisitionProgress']>,
    cancelAcquisition: request => invoke(readerChannels.cancelAcquisition, request) as ReturnType<ReaderApi['cancelAcquisition']>,
    saveDiscussionView: request => invoke(readerChannels.saveDiscussionView, request) as ReturnType<ReaderApi['saveDiscussionView']>,
    openSource: request => invoke(readerChannels.openSource, request) as ReturnType<ReaderApi['openSource']>,
    getHelperStatus: request => invoke(readerChannels.getHelperStatus, request) as ReturnType<ReaderApi['getHelperStatus']>,
    chooseHelper: request => invoke(readerChannels.chooseHelper, request) as ReturnType<ReaderApi['chooseHelper']>,
    clearHelper: request => invoke(readerChannels.clearHelper, request) as ReturnType<ReaderApi['clearHelper']>,
    bulkSeen: request => invoke(readerChannels.bulkSeen, request) as ReturnType<ReaderApi['bulkSeen']>,
    undoSeen: request => invoke(readerChannels.undoSeen, request) as ReturnType<ReaderApi['undoSeen']>,
    openLibrary: () => invoke(readerChannels.openLibrary) as ReturnType<ReaderApi['openLibrary']>,
    openSettings: () => invoke(readerChannels.openSettings) as ReturnType<ReaderApi['openSettings']>,
    moveTab: request => invoke(readerChannels.moveTab, request) as ReturnType<ReaderApi['moveTab']>,
    removeLibraryItem: request => invoke(readerChannels.removeLibraryItem, request) as ReturnType<ReaderApi['removeLibraryItem']>,
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

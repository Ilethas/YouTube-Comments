import { isTransferEvent, transferChannels } from '../shared/tab-transfer';
import type { TabTransferApi } from '../shared/tab-transfer';
import { isSharedCommit } from '../shared/reader-sync';
import { isAcquisitionNotification } from '../shared/acquisition';
import { readerChannels } from '../shared/reader-api';
import type { ReaderApi } from '../shared/reader-api';
import { isProfileEvent, profileChannels } from '../shared/profile-operation';
import type { ProfileLifecycleApi } from '../shared/profile-operation';

/** The transport stays private to preload. Renderer receives intent methods only. */
export function createReaderBridge(rawInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribe: (listener: (value: unknown) => void) => () => void = () => () => undefined,
  sharedSubscribe: (listener: (value: unknown) => void) => () => void = () => () => undefined,
  profileSubscribe?: (listener: (value: unknown) => void) => () => void,
  transferSubscribe?: (listener: (value: unknown) => void) => () => void): ReaderApi {
  const pending = new Set<Promise<unknown>>();
  const tracked = new Set<string>(['importTheme', 'importWallpaper', 'duplicateTab', 'toggleSeen', 'bulkSeen', 'undoSeen', 'updatePreferences', 'openStoredItem', 'activateTab', 'closeTab', 'openLibrary', 'openSettings', 'moveTab', 'removeLibraryItem', 'chooseHelper', 'clearHelper', 'getHelperStatus'].map(key => readerChannels[key as keyof typeof readerChannels]));
  const invoke = (channel: string, ...args: unknown[]) => {
    const task = rawInvoke(channel, ...args);
    if (tracked.has(channel)) { pending.add(task); void task.then(() => pending.delete(task), () => pending.delete(task)); }
    return task;
  };
  const lifecycle: ProfileLifecycleApi | undefined = profileSubscribe ? Object.freeze({
    stage: command => invoke(profileChannels.stage, command) as ReturnType<ProfileLifecycleApi['stage']>,
    submit: ticket => invoke(profileChannels.submit, ticket) as ReturnType<ProfileLifecycleApi['submit']>,
    settleAccepted: async () => {
      const results = await Promise.allSettled([...pending]);
      return results.every(result => result.status === 'fulfilled' && (result.value as { ok?: boolean })?.ok === true);
    },
    onEvent: listener => profileSubscribe(value => { if (isProfileEvent(value)) listener(value); }),
    current: () => invoke(profileChannels.current) as ReturnType<ProfileLifecycleApi['current']>,
    plan: (identity, commands) => invoke(profileChannels.plan, identity, commands) as ReturnType<ProfileLifecycleApi['plan']>,
    command: (grant, sequence, command) => invoke(profileChannels.command, grant, sequence, command) as ReturnType<ProfileLifecycleApi['command']>,
    ack: (grant, succeeded) => invoke(profileChannels.ack, grant, succeeded) as ReturnType<ProfileLifecycleApi['ack']>,
    refuse: identity => invoke(profileChannels.refuse, identity) as ReturnType<ProfileLifecycleApi['refuse']>,
    resume: identity => invoke(profileChannels.resume, identity) as ReturnType<ProfileLifecycleApi['resume']>,
  } satisfies ProfileLifecycleApi) : undefined;
  const transfers: TabTransferApi | undefined = transferSubscribe ? Object.freeze({
    destinations: () => invoke(transferChannels.destinations) as ReturnType<TabTransferApi['destinations']>,
    begin: request => invoke(transferChannels.begin, request) as ReturnType<TabTransferApi['begin']>,
    prepareDrag: request => invoke(transferChannels.prepareDrag, request) as ReturnType<TabTransferApi['prepareDrag']>,
    startDrag: request => invoke(transferChannels.startDrag, request) as ReturnType<TabTransferApi['startDrag']>,
    hoverDrag: request => invoke(transferChannels.hoverDrag, request) as ReturnType<TabTransferApi['hoverDrag']>,
    offerDrag: request => invoke(transferChannels.offerDrag, request) as ReturnType<TabTransferApi['offerDrag']>,
    endDrag: request => invoke(transferChannels.endDrag, request) as ReturnType<TabTransferApi['endDrag']>,
    adopted: request => invoke(transferChannels.adopted, request) as ReturnType<TabTransferApi['adopted']>,
    move: request => invoke(transferChannels.move, request) as ReturnType<TabTransferApi['move']>,
    ready: request => invoke(transferChannels.ready, request) as ReturnType<TabTransferApi['ready']>,
    cancel: request => invoke(transferChannels.cancel, request) as ReturnType<TabTransferApi['cancel']>,
    onEvent: listener => transferSubscribe(value => { if (isTransferEvent(value)) listener(value); }),
  } satisfies TabTransferApi) : undefined;
  return Object.freeze({
    ...(transfers ? { transfers } : {}),
    windowReady: () => invoke('reader:window-ready') as Promise<import('../shared/reader-api').Result<null>>,
    closeWindow: () => invoke('reader:window-close') as Promise<import('../shared/reader-api').Result<null>>,
    newWindow: () => invoke('reader:window-new') as Promise<import('../shared/reader-api').Result<null>>,
    quitApplication: () => invoke('reader:application-quit') as Promise<import('../shared/reader-api').Result<null>>,
    ...(lifecycle ? { lifecycle } : {}),
    onSharedCommit: listener => sharedSubscribe(value => { if (isSharedCommit(value)) listener(value); }),
    getSharedSnapshot: request => (request === undefined ? invoke(readerChannels.getSharedSnapshot) : invoke(readerChannels.getSharedSnapshot, request)) as ReturnType<ReaderApi['getSharedSnapshot']>,
    getDiscussionView: request => invoke(readerChannels.getDiscussionView, request) as ReturnType<ReaderApi['getDiscussionView']>,
    duplicateTab: request => invoke(readerChannels.duplicateTab, request) as ReturnType<ReaderApi['duplicateTab']>,
    getSharedMetadata: () => invoke(readerChannels.getSharedMetadata) as ReturnType<ReaderApi['getSharedMetadata']>,
    importTheme: () => invoke(readerChannels.importTheme) as Promise<import('../shared/reader-api').Result<import('../shared/preferences').Preferences | null>>,
    importWallpaper: () => invoke(readerChannels.importWallpaper) as Promise<import('../shared/reader-api').Result<import('../shared/preferences').Preferences | null>>,
    getWallpaper: () => invoke(readerChannels.getWallpaper) as Promise<import('../shared/reader-api').Result<string | null>>,
    getThumbnail: request => invoke(readerChannels.getThumbnail, request) as ReturnType<ReaderApi['getThumbnail']>,
    checkThumbnail: request => invoke(readerChannels.checkThumbnail, request) as ReturnType<ReaderApi['checkThumbnail']>,
    openThumbnail: request => invoke(readerChannels.openThumbnail, request) as ReturnType<ReaderApi['openThumbnail']>,
    openCommentAction: request => invoke(readerChannels.openCommentAction, request) as ReturnType<ReaderApi['openCommentAction']>,
    createBackup: () => invoke(readerChannels.createBackup) as ReturnType<ReaderApi['createBackup']>,
    restoreBackup: () => invoke(readerChannels.restoreBackup) as ReturnType<ReaderApi['restoreBackup']>,
    onAcquisitionProgress: listener => subscribe(value => { if (isAcquisitionNotification(value)) listener(value); }),
    getAcquisitionProgress: () => invoke(readerChannels.getAcquisitionProgress) as ReturnType<ReaderApi['getAcquisitionProgress']>,
    cancelAcquisition: request => invoke(readerChannels.cancelAcquisition, request) as ReturnType<ReaderApi['cancelAcquisition']>,
    setDiscussionCollapse: request => invoke(readerChannels.setDiscussionCollapse, request) as ReturnType<ReaderApi['setDiscussionCollapse']>,
    saveDiscussionView: request => invoke(readerChannels.saveDiscussionView, request) as ReturnType<ReaderApi['saveDiscussionView']>,
    openSource: request => invoke(readerChannels.openSource, request) as ReturnType<ReaderApi['openSource']>,
    getHelperStatus: request => invoke(readerChannels.getHelperStatus, request) as ReturnType<ReaderApi['getHelperStatus']>,
    chooseHelper: request => invoke(readerChannels.chooseHelper, request) as ReturnType<ReaderApi['chooseHelper']>,
    clearHelper: request => invoke(readerChannels.clearHelper, request) as ReturnType<ReaderApi['clearHelper']>,
    bulkSeen: request => invoke(readerChannels.bulkSeen, request) as ReturnType<ReaderApi['bulkSeen']>,
    undoSeen: request => invoke(readerChannels.undoSeen, request) as ReturnType<ReaderApi['undoSeen']>,
    openLibrary: request => invoke(readerChannels.openLibrary, request) as ReturnType<ReaderApi['openLibrary']>,
    openSettings: request => invoke(readerChannels.openSettings, request) as ReturnType<ReaderApi['openSettings']>,
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

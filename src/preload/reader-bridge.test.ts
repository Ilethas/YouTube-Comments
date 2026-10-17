import { expect, it, vi } from 'vitest';
import { createReaderBridge } from './reader-bridge';
import { readerChannels } from '../shared/reader-api';
import { defaultQuery } from '../domain/discussion-query';

it('exposes only explicit intent and progress methods without a generic privileged transport', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: {} }));
  const api = createReaderBridge(invoke);
  expect(Object.keys(api).sort()).toEqual(['acquire', 'activateTab', 'bootstrap', 'bulkSeen', 'cancelAcquisition', 'checkThumbnail', 'chooseHelper', 'clearHelper', 'closeTab', 'createBackup', 'getAcquisitionProgress', 'getHelperStatus', 'getThumbnail', 'moveTab', 'onAcquisitionProgress', 'openCommentAction', 'openLibrary', 'openSettings', 'openSource', 'openStoredItem', 'openThumbnail', 'refresh', 'removeLibraryItem', 'restoreBackup', 'saveDiscussionView', 'setDiscussionCollapse', 'toggleSeen', 'undoSeen', 'updatePreferences']);
  await api.getHelperStatus({ kind: 'yt-dlp' });
  await api.chooseHelper({ kind: 'post-archiver' });
  await api.clearHelper({ kind: 'yt-dlp' });
  expect(Object.isFrozen(api)).toBe(true);
  await api.openCommentAction({ itemId: 'stored-item', commentId: 'stored-comment', action: 'translate' });
  await api.openSource({ itemId: 'stored-item' });
  await api.bootstrap();
  await api.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: true });
  await api.updatePreferences({ appearance: 'system' });
  await api.acquire({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  await api.refresh({ itemId: 'stored-item' });
  await api.openStoredItem({ itemId: 'stored-item' });
  await api.activateTab({ tabId: 'stored-item' });
  await api.closeTab({ tabId: 'stored-item' });
  await api.openLibrary();
  await api.openSettings();
  await api.moveTab({ tabId: 'library', toIndex: 0 });
  await api.removeLibraryItem({ itemId: 'stored-item' });
  await api.bulkSeen({ itemId: 'stored-item', seen: true, target: { kind: 'all' } });
  await api.undoSeen({ itemId: 'stored-item' });
  expect(invoke.mock.calls).toEqual([
    [readerChannels.getHelperStatus, { kind: 'yt-dlp' }],
    [readerChannels.chooseHelper, { kind: 'post-archiver' }],
    [readerChannels.clearHelper, { kind: 'yt-dlp' }],
    [readerChannels.openCommentAction, { itemId: 'stored-item', commentId: 'stored-comment', action: 'translate' }],
    [readerChannels.openSource, { itemId: 'stored-item' }],
    [readerChannels.bootstrap],
    [readerChannels.toggleSeen, { itemId: 'video-demo', commentId: 'v2', subtree: true }],
    [readerChannels.updatePreferences, { appearance: 'system' }],
    [readerChannels.acquire, { url: 'https://www.youtube.com/watch?v=abcdefghijk' }],
    [readerChannels.refresh, { itemId: 'stored-item' }],
    [readerChannels.openStoredItem, { itemId: 'stored-item' }],
    [readerChannels.activateTab, { tabId: 'stored-item' }],
    [readerChannels.closeTab, { tabId: 'stored-item' }],
    [readerChannels.openLibrary],
    [readerChannels.openSettings],
    [readerChannels.moveTab, { tabId: 'library', toIndex: 0 }],
    [readerChannels.removeLibraryItem, { itemId: 'stored-item' }],
    [readerChannels.bulkSeen, { itemId: 'stored-item', seen: true, target: { kind: 'all' } }],
    [readerChannels.undoSeen, { itemId: 'stored-item' }],
  ]);
  const intent = { itemId: 'stored-item', draft: defaultQuery, applied: defaultQuery, sort: 'original' as const, anchor: { commentId: null, offset: 0 }, selected: null };
  await api.setDiscussionCollapse({ itemId: 'stored-item', kind: 'all', collapsed: true });
  expect(invoke).toHaveBeenLastCalledWith(readerChannels.setDiscussionCollapse, { itemId: 'stored-item', kind: 'all', collapsed: true });
  await api.saveDiscussionView(intent);
  expect(invoke).toHaveBeenLastCalledWith(readerChannels.saveDiscussionView, intent);
  await api.createBackup(); await api.restoreBackup();
  expect(invoke.mock.calls.slice(-2)).toEqual([[readerChannels.createBackup], [readerChannels.restoreBackup]]);
  await api.getThumbnail({ itemId: 'stored-item' }); await api.checkThumbnail({ itemId: 'stored-item' }); await api.openThumbnail({ itemId: 'stored-item' });
  expect(invoke.mock.calls.slice(-3)).toEqual([[readerChannels.getThumbnail, { itemId: 'stored-item' }], [readerChannels.checkThumbnail, { itemId: 'stored-item' }], [readerChannels.openThumbnail, { itemId: 'stored-item' }]]);
});

it('progress subscription validates exact payloads and returns transport cleanup', async () => {
  let receive!: (value: unknown) => void;
  const unsubscribe = vi.fn(), listener = vi.fn(), invoke = vi.fn(async () => ({ ok: true, value: null }));
  const api = createReaderBridge(invoke, callback => { receive = callback; return unsubscribe; });
  const cleanup = api.onAcquisitionProgress(listener);
  const progress = { operationId: 'opaque-id', kind: 'acquire', sourceKind: 'youtube-video', stage: 'fetching', startedAt: 100, cancellable: true };
  for (const invalid of [null, {}, { ...progress, executable: 'C:/private.exe' }, { ...progress, stderr: 'secret' },
    { ...progress, startedAt: NaN }, { ...progress, stage: 'saving' }, { operationId: 'id', settled: true, path: 'private' }]) receive(invalid);
  expect(listener).not.toHaveBeenCalled();
  receive(progress); receive({ operationId: 'opaque-id', settled: true });
  expect(listener.mock.calls).toEqual([[progress], [{ operationId: 'opaque-id', settled: true }]]);
  cleanup(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  await api.cancelAcquisition({ operationId: 'opaque-id' }); await api.getAcquisitionProgress();
  expect(invoke.mock.calls).toEqual([[readerChannels.cancelAcquisition, { operationId: 'opaque-id' }], [readerChannels.getAcquisitionProgress]]);
});

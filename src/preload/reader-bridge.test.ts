import { expect, it, vi } from 'vitest';
import { createReaderBridge } from './reader-bridge';
import { readerChannels } from '../shared/reader-api';
import { defaultQuery } from '../domain/discussion-query';
import { profileChannels } from '../shared/profile-operation';

it('exposes only explicit intent and progress methods without a generic privileged transport', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: {} }));
  const api = createReaderBridge(invoke);
  expect(Object.keys(api).sort()).toEqual(['acquire', 'activateTab', 'bootstrap', 'bulkSeen', 'cancelAcquisition', 'checkThumbnail', 'chooseHelper', 'clearHelper', 'closeTab', 'createBackup', 'duplicateTab', 'getAcquisitionProgress', 'getDiscussionView', 'getHelperStatus', 'getSharedMetadata', 'getSharedSnapshot', 'getThumbnail', 'moveTab', 'onAcquisitionProgress', 'onSharedCommit', 'openCommentAction', 'openLibrary', 'openSettings', 'openSource', 'openStoredItem', 'openThumbnail', 'refresh', 'removeLibraryItem', 'restoreBackup', 'saveDiscussionView', 'setDiscussionCollapse', 'toggleSeen', 'undoSeen', 'updatePreferences']);
  await api.getDiscussionView({ viewId: 'owned-view' });
  await api.duplicateTab({ sourceViewId: 'owned-view', expectedRevision: 3, intentRevision: 2, collapseRevision: 1 });
  expect(invoke.mock.calls.splice(0)).toEqual([[readerChannels.getDiscussionView, { viewId: 'owned-view' }], [readerChannels.duplicateTab, { sourceViewId: 'owned-view', expectedRevision: 3, intentRevision: 2, collapseRevision: 1 }]]);
  await api.getHelperStatus({ kind: 'yt-dlp' });
  await api.chooseHelper({ kind: 'post-archiver' });
  await api.clearHelper({ kind: 'yt-dlp' });
  expect(Object.isFrozen(api)).toBe(true);
  await api.openCommentAction({ itemId: 'stored-item', commentId: 'stored-comment', action: 'translate' });
  await api.openSource({ itemId: 'stored-item' });
  await api.bootstrap();
  await api.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: true, seen: true });
  await api.updatePreferences({ appearance: 'system' });
  await api.acquire({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  await api.refresh({ itemId: 'stored-item' });
  await api.openStoredItem({ expectedRevision: 0, itemId: 'stored-item' });
  await api.activateTab({ expectedRevision: 0, tabId: 'stored-item' });
  await api.closeTab({ expectedRevision: 0, tabId: 'stored-item' });
  await api.openLibrary({ expectedRevision: 0 });
  await api.openSettings({ expectedRevision: 0 });
  await api.moveTab({ expectedRevision: 0, tabId: 'library', toIndex: 0 });
  await api.removeLibraryItem({ itemId: 'stored-item' });
  await api.bulkSeen({ itemId: 'stored-item', seen: true, target: { kind: 'all' } });
  await api.undoSeen({ itemId: 'stored-item', expectedOperationId: 'operation' });
  expect(invoke.mock.calls).toEqual([
    [readerChannels.getHelperStatus, { kind: 'yt-dlp' }],
    [readerChannels.chooseHelper, { kind: 'post-archiver' }],
    [readerChannels.clearHelper, { kind: 'yt-dlp' }],
    [readerChannels.openCommentAction, { itemId: 'stored-item', commentId: 'stored-comment', action: 'translate' }],
    [readerChannels.openSource, { itemId: 'stored-item' }],
    [readerChannels.bootstrap],
    [readerChannels.toggleSeen, { itemId: 'video-demo', commentId: 'v2', subtree: true, seen: true }],
    [readerChannels.updatePreferences, { appearance: 'system' }],
    [readerChannels.acquire, { url: 'https://www.youtube.com/watch?v=abcdefghijk' }],
    [readerChannels.refresh, { itemId: 'stored-item' }],
    [readerChannels.openStoredItem, { expectedRevision: 0, itemId: 'stored-item' }],
    [readerChannels.activateTab, { expectedRevision: 0, tabId: 'stored-item' }],
    [readerChannels.closeTab, { expectedRevision: 0, tabId: 'stored-item' }],
    [readerChannels.openLibrary, { expectedRevision: 0 }],
    [readerChannels.openSettings, { expectedRevision: 0 }],
    [readerChannels.moveTab, { expectedRevision: 0, tabId: 'library', toIndex: 0 }],
    [readerChannels.removeLibraryItem, { itemId: 'stored-item' }],
    [readerChannels.bulkSeen, { itemId: 'stored-item', seen: true, target: { kind: 'all' } }],
    [readerChannels.undoSeen, { itemId: 'stored-item', expectedOperationId: 'operation' }],
  ]);
  const intent = { viewId: 'stored-view', expectedRevision: 0, draft: defaultQuery, applied: defaultQuery, sort: 'original' as const, anchor: { commentId: null, offset: 0 }, selected: null };
  await api.setDiscussionCollapse({ viewId: 'stored-view', expectedRevision: 0, kind: 'all', collapsed: true });
  expect(invoke).toHaveBeenLastCalledWith(readerChannels.setDiscussionCollapse, { viewId: 'stored-view', expectedRevision: 0, kind: 'all', collapsed: true });
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

it('M3 exposes only fixed lifecycle intents and validates lifecycle notifications and cleanup', async () => {
  let receive!: (value: unknown) => void;
  const cleanup = vi.fn(), invoke = vi.fn(async () => ({ ok: true, value: null }));
  const api = createReaderBridge(invoke, undefined, undefined, callback => { receive = callback; return cleanup; });
  const lifecycle = api.lifecycle; if (!lifecycle) throw new Error('Missing lifecycle');
  expect(Object.keys(lifecycle).sort()).toEqual(['ack', 'command', 'current', 'onEvent', 'plan', 'refuse', 'resume', 'settleAccepted', 'stage', 'submit']);
  expect(Object.isFrozen(lifecycle)).toBe(true);
  const listener = vi.fn(), unsubscribe = lifecycle.onEvent(listener);
  const identity = { operationId: '11111111-1111-1111-1111-111111111111', profileEpoch: '22222222-2222-2222-2222-222222222222' };
  const event = { ...identity, phase: 'DRAINING', kind: 'backup', failed: false, stamp: { profileEpoch: identity.profileEpoch, commitRevision: 4 } };
  for (const invalid of [null, {}, { ...event, windowId: 'forged' }, { ...event, phase: 'unknown' },
    { ...event, stamp: { ...event.stamp, commitRevision: NaN } }, { ...event, profileEpoch: identity.operationId }]) receive(invalid);
  expect(listener).not.toHaveBeenCalled(); receive(event); expect(listener).toHaveBeenCalledWith(event);
  unsubscribe(); expect(cleanup).toHaveBeenCalledOnce();
  await lifecycle.stage({ kind: 'updatePreferences', request: { appearance: 'dark' } });
  await lifecycle.refuse(identity); await lifecycle.resume(identity); await lifecycle.current();
  expect(invoke.mock.calls).toEqual([
    [profileChannels.stage, { kind: 'updatePreferences', request: { appearance: 'dark' } }],
    [profileChannels.refuse, identity], [profileChannels.resume, identity], [profileChannels.current],
  ]);
});

import { expect, it, vi } from 'vitest';
import { createReaderBridge } from './reader-bridge';
import { readerChannels } from '../shared/reader-api';
import { defaultQuery } from '../domain/discussion-query';

it('exposes exactly nineteen intent methods without a generic privileged transport', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: {} }));
  const api = createReaderBridge(invoke);
  expect(Object.keys(api).sort()).toEqual(['acquire', 'activateTab', 'bootstrap', 'bulkSeen', 'chooseHelper', 'clearHelper', 'closeTab', 'getHelperStatus', 'moveTab', 'openLibrary', 'openSettings', 'openSource', 'openStoredItem', 'refresh', 'removeLibraryItem', 'saveDiscussionView', 'toggleSeen', 'undoSeen', 'updatePreferences']);
  await api.getHelperStatus({ kind: 'yt-dlp' });
  await api.chooseHelper({ kind: 'post-archiver' });
  await api.clearHelper({ kind: 'yt-dlp' });
  expect(Object.isFrozen(api)).toBe(true);
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
  await api.saveDiscussionView(intent);
  expect(invoke).toHaveBeenLastCalledWith(readerChannels.saveDiscussionView, intent);
});

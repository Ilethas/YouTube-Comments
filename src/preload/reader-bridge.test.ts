import { expect, it, vi } from 'vitest';
import { createReaderBridge } from './reader-bridge';
import { readerChannels } from '../shared/reader-api';

it('exposes exactly fourteen intent methods without a generic privileged transport', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: {} }));
  const api = createReaderBridge(invoke);
  expect(Object.keys(api).sort()).toEqual(['acquire', 'activateTab', 'bootstrap', 'bulkSeen', 'closeTab', 'moveTab', 'openLibrary', 'openSettings', 'openStoredItem', 'refresh', 'removeLibraryItem', 'toggleSeen', 'undoSeen', 'updatePreferences']);
  expect(Object.isFrozen(api)).toBe(true);
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
});

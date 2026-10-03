import { expect, it, vi } from 'vitest';
import { createReaderBridge } from './reader-bridge';
import { readerChannels } from '../shared/reader-api';

it('exposes exactly eight intent methods without a generic privileged transport', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: {} }));
  const api = createReaderBridge(invoke);
  expect(Object.keys(api).sort()).toEqual(['acquire', 'activateTab', 'bootstrap', 'closeTab', 'openStoredItem', 'refresh', 'toggleSeen', 'updatePreferences']);
  expect(Object.isFrozen(api)).toBe(true);
  await api.bootstrap();
  await api.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: true });
  await api.updatePreferences({ appearance: 'system' });
  await api.acquire({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  await api.refresh({ itemId: 'stored-item' });
  await api.openStoredItem({ itemId: 'stored-item' });
  await api.activateTab({ itemId: 'stored-item' });
  await api.closeTab({ itemId: 'stored-item' });
  expect(invoke.mock.calls).toEqual([
    [readerChannels.bootstrap],
    [readerChannels.toggleSeen, { itemId: 'video-demo', commentId: 'v2', subtree: true }],
    [readerChannels.updatePreferences, { appearance: 'system' }],
    [readerChannels.acquire, { url: 'https://www.youtube.com/watch?v=abcdefghijk' }],
    [readerChannels.refresh, { itemId: 'stored-item' }],
    [readerChannels.openStoredItem, { itemId: 'stored-item' }],
    [readerChannels.activateTab, { itemId: 'stored-item' }],
    [readerChannels.closeTab, { itemId: 'stored-item' }],
  ]);
});

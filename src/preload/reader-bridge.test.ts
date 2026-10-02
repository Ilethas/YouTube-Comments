import { expect, it, vi } from 'vitest';
import { createReaderBridge } from './reader-bridge';
import { readerChannels } from '../shared/reader-api';

it('exposes exactly three intent methods without a generic privileged transport', async () => {
  const invoke = vi.fn(async () => ({ ok: true, value: {} }));
  const api = createReaderBridge(invoke);
  expect(Object.keys(api).sort()).toEqual(['bootstrap', 'toggleSeen', 'updatePreferences']);
  expect(Object.isFrozen(api)).toBe(true);
  await api.bootstrap();
  await api.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: true });
  await api.updatePreferences({ appearance: 'system' });
  expect(invoke.mock.calls).toEqual([
    [readerChannels.bootstrap],
    [readerChannels.toggleSeen, { itemId: 'video-demo', commentId: 'v2', subtree: true }],
    [readerChannels.updatePreferences, { appearance: 'system' }],
  ]);
});

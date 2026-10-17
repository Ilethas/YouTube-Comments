import { expect, it, vi } from 'vitest';
import { isSharedCommit } from './reader-sync';
import { createReaderBridge } from '../preload/reader-bridge';

const stamp = { profileEpoch: '00000000-0000-0000-0000-000000000001', commitRevision: 1 };
const seen = { ...stamp, change: { kind: 'seen', itemId: 'item', values: [{ id: 'comment', seen: true }], undo: null } };
it('validates exact, bounded shared notifications through the real bridge wrapper', () => {
  let deliver: (value: unknown) => void = () => undefined;
  const cleanup = vi.fn(), listener = vi.fn();
  const bridge = createReaderBridge(vi.fn(), undefined, receive => { deliver = receive; return cleanup; });
  const unsubscribe = bridge.onSharedCommit(listener);
  for (const invalid of [null, [], {}, { ...seen, windowId: 'forged' }, { ...seen, profileEpoch: 'forged' },
    { ...seen, commitRevision: -1 }, { ...seen, commitRevision: Infinity }, { ...seen, commitRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...seen, change: { ...seen.change, sql: 'DELETE' } }, { ...seen, change: { ...seen.change, values: Array(257).fill({ id: 'x', seen: true }) } },
    { ...seen, change: { ...seen.change, values: [{ id: 'x', seen: true }, { id: 'x', seen: false }] } },
    { ...seen, change: { ...seen.change, values: [{ id: 'x'.repeat(257), seen: true }] } },
    { ...seen, change: { ...seen.change, values: [{ id: 'x', seen: 'true' }] } },
    { ...seen, change: { ...seen.change, undo: { id: 'foreign' } } }, { ...seen, change: { kind: 'execute', payload: 'evil' } }]) {
    expect(isSharedCommit(invalid)).toBe(false); deliver(invalid);
  }
  expect(listener).not.toHaveBeenCalled();
  deliver(seen);
  for (const kind of ['watermark', 'helpers', 'preferences', 'workspace']) deliver({ ...stamp, change: { kind } });
  for (const kind of ['item', 'removed', 'seen-invalidation']) deliver({ ...stamp, change: { kind, itemId: 'item' } });
  expect(listener).toHaveBeenCalledTimes(8); unsubscribe(); expect(cleanup).toHaveBeenCalledOnce();
});
it('rejects forged/cross-item, oversized and nonfinite Undo descriptors', () => {
  const undo = { id: 'op', itemId: 'item', createdAt: '2026-10-18T00:00:00Z', kind: 'all', targetSeen: true, targetCount: 50000, changedCount: 40000 };
  expect(isSharedCommit({ ...seen, change: { ...seen.change, undo } })).toBe(true);
  for (const invalid of [{ ...undo, itemId: 'other' }, { ...undo, changedCount: Infinity }, { ...undo, targetCount: 100001 },
    { ...undo, changedCount: 50001 }, { ...undo, targetSeen: 1 }, { ...undo, path: 'private' }]) {
    expect(isSharedCommit({ ...seen, change: { ...seen.change, undo: invalid } })).toBe(false);
  }
});

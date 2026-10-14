import { afterEach, expect, it, vi } from 'vitest';
import { DiscussionViewSaveQueue, draftSaveDelay, scrollSaveDelay } from './discussion-view-save-queue';
import type { Result } from '../shared/reader-api';
afterEach(() => { vi.useRealTimers(); });

it('serializes/coalesces all state and never lets an older delayed scroll save replace newer query/sort', async () => {
  vi.useFakeTimers(); let current = { text: 'old', sort: 'original', anchor: 'a' };
  let finish!: (result: Result<null>) => void;
  const writes: typeof current[] = [], save = vi.fn(() => { writes.push({ ...current }); return new Promise<Result<null>>(resolve => { finish = resolve; }); });
  const feedback = vi.fn(), queue = new DiscussionViewSaveQueue(save, feedback);
  queue.schedule(0); await vi.advanceTimersByTimeAsync(0); expect(writes).toHaveLength(1);
  current = { text: 'new', sort: 'newest', anchor: 'b' }; queue.schedule(draftSaveDelay);
  queue.schedule(scrollSaveDelay); const flushed = queue.flush();
  expect(writes).toHaveLength(1);
  finish({ ok: true, value: null }); await vi.advanceTimersByTimeAsync(0);
  expect(writes).toEqual([{ text: 'old', sort: 'original', anchor: 'a' }, current]);
  finish({ ok: true, value: null }); await flushed;
  await vi.advanceTimersByTimeAsync(1000); expect(save).toHaveBeenCalledTimes(2);
  expect(feedback.mock.calls).toEqual([[false], [false]]); queue.dispose();
});

it('burst edits issue one write after idle; failures remain dirty for flush without blocking reading or retry loops', async () => {
  vi.useFakeTimers(); const feedback = vi.fn(), save = vi.fn<() => Promise<Result<null>>>()
    .mockResolvedValueOnce({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }).mockRejectedValueOnce(new Error('transport')).mockResolvedValue({ ok: true, value: null });
  const queue = new DiscussionViewSaveQueue(save, feedback);
  for (let i = 0; i < 30; i++) { queue.schedule(draftSaveDelay); await vi.advanceTimersByTimeAsync(10); }
  expect(save).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(draftSaveDelay);
  expect(save).toHaveBeenCalledTimes(1); expect(feedback).toHaveBeenLastCalledWith(true);
  await vi.advanceTimersByTimeAsync(10000); expect(save).toHaveBeenCalledTimes(1);
  await queue.flush(); expect(feedback).toHaveBeenLastCalledWith(true);
  await queue.flush(); expect(feedback).toHaveBeenLastCalledWith(false);
  await queue.flush(); expect(save).toHaveBeenCalledTimes(3); queue.dispose();
});

it('removal cancels delayed saves and any pending follow-up, so no record can be recreated', async () => {
  vi.useFakeTimers(); let finish!: (result: Result<null>) => void;
  const save = vi.fn(() => new Promise<Result<null>>(resolve => { finish = resolve; })), feedback = vi.fn();
  const queue = new DiscussionViewSaveQueue(save, feedback);
  queue.schedule(0); await vi.advanceTimersByTimeAsync(0);
  queue.schedule(0); const flushing = queue.flush(); queue.dispose();
  finish({ ok: true, value: null }); await flushing; await vi.advanceTimersByTimeAsync(1000);
  expect(save).toHaveBeenCalledTimes(1); expect(feedback).not.toHaveBeenCalled();
});

it('a switch/close flush immediately after acknowledgment drains the newest intent even between promise finalizers', async () => {
  const save = vi.fn(async () => ({ ok: true as const, value: null }));
  let followup = false;
  const queue = new DiscussionViewSaveQueue(save, () => {
    if (followup) return;
    followup = true;
    queueMicrotask(() => { queue.schedule(400); void queue.flush(); });
  });
  queue.schedule(400); await queue.flush();
  expect(save).toHaveBeenCalledTimes(2); queue.dispose();
});

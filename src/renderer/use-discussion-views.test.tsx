// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDiscussionViews } from './use-discussion-views';
import { dateTestComment } from '../fixtures/date-discussion';
import { defaultQuery, evaluateDiscussionQuery } from '../domain/discussion-query';
import { createQueryExecutor } from './query-executor';
import type { ReaderApi } from '../shared/reader-api';
import type { QueryExecutor } from './query-worker-client';

vi.mock('./query-executor', () => ({ createQueryExecutor: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('M3 captures only the visible anchor and preserves hidden logical anchors while draining all dirty sessions', async () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  const save = vi.fn<ReaderApi['saveDiscussionView']>(async () => ({ ok: true, value: null }));
  const { result } = renderHook(() => useDiscussionViews({ saved: {}, save }));
  const rows = [dateTestComment('a')], a = result.current.get('a', rows), b = result.current.get('b', rows);
  let hidden = false;
  a.attachReader(() => ({ id: 'a', offset: 11 })); b.attachReader(() => hidden ? { offset: 0 } : { id: 'a', offset: 22 });
  act(() => { a.readerSettled(); b.readerSettled(); hidden = true; result.current.freeze('a'); });
  const entries = await result.current.checkpoints();
  expect(entries.filter(entry => entry.command.kind === 'view').map(entry => entry.command.request)).toEqual([
    expect.objectContaining({ itemId: 'a', anchor: { commentId: 'a', offset: 11 } }),
    expect.objectContaining({ itemId: 'b', anchor: { commentId: 'a', offset: 22 } }),
  ]);
  entries.forEach(entry => entry.accept({ ok: true, value: null }));
  expect(save).not.toHaveBeenCalled();
  expect(await result.current.checkpoints()).toEqual([]);
  result.current.resume();
});

it('flushAll waits for accepted query evaluation and the latest full-intent save, reporting failed persistence', async () => {
  let finish: ((result: ReturnType<typeof evaluateDiscussionQuery>) => void) | undefined;
  const evaluate = vi.fn<QueryExecutor['evaluate']>(() => new Promise<ReturnType<typeof evaluateDiscussionQuery>>(resolve => { finish = resolve; }));
  vi.mocked(createQueryExecutor).mockReturnValue({ evaluate, dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>);
  const save = vi.fn<ReaderApi['saveDiscussionView']>(async () => ({ ok: false as const, error: { code: 'STORAGE_UNAVAILABLE' as const } }));
  const { result } = renderHook(() => useDiscussionViews({ saved: {}, save }));
  const comments = [dateTestComment('a')], session = result.current.get('video', comments);
  act(() => session.edit({ ...defaultQuery, text: 'draft' }));
  const applying = session.apply(comments), flushing = result.current.flushAll();
  expect(save).not.toHaveBeenCalled();
  const [rows, query] = evaluate.mock.calls[0];
  if (!finish) throw new Error('Missing worker completion');
  await act(async () => { finish?.(evaluateDiscussionQuery(rows, query)); await applying; });
  expect(await flushing).toBe(false); expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({ itemId: 'video', draft: { text: 'draft' }, applied: { text: 'draft' } });
});

it('registry retains independent sort on close/reopen, removal disposes/clears it, and a new Reader lifetime starts Original', () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  const comments = [dateTestComment('a')], { result, unmount } = renderHook(useDiscussionViews);
  const video = result.current.get('video', comments), post = result.current.get('post', comments);
  act(() => { video.setSort('newest'); post.setSort('most-liked'); });
  expect(result.current.get('video', comments)).toBe(video);
  expect(result.current.get('post', comments).state.sort).toBe('most-liked');
  expect(result.current.get('video', comments).state.sort).toBe('newest');
  act(() => result.current.remove('video'));
  expect(result.current.get('video', comments)).not.toBe(video);
  expect(result.current.get('video', comments).state.sort).toBe('original');
  expect(result.current.get('post', comments).state.sort).toBe('most-liked');
  unmount();
  const restarted = renderHook(useDiscussionViews);
  expect(restarted.result.current.get('post', comments).state.sort).toBe('original');
});

it('later bootstrap/acquisition copies never rehydrate already-live sessions or overwrite drafts/sorting/selection', async () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  const comments = [dateTestComment('a')], saved = { draft: defaultQuery, applied: defaultQuery, sort: 'oldest' as const, anchor: { commentId: null, offset: 0 }, selected: 'a' };
  const options = { saved: { video: saved }, save: vi.fn(async () => ({ ok: true as const, value: null })) };
  const { result, rerender } = renderHook(props => useDiscussionViews(props), { initialProps: options });
  const session = result.current.get('video', comments);
  await act(() => session.restore(comments));
  act(() => { session.edit({ ...defaultQuery, text: 'live draft' }); session.setSort('newest'); session.select('a'); });
  rerender({ ...options, saved: { video: { ...saved, draft: { ...defaultQuery, text: 'older saved copy' } } } });
  expect(result.current.get('video', comments)).toBe(session);
  expect(session.state.draft.text).toBe('live draft'); expect(session.state.sort).toBe('newest'); expect(session.state.selected).toBe('a');
  await act(async () => { result.current.refresh('video', comments); });
  expect(session.state.draft.text).toBe('live draft'); expect(session.state.sort).toBe('newest');
  act(() => result.current.remove('video'));
  expect(result.current.get('video', comments).state.sort).toBe('original');
});

// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDiscussionViews } from './use-discussion-views';
import { dateTestComment } from '../fixtures/date-discussion';
import { defaultQuery, evaluateDiscussionQuery } from '../domain/discussion-query';
import { createQueryExecutor } from './query-executor';
import type { ReaderApi } from '../shared/reader-api';
import type { QueryExecutor } from './query-worker-client';
import { required } from './testing/required';

vi.mock('./query-executor', () => ({ createQueryExecutor: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('M3 captures only the visible anchor and preserves hidden logical anchors while draining all dirty sessions', async () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  const save = vi.fn<ReaderApi['saveDiscussionView']>(async () => ({ ok: true, value: null }));
  const { result } = renderHook(() => useDiscussionViews({ saved: {}, save }));
  const rows = [dateTestComment('a')], a = result.current.get('a', rows, 'a'), b = result.current.get('b', rows, 'b');
  let hidden = false;
  a.attachReader(() => ({ id: 'a', offset: 11 })); b.attachReader(() => hidden ? { offset: 0 } : { id: 'a', offset: 22 });
  act(() => { a.readerSettled(); b.readerSettled(); hidden = true; result.current.freeze('a'); });
  const entries = await result.current.checkpoints();
  expect(entries.filter(entry => entry.command.kind === 'view').map(entry => entry.command.request)).toEqual([
    expect.objectContaining({ viewId: 'a', anchor: { commentId: 'a', offset: 11 } }),
    expect.objectContaining({ viewId: 'b', anchor: { commentId: 'a', offset: 22 } }),
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
  const comments = [dateTestComment('a')], session = result.current.get('video', comments, 'video');
  act(() => session.edit({ ...defaultQuery, text: 'draft' }));
  const applying = session.apply(comments), flushing = result.current.flushAll();
  expect(save).not.toHaveBeenCalled();
  const [rows, query] = evaluate.mock.calls[0];
  if (!finish) throw new Error('Missing worker completion');
  await act(async () => { finish?.(evaluateDiscussionQuery(rows, query)); await applying; });
  expect(await flushing).toBe(false); expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({ viewId: 'video', draft: { text: 'draft' }, applied: { text: 'draft' } });
});

it('registry retains independent sort on close/reopen, removal disposes/clears it, and a new Reader lifetime starts Original', () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  const comments = [dateTestComment('a')], { result, unmount } = renderHook(useDiscussionViews);
  const video = result.current.get('video', comments, 'video'), post = result.current.get('post', comments, 'post');
  act(() => { video.setSort('newest'); post.setSort('most-liked'); });
  expect(result.current.get('video', comments, 'video')).toBe(video);
  expect(result.current.get('post', comments, 'post').state.sort).toBe('most-liked');
  expect(result.current.get('video', comments, 'video').state.sort).toBe('newest');
  act(() => result.current.remove('video'));
  expect(result.current.get('video', comments, 'video')).not.toBe(video);
  expect(result.current.get('video', comments, 'video').state.sort).toBe('original');
  expect(result.current.get('post', comments, 'post').state.sort).toBe('most-liked');
  unmount();
  const restarted = renderHook(useDiscussionViews);
  expect(restarted.result.current.get('post', comments, 'post').state.sort).toBe('original');
});

it('later bootstrap/acquisition copies never rehydrate already-live sessions or overwrite drafts/sorting/selection', async () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  const comments = [dateTestComment('a')], saved = { draft: defaultQuery, applied: defaultQuery, sort: 'oldest' as const, anchor: { commentId: null, offset: 0 }, selected: 'a' };
  const options = { saved: { video: saved }, save: vi.fn(async () => ({ ok: true as const, value: null })) };
  const { result, rerender } = renderHook(props => useDiscussionViews(props), { initialProps: options });
  const session = result.current.get('video', comments, 'video');
  await act(() => session.restore(comments));
  act(() => { session.edit({ ...defaultQuery, text: 'live draft' }); session.setSort('newest'); session.select('a'); });
  rerender({ ...options, saved: { video: { ...saved, draft: { ...defaultQuery, text: 'older saved copy' } } } });
  expect(result.current.get('video', comments, 'video')).toBe(session);
  expect(session.state.draft.text).toBe('live draft'); expect(session.state.sort).toBe('newest'); expect(session.state.selected).toBe('a');
  await act(async () => { result.current.refresh('video', comments); });
  expect(session.state.draft.text).toBe('live draft'); expect(session.state.sort).toBe('newest');
  act(() => result.current.remove('video'));
  expect(result.current.get('video', comments, 'video').state.sort).toBe('original');
});

it('two same-item instances retain independent semantic and collapse state, while shared seen changes reach both', async () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  const rows = [dateTestComment('a')];
  const save = vi.fn<ReaderApi['saveDiscussionView']>(async () => ({ ok: true, value: null }));
  const saveCollapse = vi.fn<ReaderApi['setDiscussionCollapse']>(async () => ({ ok: true, value: null }));
  const { result } = renderHook(() => useDiscussionViews({ saved: {}, save, saveCollapse }));
  const a = result.current.get('instance-a', rows, 'shared-item'), b = result.current.get('instance-b', rows, 'shared-item');
  act(() => { a.edit({ ...defaultQuery, text: 'independent-a', seen: 'unseen' }); b.edit({ ...defaultQuery, text: 'independent-b' }); a.setSort('oldest'); b.setSort('newest'); });
  await act(async () => { await a.apply(rows); await b.apply(rows); });
  act(() => a.setCollapsed({ kind: 'all', collapsed: true }));
  await result.current.flushAll();
  const aResult = a.state.result, bResult = b.state.result;
  act(() => result.current.seenChanged('shared-item'));
  expect(a.state.seenStale).toBe(true); expect(b.state.seenStale).toBe(false);
  expect(a.state.result).toBe(aResult); expect(b.state.result).toBe(bResult);
  expect(a.state.draft.text).toBe('independent-a'); expect(b.state.draft.text).toBe('independent-b');
  expect(a.state.sort).toBe('oldest'); expect(b.state.sort).toBe('newest');
  expect(a.state.collapse.defaultCollapsed).toBe(true); expect(b.state.collapse.defaultCollapsed).toBe(false);
  expect(save.mock.calls.some(([r]) => r.viewId === 'instance-a')).toBe(true);
  expect(save.mock.calls.some(([r]) => r.viewId === 'instance-b')).toBe(true);
  act(() => result.current.remove('shared-item')); expect(result.current.has('instance-a')).toBe(false); expect(result.current.has('instance-b')).toBe(false);
});

it('intent/collapse queues and sealed checkpoints advance their own CAS lanes without reusing accepted versions', async () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  const save = vi.fn<ReaderApi['saveDiscussionView']>(async () => ({ ok: true, value: null }));
  const saveCollapse = vi.fn<ReaderApi['setDiscussionCollapse']>(async () => ({ ok: true, value: null }));
  const { result } = renderHook(() => useDiscussionViews({ instances: { instance: { itemId: 'shared', intentRevision: 4, collapseRevision: 9 } }, saved: {}, save, saveCollapse }));
  const session = result.current.get('instance', [dateTestComment('a')], 'shared');
  act(() => { session.edit({ ...defaultQuery, text: 'first' }); session.setCollapsed({ kind: 'all', collapsed: true }); });
  await result.current.flushAll();
  expect(required(save.mock.calls.at(-1))[0].expectedRevision).toBe(4);
  expect(required(saveCollapse.mock.calls.at(-1))[0].expectedRevision).toBe(9);
  act(() => { result.current.freeze('instance'); session.edit({ ...defaultQuery, text: 'checkpoint' }); session.setCollapsed({ kind: 'all', collapsed: false }); });
  const checkpoints = await result.current.checkpoints();
  expect(checkpoints.find(c => c.command.kind === 'view')?.command.request).toMatchObject({ viewId: 'instance', expectedRevision: 5 });
  expect(checkpoints.find(c => c.command.kind === 'collapse')?.command.request).toMatchObject({ viewId: 'instance', expectedRevision: 10 });
  checkpoints.forEach(checkpoint => checkpoint.accept({ ok: true, value: null }));
  result.current.resume();
  act(() => session.edit({ ...defaultQuery, text: 'after release' })); await result.current.flushAll();
  expect(required(save.mock.calls.at(-1))[0].expectedRevision).toBe(6);
});

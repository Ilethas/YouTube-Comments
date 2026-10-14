// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDiscussionViews } from './use-discussion-views';
import { dateTestComment } from '../fixtures/date-discussion';
import { defaultQuery, evaluateDiscussionQuery } from '../domain/discussion-query';
import { createQueryExecutor } from './query-executor';

vi.mock('./query-executor', () => ({ createQueryExecutor: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

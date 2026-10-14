// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDiscussionViews } from './use-discussion-views';
import { dateTestComment } from '../fixtures/date-discussion';
import { evaluateDiscussionQuery } from '../domain/discussion-query';
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

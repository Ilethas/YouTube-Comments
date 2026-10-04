import { expect, it, vi } from 'vitest';
import { DiscussionViewSession } from './discussion-view-session';
import { evaluateDiscussionQuery } from '../domain/discussion-query';
import type { QueryOutcome, QueryComment, DiscussionQuery } from '../domain/discussion-query';
import { initialComments } from '../fixtures/discussions';
const rows = initialComments['video-demo'];
const executor = () => ({ evaluate: vi.fn(async (comments: readonly QueryComment[], query: DiscussionQuery): Promise<QueryOutcome> => evaluateDiscussionQuery(comments, query)), dispose: vi.fn() });

it('applied unseen IDs/counts remain frozen after save, second Apply recomputes, failed drafts retain result', async () => {
  const engine = executor(), session = new DiscussionViewSession(rows, engine, vi.fn());
  session.edit({ ...session.state.draft, seen: 'unseen' }); await session.apply(rows);
  const previous = session.state.result;
  const changed = rows.map(row => ({ ...row, seen: true }));
  session.seenChanged();
  expect(session.state.result).toBe(previous); expect(session.state.seenStale).toBe(true);
  session.edit({ ...session.state.draft, text: '[', mode: 'regex' }); await session.apply(changed);
  expect(session.state.error).toBe('INVALID_REGEX'); expect(session.state.result).toBe(previous);
  session.edit({ ...session.state.applied }); await session.apply(changed);
  expect(session.state.result.matchCount).toBe(0); expect(session.state.seenStale).toBe(false);
});
it('Refresh reuses applied criteria, retains draft, missing committed comments/local state, adds matching discovery', async () => {
  const engine = executor(), session = new DiscussionViewSession(rows, engine, vi.fn());
  session.edit({ ...session.state.draft, text: 'needle', seen: 'unseen' }); await session.apply(rows);
  session.edit({ ...session.state.draft, text: 'unapplied draft' });
  const added = { ...rows[0], id: 'new', text: 'needle', seen: false };
  const committed = [...rows, added];
  await session.apply(committed, true);
  expect(session.state.applied.text).toBe('needle'); expect(session.state.draft.text).toBe('unapplied draft');
  expect(session.state.result.activeMatchIds).toEqual(['new']);
  expect(engine.evaluate.mock.calls.at(-1)?.[0]).toHaveLength(rows.length + 1);
  const previous = session.state.result;
  engine.evaluate.mockResolvedValueOnce({ ok: false, error: 'QUERY_TOO_EXPENSIVE' });
  await session.apply(committed, true); expect(session.state.result).toBe(previous);
  expect(session.state.error).toBe('QUERY_TOO_EXPENSIVE');
});
it('seen edits during evaluation make its snapshot stale; seen All never produces stale indicator', async () => {
  let finish: (outcome: QueryOutcome) => void = () => undefined;
  const engine = { evaluate: vi.fn(() => new Promise<QueryOutcome>(resolve => { finish = resolve; })), dispose: vi.fn() };
  const session = new DiscussionViewSession(rows, engine, vi.fn());
  session.seenChanged(); expect(session.state.seenStale).toBe(false);
  session.edit({ ...session.state.draft, seen: 'unseen' });
  const pending = session.apply(rows); session.seenChanged();
  finish(evaluateDiscussionQuery(rows, session.state.draft)); await pending;
  expect(session.state.seenStale).toBe(true);
});
it('late/superseded results and disposed sessions cannot promote criteria or notify', async () => {
  const finishes: ((result: QueryOutcome) => void)[] = [];
  const changed = vi.fn();
  const engine = { evaluate: () => new Promise<QueryOutcome>(resolve => finishes.push(resolve)), dispose: vi.fn() };
  const session = new DiscussionViewSession(rows, engine, changed);
  const first = session.apply(rows);
  session.edit({ ...session.state.draft, text: 'missing' }); const second = session.apply(rows);
  finishes[1](evaluateDiscussionQuery(rows, session.state.draft)); await second;
  finishes[0](evaluateDiscussionQuery(rows, session.state.applied)); await first;
  expect(session.state.applied.text).toBe('missing');
  const third = session.apply(rows); session.dispose(); const count = changed.mock.calls.length;
  finishes[2](evaluateDiscussionQuery(rows, session.state.draft)); await third;
  expect(changed).toHaveBeenCalledTimes(count); expect(engine.dispose).toHaveBeenCalledOnce();
});

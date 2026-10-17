import { afterEach, expect, it, vi } from 'vitest';
import { defaultQuery, evaluateDiscussionQuery } from '../domain/discussion-query';
import type { DiscussionQuery } from '../domain/discussion-query';
import type { DiscussionViewIntent } from '../domain/discussion-view';
import { discussionSorts, boundedAnchor } from '../domain/discussion-view';
import { DiscussionViewSession } from './discussion-view-session';
import { dateTestComment, dateTestItem } from '../fixtures/date-discussion';
import { navigateDiscussion } from './discussion-navigation';
import { draftSaveDelay } from './discussion-view-save-queue';

const clock = { now: Date.parse('2026-10-14T12:00:00Z'), timeZone: 'Europe/Warsaw' };
const comments = [dateTestComment('old', '2026-10-06T12:00:00Z', { author: { displayName: 'Alice', handle: '@alice' }, likeCount: 30 }),
  dateTestComment('today', '2026-10-14T09:00:00Z', { author: { displayName: 'Bob', handle: '@bob' }, text: 'Camera', likeCount: 10 }),
  dateTestComment('reply', '2026-10-14T10:00:00Z', { parentId: 'old', directParentId: 'old', relationshipStatus: 'resolved',
    relationship: { kind: 'direct-parent', parentSourceId: 'old' }, text: 'Microphone', discovery: { firstDiscoveredAt: '2026-10-14T12:00:00Z', lastObservedAt: '2026-10-14T12:00:00Z', firstDiscoveryId: 'latest' } }),
  dateTestComment('week', '2026-10-08T10:00:00Z', { seen: true })];
const engine = () => ({ evaluate: vi.fn(async (rows: Parameters<typeof evaluateDiscussionQuery>[0], query: Parameters<typeof evaluateDiscussionQuery>[1]) => evaluateDiscussionQuery(rows, query)), dispose: vi.fn() });
const saved = (applied: DiscussionQuery = defaultQuery, overrides: Partial<DiscussionViewIntent> = {}): DiscussionViewIntent => ({
  applied, draft: applied, sort: 'newest', anchor: { commentId: 'old', offset: 23.75 }, selected: 'reply', ...overrides });
const create = (view: DiscussionViewIntent, executor = engine(), evaluationTime = () => clock) => new DiscussionViewSession(comments, executor, undefined, evaluationTime, { saved: view });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('restores draft separately without flashing unrestricted data, and uses the worker exactly once', async () => {
  const executor = engine(), applied = { ...defaultQuery, text: 'Camera' }, draft = { ...defaultQuery, text: 'Microphone' };
  const session = create(saved(applied, { draft }), executor);
  expect(session.state.restoring).toBe(true); expect(session.state.result.visibleCommentIds).toEqual([]);
  await session.restore(comments, dateTestItem); await session.restore(comments, dateTestItem);
  expect(executor.evaluate).toHaveBeenCalledTimes(1);
  expect(session.state.draft).toEqual(draft); expect(session.state.applied).toEqual(applied);
  expect(session.state.result.activeMatchIds).toEqual(['today']); expect(session.state.seenStale).toBe(false);
});

it.each([
  [{ text: 'Camera' }, ['today']],
  [{ text: 'Alice', fields: ['author'] }, ['old']],
  [{ text: '@alice', fields: ['replied-to-author'] }, ['reply']],
  [{ text: '^camera$', mode: 'regex', caseSensitive: false }, ['today']],
  [{ text: '^camera$', mode: 'regex', caseSensitive: true }, []],
  [{ seen: 'seen' }, ['week']],
  [{ seen: 'unseen' }, ['old', 'reply', 'today']],
  [{ publication: { kind: 'custom', from: '2026-10-08', to: '2026-10-08' } }, ['week']],
  [{ publication: { kind: 'custom', from: '2026-10-14', fromTime: '11:00', to: '2026-10-14', toTime: '11:00' } }, ['today']],
  [{ publication: { kind: 'today' } }, ['reply', 'today']],
  [{ publication: { kind: 'last-24-hours' } }, ['reply', 'today']],
  [{ publication: { kind: 'last-7-days' } }, ['reply', 'today', 'week']],
  [{ discovery: 'new' }, ['reply']],
] as [Partial<DiscussionQuery>, string[]][])('reconstructs current data using existing query semantics: %j', async (criteria, ids) => {
  const session = create(saved({ ...defaultQuery, ...criteria })); await session.restore(comments, dateTestItem);
  expect(session.state.result.activeMatchIds).toEqual(ids); expect(session.state.restoreFailed).toBe(false);
});

it('relative presets resolve with a fresh restart clock/day/timezone; durable intent contains no resolved bounds', async () => {
  const rolling = saved({ ...defaultQuery, publication: { kind: 'last-24-hours' } });
  const first = create(rolling); await first.restore(comments, dateTestItem);
  expect(first.state.result.activeMatchIds).toEqual(['reply', 'today']);
  const next = create(rolling, engine(), () => ({ ...clock, now: clock.now + 86400000 }));
  await next.restore(comments, dateTestItem); expect(next.state.result.activeMatchIds).toEqual([]);
  const today = saved({ ...defaultQuery, publication: { kind: 'today' } });
  const rows = [dateTestComment('edge', '2026-10-14T00:30:00Z')];
  const utc = create(today, engine(), () => ({ now: Date.parse('2026-10-14T01:00:00Z'), timeZone: 'UTC' }));
  const la = create(today, engine(), () => ({ now: Date.parse('2026-10-14T12:00:00Z'), timeZone: 'America/Los_Angeles' }));
  await utc.restore(rows); await la.restore(rows);
  expect(utc.state.result.activeMatchIds).toEqual(['edge']); expect(la.state.result.activeMatchIds).toEqual([]);
  expect(JSON.stringify(next.persistentIntent())).not.toMatch(/publicationBounds|timeZone|now/);
});

it('restart is a reconstruction boundary for a stale Unseen result, preserving durable seen edits and clearing seenStale', async () => {
  const session = new DiscussionViewSession(comments, engine(), undefined, () => clock);
  session.edit({ ...defaultQuery, seen: 'unseen' }); await session.apply(comments, false, dateTestItem);
  const changed = comments.map(row => row.id === 'today' ? { ...row, seen: true } : row);
  session.seenChanged(); expect(session.state.seenStale).toBe(true); expect(session.state.result.activeMatchIds).toContain('today');
  const restart = create(session.persistentIntent()); await restart.restore(changed, dateTestItem);
  expect(restart.state.result.activeMatchIds).not.toContain('today'); expect(restart.state.seenStale).toBe(false);
});

it('Refresh committed while restore is pending reevaluates current comments afterward without replacing draft or sort from bootstrap', async () => {
  const executor = engine(); let finish!: (outcome: ReturnType<typeof evaluateDiscussionQuery>) => void;
  executor.evaluate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const session = create(saved({ ...defaultQuery, seen: 'unseen' }, { draft: { ...defaultQuery, text: 'pending draft' } }), executor);
  const restoring = session.restore(comments, dateTestItem);
  expect(session.restore(comments, dateTestItem)).toBe(restoring);
  const changed = comments.map(row => ({ ...row, seen: true }));
  const refreshing = session.refresh(changed, dateTestItem);
  const [rows, query] = executor.evaluate.mock.calls[0]; finish(evaluateDiscussionQuery(rows, query));
  await refreshing;
  expect(executor.evaluate).toHaveBeenCalledTimes(2); expect(session.state.result.activeMatchIds).toEqual([]);
  expect(session.state.draft.text).toBe('pending draft'); expect(session.state.sort).toBe('newest');
});

it.each(discussionSorts)('restores %s before projecting selection, navigation, matches and ruler rows', async sort => {
  const session = create(saved({ ...defaultQuery, text: 'needle' }, { sort, selected: 'old' }));
  await session.restore(comments, dateTestItem);
  expect(session.state.sort).toBe(sort); expect(session.state.selected).toBe('old');
  const presentation = session.presentation(comments), before = session.state.result;
  expect(presentation.rows.map(row => row.id)).toEqual(presentation.orderedIds);
  navigateDiscussion(session, comments, 'match', 1);
  expect(session.state.selected).toBe('week');
  expect(session.state.result).toBe(before);
});

it('Most liked preference remains selected when every root key is unknown', async () => {
  const session = create(saved(defaultQuery, { sort: 'most-liked' }));
  const unknown = comments.map(row => ({ ...row, likeCount: undefined })); await session.restore(unknown);
  expect(session.state.sort).toBe('most-liked'); expect(session.presentation(unknown).mostLikedAvailable).toBe(false);
  expect(session.presentation(unknown).orderedIds).toEqual(session.state.result.visibleCommentIds);
  expect(session.persistentIntent().sort).toBe('most-liked');
});

it.each([
  [{ commentId: 'old', offset: 31.5 }, 'reply', 'old', 31.5],
  [{ commentId: 'missing', offset: 20 }, 'reply', 'reply', 0],
  [{ commentId: 'missing', offset: 20 }, 'week', 'today', 0],
  [{ commentId: null, offset: 90 }, 'reply', undefined, 0],
] as const)('anchor/fallback %j and selection %s resolve against complete sorted displayed trees', async (anchor, selected, id, offset) => {
  const session = create(saved({ ...defaultQuery, seen: 'unseen' }, { anchor, selected }));
  await session.restore(comments, dateTestItem);
  expect(session.state.scrollRequest).toMatchObject({ kind: 'restore', id, offset });
  expect(session.state.selected).toBe(selected === 'week' ? undefined : selected);
});

it('hidden anchor and selection fall back to first sorted active match; unrestricted missing identities fall back to top', async () => {
  const restrictive = create(saved({ ...defaultQuery, text: 'Camera' })); await restrictive.restore(comments);
  expect(restrictive.state.selected).toBeUndefined(); expect(restrictive.state.scrollRequest?.id).toBe('today');
  const all = create(saved(defaultQuery, { anchor: { commentId: 'missing', offset: Infinity }, selected: 'missing' })); await all.restore(comments);
  expect(all.state.scrollRequest).toMatchObject({ id: undefined, offset: 0 });
  expect(boundedAnchor('old', Infinity).offset).toBe(0); expect(boundedAnchor('old', 1e9).offset).toBe(100000);
});

it.each(['QUERY_TOO_EXPENSIVE', 'QUERY_FAILED'] as const)('restore %s falls back to all comments with saved applied criteria as draft and retains original durable intent', async error => {
  const executor = engine(); executor.evaluate.mockResolvedValueOnce({ ok: false, error });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const applied = { ...defaultQuery, text: 'Camera' }, session = create(saved(applied, { draft: { ...defaultQuery, text: 'other draft' } }), executor);
  await session.restore(comments, dateTestItem);
  expect(session.state.restoreFailed).toBe(true); expect(session.state.applied).toEqual(defaultQuery);
  expect(session.state.draft).toEqual(applied); expect(session.state.result.restrictive).toBe(false);
  expect(session.state.result.visibleCommentIds).toHaveLength(comments.length); expect(session.persistentIntent().applied).toEqual(applied);
  await session.apply(comments, false, dateTestItem);
  expect(session.state.restoreFailed).toBe(false); expect(session.state.result.activeMatchIds).toEqual(['today']);
});

it('typing coalesces; failed Apply retains applied but saves draft; promotion/Refresh preserve draft and sort', async () => {
  vi.useFakeTimers(); const executor = engine(), save = vi.fn(async () => ({ ok: true as const, value: null }));
  const session = new DiscussionViewSession(comments, executor, undefined, () => clock, { save });
  for (const text of ['C', 'Ca', 'Cam', 'Camera']) session.edit({ ...defaultQuery, text });
  expect(save).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(draftSaveDelay);
  expect(save).toHaveBeenCalledTimes(1);
  session.edit({ ...defaultQuery, mode: 'regex', text: '[' }); await session.apply(comments);
  await session.flush(); expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ applied: defaultQuery, draft: expect.objectContaining({ text: '[' }) }));
  session.edit({ ...defaultQuery, text: 'Camera' }); await session.apply(comments);
  session.setSort('oldest'); session.edit({ ...defaultQuery, text: 'unapplied' });
  await session.apply(comments, true); await session.flush();
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ applied: expect.objectContaining({ text: 'Camera' }), draft: expect.objectContaining({ text: 'unapplied' }), sort: 'oldest' }));
  session.dispose();
});

it('failed presentation writes report a retryable failure without changing reading, selection or query result', async () => {
  const save = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }).mockResolvedValue({ ok: true, value: null });
  const session = new DiscussionViewSession(comments, engine(), undefined, () => clock, { save });
  const result = session.state.result;
  session.edit({ ...defaultQuery, text: 'draft' }); session.select('today'); await session.flush();
  expect(session.state.saveFailed).toBe(true); expect(session.state.result).toBe(result); expect(session.state.selected).toBe('today');
  await session.flush(); expect(session.state.saveFailed).toBe(false); expect(session.state.result).toBe(result); session.dispose();
});

it('Refresh/reacquisition of a retained closed session preserves its settled anchor while the virtual reader is detached', async () => {
  const session = new DiscussionViewSession(comments, engine(), undefined, () => clock);
  const detach = session.attachReader(() => ({ id: 'reply', offset: 19.5 }));
  session.readerSettled(); detach(); await session.refresh(comments, dateTestItem);
  expect(session.state.scrollRequest).toMatchObject({ kind: 'refresh', id: 'reply', offset: 19.5 });
  expect(session.persistentIntent().anchor).toEqual({ commentId: 'reply', offset: 19.5 });
});

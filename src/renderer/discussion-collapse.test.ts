import { evaluateTestQuery } from '../fixtures/query-testing';
import { required } from './testing/required';
import { expect, it, vi } from 'vitest';
import { changeCollapse, expandedDiscussion, isSetDiscussionCollapseRequest } from '../domain/discussion-collapse';
import { discussionSorts } from '../domain/discussion-view';
import { defaultQuery, evaluateDiscussionQuery, queryComments, unrestrictedView } from '../domain/discussion-query';
import { generateDiscussion } from '../development/large-discussions';
import { dateTestComment } from '../fixtures/date-discussion';
import { projectReaderRows } from './discussion-presentation';
import { collapsedAncestors, projectCollapsedRows } from './discussion-collapse';
import { DiscussionViewSession } from './discussion-view-session';
import { navigateDiscussion } from './discussion-navigation';
import { aggregateRulerMarkers, projectRulerMarkers, rulerTarget } from './discussion-ruler';
import { CollapseSaveQueue } from './collapse-save-queue';

const engine = () => ({ evaluate: vi.fn(async (rows: Parameters<typeof evaluateDiscussionQuery>[0], query: Parameters<typeof evaluateDiscussionQuery>[1]) => evaluateDiscussionQuery(rows, query)), dispose: vi.fn() });
const tree = () => generateDiscussion({ count: 12, roots: 2, shape: 'chain', maxDepth: 20, seenRatio: 0, matchIndexes: [4, 5, 10, 11] });
const all = { kind: 'all' as const, collapsed: true };

it('starts fully expanded and applies sparse, identity-based exceptions without touching data', () => {
  const { comments } = tree(), result = unrestrictedView(queryComments(comments));
  const complete = projectReaderRows(comments, result), serialized = JSON.stringify({ comments, result });
  expect(projectCollapsedRows(complete, expandedDiscussion).rows).toEqual(complete.rows);
  let state = changeCollapse(expandedDiscussion, { kind: 'comments', ids: ['generated-2'], collapsed: true });
  expect(projectCollapsedRows(complete, state).rows.map(row => row.id)).toEqual(['generated-0', 'generated-1', 'generated-2', ...comments.slice(6).map(row => row.id)]);
  state = changeCollapse(state, { kind: 'comments', ids: ['generated-2'], collapsed: false });
  expect(state.overrides).toEqual([]);
  state = changeCollapse(state, all);
  expect(state).toEqual({ defaultCollapsed: true, overrides: [] });
  const collapsed = projectCollapsedRows(complete, state);
  expect(collapsed.rows.map(row => row.id)).toEqual(['generated-0', 'generated-6']);
  expect(collapsed.summaries.get('generated-0')).toEqual({ descendants: 5, unseen: 5, matches: 0 });
  expect(collapsed.representativeById.get('generated-5')).toBe('generated-0');
  expect(changeCollapse(state, { kind: 'all', collapsed: false })).toEqual(expandedDiscussion);
  expect(JSON.stringify({ comments, result })).toBe(serialized);
});

it.each([10000, 50000])('%i pathological deep ancestors/projecting remain iterative, including new replies under both defaults', count => {
  const { comments } = generateDiscussion({ count, roots: 1, shape: 'chain', maxDepth: count, textLength: 10 });
  const complete = projectReaderRows(comments, unrestrictedView(queryComments(comments)));
  const collapsed = changeCollapse(expandedDiscussion, all);
  expect(projectCollapsedRows(complete, collapsed).rows).toHaveLength(1);
  const ancestors = collapsedAncestors(`generated-${count - 1}`, complete, collapsed);
  expect(ancestors).toHaveLength(count - 1);
  const revealed = changeCollapse(collapsed, { kind: 'comments', ids: ancestors, collapsed: false });
  expect(projectCollapsedRows(complete, revealed).rows).toHaveLength(count);
  expect(projectCollapsedRows(complete, expandedDiscussion).rows).toHaveLength(count);
  const prior = projectReaderRows(comments.slice(0, -1), unrestrictedView(queryComments(comments.slice(0, -1))));
  expect(projectCollapsedRows(prior, collapsed).rows).toHaveLength(1);
});

it.each(['flat', 'shallow', 'mixed', 'chain'] as const)('10k/50k %s collapse uses complete safe preorder and only mounts roots after All', shape => {
  for (const count of [10000, 50000]) {
    const { comments } = generateDiscussion({ count, shape });
    const complete = projectReaderRows(comments, unrestrictedView(queryComments(comments)));
    const displayed = projectCollapsedRows(complete, changeCollapse(expandedDiscussion, all));
    expect(displayed.rows.map(row => row.id)).toEqual(complete.rows.filter(row => row.parentId === null).map(row => row.id));
    expect(complete.orderedIds).toHaveLength(count);
  }
});

it('uses frozen safe fallback roots, Community containment and full context rather than source identities', () => {
  const comments = [dateTestComment('a', undefined, { text: 'other', parentId: null, relationshipStatus: 'cyclic', relationship: { kind: 'direct-parent', parentSourceId: 'b' } }), dateTestComment('b', undefined, { text: 'other', parentId: null, relationshipStatus: 'cyclic', relationship: { kind: 'direct-parent', parentSourceId: 'a' } }),
    dateTestComment('missing', undefined, { text: 'other', parentId: null, relationshipStatus: 'unresolved', relationship: { kind: 'direct-parent', parentSourceId: 'absent' } }), dateTestComment('root', undefined, { text: 'other' }),
    dateTestComment('contained', undefined, { parentId: 'root', directParentId: null, text: 'needle', relationship: { kind: 'thread-containment', rootSourceId: 'root' }, relationshipStatus: 'resolved' })];
  const complete = projectReaderRows(comments, unrestrictedView(queryComments(comments)));
  const displayed = projectCollapsedRows(complete, changeCollapse(expandedDiscussion, all));
  expect(displayed.rows.map(row => row.id)).toEqual(complete.rows.filter(row => row.parentId === null).map(row => row.id));
  expect(displayed.representativeById.get('contained')).toBe('root');
  expect(comments[4].directParentId).toBeNull();
  const outcome = evaluateTestQuery(queryComments(comments), { ...defaultQuery, text: 'needle' });
  if (!outcome.ok) throw new Error('query');
  const filtered = projectReaderRows(comments, outcome.result);
  expect(filtered.orderedIds).toEqual(['root', 'contained']);
  expect(projectCollapsedRows(filtered, changeCollapse(expandedDiscussion, all)).rows.map(row => row.id)).toEqual(['root']);
});

it.each(discussionSorts)('%s keeps collapsed tree identities and original reply order', sort => {
  const { comments } = tree(), result = unrestrictedView(queryComments(comments));
  const complete = projectReaderRows(comments, result, sort), state = changeCollapse(expandedDiscussion, { kind: 'comments', ids: ['generated-1'], collapsed: true });
  const displayed = projectCollapsedRows(complete, state);
  expect(displayed.rows.map(row => row.id)).toEqual(complete.orderedIds.filter(id => !['generated-2', 'generated-3', 'generated-4', 'generated-5'].includes(id)));
  expect(complete.rows.filter(row => row.rootId === 'generated-6').map(row => row.id)).toEqual(comments.slice(6).map(row => row.id));
});

it('next/previous matches and unseen navigate full order, persist only ancestors, preserve match position and never mark seen', async () => {
  const { comments } = tree(), saveCollapse = vi.fn(async () => ({ ok: true as const, value: null }));
  const session = new DiscussionViewSession(comments, engine(), undefined, undefined, { saveCollapse });
  session.edit({ ...defaultQuery, text: 'PROFILE_MATCH' }); await session.apply(comments);
  const result = session.state.result;
  session.setCollapsed(all);
  navigateDiscussion(session, comments, 'match', 1);
  expect(session.state.selected).toBe('generated-4');
  expect(session.displayed(comments).indexById.has('generated-4')).toBe(true);
  expect(session.state.collapse.overrides).toEqual(['generated-3', 'generated-2', 'generated-1', 'generated-0']);
  expect(session.displayed(comments).representativeById.get('generated-11')).toBe('generated-6');
  navigateDiscussion(session, comments, 'match', -1);
  expect(session.state.selected).toBe('generated-11');
  expect(session.displayed(comments).indexById.has('generated-11')).toBe(true);
  expect(session.presentation(comments).orderedMatchIds).toEqual(['generated-4', 'generated-5', 'generated-10', 'generated-11']);
  session.setCollapsed(all); session.select('generated-4');
  navigateDiscussion(session, comments, 'unseen', 1);
  expect(session.state.selected).toBe('generated-5');
  expect(session.state.result).toBe(result); expect(comments.every(row => !row.seen)).toBe(true);
  await session.flush(); expect(saveCollapse).toHaveBeenCalled(); session.dispose();
});

it('anchors hide to the nearest visible ancestor, preserve hidden selection and retain collapse through Apply/Refresh/seen-stale', async () => {
  const { comments } = tree(), session = new DiscussionViewSession(comments, engine());
  session.edit({ ...defaultQuery, seen: 'unseen', text: 'PROFILE_MATCH' }); await session.apply(comments);
  session.select('generated-4'); session.attachReader(() => ({ id: 'generated-4', offset: 27 }));
  session.setCollapsed({ kind: 'comments', ids: ['generated-2'], collapsed: true });
  expect(session.state.scrollRequest).toMatchObject({ id: 'generated-2', offset: 0, kind: 'collapse' });
  expect(session.state.selected).toBe('generated-4');
  const collapse = session.state.collapse, matches = session.state.result.activeMatchIds;
  const changed = comments.map(row => row.id === 'generated-4' ? { ...row, seen: true } : row);
  session.seenChanged(); expect(session.state.seenStale).toBe(true);
  expect(session.displayed(changed).summaries.get('generated-2')).toEqual({ descendants: 3, unseen: 2, matches: 2 });
  expect(session.state.result.activeMatchIds).toBe(matches);
  await session.apply(changed); expect(session.state.collapse).toBe(collapse);
  await session.refresh(changed); expect(session.state.collapse).toBe(collapse);
  expect(session.state.result.activeMatchIds).not.toContain('generated-4');
  session.dispose();
});

it('all ruler categories compress onto the visible ancestor, distinguish own/hidden counts and reveal real hidden targets', () => {
  const { comments } = tree(), session = new DiscussionViewSession(comments, engine());
  session.setCollapsed(all);
  const complete = session.presentation(comments), displayed = session.displayed(comments);
  const markers = projectRulerMarkers(complete.rows, session.state.result, new Set(['generated-5']), displayed);
  const buckets = aggregateRulerMarkers(markers, [{ start: 0, size: 100 }, { start: 100, size: 100 }], 200, 200);
  const bucket = required(buckets.find(row => row.targets.new.length));
  expect(bucket.targets.new.hiddenLength).toBe(1);
  expect(bucket.targets.unseen.length).toBe(6); expect(bucket.targets.unseen.hiddenLength).toBe(5);
  expect(rulerTarget(bucket, 'new', bucket.top + 1)).toBe('generated-5');
  session.select(required(rulerTarget(bucket, 'new', bucket.top + 1)));
  expect(session.displayed(comments).indexById.has('generated-5')).toBe(true);
  expect(session.displayed(comments).representativeById.get('generated-11')).toBe('generated-6');
  expect(buckets.length).toBeLessThan(100); session.dispose();
});

it('rejects extra/unbounded/duplicate IPC fields and serializes failed idempotent saves before later assignments', async () => {
  expect(isSetDiscussionCollapseRequest({ itemId: 'x', ...all })).toBe(true);
  for (const request of [{ itemId: 'x', ...all, ids: [] }, { itemId: '', ...all }, { itemId: 'x', kind: 'comments', collapsed: false, ids: ['a', 'a'] },
    { itemId: 'x', kind: 'comments', collapsed: false, ids: Array(100001).fill('a') }]) expect(isSetDiscussionCollapseRequest(request)).toBe(false);
  const save = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }).mockResolvedValue({ ok: true, value: null });
  const feedback = vi.fn(), queue = new CollapseSaveQueue(save, feedback);
  queue.schedule(all); await queue.flush(); expect(feedback).toHaveBeenLastCalledWith(true);
  queue.schedule({ kind: 'all', collapsed: false }); await queue.flush();
  expect(save.mock.calls.map(args => args[0].collapsed)).toEqual([true, true, false]);
  expect(feedback).toHaveBeenLastCalledWith(false); queue.dispose();
});

it('flush includes edits arriving in the completion microtask gap and disposal cancels queued follow-ups', async () => {
  const save = vi.fn(async () => ({ ok: true as const, value: null }));
  let queued = false;
  const queue = new CollapseSaveQueue(save, () => {
    if (!queued) { queued = true; queueMicrotask(() => queue.schedule({ kind: 'all', collapsed: false })); }
  });
  queue.schedule(all); await queue.flush();
  expect(save.mock.calls).toHaveLength(2); queue.dispose();
  let finish!: (value: { ok: true; value: null }) => void;
  const pending = vi.fn(() => new Promise<{ ok: true; value: null }>(resolve => { finish = resolve; }));
  const removed = new CollapseSaveQueue(pending, vi.fn());
  removed.schedule(all); removed.schedule({ kind: 'all', collapsed: false });
  const flushed = removed.flush(); removed.dispose(); finish({ ok: true, value: null }); await flushed;
  expect(pending).toHaveBeenCalledTimes(1);
});

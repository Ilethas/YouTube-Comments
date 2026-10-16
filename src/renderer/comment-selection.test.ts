import { expect, it, vi } from 'vitest';
import { dateTestComment as comment } from '../fixtures/date-discussion';
import { defaultQuery, evaluateDiscussionQuery, queryComments, unrestrictedView } from '../domain/discussion-query';
import { projectReaderRows } from './discussion-presentation';
import { projectCollapsedRows } from './discussion-collapse';
import { toggleBulkSelection, viewPrefix } from './comment-selection';
import { DiscussionViewSession } from './discussion-view-session';
import { generateDiscussion } from '../development/large-discussions';
import { discussionSorts } from './discussion-sort';

const early = '2025-01-01T00:00:00Z', late = '2026-10-01T00:00:00Z';
const data = () => [comment('A', early, { likeCount: 3 }), comment('A1', late, { parentId: 'A', text: 'needle' }),
  comment('A2', early, { parentId: 'A' }), comment('B', late, { likeCount: 7, text: 'needle' }),
  comment('B1', late, { parentId: 'B' }), comment('C', early), comment('C1', early, { parentId: 'C' })]
  .map(row => ({ ...row, text: row.id === 'A1' || row.id === 'B' ? 'needle' : 'context' }));
function projections(collapsed = ['A'], sort: typeof discussionSorts[number] = 'original') {
  const comments = data(), complete = projectReaderRows(comments, unrestrictedView(comments), sort);
  return { complete, displayed: projectCollapsedRows(complete, { defaultCollapsed: false, overrides: collapsed }) };
}
const engine = () => ({ evaluate: vi.fn(async (rows: Parameters<typeof evaluateDiscussionQuery>[0], query: Parameters<typeof evaluateDiscussionQuery>[1]) => evaluateDiscussionQuery(rows, query)), dispose: vi.fn() });

it('toggles individually and adds visual ranges without including collapsed replies or replacing prior selection', () => {
  const { displayed } = projections();
  let selected = toggleBulkSelection(new Set(), 'B', undefined, false, displayed);
  expect([...selected]).toEqual(['B']);
  selected = toggleBulkSelection(selected, 'B', 'B', false, displayed); expect(selected.size).toBe(0);
  selected = toggleBulkSelection(new Set(['C1']), 'B1', 'A', true, displayed);
  expect([...selected]).toEqual(['C1', 'A', 'B', 'B1']);
  expect(toggleBulkSelection(selected, 'A1', 'A', true, displayed)).toBe(selected);
  expect([...toggleBulkSelection(new Set(), 'B', 'A1', true, displayed)]).toEqual(['B']);
});

it.each(discussionSorts)('prefix is the exact inclusive applied %s order; clicked collapsed descendants after the endpoint stay excluded', sort => {
  const { complete, displayed } = projections(['A', 'B'], sort);
  const end = complete.orderedIds.indexOf('B');
  const full = viewPrefix(complete, displayed, 'B', true);
  expect(full?.ids).toEqual(complete.orderedIds.slice(0, end + 1));
  expect(full?.ids).not.toContain('B1');
  const visibleEnd = displayed.indexById.get('B') ?? -1;
  expect(viewPrefix(complete, displayed, 'B', false)?.ids).toEqual(displayed.rows.slice(0, visibleEnd + 1).map(row => row.id));
  expect(viewPrefix(complete, displayed, 'A1', true)).toBeUndefined();
});

it('default complete prefix includes earlier hidden replies, visible-only excludes them, and no prefix extends to endpoint subtree end', () => {
  const { complete, displayed } = projections(['A', 'B']);
  expect(viewPrefix(complete, displayed, 'B', true)).toEqual({ ids: ['A', 'A1', 'A2', 'B'], hidden: 2, position: 4, total: 7 });
  expect(viewPrefix(complete, displayed, 'B', false)).toEqual({ ids: ['A', 'B'], hidden: 0, position: 2, total: 4 });
});

it('restrictive prefix includes context from applied containing trees, excludes other trees and ignores draft changes', async () => {
  const session = new DiscussionViewSession(data(), engine());
  session.edit({ ...defaultQuery, text: 'needle' }); await session.apply(data());
  session.edit({ ...defaultQuery, text: 'unapplied' });
  const complete = session.presentation(data()), displayed = session.displayed(data());
  expect(viewPrefix(complete, displayed, 'B', true)?.ids).toEqual(['A', 'A1', 'A2', 'B']);
  expect(complete.rows.find(row => row.id === 'A')?.role).toBe('context');
  expect(complete.orderedIds).not.toContain('C');
});

it('session selection stays independent of navigation, sort, hidden collapse, other discussions and persistence; Apply reconciles', async () => {
  const comments = data(), session = new DiscussionViewSession(comments, engine()), other = new DiscussionViewSession(comments, engine());
  session.select('C'); const navigation = session.state.selected;
  session.toggleBulk('A1', false); session.toggleBulk('C1', false);
  session.setCollapsed({ kind: 'comments', ids: ['A'], collapsed: true });
  session.setSort('newest');
  expect([...session.state.bulkSelected]).toEqual(['A1', 'C1']); expect(session.state.selected).toBe(navigation);
  expect(other.state.bulkSelected.size).toBe(0); expect(session.persistentIntent()).not.toHaveProperty('bulkSelected');
  session.edit({ ...defaultQuery, text: 'needle' }); await session.apply(comments);
  expect([...session.state.bulkSelected]).toEqual(['A1']);
  session.clearBulkSelection(); expect(session.state.selectionMode).toBe(true); expect(session.state.bulkSelected.size).toBe(0);
  session.toggleBulk('B', false); session.setSelectionMode(false);
  expect(session.state.bulkSelected.size).toBe(0); expect(session.state.selectionMode).toBe(false);
});

it('nested selected thread assignments retain unrelated descendant preferences and never mark seen or expand recursively', () => {
  const comments = data(), session = new DiscussionViewSession(comments, engine());
  session.toggleBulk('A', false); session.toggleBulk('A1', false); session.toggleBulk('B', false);
  session.setCollapsed({ kind: 'comments', ids: ['C'], collapsed: true });
  session.collapseSelected(true); expect(new Set(session.state.collapse.overrides)).toEqual(new Set(['A', 'B', 'C']));
  session.collapseSelected(false); expect(session.state.collapse.overrides).toEqual(['C']);
  expect(comments).toEqual(data());
});

it.each([10000, 50000])('%i offscreen range and deeply nested prefix remain iterative and operate entirely on data', count => {
  const { comments } = generateDiscussion({ count, shape: 'chain', roots: 1, maxDepth: count, seenRatio: 0 });
  const complete = projectReaderRows(comments, unrestrictedView(queryComments(comments)));
  const displayed = projectCollapsedRows(complete, { defaultCollapsed: false, overrides: [] });
  const start = performance.now(), selected = toggleBulkSelection(new Set(), `generated-${count - 1}`, 'generated-0', true, displayed);
  const prefix = viewPrefix(complete, displayed, `generated-${count - 2}`, true);
  expect(selected.size).toBe(count); expect(prefix?.ids.length).toBe(count - 1);
  const collapsed = projectCollapsedRows(complete, { defaultCollapsed: false, overrides: ['generated-0'] });
  expect(viewPrefix(complete, collapsed, 'generated-0', true)?.ids).toEqual(['generated-0']);
  console.log(JSON.stringify({ selectionScale: count, rangeAndPrefixMs: performance.now() - start }));
});

it('empty and single-row prefixes are exact snapshots', () => {
  const comments = [comment('only')], complete = projectReaderRows(comments, unrestrictedView(comments));
  const displayed = projectCollapsedRows(complete, { defaultCollapsed: false, overrides: [] });
  const prefix = viewPrefix(complete, displayed, 'only', true); expect(prefix?.ids).toEqual(['only']);
  expect(viewPrefix(complete, displayed, 'missing', true)).toBeUndefined();
  const empty = projectReaderRows([], unrestrictedView([]));
  expect(viewPrefix(empty, projectCollapsedRows(empty, { defaultCollapsed: false, overrides: [] }), 'only', true)).toBeUndefined();
});

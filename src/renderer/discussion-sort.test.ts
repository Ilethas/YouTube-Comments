import { expect, it } from 'vitest';
import { dateTestComment as comment } from '../fixtures/date-discussion';
import { evaluateTestQuery } from '../fixtures/query-testing';
import { defaultQuery, unrestrictedView } from '../domain/discussion-query';
import { projectReaderRows } from './discussion-presentation';
import { discussionSorts } from './discussion-sort';
import { generateDiscussion } from '../development/large-discussions';
import { projectRulerMarkers, aggregateRulerMarkers, rulerMarkerCoordinate } from './discussion-ruler';
import type { Comment } from '../domain/discussion';

const early = '2025-01-01T00:00:00Z', late = '2026-09-20T00:00:00Z', latest = '2026-10-01T00:00:00Z';
const data = () => [
  comment('unknown', undefined),
  comment('old', early, { likeCount: 0, publication: { instant: { status: 'observed', value: early }, precision: 'coarse', estimated: { status: 'observed', value: true }, label: { status: 'unknown', reason: 'unavailable' } } }),
  comment('reply', latest, { parentId: 'old', likeCount: 999 }),
  comment('nested', undefined, { parentId: 'reply' }),
  comment('sibling', undefined, { parentId: 'old' }),
  comment('new', late, { likeCount: 7 }),
  comment('tied', late, { likeCount: 7 }),
  comment('invalid', 'yesterday'),
];
const roots = (rows: readonly { id: string; parentId: string | null }[]) => rows.filter(row => row.parentId === null).map(row => row.id);

it('Original exactly reproduces the existing complete preorder and leaves inputs unchanged in every mode', () => {
  const comments = data(), result = unrestrictedView(comments), snapshot = JSON.stringify({ comments, result });
  expect(projectReaderRows(comments, result).orderedIds).toEqual(result.visibleCommentIds);
  for (const sort of discussionSorts) projectReaderRows(comments, result, sort);
  expect(JSON.stringify({ comments, result })).toBe(snapshot);
});

it.each([
  ['newest', ['new', 'tied', 'old', 'unknown', 'invalid']],
  ['oldest', ['old', 'new', 'tied', 'unknown', 'invalid']],
  ['most-liked', ['new', 'tied', 'old', 'unknown', 'invalid']],
  ['latest-activity', ['old', 'new', 'tied', 'unknown', 'invalid']],
] as const)('%s uses the specified key, unknown-last and Original ties', (sort, expected) => {
  const comments = data(), result = unrestrictedView(comments);
  const presentation = projectReaderRows(comments, result, sort);
  expect(roots(presentation.rows)).toEqual(expected);
  const start = presentation.indexById.get('old') ?? -1;
  expect(presentation.orderedIds.slice(start, start + 4)).toEqual(['old', 'reply', 'nested', 'sibling']);
});

it('Latest activity accepts estimated descendants, ignores label-only/missing instants, and lets the root supply activity', () => {
  const comments = [comment('empty'), comment('a', early), comment('estimated', latest, { parentId: 'a',
    publication: { instant: { status: 'observed', value: latest }, precision: 'coarse', estimated: { status: 'observed', value: true }, label: { status: 'unknown', reason: 'unavailable' } } }),
  comment('label', undefined, { parentId: 'a', publication: { instant: { status: 'unknown', reason: 'unavailable' }, precision: 'coarse', label: { status: 'observed', value: '1 minute ago' }, estimated: { status: 'observed', value: true } } }),
  comment('root-latest', latest), comment('older-reply', early, { parentId: 'root-latest' })];
  expect(roots(projectReaderRows(comments, unrestrictedView(comments), 'latest-activity').rows)).toEqual(['a', 'root-latest', 'empty']);
});

it('Most liked uses only projected root evidence: zero is known, descendants and raw unknown evidence cannot rank roots', () => {
  const comments = data().map(row => ({ ...row, likeCount: row.parentId ? 999 : undefined }));
  const result = unrestrictedView(comments), presentation = projectReaderRows(comments, result, 'most-liked');
  expect(presentation.mostLikedAvailable).toBe(false);
  expect(presentation.orderedIds).toEqual(result.visibleCommentIds);
  expect(projectReaderRows([], unrestrictedView([]), 'most-liked').mostLikedAvailable).toBe(false);
});

it.each(['shallow', 'mixed', 'chain'] as const)('whole %s filtered trees retain exact reply structure, roles, ancestry and sibling metadata', shape => {
  const { comments } = generateDiscussion({ count: 1000, roots: 4, shape, maxDepth: 1000, matchIndexes: [10, 600, 999] });
  const changed = comments.map((row, index) => ({ ...row, publishedAt: new Date(Date.parse(early) + index * 1000).toISOString() }));
  const outcome = evaluateTestQuery(changed, { ...defaultQuery, text: 'PROFILE_MATCH' });
  if (!outcome.ok) throw new Error('Query failed');
  const original = projectReaderRows(changed, outcome.result), sorted = projectReaderRows(changed, outcome.result, 'newest');
  expect(sorted.rows.length).toBe(original.rows.length);
  expect(roots(sorted.rows)).toEqual(roots(original.rows).reverse());
  const originalById = new Map(original.rows.map(row => [row.id, row]));
  for (const row of sorted.rows) {
    const before = originalById.get(row.id);
    expect(row.depth).toBe(before?.depth); expect(row.parentId).toBe(before?.parentId); expect(row.rootId).toBe(before?.rootId);
    expect(row.role).toBe(before?.role); expect(row.rawHit).toBe(before?.rawHit);
    if (row.parentId) {
      expect(sorted.indexById.get(row.parentId)).toBeLessThan(sorted.indexById.get(row.id) ?? -1);
      expect(row.firstSibling).toBe(before?.firstSibling); expect(row.lastSibling).toBe(before?.lastSibling);
    }
    expect(row.ancestors?.id).toBe(before?.ancestors?.id);
  }
  for (const root of roots(original.rows)) {
    expect(sorted.rows.filter(row => row.rootId === root).map(row => row.id)).toEqual(original.rows.filter(row => row.rootId === root).map(row => row.id));
  }
  expect(sorted.rows.find(row => row.parentId === null)?.firstSibling).toBe(true);
  expect(sorted.rows.filter(row => row.parentId === null).at(-1)?.lastSibling).toBe(true);
});

it('safe cyclic/unresolved roots and Community containment remain display structures, without reinterpreting source truth', () => {
  const comments = [comment('cycle-a', early, { relationshipStatus: 'cyclic', relationship: { kind: 'direct-parent', parentSourceId: 'cycle-b' } }),
    comment('cycle-b', latest, { relationshipStatus: 'cyclic', relationship: { kind: 'direct-parent', parentSourceId: 'cycle-a' } }),
    comment('missing', late, { relationshipStatus: 'unresolved', relationship: { kind: 'direct-parent', parentSourceId: 'absent' } }),
    comment('contained', latest, { parentId: 'cycle-a', directParentId: null, relationshipStatus: 'resolved', relationship: { kind: 'thread-containment', rootSourceId: 'cycle-a' } })];
  const result = unrestrictedView(comments), snapshot = JSON.stringify(comments);
  expect(projectReaderRows(comments, result, 'newest').orderedIds).toEqual(['cycle-b', 'missing', 'cycle-a', 'contained']);
  expect(projectReaderRows(comments, result, 'latest-activity').orderedIds).toEqual(['cycle-a', 'contained', 'cycle-b', 'missing']);
  expect(JSON.stringify(comments)).toBe(snapshot);
});

it('ruler keeps category identities while positions/targets follow sorted geometry', () => {
  const comments = data(), result = { ...unrestrictedView(comments), restrictive: true, activeMatchIds: ['old', 'new'] };
  const markers = (sort: 'original' | 'newest') => projectRulerMarkers(projectReaderRows(comments, result, sort).rows, result, new Set(['reply', 'new']));
  const original = markers('original'), sorted = markers('newest');
  const membership = (rows: typeof original) => new Map(rows.map(row => [row.commentId, row.categories]));
  expect(membership(sorted)).toEqual(membership(original));
  expect(sorted[0].commentId).toBe('new'); expect(sorted[0].presentationIndex).toBe(0);
  const measurements = comments.map((_, index) => ({ start: index * 100, size: 100 }));
  const buckets = aggregateRulerMarkers(sorted, measurements, comments.length * 100, 600);
  expect(buckets[0].targets.match.markers[0].commentId).toBe('new');
  expect(rulerMarkerCoordinate(sorted[0], buckets[0].geometry)).toBe(37.5);
});

it.each([10000, 50000])('%i projection reads publication once per displayed comment and root likes once, including deep chains', count => {
  for (const shape of ['flat', 'chain'] as const) {
    let publicationReads = 0, likeReads = 0;
    const data = generateDiscussion({ count, shape, roots: shape === 'flat' ? count : 1, maxDepth: count });
    const result = unrestrictedView(data.comments);
    const comments: readonly Comment[] = data.comments.map((row, index) => ({ ...row,
      get publishedAt() { publicationReads++; return new Date(Date.parse(early) + index * 1000).toISOString(); },
      get likeCount() { likeReads++; return index; } }));
    const sorted = projectReaderRows(comments, result, 'latest-activity');
    expect(publicationReads).toBe(count); expect(likeReads).toBe(shape === 'flat' ? count : 1);
    expect(sorted.rows).toHaveLength(count);
    expect(sorted.rows.at(-1)?.depth).toBe(shape === 'flat' ? 0 : count - 1);
  }
});

import { expect, it } from 'vitest';
import { defaultQuery, evaluateDiscussionQuery, queryComments, sameQuery } from './discussion-query';
import type { DiscussionQuery } from './discussion-query';
import type { Comment } from './discussion';
import { dateTestItem, dateTestComment } from '../fixtures/date-discussion';
import { resolveDiscussionQuery } from './discussion-query-resolution';

function view(comments: readonly Comment[], criteria: Partial<DiscussionQuery>, item = dateTestItem) {
  const resolution = resolveDiscussionQuery({ ...defaultQuery, ...criteria }, { now: Date.parse('2026-10-07T12:00:00Z'), timeZone: 'UTC' });
  if (!resolution.ok) throw new Error(resolution.error);
  const result = evaluateDiscussionQuery(queryComments(comments, item), resolution.query);
  if (!result.ok) throw new Error(result.error);
  return result.result;
}
const newDiscovery = { firstDiscoveredAt: '2026-10-07T12:00:00Z', lastObservedAt: '2026-10-07T12:00:00Z', firstDiscoveryId: 'latest' };
it('uses exact, estimated and coarse stored own instants, never labels/discovery/parent time', () => {
  const publication = { instant: { status: 'observed' as const, value: '2026-10-07T01:00:00Z' }, label: { status: 'observed' as const, value: 'one day ago' },
    precision: 'coarse' as const, estimated: { status: 'observed' as const, value: true } };
  const rows = [dateTestComment('exact', '2026-10-07T01:00:00Z'), dateTestComment('estimate', '2026-10-07T01:00:00Z', { publication }),
    dateTestComment('missing', undefined, { parentId: 'exact' }), dateTestComment('label', undefined, { publication }),
    dateTestComment('invalid', 'bad'), dateTestComment('date-only', '2026-10-07'), dateTestComment('old', '2001-01-01T00:00:00Z')];
  const result = view(rows, { publication: { kind: 'today' } });
  expect(result.activeMatchIds).toEqual(['exact', 'estimate']);
  expect(result.visibleCommentIds).toEqual(['exact', 'missing', 'estimate']);
  expect(view(rows, {}).matchCount).toBe(rows.length);
  const projected = queryComments(rows, dateTestItem);
  expect(projected[1].publicationInstant).toBe(Date.parse(publication.instant.value));
  expect(projected.every(row => !('publication' in row) && !('discovery' in row) && !('remote' in row))).toBe(true);
});
it('NEW is the durable latest post-baseline cohort independent of seen and publication age', () => {
  const rows = [dateTestComment('baseline', '2026-10-07T01:00:00Z'), dateTestComment('old-seen-new', '2001-01-01T00:00:00Z', { seen: true, discovery: newDiscovery }),
    dateTestComment('no-publication-new', undefined, { discovery: newDiscovery }), dateTestComment('prior', '2026-10-07T01:00:00Z', { discovery: { ...newDiscovery, firstDiscoveryId: 'prior' } })];
  expect(view(rows, { discovery: 'new' }).activeMatchIds).toEqual(['old-seen-new', 'no-publication-new']);
  expect(view(rows, { discovery: 'new' }, { ...dateTestItem, latestAcceptedDiscoveryId: 'baseline' }).matchCount).toBe(0);
  expect(view(rows, { discovery: 'new' }, { ...dateTestItem, latestAcceptedDiscoveryId: 'zero-insert' }).matchCount).toBe(0);
});
it('ANDs all clauses on one comment, retaining full context and independent raw search counts', () => {
  const rows = [dateTestComment('root', '2026-10-07T01:00:00Z', { seen: true, discovery: newDiscovery }),
    dateTestComment('old', '2001-01-01T00:00:00Z', { parentId: 'root', discovery: newDiscovery }),
    dateTestComment('no-search', '2026-10-07T01:00:00Z', { parentId: 'root', text: 'context', discovery: newDiscovery }),
    dateTestComment('baseline', '2026-10-07T01:00:00Z', { parentId: 'root' })];
  const criteria = { text: 'needle', seen: 'unseen' as const, publication: { kind: 'today' as const }, discovery: 'new' as const };
  expect(view(rows, criteria).matchCount).toBe(0);
  const result = view([...rows, dateTestComment('match', '2026-10-07T01:00:00Z', { parentId: 'root', discovery: newDiscovery })], criteria);
  expect(result.activeMatchIds).toEqual(['match']); expect(result.rawSearchMatchIds).toEqual(['root', 'old', 'baseline', 'match']);
  expect(result.visibleCommentIds).toEqual(['root', 'old', 'no-search', 'baseline', 'match']);
  expect(result.matchCount).toBe(1); expect(result.threadCount).toBe(1); expect(result.restrictive).toBe(true);
});
it('draft equality includes date/discovery semantic criteria and no captured clock', () => {
  expect(sameQuery(defaultQuery, { ...defaultQuery, discovery: 'new' })).toBe(false);
  expect(sameQuery(defaultQuery, { ...defaultQuery, publication: { kind: 'today' } })).toBe(false);
  const query = { ...defaultQuery, publication: { kind: 'custom' as const, from: '2026-10-07' } };
  expect(sameQuery(query, { ...query })).toBe(true);
  expect(sameQuery(query, { ...query, publication: { kind: 'custom', from: '2026-10-08' } })).toBe(false);
});

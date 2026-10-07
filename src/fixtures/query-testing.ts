import { defaultQuery, evaluateDiscussionQuery } from '../domain/discussion-query';
import type { DiscussionQuery, QueryComment, ResolvedDiscussionQuery } from '../domain/discussion-query';
import { resolveDiscussionQuery } from '../domain/discussion-query-resolution';

/** Fixed clock/zone for older search-only tests. Date-specific tests inject their own. */
export function resolveTestQuery(query: DiscussionQuery): ResolvedDiscussionQuery {
  const resolved = resolveDiscussionQuery(query, { now: Date.parse('2026-10-07T12:00:00Z'), timeZone: 'UTC' });
  if (!resolved.ok) throw new Error(resolved.error);
  return resolved.query;
}
export const defaultResolvedQuery = resolveTestQuery(defaultQuery);
export function evaluateTestQuery(comments: readonly QueryComment[], query: DiscussionQuery) {
  return evaluateDiscussionQuery(comments, resolveTestQuery(query));
}

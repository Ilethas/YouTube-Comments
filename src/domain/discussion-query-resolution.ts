import type { DiscussionQuery, QueryErrorCode, ResolvedDiscussionQuery } from './discussion-query';
import { resolvePublication } from './publication-filter';
import type { QueryEvaluationTime } from './publication-filter';

/** Semantic dates remain in the session. Resolve once before dispatch; worker
 * imports never include the timezone resolver or Temporal runtime. */
export function resolveDiscussionQuery(query: DiscussionQuery, time: QueryEvaluationTime):
  { readonly ok: true; readonly query: ResolvedDiscussionQuery } | { readonly ok: false; readonly error: QueryErrorCode } {
  const resolution = resolvePublication(query.publication, time);
  if (!resolution.ok) return resolution;
  const { text, fields, mode, caseSensitive, seen, discovery } = query;
  return { ok: true, query: { text, fields, mode, caseSensitive, seen, discovery, publicationBounds: resolution.bounds } };
}

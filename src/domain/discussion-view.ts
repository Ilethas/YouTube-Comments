import type { DiscussionQuery } from './discussion-query';

/** Durable presentation intent; sorting moves whole conversations only. */
export type DiscussionSort = 'original' | 'newest' | 'oldest' | 'most-liked' | 'latest-activity';
export const discussionSorts: readonly DiscussionSort[] = ['original', 'newest', 'oldest', 'most-liked', 'latest-activity'];
export const maxQueryTextLength = 16384;
export const maxAnchorOffset = 100000;
/** A null identity represents the reader header/top, independent of header height. */
export interface DiscussionAnchor { readonly commentId: string | null; readonly offset: number }
/** Semantic criteria and application identities only. Results, resolved dates,
 * geometry, pending/errors and focus never belong to this durable record. */
export interface DiscussionViewIntent {
  readonly draft: DiscussionQuery;
  readonly applied: DiscussionQuery;
  readonly sort: DiscussionSort;
  readonly anchor: DiscussionAnchor;
  readonly selected: string | null;
}
export interface SaveDiscussionViewRequest extends DiscussionViewIntent { readonly itemId: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return record(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
export function isViewIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}
/** Exact bounded shape validation, without evaluating regex or resolving dates.
 * Incomplete/invalid semantic drafts can be saved and corrected in the reader. */
export function isDiscussionQuery(value: unknown): value is DiscussionQuery {
  if (!keys(value, ['text', 'fields', 'mode', 'caseSensitive', 'seen', 'publication', 'discovery'])) return false;
  const publication = value.publication;
  const validPublication = keys(publication, ['kind']) && ['all', 'today', 'last-24-hours', 'last-7-days'].includes(publication.kind as string)
    || keys(publication, ['kind'], ['from', 'to']) && publication.kind === 'custom'
      && ['from', 'to'].every(key => publication[key] === undefined || typeof publication[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(publication[key] as string));
  return typeof value.text === 'string' && value.text.length <= maxQueryTextLength
    && Array.isArray(value.fields) && value.fields.length <= 3
    && value.fields.every(field => ['content', 'author', 'replied-to-author'].includes(field)) && new Set(value.fields).size === value.fields.length
    && ['text', 'regex'].includes(value.mode as string) && typeof value.caseSensitive === 'boolean'
    && ['all', 'unseen', 'seen'].includes(value.seen as string) && ['all', 'new'].includes(value.discovery as string) && validPublication;
}
/** Main checks exact runtime shape and then separately checks same-item ownership. */
export function isSaveDiscussionViewRequest(value: unknown): value is SaveDiscussionViewRequest {
  if (!keys(value, ['itemId', 'draft', 'applied', 'sort', 'anchor', 'selected'])) return false;
  return isViewIdentity(value.itemId) && isDiscussionQuery(value.draft) && isDiscussionQuery(value.applied)
    && discussionSorts.includes(value.sort as DiscussionSort)
    && (value.selected === null || isViewIdentity(value.selected))
    && keys(value.anchor, ['commentId', 'offset']) && (value.anchor.commentId === null || isViewIdentity(value.anchor.commentId))
    && typeof value.anchor.offset === 'number' && Number.isFinite(value.anchor.offset) && Math.abs(value.anchor.offset) <= maxAnchorOffset;
}
/** Bound geometry from measured rows before it crosses the intent boundary. */
export function boundedAnchor(commentId: string | undefined, offset: number): DiscussionAnchor {
  return { commentId: commentId ?? null, offset: commentId === undefined ? 0
    : Number.isFinite(offset) ? Math.max(-maxAnchorOffset, Math.min(maxAnchorOffset, offset)) : 0 };
}

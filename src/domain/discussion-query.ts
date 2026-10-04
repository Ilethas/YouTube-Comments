import { buildCommentTree, walkComments } from './discussion';
import type { Comment } from './discussion';

export type SearchField = 'content' | 'author' | 'replied-to-author';
export type SearchMode = 'text' | 'regex';
export type SeenFilter = 'all' | 'unseen' | 'seen';
/** Locale-independent criteria over every application comment of one discussion. */
export interface DiscussionQuery {
  readonly text: string;
  readonly fields: readonly SearchField[];
  readonly mode: SearchMode;
  readonly caseSensitive: boolean;
  readonly seen: SeenFilter;
}
export const defaultQuery: DiscussionQuery = { text: '', fields: ['content'], mode: 'text', caseSensitive: false, seen: 'all' };
/** Immutable evaluation snapshot. Live seen state must never redefine these IDs. */
export interface DiscussionViewResult {
  readonly restrictive: boolean;
  readonly searchActive: boolean;
  readonly rawSearchMatchIds: readonly string[];
  readonly activeMatchIds: readonly string[];
  readonly containingThreadIds: readonly string[];
  /** Complete containing trees in stable reader preorder. */
  readonly visibleCommentIds: readonly string[];
  readonly visibleParentIds: Readonly<Record<string, string | null>>;
  readonly orderedMatchIds: readonly string[];
  readonly matchCount: number;
  readonly threadCount: number;
}
export type QueryErrorCode = 'NO_SEARCH_FIELDS' | 'INVALID_REGEX' | 'QUERY_TOO_EXPENSIVE' | 'QUERY_FAILED' | 'QUERY_CANCELLED';
export type QueryOutcome = { readonly ok: true; readonly result: DiscussionViewResult }
  | { readonly ok: false; readonly error: QueryErrorCode };

/** Only query-owned application fields cross the worker boundary, never evidence/raw output. */
export type QueryComment = Pick<Comment, 'id' | 'itemId' | 'parentId' | 'text' | 'seen' | 'directParentId' | 'relationshipStatus'> & {
  readonly author?: Pick<NonNullable<Comment['author']>, 'displayName' | 'handle'>;
  readonly relationshipKind?: 'top-level' | 'direct-parent' | 'thread-containment';
};
export function queryComments(comments: readonly Comment[]): readonly QueryComment[] {
  return comments.map(({ id, itemId, parentId, text, seen, directParentId, relationshipStatus, author, relationship }) => ({
    id, itemId, parentId, text, seen, directParentId, relationshipStatus, relationshipKind: relationship?.kind,
    author: author ? { displayName: author.displayName, handle: author.handle } : undefined,
  }));
}

function orderedTrees(comments: readonly QueryComment[]) {
  return buildCommentTree(comments).map(root => ({ id: root.comment.id, rows: walkComments([root]) }));
}
/** Initial identity view needs no comparison/RegExp execution. */
export function unrestrictedView(comments: readonly QueryComment[]): DiscussionViewResult {
  const trees = orderedTrees(comments), ids = trees.flatMap(tree => tree.rows.map(row => row.id));
  return { restrictive: false, searchActive: false, rawSearchMatchIds: [], activeMatchIds: ids,
    containingThreadIds: trees.map(tree => tree.id), visibleCommentIds: ids, orderedMatchIds: ids,
    visibleParentIds: Object.fromEntries(comments.map(row => [row.id, row.parentId])),
    matchCount: ids.length, threadCount: trees.length };
}
/** Pure complete evaluation; production callers must execute through the cancellable worker. */
export function evaluateDiscussionQuery(comments: readonly QueryComment[], query: DiscussionQuery): QueryOutcome {
  const searchActive = query.text.length > 0;
  if (searchActive && !query.fields.length) return { ok: false, error: 'NO_SEARCH_FIELDS' };
  let regex: RegExp | undefined;
  const pattern = query.text.normalize('NFC');
  if (searchActive && query.mode === 'regex') {
    try { regex = new RegExp(pattern, query.caseSensitive ? 'u' : 'iu'); }
    catch { return { ok: false, error: 'INVALID_REGEX' }; }
  }
  const needle = query.caseSensitive ? pattern : pattern.toLowerCase();
  const matches = (value: string | undefined) => {
    if (value === undefined) return false;
    const normalized = value.normalize('NFC');
    return regex ? regex.test(normalized) : (query.caseSensitive ? normalized : normalized.toLowerCase()).includes(needle);
  };
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const authorMatches = (comment?: QueryComment) => matches(comment?.author?.displayName) || matches(comment?.author?.handle);
  const raw = new Set<string>(), active = new Set<string>();
  for (const comment of comments) {
    const parent = comment.relationshipKind === 'direct-parent' && comment.relationshipStatus === 'resolved'
      && comment.directParentId && comment.directParentId !== comment.id ? byId.get(comment.directParentId) : undefined;
    const searchMatch = searchActive && query.fields.some(field => field === 'content' ? matches(comment.text)
      : field === 'author' ? authorMatches(comment) : authorMatches(parent));
    if (searchMatch) raw.add(comment.id);
    if ((!searchActive || searchMatch) && (query.seen === 'all' || comment.seen === (query.seen === 'seen'))) active.add(comment.id);
  }
  const allTrees = orderedTrees(comments);
  const trees = allTrees.filter(tree => tree.rows.some(row => active.has(row.id)));
  const visible = trees.flatMap(tree => tree.rows.map(row => row.id));
  const orderedMatchIds = visible.filter(id => active.has(id));
  return { ok: true, result: { restrictive: searchActive || query.seen !== 'all', searchActive,
    rawSearchMatchIds: allTrees.flatMap(tree => tree.rows.filter(row => raw.has(row.id)).map(row => row.id)),
    activeMatchIds: orderedMatchIds, containingThreadIds: trees.map(tree => tree.id), visibleCommentIds: visible,
    visibleParentIds: Object.fromEntries(trees.flatMap(tree => tree.rows.map(row => [row.id, row.parentId]))),
    orderedMatchIds, matchCount: active.size, threadCount: trees.length } };
}

export function sameQuery(left: DiscussionQuery, right: DiscussionQuery): boolean {
  return left.text === right.text && left.mode === right.mode && left.caseSensitive === right.caseSensitive && left.seen === right.seen
    && left.fields.length === right.fields.length && left.fields.every(field => right.fields.includes(field));
}
/** Resolve browser-find style wrap using displayed preorder, even when selection is context. */
export function navigationTarget(order: readonly string[], candidates: readonly string[], selected: string | undefined, direction: 1 | -1): string | undefined {
  const eligible = new Set(candidates), targets = order.filter(id => eligible.has(id));
  if (!targets.length) return undefined;
  const position = selected === undefined ? -1 : order.indexOf(selected);
  if (position < 0) return direction === 1 ? targets[0] : targets[targets.length - 1];
  if (direction === 1) return order.slice(position + 1).find(id => eligible.has(id)) ?? targets[0];
  return order.slice(0, position).reverse().find(id => eligible.has(id)) ?? targets[targets.length - 1];
}
/** Unseen navigation deliberately uses live state within the frozen displayed membership. */
export function visibleUnseenIds(result: DiscussionViewResult, comments: readonly QueryComment[]): readonly string[] {
  const unseen = new Set(comments.filter(comment => !comment.seen).map(comment => comment.id));
  return result.visibleCommentIds.filter(id => unseen.has(id));
}

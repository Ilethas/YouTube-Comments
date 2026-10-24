import type { Comment } from '../domain/discussion';
import type { DiscussionViewResult } from '../domain/discussion-query';
import { sortDiscussionTrees } from './discussion-sort';
import type { DiscussionSort } from './discussion-sort';

/** Shared linked ancestry keeps projection linear even for very deep chains.
 * `continues` means this ancestor has a following sibling, not source parent truth. */
export interface ReaderAncestor {
  readonly id: string;
  readonly depth: number;
  readonly continues: boolean;
  readonly parent: ReaderAncestor | null;
}
/** Frozen display placement plus live acknowledged content; no source fields are rewritten. */
export interface ReaderRow {
  readonly id: string;
  readonly comment: Comment;
  readonly depth: number;
  readonly parentId: string | null;
  readonly rootId: string;
  readonly hasChildren: boolean;
  readonly lastSibling: boolean;
  readonly firstSibling: boolean;
  readonly ancestors: ReaderAncestor | null;
  readonly role: 'normal' | 'match' | 'context';
  readonly rawHit: boolean;
}
export interface ReaderPresentation {
  readonly rows: readonly ReaderRow[];
  readonly indexById: ReadonlyMap<string, number>;
  readonly orderedIds: readonly string[];
  readonly orderedMatchIds: readonly string[];
  readonly mostLikedAvailable: boolean;
}
/** Project the applied complete-tree preorder, using its frozen parents even after
 * a failed Refresh evaluation. Live seen never changes membership or role.
 * A retained order joins live content without moving rows before Refresh captures
 * its anchor. New applied results and explicit sort changes compute fresh keys.
 * Availability follows all current display roots, independently of frozen order. */
export function projectReaderRows(comments: readonly Comment[], result: DiscussionViewResult, sort: DiscussionSort = 'original',
  retainedOrder?: Pick<ReaderPresentation, 'orderedIds'>): ReaderPresentation {
  const byId = new Map<string, Comment>();
  let mostLikedAvailable = false;
  // Reuse the existing full-discussion join, without constructing another tree.
  // parentId is the safe display placement; source relationships stay untouched.
  for (const comment of comments) {
    byId.set(comment.id, comment);
    if (!mostLikedAvailable && comment.parentId === null && comment.likeCount !== undefined) mostLikedAvailable = true;
  }
  const order = retainedOrder?.orderedIds ?? sortDiscussionTrees(result, byId, sort);
  const lastChild = new Map<string | null, string>(), firstChild = new Map<string | null, string>(), parents = new Set<string>();
  for (const id of order) {
    if (!byId.has(id)) continue;
    const parent = result.visibleParentIds[id];
    lastChild.set(parent, id);
    if (!firstChild.has(parent)) firstChild.set(parent, id);
    if (parent !== null) parents.add(parent);
  }
  const active = new Set(result.activeMatchIds), raw = new Set(result.rawSearchMatchIds);
  const rows: ReaderRow[] = [], indexById = new Map<string, number>();
  const paths = new Map<string, ReaderAncestor>();
  for (const id of order) {
    const comment = byId.get(id);
    if (!comment) continue;
    const parentId = result.visibleParentIds[id], ancestor = parentId === null ? null : paths.get(parentId);
    if (parentId !== null && !ancestor) throw new Error('Applied reader order must contain parents before children');
    const depth = ancestor ? ancestor.depth + 1 : 0;
    const parentIndex = parentId === null ? undefined : indexById.get(parentId);
    const rootId = parentIndex === undefined ? id : rows[parentIndex].rootId;
    const lastSibling = lastChild.get(parentId) === id;
    indexById.set(id, rows.length);
    rows.push({ id, comment, depth, parentId, rootId, hasChildren: parents.has(id), lastSibling, firstSibling: firstChild.get(parentId) === id, ancestors: ancestor ?? null,
      role: !result.restrictive ? 'normal' : active.has(id) ? 'match' : 'context', rawHit: raw.has(id) });
    paths.set(id, { id, depth, continues: !lastSibling, parent: ancestor ?? null });
  }
  const orderedIds = rows.map(row => row.id);
  return { rows, indexById, orderedIds, orderedMatchIds: orderedIds.filter(id => active.has(id)), mostLikedAvailable };
}
/** Original 44/10/3px compaction with an upper gutter budget for pathological depth.
 * Exact depth and linked ancestry remain available, independently of pixel compaction. */
export function readerIndent(depth: number): number {
  return Math.min(340, Math.min(depth, 4) * 44 + Math.max(0, Math.min(depth, 9) - 4) * 10 + Math.max(0, depth - 9) * 3);
}
/** CSS shares the same responsive indentation budget for articles and rails.
 * Selection controls use this same clamped indent beside their own avatars. */
export function readerIndentCss(depth: number): string {
  return `min(${readerIndent(depth)}px, var(--indent-budget))`;
}
/** Compact reply levels return from the parent's avatar gutter to its left edge. */
export function readerRailX(depth: number): string {
  return `calc(${readerIndentCss(Math.max(0, depth - 1))} + ${depth < 5 ? 'var(--rail-x)' : '0px'})`;
}
/** Unmeasured multiline estimate; every mounted row is subsequently measured. */
export function estimateReaderHeight(row: ReaderRow, width: number): number {
  const charsPerLine = Math.max(12, Math.floor((width - readerIndent(row.depth) - 140) / 7));
  const lines = row.comment.text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return 72 + lines * 20.3;
}

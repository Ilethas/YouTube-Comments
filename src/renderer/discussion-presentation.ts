import type { Comment } from '../domain/discussion';
import type { DiscussionViewResult } from '../domain/discussion-query';

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
}
/** Project the applied complete-tree preorder, using its frozen parents even after
 * a failed Refresh evaluation. Live seen never changes membership or role. */
export function projectReaderRows(comments: readonly Comment[], result: DiscussionViewResult): ReaderPresentation {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const lastChild = new Map<string | null, string>(), firstChild = new Map<string | null, string>(), parents = new Set<string>();
  for (const id of result.visibleCommentIds) {
    if (!byId.has(id)) continue;
    const parent = result.visibleParentIds[id];
    lastChild.set(parent, id);
    if (!firstChild.has(parent)) firstChild.set(parent, id);
    if (parent !== null) parents.add(parent);
  }
  const active = new Set(result.activeMatchIds), raw = new Set(result.rawSearchMatchIds);
  const rows: ReaderRow[] = [], indexById = new Map<string, number>();
  const paths = new Map<string, ReaderAncestor>();
  for (const id of result.visibleCommentIds) {
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
  return { rows, indexById };
}
/** Original 22/10/3px compaction with an upper gutter budget for pathological depth.
 * Exact depth and linked ancestry remain available, independently of pixel compaction. */
export function readerIndent(depth: number): number {
  return Math.min(340, Math.min(depth, 4) * 44 + Math.max(0, Math.min(depth, 9) - 4) * 10 + Math.max(0, depth - 9) * 3);
}
/** Compact reply levels return from the parent's avatar gutter to its left edge. */
export function readerRailX(depth: number): number {
  return readerIndent(Math.max(0, depth - 1)) + (depth < 5 ? 22 : 0);
}
/** Unmeasured multiline estimate; every mounted row is subsequently measured. */
export function estimateReaderHeight(row: ReaderRow, width: number): number {
  const charsPerLine = Math.max(12, Math.floor((width - readerIndent(row.depth) - 140) / 7));
  const lines = row.comment.text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return 72 + lines * 20.3;
}

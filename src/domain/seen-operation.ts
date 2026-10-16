import type { Comment } from './discussion';
import type { BulkPublicationCriteria } from './publication-filter';

/** Frozen explicit IDs describe user selection or a confirmed reading prefix. */
export type BulkSeenTarget = { readonly kind: 'all' }
  | { readonly kind: 'matching'; readonly ids: readonly string[] }
  | { readonly kind: 'explicit'; readonly reason: 'selected' | 'view-prefix'; readonly ids: readonly string[] }
  | ({ readonly kind: 'publication' } & BulkPublicationCriteria);
/** Main resolves and validates this discussion-scoped assignment transactionally. */
export interface BulkSeenRequest { readonly itemId: string; readonly seen: boolean; readonly target: BulkSeenTarget }
/** Safe presentation metadata; revisions and recovery entries remain main-only. */
export interface SeenUndoDescriptor {
  readonly id: string; readonly itemId: string;
  readonly kind: 'all' | 'matching' | 'publication' | 'subtree' | 'selected' | 'view-prefix';
  readonly targetSeen: boolean; readonly targetCount: number; readonly changedCount: number; readonly createdAt: string;
}
/** Acknowledged live state, actual transition count, and current recovery availability.
 * Applied query membership is independent and must not be recomputed from this. */
export interface SeenMutationResult {
  readonly comments: readonly Comment[];
  readonly targetCount: number; readonly changedCount: number;
  readonly undo: SeenUndoDescriptor | null;
}
/** Successful one-shot recovery counts later-owned/missing recorded rows as skipped. */
export interface SeenUndoResult extends SeenMutationResult { readonly restored: number; readonly skipped: number }

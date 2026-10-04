import type { CommentRelationship, ContentSourceKind } from './extraction-observation';
import type { StoredCommentObservation, StoredContentObservation, StoredPublication } from './observation-merge';
/** Reader content discriminants map one-to-one to the two current source families.
 * Internal application IDs remain separate from opaque remote IDs. */
export type ItemKind = 'video' | 'post';

/** Available identity and display metadata; a display name is never an account ID. */
export interface Author {
  readonly sourceId?: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

interface ItemBase {
  readonly id: string;
  /** Main-derived capability; synthetic baseline content cannot be removed. */
  readonly removable?: boolean;
  readonly sourceId: string;
  readonly author?: Author;
  readonly publishedAt?: string;
  readonly baselineDiscoveryId: string;
  readonly sourceKind?: ContentSourceKind;
  /** Stored normalized evidence, including labels/precision and remote attachments. */
  readonly remote?: StoredContentObservation;
}

/** Source-independent discussion content. The discriminant determines its header;
 * application identity remains separate from the opaque source ID. */
export type ContentItem = ItemBase & (
  | { readonly kind: 'video'; readonly title: string; readonly description?: string }
  | { readonly kind: 'post'; readonly text: string }
);

/** One stored reader comment. Only explicit user actions change `seen`.
 * Publication stays distinct from discovery, with honest precision/label evidence.
 * Optional evidence properties also permit the original pure synthetic fixtures. */
export interface Comment {
  readonly id: string;
  readonly itemId: string;
  readonly source: { readonly kind: ItemKind; readonly itemId: string; readonly commentId: string };
  /** Safe display placement; containment is not direct replied-to evidence. */
  readonly parentId: string | null;
  /** Source truth is separate from best-effort display parentId. */
  readonly relationship?: CommentRelationship;
  readonly relationshipStatus?: 'top-level' | 'resolved' | 'unresolved' | 'cyclic';
  readonly directParentId?: string | null;
  readonly publication?: StoredPublication;
  readonly remote?: StoredCommentObservation;
  readonly author?: Author;
  readonly text: string;
  readonly publishedAt?: string;
  readonly discovery: {
    readonly firstDiscoveredAt: string;
    readonly lastObservedAt: string;
    readonly firstDiscoveryId: string;
    readonly lastObservationId?: string;
  };
  readonly likeCount?: number;
  readonly isCreator?: boolean;
  readonly isPinned?: boolean;
  readonly seen: boolean;
}

export interface CommentNode<T = Comment> {
  readonly comment: T;
  readonly children: readonly CommentNode<T>[];
}

/** Constructs a forest for one complete, valid in-memory discussion, retaining
 * input sibling order. Parents may follow children. Invalid fixtures throw;
 * this is a precondition check, not a source repair/partial-acquisition policy. */
export function buildCommentTree<T extends Pick<Comment, 'id' | 'itemId' | 'parentId'>>(comments: readonly T[]): readonly CommentNode<T>[] {
  const nodes = new Map<string, { comment: T; children: CommentNode<T>[] }>();
  for (const comment of comments) {
    if (nodes.has(comment.id)) throw new Error('Duplicate application comment ID');
    if (comment.itemId !== comments[0].itemId) throw new Error('Mixed discussions');
    nodes.set(comment.id, { comment, children: [] });
  }
  const roots: CommentNode<T>[] = [];
  for (const node of nodes.values()) {
    if (node.comment.parentId === null) roots.push(node);
    else {
      const parent = nodes.get(node.comment.parentId);
      if (!parent) throw new Error('Missing parent in complete discussion');
      parent.children.push(node);
    }
  }
  if (walkComments(roots).length !== comments.length) throw new Error('Cyclic comment relationships');
  return roots;
}

/** Preorder traversal over data, independent of displayed or mounted rows. */
export function walkComments<T>(roots: readonly CommentNode<T>[]): readonly T[] {
  const result: T[] = [];
  const pending = [...roots].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    result.push(node.comment);
    for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
  }
  return result;
}

/** Toggles the target once. Ctrl applies that resulting value to every stored
 * descendant; ancestors/siblings and discovery metadata are never changed.
 * Returns new data without mutating its input. The main service persists this
 * result atomically; this pure function has no storage dependency. */
export function toggleSeen(comments: readonly Comment[], id: string, subtree = false): readonly Comment[] {
  const roots = buildCommentTree(comments);
  const target = comments.find(comment => comment.id === id);
  if (!target) throw new Error('Unknown comment');
  const ids = new Set([id]);
  if (subtree) {
    const pending = [...roots];
    while (pending.length) {
      const node = pending.pop();
      if (!node) break;
      if (node.comment.id === id) {
        for (const comment of walkComments([node])) ids.add(comment.id);
        break;
      }
      pending.push(...node.children);
    }
  }
  return comments.map(comment => ids.has(comment.id) ? { ...comment, seen: !target.seen } : comment);
}

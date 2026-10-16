import { isNewDiscovery } from '../domain/discussion';
import type { Comment, ContentItem } from '../domain/discussion';
// Fixed fixture examples are confined to the original synthetic discussions.
export const demoNow = Date.parse('2026-09-20T12:00:00Z');
export const demoNewCommentIds: ReadonlySet<string> = new Set(['v3', 'p3']);

/** Join durable production eligibility while isolating the original two demo
 * fixture examples. Neither branch reads or changes manual seen state. */
export function readerNewCommentIds(item: ContentItem, comments: readonly Comment[]): ReadonlySet<string> {
  return new Set(comments.filter(comment => item.isDemo ? demoNewCommentIds.has(comment.id) : isNewDiscovery(item, comment)).map(comment => comment.id));
}

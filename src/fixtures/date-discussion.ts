import type { Comment, ContentItem } from '../domain/discussion';

/** Deterministic synthetic evidence; never initialized in a valuable profile. */
export const dateTestItem: ContentItem = { id: 'date-test', kind: 'video', sourceId: 'synthetic-date-test', title: 'Date boundary fixture',
  baselineDiscoveryId: 'baseline', latestAcceptedDiscoveryId: 'latest' };
export function dateTestComment(id: string, publishedAt?: string, options: Partial<Comment> = {}): Comment {
  return { id, itemId: dateTestItem.id, parentId: null, text: 'needle', seen: false,
    source: { kind: 'video', itemId: dateTestItem.sourceId, commentId: id }, publishedAt,
    discovery: { firstDiscoveredAt: '2026-10-07T12:00:00Z', lastObservedAt: '2026-10-07T12:00:00Z', firstDiscoveryId: 'baseline' }, ...options };
}

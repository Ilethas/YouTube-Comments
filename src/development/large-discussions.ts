import type { Comment, ContentItem } from '../domain/discussion';

export interface GeneratedDiscussionOptions {
  count: number;
  shape?: 'flat' | 'shallow' | 'mixed' | 'chain';
  roots?: number;
  maxDepth?: number;
  textLength?: number;
  seenRatio?: number;
  matchIndexes?: readonly number[];
  newIndexes?: readonly number[];
}
/** Deterministic application data for offline tests/profiling, never demo bootstrap.
 * Indices are input order; IDs, evidence, text and state repeat across runs. */
export function generateDiscussion({ count, shape = 'mixed', roots = Math.max(1, Math.ceil(count / 20)), maxDepth = 30,
  textLength = 160, seenRatio = .5, matchIndexes = [count - 1], newIndexes = [] }: GeneratedDiscussionOptions) {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(roots) || roots < 1
    || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || textLength < 0 || seenRatio < 0 || seenRatio > 1) throw new Error('Invalid generated discussion options');
  const item: ContentItem = { id: 'generated', sourceId: 'generated', kind: 'video', title: 'Generated discussion',
    description: 'Deterministic offline performance dataset', author: { displayName: 'Generated creator' }, baselineDiscoveryId: 'generated-baseline',
    latestAcceptedDiscoveryId: newIndexes.length ? 'generated-refresh' : 'generated-baseline' };
  const matches = new Set(matchIndexes), discoveries = new Set(newIndexes), depths: number[] = [], threadSize = Math.ceil(count / roots);
  const comments: Comment[] = Array.from({ length: count }, (_, index) => {
    const rootIndex = Math.floor(index / threadSize) * threadSize;
    const isRoot = shape === 'flat' || index === rootIndex || maxDepth === 0;
    const parentIndex = isRoot ? null : ((shape === 'chain' || (shape === 'mixed' && index % 7 !== 0)) && depths[index - 1] < maxDepth) ? index - 1 : rootIndex;
    depths[index] = parentIndex === null ? 0 : depths[parentIndex] + 1;
    const id = `generated-${index}`, parentId = parentIndex === null ? null : `generated-${parentIndex}`;
    const length = Math.floor(textLength * [0.15, .5, 1, 3, .3][index % 5]);
    const text = ('Sample discussion text Zażółć gęślą jaźń.\n'.repeat(Math.ceil(length / 40))).slice(0, length);
    return { id, itemId: item.id, source: { kind: 'video', itemId: item.sourceId, commentId: id }, parentId,
      relationship: parentId ? { kind: 'direct-parent', parentSourceId: parentId } : { kind: 'top-level' },
      relationshipStatus: parentId ? 'resolved' : 'top-level', directParentId: parentId,
      text: `${matches.has(index) ? 'PROFILE_MATCH ' : ''}${index}: ${text}`,
      author: index % 6 ? { displayName: `Reader ${index % 113}`, handle: `@reader${index % 113}`,
        ...(index % 3 ? {} : { avatarUrl: 'https://avatars.invalid/generated.png' }) } : undefined,
      publishedAt: '2026-10-01T12:00:00Z', likeCount: index % 19, isCreator: index % 97 === 0,
      seen: ((index * 37) % 100) / 100 < seenRatio,
      discovery: { firstDiscoveredAt: '2026-10-01T12:00:00Z', lastObservedAt: '2026-10-01T12:00:00Z', firstDiscoveryId: discoveries.has(index) ? 'generated-refresh' : item.baselineDiscoveryId } };
  });
  return { item, comments };
}

import type { Comment } from '../domain/discussion';
import type { DiscussionViewResult } from '../domain/discussion-query';
import { ownPublicationInstant } from '../domain/publication-predicate';

import type { DiscussionSort } from '../domain/discussion-view';
export type { DiscussionSort } from '../domain/discussion-view';
export { discussionSorts } from '../domain/discussion-view';

interface ConversationKey {
  readonly start: number;
  end: number;
  readonly publication?: number;
  readonly likes?: number;
  activity?: number;
}

/** Reorder complete contiguous display-root trees from the frozen applied preorder.
 * One pass builds keys, then only roots are compared: O(N + T log T). Source
 * relationships, reply order, query membership and the input snapshot are untouched.
 * Only projected likes are authoritative; raw backend evidence is never inspected. */
export function sortDiscussionTrees(result: DiscussionViewResult, byId: ReadonlyMap<string, Comment>, sort: DiscussionSort) {
  const original = result.visibleCommentIds;
  const trees: ConversationKey[] = [];
  let tree: ConversationKey | undefined;
  for (let index = 0; index < original.length; index++) {
    const id = original[index], comment = byId.get(id);
    const publication = ownPublicationInstant(comment?.publishedAt);
    if (result.visibleParentIds[id] === null) {
      tree = { start: index, end: index, publication, likes: comment?.likeCount, activity: publication };
      trees.push(tree);
    }
    if (!tree) throw new Error('Applied reader order must start with a display root');
    tree.end = index + 1;
    if (publication !== undefined && (tree.activity === undefined || publication > tree.activity)) tree.activity = publication;
  }
  // All-unknown filtered roots keep Original order even when another, excluded
  // conversation makes Most liked available for the discussion.
  if (sort === 'original' || (sort === 'most-liked' && trees.every(tree => tree.likes === undefined))) return original;
  const key = (tree: ConversationKey) => sort === 'most-liked' ? tree.likes : sort === 'latest-activity' ? tree.activity : tree.publication;
  trees.sort((a, b) => {
    const left = key(a), right = key(b);
    // Unknown is last in both directions. Original position breaks every tie.
    if (left === undefined) return right === undefined ? a.start - b.start : 1;
    if (right === undefined) return -1;
    return (sort === 'oldest' ? left - right : right - left) || a.start - b.start;
  });
  const ids: string[] = [];
  for (const tree of trees) for (let index = tree.start; index < tree.end; index++) ids.push(original[index]);
  return ids;
}

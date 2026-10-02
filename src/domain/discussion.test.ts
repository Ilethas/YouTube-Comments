import { describe, expect, it } from 'vitest';
import { buildCommentTree, Comment, toggleSeen, walkComments } from './discussion';
import { demoNewCommentIds, initialComments, items } from '../fixtures/discussions';

const comments = initialComments['video-demo'];
const states = (data: readonly Comment[]) => Object.fromEntries(data.map(comment => [comment.id, comment.seen]));

describe('complete discussion trees', () => {
  it('constructs parents after children, preserving sibling input order and preorder traversal', () => {
    const [root, child, grandchild, greatGrandchild, sibling] = comments;
    const forest = buildCommentTree([grandchild, sibling, child, root, greatGrandchild]);
    expect(forest.map(node => node.comment.id)).toEqual(['v1']);
    expect(forest[0].children.map(node => node.comment.id)).toEqual(['v5', 'v2']);
    expect(walkComments(forest).map(comment => comment.id)).toEqual(['v1', 'v5', 'v2', 'v3', 'v4']);
  });
  it('supports an empty discussion', () => {
    expect(walkComments(buildCommentTree([]))).toEqual([]);
  });
  it('rejects invalid fixture preconditions without inventing source repair rules', () => {
    expect(() => buildCommentTree([comments[0], comments[0]])).toThrow('Duplicate');
    expect(() => buildCommentTree([comments[1]])).toThrow('Missing parent');
    expect(() => buildCommentTree([{ ...comments[0], parentId: 'v2' }, comments[1]])).toThrow('Cyclic');
    expect(() => buildCommentTree([{ ...comments[0], parentId: 'v1' }])).toThrow('Cyclic');
    expect(() => buildCommentTree([comments[0], initialComments['post-demo'][0]])).toThrow('Mixed');
  });
});

describe('manual seen state', () => {
  it('ordinary action toggles only its target and does not mutate the original', () => {
    const before = states(comments);
    const updated = toggleSeen(comments, 'v3');
    expect(states(updated)).toEqual({ ...before, v3: true });
    expect(states(comments)).toEqual(before);
    expect(states(toggleSeen(updated, 'v3'))).toEqual(before);
    expect(() => toggleSeen(comments, 'absent')).toThrow('Unknown');
  });
  it.each([true, false])('Ctrl action sets mixed descendants to the opposite of target=%s', seen => {
    const input = comments.map(comment => comment.id === 'v2' ? { ...comment, seen } : comment);
    const updated = toggleSeen(input, 'v2', true);
    expect(states(updated)).toEqual({ ...states(input), v2: !seen, v3: !seen, v4: !seen });
    for (const id of ['v1', 'v5', 'v6']) expect(updated.find(comment => comment.id === id)).toBe(input.find(comment => comment.id === id));
    expect(updated.map(comment => comment.id)).toEqual(input.map(comment => comment.id));
    expect(updated.map(comment => comment.discovery)).toEqual(input.map(comment => comment.discovery));
  });
  it('root subtree includes every depth and leaves other trees alone', () => {
    const updated = toggleSeen(comments, 'v1', true);
    expect(states(updated)).toEqual({ ...states(comments), v1: false, v2: false, v3: false, v4: false, v5: false });
  });
});

it('fixtures have valid trees, missing metadata, and NEW examples only after baseline', () => {
  for (const item of items) {
    const data = initialComments[item.id];
    expect(walkComments(buildCommentTree(data))).toHaveLength(data.length);
    expect(data.some(comment => !comment.author)).toBe(true);
    expect(data.some(comment => comment.publishedAt === undefined)).toBe(true);
    for (const comment of data) {
      expect(comment.source.kind).toBe(item.kind);
      expect(comment.source.itemId).toBe(item.sourceId);
      if (demoNewCommentIds.has(comment.id)) {
        expect(comment.discovery.firstDiscoveryId).not.toBe(item.baselineDiscoveryId);
        expect(comment.seen).toBe(false);
      }
    }
  }
});

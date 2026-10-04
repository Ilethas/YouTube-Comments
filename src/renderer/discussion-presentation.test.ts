import { expect, it } from 'vitest';
import { buildCommentTree, toggleSeen, walkComments } from '../domain/discussion';
import { defaultQuery, evaluateDiscussionQuery, queryComments, unrestrictedView } from '../domain/discussion-query';
import { generateDiscussion } from '../development/large-discussions';
import { projectReaderRows } from './discussion-presentation';

it.each(['flat', 'shallow', 'mixed', 'chain'] as const)('preserves %s reader preorder, depth, parents, roots and shared ancestry', shape => {
  const { comments } = generateDiscussion({ count: 1000, shape, roots: 4 });
  const result = unrestrictedView(comments), projection = projectReaderRows(comments, result);
  expect(projection.rows.map(row => row.id)).toEqual(walkComments(buildCommentTree(comments)).map(row => row.id));
  const byId = new Map(projection.rows.map(row => [row.id, row]));
  for (const [index, row] of projection.rows.entries()) {
    expect(row.comment).toBe(comments[index]);
    expect(projection.indexById.get(row.id)).toBe(index);
    expect(row.parentId).toBe(row.comment.parentId);
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    expect(row.depth).toBe(parent ? parent.depth + 1 : 0);
    expect(row.rootId).toBe(parent?.rootId ?? row.id);
    expect(row.ancestors?.id ?? null).toBe(row.parentId);
    if (parent) expect(row.ancestors?.parent).toBe(parent.ancestors);
    const siblings = projection.rows.filter(other => other.parentId === row.parentId);
    expect(row.lastSibling).toBe(siblings.at(-1)?.id === row.id);
    expect(row.ancestors?.continues).toBe(parent ? !parent.lastSibling : undefined);
    expect(row.hasChildren).toBe(comments.some(other => other.parentId === row.id));
  }
});
it('projects complete filtered threads with applied roles and live seen without altering source/direct truth', () => {
  const { comments } = generateDiscussion({ count: 1000, roots: 1, shape: 'shallow', seenRatio: 0, matchIndexes: [999] });
  const containment = comments.map(row => row.parentId ? { ...row, relationship: { kind: 'thread-containment' as const, rootSourceId: comments[0].id }, directParentId: null } : row);
  const outcome = evaluateDiscussionQuery(queryComments(containment), { ...defaultQuery, text: 'PROFILE_MATCH', seen: 'unseen' });
  if (!outcome.ok) throw new Error('Query failed');
  const changed = toggleSeen(containment, comments[999].id);
  const projection = projectReaderRows(changed, outcome.result);
  expect(projection.rows).toHaveLength(1000);
  expect(projection.rows.filter(row => row.role === 'match').map(row => row.id)).toEqual([comments[999].id]);
  expect(projection.rows[999].comment.seen).toBe(true);
  expect(outcome.result.matchCount).toBe(1); expect(outcome.result.threadCount).toBe(1);
  expect(projection.rows[999].comment.directParentId).toBeNull();
  expect(projection.rows[999].comment.relationship).toEqual(containment[999].relationship);
  const direct = evaluateDiscussionQuery(queryComments(containment), { ...defaultQuery, text: 'Reader', fields: ['replied-to-author'] });
  expect(direct.ok && direct.result.matchCount).toBe(0);
});
it('uses frozen applied placement after remote placement changes and never mutates inputs', () => {
  const { comments } = generateDiscussion({ count: 30, shape: 'chain', roots: 1 });
  const result = unrestrictedView(comments), original = JSON.stringify(result);
  const changed = comments.map(row => ({ ...row, parentId: null }));
  const projection = projectReaderRows(changed, result);
  expect(projection.rows[29].depth).toBe(29);
  expect(projection.rows[29].comment.parentId).toBeNull();
  expect(JSON.stringify(result)).toBe(original);
});
it('projects a 10k deep chain iteratively with shared paths rather than copied ancestor arrays', () => {
  const { comments } = generateDiscussion({ count: 10000, shape: 'chain', roots: 1, maxDepth: 10000, textLength: 10 });
  const projection = projectReaderRows(comments, unrestrictedView(comments));
  expect(projection.rows.at(-1)?.depth).toBe(9999);
  expect(projection.rows.at(-1)?.ancestors?.parent).toBe(projection.rows[9998].ancestors);
});

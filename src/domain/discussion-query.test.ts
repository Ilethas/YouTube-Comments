import { evaluateTestQuery } from '../fixtures/query-testing';
import { expect, it } from 'vitest';
import { defaultQuery, navigationTarget, queryComments, visibleUnseenIds } from './discussion-query';
import type { DiscussionQuery, QueryComment } from './discussion-query';
import { initialComments } from '../fixtures/discussions';

const rows: readonly QueryComment[] = [
  { id: 'nested', itemId: 'item', parentId: 'child', directParentId: 'child', relationshipKind: 'direct-parent', relationshipStatus: 'resolved', text: 'Zażółć\nGĘŚLĄ camera', author: { displayName: 'Bob', handle: '@bobby' }, seen: false },
  { id: 'root', itemId: 'item', parentId: null, text: 'camera root', author: { displayName: 'Alice', handle: '@alice' }, seen: true },
  { id: 'child', itemId: 'item', parentId: 'root', directParentId: 'root', relationshipKind: 'direct-parent', relationshipStatus: 'resolved', text: 'desk', author: { displayName: 'Carol', handle: '@carol' }, seen: true },
  { id: 'sibling', itemId: 'item', parentId: 'root', text: '@Alice unrelated', seen: true },
  { id: 'other', itemId: 'item', parentId: null, text: 'other camera', author: { displayName: 'Dave' }, seen: false },
];
function result(query: Partial<DiscussionQuery> = {}, comments = rows) {
  const outcome = evaluateTestQuery(comments, { ...defaultQuery, ...query });
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result;
}

it('searches content substrings over all comments in data preorder without mutating input', () => {
  const before = JSON.stringify(rows);
  expect(result({ text: 'camera' }).orderedMatchIds).toEqual(['root', 'nested', 'other']);
  expect(JSON.stringify(rows)).toBe(before);
});
it.each([['Alice', 'root'], ['@bobby', 'nested']])('searches author displayName/handle %s', (text, id) => {
  expect(result({ text, fields: ['author'] }).activeMatchIds).toEqual([id]);
});
it('searches genuinely resolved direct parent author, never own author or mentions', () => {
  expect(result({ text: 'alice', fields: ['replied-to-author'] }).activeMatchIds).toEqual(['child']);
  expect(result({ text: '@carol', fields: ['replied-to-author'] }).activeMatchIds).toEqual(['nested']);
});
it.each(['thread-containment', 'missing', 'cyclic', 'unknown'] as const)('unavailable direct author (%s) never fabricates matches', kind => {
  const comments = rows.map(row => row.id !== 'child' ? row : { ...row,
    relationshipKind: kind === 'thread-containment' ? 'thread-containment' as const : kind === 'unknown' ? undefined : 'direct-parent' as const,
    relationshipStatus: kind === 'cyclic' ? 'cyclic' as const : kind === 'missing' ? 'unresolved' as const : 'resolved' as const,
    directParentId: kind === 'missing' ? 'absent' : 'root' });
  expect(result({ text: 'alice', fields: ['replied-to-author'] }, comments).activeMatchIds).toEqual([]);
});
it('missing parent author and opaque author IDs never match', () => {
  const comments = rows.map(row => ({ ...row, author: undefined }));
  expect(result({ text: 'alice', fields: ['replied-to-author'] }, comments).activeMatchIds).toEqual([]);
  const projected = queryComments(initialComments['video-demo'].map(comment => ({ ...comment, author: { sourceId: 'secret' } })));
  expect(result({ text: 'secret', fields: ['author'] }, projected).matchCount).toBe(0);
  expect(projected.every(row => !('remote' in row) && !('source' in row))).toBe(true);
});
it('ORs selected fields and ANDs seen on the same individual comment', () => {
  expect(result({ text: 'alice', fields: ['content', 'author'] }).activeMatchIds).toEqual(['root', 'sibling']);
  expect(result({ text: 'desk', seen: 'unseen' }).matchCount).toBe(0);
  expect(result({ text: 'camera', seen: 'unseen' }).activeMatchIds).toEqual(['nested', 'other']);
});
it('empty search imposes no restriction, has no raw hits, and still allows seen filtering', () => {
  expect(result({ fields: [] }).rawSearchMatchIds).toEqual([]);
  expect(result({ fields: [] }).restrictive).toBe(false);
  expect(result({ fields: [], seen: 'unseen' }).matchCount).toBe(2);
  expect(evaluateTestQuery(rows, { ...defaultQuery, text: 'x', fields: [] })).toEqual({ ok: false, error: 'NO_SEARCH_FIELDS' });
});
it('case comparison uses deterministic lowercase independently of UI locale', () => {
  expect(result({ text: 'CAMERA', caseSensitive: true }).matchCount).toBe(0);
  expect(result({ text: 'CAMERA' }).matchCount).toBe(3);
  expect(result({ text: 'gęślą' }).activeMatchIds).toEqual(['nested']);
  expect(result({ text: 'gęślą', caseSensitive: true }).matchCount).toBe(0);
});
it('NFC equivalents match, diacritics remain significant, and multiline text is literal', () => {
  expect(result({ text: 'Zaz\u0307o\u0301łc\u0301\nGĘŚLĄ' }).activeMatchIds).toEqual(['nested']);
  expect(result({ text: 'zolc' }).matchCount).toBe(0);
  expect(result({ text: 'z' }, [{ ...rows[0], parentId: null, text: 'ż' }]).matchCount).toBe(0);
});
it('uses ECMAScript u/iu, pattern-only, NFC regex without implicit multiline/dotall flags', () => {
  expect(result({ text: '\\p{Lu}+', mode: 'regex', caseSensitive: true }).matchCount).toBe(2);
  expect(result({ text: '^camera', mode: 'regex' }).activeMatchIds).toEqual(['root']);
  expect(result({ text: 'zażółć.gęślą', mode: 'regex' }).matchCount).toBe(0);
  expect(result({ text: 'zażółć\\ngęślą', mode: 'regex' }).activeMatchIds).toEqual(['nested']);
  expect(result({ text: 'CAMERA', mode: 'regex', caseSensitive: true }).matchCount).toBe(0);
  expect(result({ text: 'CAMERA', mode: 'regex' }).matchCount).toBe(3);
  expect(result({ text: '/camera/i', mode: 'regex' }).matchCount).toBe(0);
  expect(result({ text: 'Zaz\u0307o\u0301łc\u0301', mode: 'regex' }).matchCount).toBe(1);
  expect(evaluateTestQuery(rows, { ...defaultQuery, text: '[', mode: 'regex' })).toEqual({ ok: false, error: 'INVALID_REGEX' });
});
it.each(['camera root', 'GĘŚLĄ'])('root or nested match (%s) includes complete tree and unrelated siblings', text => {
  const view = result({ text });
  expect(view.visibleCommentIds).toEqual(['root', 'child', 'nested', 'sibling']);
  expect(view.matchCount).toBe(1); expect(view.threadCount).toBe(1);
});
it('counts threads once, keeps raw hits failing unseen as context, and excludes context from match count', () => {
  const view = result({ text: 'camera', seen: 'unseen' });
  expect(view.rawSearchMatchIds).toEqual(['root', 'nested', 'other']);
  expect(view.activeMatchIds).toEqual(['nested', 'other']);
  expect(view.matchCount).toBe(2); expect(view.threadCount).toBe(2);
  expect(result({ text: 'camera' }).threadCount).toBe(2);
  expect(result().visibleCommentIds).toEqual(['root', 'child', 'nested', 'sibling', 'other']);
});
it('navigation resolves nested application identities, wraps, uses context selection and never mutates seen', () => {
  const view = result({ text: 'camera', seen: 'unseen' });
  expect(navigationTarget(view.visibleCommentIds, view.orderedMatchIds, undefined, 1)).toBe('nested');
  expect(navigationTarget(view.visibleCommentIds, view.orderedMatchIds, 'other', 1)).toBe('nested');
  expect(navigationTarget(view.visibleCommentIds, view.orderedMatchIds, 'nested', -1)).toBe('other');
  expect(navigationTarget(view.visibleCommentIds, view.orderedMatchIds, 'child', 1)).toBe('nested');
  expect(navigationTarget(view.visibleCommentIds, [], 'child', 1)).toBeUndefined();
  const changed = rows.map(row => ({ ...row, seen: row.id === 'sibling' ? false : true }));
  expect(visibleUnseenIds(view, changed)).toEqual(['sibling']);
  expect(view.activeMatchIds).toEqual(['nested', 'other']);
  expect(rows.filter(row => !row.seen).map(row => row.id)).toEqual(['nested', 'other']);
});

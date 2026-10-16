import { expect, it } from 'vitest';
import { readerNewCommentIds } from './demo-presentation';
import { initialComments, items } from '../fixtures/discussions';

it('fixture-like application IDs retain real NEW semantics; renamed synthetic demos retain demo examples', () => {
  const fixture = items[0], comments = initialComments[fixture.id];
  const real = { ...fixture, isDemo: false, latestAcceptedDiscoveryId: 'latest' };
  const observed = comments.map((comment, index) => ({ ...comment, discovery: { ...comment.discovery, firstDiscoveryId: index === 0 ? 'latest' : fixture.baselineDiscoveryId } }));
  expect(readerNewCommentIds(real, observed)).toEqual(new Set([comments[0].id]));
  const demo = { ...fixture, id: 'renamed-demo' };
  expect(readerNewCommentIds(demo, comments.map(comment => ({ ...comment, itemId: demo.id })))).toEqual(new Set(['v3']));
});

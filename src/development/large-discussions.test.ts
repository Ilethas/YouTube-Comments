import { expect, it } from 'vitest';
import { generateDiscussion } from './large-discussions';
import { projectReaderRows } from '../renderer/discussion-presentation';
import { unrestrictedView } from '../domain/discussion-query';

it.each(['flat', 'shallow', 'mixed', 'chain'] as const)('generates deterministic %s data with controllable count, text, depth, state and matches', shape => {
  const options = { count: 1000, shape, roots: 10, maxDepth: 15, textLength: 80, seenRatio: .3, matchIndexes: [1, 999] };
  const data = generateDiscussion(options);
  expect(data).toEqual(generateDiscussion(options)); expect(data.comments).toHaveLength(1000);
  const rows = projectReaderRows(data.comments, unrestrictedView(data.comments)).rows;
  expect(Math.max(...rows.map(row => row.depth))).toBeLessThanOrEqual(15);
  expect(data.comments.filter(row => row.text.includes('PROFILE_MATCH')).map(row => row.id)).toEqual(['generated-1', 'generated-999']);
  expect(data.comments.filter(row => row.seen)).toHaveLength(300);
  expect(new Set(data.comments.map(row => row.text.length)).size).toBeGreaterThan(4);
  expect(data.comments.some(row => row.author?.avatarUrl)).toBe(true);
  expect(data.comments.some(row => !row.author)).toBe(true);
});

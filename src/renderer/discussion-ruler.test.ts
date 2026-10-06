import { expect, it } from 'vitest';
import { defaultQuery, evaluateDiscussionQuery, unrestrictedView } from '../domain/discussion-query';
import { generateDiscussion } from '../development/large-discussions';
import { estimateReaderHeight, projectReaderRows } from './discussion-presentation';
import { aggregateRulerMarkers, indexRulerMarkers, projectRulerMarkers, rulerLanePath, rulerMarkerCoordinate, rulerTarget } from './discussion-ruler';
import { rulerBucketLabel } from './i18n';

it('projects applied matches, live unseen context, NEW overlap and exact virtual preorder; excludes hidden and raw-only matches', () => {
  const { comments } = generateDiscussion({ count: 5, shape: 'shallow', roots: 2, seenRatio: 0, matchIndexes: [0, 1] });
  const live = comments.map((comment, index) => index === 0 ? { ...comment, seen: true } : comment);
  const outcome = evaluateDiscussionQuery(live, { ...defaultQuery, text: 'PROFILE_MATCH', seen: 'unseen' });
  if (!outcome.ok) throw new Error('Query failed');
  const rows = projectReaderRows(live, outcome.result).rows;
  expect(rows.map(row => row.id)).toEqual(['generated-0', 'generated-1', 'generated-2']);
  const markers = projectRulerMarkers(rows, outcome.result, new Set(['generated-0', 'generated-1', 'generated-4']));
  expect(markers).toEqual([
    { commentId: 'generated-0', presentationIndex: 0, categories: ['new'] }, // raw-only context, seen
    { commentId: 'generated-1', presentationIndex: 1, categories: ['unseen', 'match', 'new'] },
    { commentId: 'generated-2', presentationIndex: 2, categories: ['unseen'] }, // unseen context
  ]);
  const identity = unrestrictedView(live);
  const unrestricted = projectRulerMarkers(projectReaderRows(live, identity).rows, identity, new Set(['generated-0']));
  expect(unrestricted.some(marker => marker.categories.includes('match'))).toBe(false);
  expect(unrestricted[0].categories).toEqual(['new']);
});

it('maps first/middle/last inside bounds including header, and responds to measured heights and resize', () => {
  const { comments } = generateDiscussion({ count: 3, shape: 'flat', seenRatio: 0 });
  const result = unrestrictedView(comments), rows = projectReaderRows(comments, result).rows;
  const markers = projectRulerMarkers(rows, result, new Set());
  const layout = (heights: number[]) => {
    let start = 200;
    return heights.map(size => { const row = { start, size }; start += size; return row; });
  };
  const positions = (heights: number[], height = 300) => aggregateRulerMarkers(markers, layout(heights), 200 + heights.reduce((sum, size) => sum + size, 0), height)
    .flatMap(bucket => bucket.targets.unseen.markers.slice(bucket.targets.unseen.from, bucket.targets.unseen.to).map(target => rulerMarkerCoordinate(target, bucket.geometry)));
  expect(positions([100, 100, 100])).toEqual([150, 210, 270]);
  expect(positions([100, 1000, 100])).toEqual([250 / 1400 * 300, 800 / 1400 * 300, 1350 / 1400 * 300]);
  expect(positions([100, 100, 100], 600)).toEqual([300, 420, 540]);
  const estimates = rows.map(row => estimateReaderHeight(row, 1000));
  const narrow = rows.map(row => estimateReaderHeight(row, 200));
  expect(positions(estimates)).not.toEqual(positions(narrow));
  for (const y of positions([1, 100000, 1])) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(300); }
  expect(aggregateRulerMarkers(markers, [], 0, 0)).toEqual([]);
});

it.each([10000, 50000])('%i comments aggregate into pixel-bounded lanes retaining counts and identities', count => {
  const { comments } = generateDiscussion({ count, shape: 'flat', seenRatio: 0 });
  const result = unrestrictedView(comments), rows = projectReaderRows(comments, result).rows;
  const ids = new Set(comments.map(comment => comment.id));
  const markers = projectRulerMarkers(rows, { ...result, restrictive: true }, ids);
  const measurements = rows.map((_, index) => ({ start: index * 100, size: 100 }));
  const buckets = aggregateRulerMarkers(markers, measurements, count * 100, 600);
  expect(buckets).toHaveLength(200);
  for (const category of ['unseen', 'match', 'new'] as const) {
    expect(buckets.reduce((sum, bucket) => sum + bucket.targets[category].length, 0)).toBe(count);
    expect(rulerLanePath(buckets, category).match(/M/g)).toHaveLength(200);
  }
  expect(rulerBucketLabel('en', buckets[0])).toBe(`${count / 200} unseen\n${count / 200} matches\n${count / 200} new`);
  expect(rulerBucketLabel('pl', buckets[0])).toContain(`Nowe: ${count / 200}`);
});

it('crowded band chooses nearest row center deterministically, breaking ties by preorder', () => {
  const { comments } = generateDiscussion({ count: 4, shape: 'flat', seenRatio: 0 });
  const result = unrestrictedView(comments), markers = projectRulerMarkers(projectReaderRows(comments, result).rows, result, new Set());
  const [bucket] = aggregateRulerMarkers(markers, [0, 1, 2, 3].map(start => ({ start, size: 1 })), 4, 2);
  expect(rulerTarget(bucket, 'unseen', 1.8)).toBe('generated-3');
  expect(rulerTarget(bucket, 'unseen', 1)).toBe('generated-1'); // equal distance to rows 1/2
  expect(rulerTarget(bucket, 'match', 1)).toBeUndefined();
});

it('geometry refinement searches shared category spans without inspecting every virtual measurement', () => {
  const { comments } = generateDiscussion({ count: 50000, shape: 'flat', seenRatio: 0 });
  const result = unrestrictedView(comments), markers = projectRulerMarkers(projectReaderRows(comments, result).rows, result, new Set());
  const indexed = indexRulerMarkers(markers);
  let reads = 0;
  const geometry = new Proxy([] as { start: number; size: number }[], { get(_target, key) {
    if (typeof key !== 'string' || !/^\d+$/.test(key)) return undefined;
    reads++; return { start: Number(key) * 100, size: 100 };
  } });
  const buckets = aggregateRulerMarkers(indexed, geometry, 50000 * 100, 600);
  expect(reads).toBeLessThan(50000);
  expect(buckets[0].targets.unseen.markers).toBe(indexed.unseen);
  expect(buckets.reduce((sum, bucket) => sum + bucket.targets.unseen.length, 0)).toBe(50000);
});

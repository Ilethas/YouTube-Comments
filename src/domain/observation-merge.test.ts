// eslint-disable-next-line import/no-unresolved
import { expect, it } from 'vitest';
import { mergePublication, planObservationMerge, projectRelationships } from './observation-merge';
import type { StoredObservationDiscussion } from './observation-merge';
import type { CommentObservation, ContentObservation, NormalizedExtraction, ObservedField, PublicationObservation } from './extraction-observation';

const observed = <T>(value: T): ObservedField<T> => ({ status: 'observed', value });
const unknown = <T>(): ObservedField<T> => ({ status: 'unknown', reason: 'unavailable' });
const publication: PublicationObservation = { instant: unknown(), label: unknown(), precision: 'unknown', estimated: unknown() };
const author = { sourceId: unknown<string>(), displayName: observed('author'), handle: unknown<string>(), avatarUrl: unknown<string>() };
const comment: CommentObservation = { sourceId: 'opaque', text: observed('text'), author, publication, relationship: { kind: 'top-level' }, likeCount: observed(12), pinned: unknown(), creator: unknown() };
function input(comments: readonly CommentObservation[] = [comment]): Extract<NormalizedExtraction, { item: ContentObservation }> {
  return { provenance: { backend: 'fixture', version: '1', evidence: [] }, coverage: { kind: 'unknown' }, issues: [],
    item: { sourceKind: 'youtube-video', sourceId: 'opaque-item', title: observed('title'), text: unknown(), canonicalUrl: unknown(), author, publication,
      images: observed([{ url: 'image', width: observed(640), height: observed(480) }]), links: observed([{ url: 'link', text: observed('label') }]), likeCount: unknown(), reportedCommentCount: unknown() },
    collection: { status: 'present', comments } };
}
const context = () => { let id = 0; return { at: '2026-10-02T08:00:00Z', attemptId: 'attempt', newId: () => `id-${++id}` }; };
function current(): StoredObservationDiscussion {
  const plan = planObservationMerge(undefined, input(), context());
  if (!plan.item) throw new Error('Missing plan');
  return { ...plan.item, comments: plan.inserts };
}

it('plans only accepted observed comments, leaves inputs immutable and carries no local seen state', () => {
  const old = current(), incoming = input([{ ...comment, text: observed('edited'), likeCount: { status: 'unknown', reason: 'lossy-default' } }]);
  const before = JSON.stringify({ old, incoming });
  const plan = planObservationMerge(old, incoming, { ...context(), attemptId: 'later', at: '2026-10-02T09:00:00Z' });
  expect(plan.updates[0]).toMatchObject({ id: old.comments[0].id, firstDiscoveryId: 'attempt', lastObservationId: 'later', remote: { text: observed('edited'), likeCount: observed(12) } });
  expect(JSON.stringify(plan)).not.toMatch(/"seen"/);
  expect(JSON.stringify({ old, incoming })).toBe(before);
  expect(planObservationMerge(old, input([]), context()).updates).toEqual([]);
});

it('never chooses an identical duplicate winner and retains independent candidates', () => {
  const plan = planObservationMerge(current(), input([comment, comment, { ...comment, sourceId: 'independent' }]), context());
  expect(plan.updates).toEqual([]); expect(plan.inserts).toHaveLength(1);
  expect(plan.attempt.counts).toMatchObject({ candidates: 3, skipped: 2, conflictedIdentities: 1 });
});

it('preserves failed coverage/history without planning item or comment writes', () => {
  const plan = planObservationMerge(current(), { provenance: { backend: 'fixture', version: '1', evidence: [] }, issues: [], coverage: { kind: 'failed', reason: 'failed' } }, context());
  expect(plan.item).toBeUndefined(); expect(plan.inserts).toEqual([]); expect(plan.updates).toEqual([]);
  expect(plan.attempt.outcome).toBe('failed');
});

it('rejects mismatched discussion/explicit target and invalid injected attempt metadata', () => {
  const old = current();
  expect(() => planObservationMerge({ ...old, remote: { ...old.remote, sourceKind: 'youtube-community-post' } }, input(), context())).toThrow('Mismatched discussion');
  expect(() => planObservationMerge(old, input(), { ...context(), target: { sourceKind: 'youtube-video', sourceId: 'other' } })).toThrow('Mismatched attempt target');
  expect(() => planObservationMerge(old, input(), { ...context(), at: 'invalid' })).toThrow('Invalid attempt');
  expect(() => planObservationMerge(undefined, input(), { ...context(), newId: () => '' })).toThrow('Invalid generated internal ID');
});

it('preserves nested attachment fields when a still-observed image/link carries unknown dimensions/label', () => {
  const old = current(), candidate = input();
  if (!candidate.item) throw new Error('Missing item');
  const plan = planObservationMerge(old, { ...candidate, item: { ...candidate.item,
    images: observed([{ url: 'image', width: unknown<number>(), height: observed(720) }]), links: observed([{ url: 'link', text: unknown<string>() }]) } }, context());
  expect(plan.item?.remote.images).toEqual(observed([{ url: 'image', width: observed(640), height: observed(720) }]));
  expect(plan.item?.remote.links).toEqual(old.remote.links);
});

it('keeps exact/coarse/unknown publication evidence honest and never substitutes a discovery clock', () => {
  const exact = { ...publication, instant: observed('2026-09-01T00:00:00Z'), precision: 'exact' as const };
  expect(mergePublication(exact, publication)).toMatchObject(exact);
  const label = { ...publication, label: observed('a week ago'), precision: 'coarse' as const, estimated: observed(true) };
  expect(mergePublication(exact, label)).toMatchObject({ instant: exact.instant, label: label.label, precision: 'exact' });
  expect(mergePublication(exact, label)).toMatchObject({ instantEvidence: { precision: 'exact' }, labelEvidence: { precision: 'coarse', estimated: observed(true) } });
  expect(mergePublication(undefined, label).instant).toEqual(unknown());
  expect(mergePublication(exact, { ...publication, instant: observed('2026-09-02T00:00:00Z') }).precision).toBe('unknown');
});

it('projects self cycles and multi-node cycles deterministically without rewriting source truth or losing descendants', () => {
  const rows = [
    { id: 'a', remote: { ...comment, sourceId: 'a', relationship: { kind: 'direct-parent' as const, parentSourceId: 'b' } } },
    { id: 'b', remote: { ...comment, sourceId: 'b', relationship: { kind: 'thread-containment' as const, rootSourceId: 'a' } } },
    { id: 'c', remote: { ...comment, sourceId: 'c', relationship: { kind: 'direct-parent' as const, parentSourceId: 'a' } } },
    { id: 'self', remote: { ...comment, sourceId: 'self', relationship: { kind: 'direct-parent' as const, parentSourceId: 'self' } } },
  ];
  const original = JSON.stringify(rows), first = projectRelationships(rows), second = projectRelationships([...rows].reverse());
  for (const row of rows) expect(second.get(row.id)).toEqual(first.get(row.id));
  for (const id of ['a', 'b', 'self']) expect(first.get(id)).toEqual({ parentId: null, directParentId: null, status: 'cyclic' });
  expect(first.get('c')).toEqual({ parentId: 'a', directParentId: 'a', status: 'resolved' });
  expect(JSON.stringify(rows)).toBe(original);
});

it('retains affirmative complete evidence without inferring it from counts', () => {
  const plan = planObservationMerge(undefined, { ...input(), coverage: { kind: 'complete', evidence: ['affirmative test evidence'] } }, context());
  expect(plan.attempt.coverage).toEqual({ kind: 'complete', evidence: ['affirmative test evidence'] });
});

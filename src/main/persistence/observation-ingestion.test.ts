import { evaluateTestQuery } from '../../fixtures/query-testing';
// eslint-disable-next-line import/no-unresolved
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './reader-repository';
import { migrateDatabase, migrations } from './migrations';
import { normalizeYtDlp } from '../extractors/yt-dlp';
import { normalizeCommunityArchive } from '../extractors/community';
import { observed, unknown } from '../extractors/normalization';
import type { CaptureContext } from '../extractors/normalization';
import type { CommentObservation, ContentObservation, NormalizedExtraction, ObservationCoverage } from '../../domain/extraction-observation';
import { buildCommentTree, walkComments, isNewDiscovery } from '../../domain/discussion';
import { initialComments, items } from '../../fixtures/discussions';
import { defaultQuery, queryComments } from '../../domain/discussion-query';

type Usable = NormalizedExtraction & { item: ContentObservation; collection: { status: 'present'; comments: readonly CommentObservation[] }; coverage: Exclude<ObservationCoverage, {kind: 'failed'}> };
function fixture(id = 'yt-nested-a'): Usable {
  const input = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__', `${id}.json`), 'utf8')) as { raw: unknown; context: CaptureContext };
  const result = (id.startsWith('yt-') ? normalizeYtDlp : normalizeCommunityArchive)(JSON.stringify(input.raw), input.context);
  if (!result.item || result.collection?.status !== 'present') throw new Error('Expected usable fixture');
  return result as Usable;
}
function batch(input: Usable, comments: readonly CommentObservation[]): Usable { return { ...input, issues: [], collection: { status: 'present', comments } }; }
function required<T>(value: T | undefined | null): T { if (value === undefined || value === null) throw new Error('Missing test value'); return value; }
let directory: string, databasePath: string, repository: ReaderRepository, at: string, sequence: number;
const handles: { close(): void }[] = [];
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'youtube-comments-ingestion-'));
  databasePath = path.join(directory, 'reader.sqlite'); at = '2026-10-02T08:00:00.000Z'; sequence = 0;
  repository = open();
});
afterEach(() => {
  handles.splice(0).forEach(handle => handle.close());
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('youtube-comments-ingestion-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function open() { const repo = ReaderRepository.open(databasePath, { now: () => at, newId: () => `local-${++sequence}` }); handles.push(repo); return repo; }
function raw() { const db = new DatabaseSync(databasePath); db.exec('PRAGMA foreign_keys = ON'); handles.push(db); return db; }
function state() { return repository.bootstrap(['en']); }
function comments() { return Object.values(state().comments)[0]; }
function later() { at = '2026-10-02T09:00:00.000Z'; }

const newCohort = () => {
  const snapshot = state(), item = snapshot.items[0];
  const comments = snapshot.comments[item.id];
  const cohort = comments.filter(comment => isNewDiscovery(item, comment));
  const result = evaluateTestQuery(queryComments(comments, item), { ...defaultQuery, discovery: 'new' });
  expect(result.ok && [...result.result.activeMatchIds].sort()).toEqual(cohort.map(comment => comment.id).sort());
  return cohort;
};
it('derives latest accepted NEW independently of seen/publication, tied/regressing clocks and restart', () => {
  const input = fixture(), root = { ...input.collection.comments[0], relationship: { kind: 'top-level' as const } };
  const baseline = repository.ingest(batch(input, [root]), undefined, true);
  expect(state().items[0].latestAcceptedDiscoveryId).toBe(baseline.id);
  expect(newCohort()).toEqual([]);
  const oldPublication = { ...root.publication, instant: observed('2001-01-01T00:00:00Z') };
  // Clock deliberately stays identical; lexicographic generated IDs also cross 9.
  const refresh = repository.ingest(batch(input, [root, { ...root, sourceId: 'old-but-new', publication: oldPublication }]));
  expect(newCohort().map(comment => comment.source.commentId)).toEqual(['old-but-new']);
  const added = newCohort()[0];
  repository.toggleSeen({ itemId: added.itemId, commentId: added.id, subtree: false });
  expect(newCohort()[0].seen).toBe(true);
  const failed: NormalizedExtraction = { provenance: input.provenance, issues: [], coverage: { kind: 'failed', reason: 'parse-failed' } };
  repository.ingest(failed, { sourceKind: input.item.sourceKind, sourceId: input.item.sourceId });
  expect(state().items[0].latestAcceptedDiscoveryId).toBe(refresh.id);
  expect(newCohort()).toHaveLength(1);
  repository.changeWorkspace('closeTab', `discussion:${added.itemId}`);
  repository.changeWorkspace('openStoredItem', added.itemId);
  const before = state();
  const db = raw(), orders = db.prepare('SELECT id, attempt_order FROM extraction_attempts ORDER BY attempt_order').all();
  db.exec('VACUUM');
  expect(db.prepare('SELECT id, attempt_order FROM extraction_attempts ORDER BY attempt_order').all()).toEqual(orders);
  expect(state()).toEqual(before);
  handles.splice(handles.indexOf(repository), 1); repository.close(); repository = open();
  expect(state()).toEqual(before); expect(newCohort()[0]).toMatchObject({ id: added.id, seen: true });
  at = '2026-10-01T00:00:00.000Z'; // Even a regressing clock cannot reverse acceptance order.
  const next = repository.ingest(batch(input, [root, { ...root, sourceId: 'replacement' }]));
  expect(state().items[0].latestAcceptedDiscoveryId).toBe(next.id);
  expect(newCohort().map(comment => comment.source.commentId)).toEqual(['replacement']);
  repository.toggleSeen({ itemId: added.itemId, commentId: added.id, subtree: false });
  expect(newCohort().map(comment => comment.source.commentId)).toEqual(['replacement']);
  repository.ingest(batch(input, [root]));
  expect(newCohort()).toEqual([]); // Existing observations, zero inserts, replace cohort.
});
it.each(['partial', 'unknown'] as const)('accepted %s refresh supersedes the cohort, including unavailable collection', kind => {
  const input = fixture(), root = { ...input.collection.comments[0], relationship: { kind: 'top-level' as const } };
  repository.ingest(batch(input, [root]));
  const coverage = kind === 'partial' ? { kind, evidence: ['fixture limit'] } : { kind };
  const attempt = repository.ingest({ ...batch(input, [{ ...root, sourceId: 'new' }]), coverage });
  expect(newCohort()[0].discovery.firstDiscoveryId).toBe(attempt.id);
  repository.ingest({ ...input, coverage, collection: { status: 'unavailable' as const, reason: 'disabled' as const } });
  expect(newCohort()).toEqual([]);
});

it('schema 4 → 5 freezes existing attempt insertion order transactionally without rewriting discussion facts', () => {
  repository.ingest(fixture()); repository.ingest(fixture('yt-membership-b'));
  const before = state(), db = raw();
  db.exec('DROP TRIGGER assign_attempt_order; DROP INDEX latest_accepted_attempt; DROP INDEX extraction_attempt_order; ALTER TABLE extraction_attempts DROP COLUMN attempt_order; PRAGMA user_version=4;');
  const historyRows = db.prepare('SELECT * FROM extraction_attempts ORDER BY rowid').all();
  expect(() => migrateDatabase(db, [...migrations.slice(0, 4), { version: 5, apply: database => {
    migrations[4].apply(database); throw new Error('injected order migration failure');
  } }])).toThrow('injected order migration failure');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
  expect(db.prepare('SELECT * FROM extraction_attempts ORDER BY rowid').all()).toEqual(historyRows);
  migrateDatabase(db);
  expect(state()).toEqual(before);
  expect(db.prepare('SELECT id FROM extraction_attempts ORDER BY attempt_order').all().map(row => row.id)).toEqual(historyRows.map(row => row.id));
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('evaluates committed refresh rows, preserving absent stored identities and live seen with new unseen matches', () => {
  repository.ingest(fixture());
  const before = comments(), root = required(before.find(comment => comment.parentId === null));
  repository.toggleSeen({ itemId: root.itemId, commentId: root.id, subtree: false });
  const criterion = { ...defaultQuery, seen: 'unseen' as const };
  const old = evaluateTestQuery(queryComments(comments()), criterion);
  repository.ingest(fixture('yt-membership-b'));
  const committed = comments(), next = evaluateTestQuery(queryComments(committed), criterion);
  expect(committed.find(comment => comment.id === root.id)?.seen).toBe(true);
  expect(before.every(comment => committed.some(row => row.id === comment.id))).toBe(true);
  expect(old.ok && next.ok).toBe(true);
  if (!old.ok || !next.ok) throw new Error('Unexpected invalid query');
  const inserted = committed.filter(row => !before.some(previous => previous.id === row.id));
  expect(inserted.length).toBeGreaterThan(0);
  expect(inserted.every(row => next.result.activeMatchIds.includes(row.id))).toBe(true);
  expect(next.result.activeMatchIds).not.toContain(root.id);
  expect(next.result.matchCount).toBe(committed.filter(row => !row.seen).length);
});
it('replied-to-author query uses actual repository video projection and never Community containment', () => {
  repository.ingest(fixture());
  const rows = comments(), child = required(rows.find(row => row.directParentId));
  const parent = required(rows.find(row => row.id === child.directParentId));
  const query = { ...defaultQuery, text: required(parent.author?.displayName), fields: ['replied-to-author' as const] };
  const video = evaluateTestQuery(queryComments(rows), query);
  expect(video.ok && video.result.activeMatchIds.includes(child.id)).toBe(true);
  repository.ingest(fixture('community-thread-a'));
  const post = required(state().items.find(item => item.kind === 'post'));
  const community = evaluateTestQuery(queryComments(state().comments[post.id]), { ...query, text: '.', mode: 'regex' });
  expect(community.ok && community.result.matchCount).toBe(0);
});

it('persists avatar evidence: lossy refresh preserves known URL, newer observed URL updates it across restart', () => {
  const input = fixture('community-thread-a'), first = input.collection.comments[0];
  repository.ingest(batch(input, [first]));
  const id = comments()[0].id;
  expect(comments()[0].author?.avatarUrl).toBe('https://example.invalid/comment-author.png');
  repository.toggleSeen({ itemId: comments()[0].itemId, commentId: id, subtree: false });
  for (const reason of ['unavailable', 'lossy-default', 'unreliable', 'invalid', 'unsupported'] as const) {
    repository.ingest(batch(input, [{ ...first, author: { ...first.author, avatarUrl: unknown(reason) } }]));
    expect(comments()[0].author?.avatarUrl).toBe('https://example.invalid/comment-author.png');
  }
  repository.ingest(batch(input, [{ ...first, author: { ...first.author, avatarUrl: observed('https://example.invalid/new.png') } }]));
  handles.splice(handles.indexOf(repository), 1); repository.close(); repository = open();
  expect(comments()[0]).toMatchObject({ id, seen: true, author: { avatarUrl: 'https://example.invalid/new.png' },
    remote: { author: { avatarUrl: { status: 'observed', value: 'https://example.invalid/new.png' } } } });
});

it('establishes an accepted unknown baseline with opaque injected IDs, unseen comments and honest publication evidence', () => {
  const input = fixture(), result = repository.ingest(input);
  expect(result).toMatchObject({ id: 'local-1', itemId: 'local-2', outcome: 'accepted', coverage: { kind: 'unknown' }, counts: { inserted: input.collection.comments.length } });
  expect(state().items[0].baselineDiscoveryId).toBe(result.id);
  for (const comment of comments()) {
    expect(comment.seen).toBe(false);
    expect(comment.id).not.toBe(comment.source.commentId);
    expect(comment.discovery).toEqual({ firstDiscoveredAt: at, lastObservedAt: at, firstDiscoveryId: result.id, lastObservationId: result.id });
    expect(comment.publication).toMatchObject(required(input.collection.comments.find(candidate => candidate.sourceId === comment.source.commentId)).publication);
    // Baseline membership, rather than a transient badge, distinguishes later discoveries.
    expect(comment.discovery.firstDiscoveryId !== state().items[0].baselineDiscoveryId).toBe(false);
  }
  expect(repository.history()).toEqual([result]);
});

it('reacquires the same source identities without duplicates and preserves both seen states and first discoveries', () => {
  repository.ingest(fixture());
  const first = comments();
  repository.toggleSeen({ itemId: first[0].itemId, commentId: first[0].id, subtree: false });
  later(); const second = repository.ingest(fixture());
  expect(second.counts).toMatchObject({ inserted: 0, updated: first.length });
  expect(state().items).toHaveLength(1);
  expect(comments().map(comment => comment.id)).toEqual(first.map(comment => comment.id));
  for (const [index, comment] of comments().entries()) {
    expect(comment.seen).toBe(index === 0);
    expect(comment.discovery).toEqual({ ...first[index].discovery, lastObservedAt: at, lastObservationId: second.id });
  }
});

it.each([['yt-nested-a', 'yt-membership-b'], ['community-thread-a', 'community-membership-b']])('accumulates %s/%s: absent rows are untouched and later discoveries start unseen', (a, b) => {
  const firstInput = fixture(a); repository.ingest(firstInput);
  const first = comments();
  repository.toggleSeen({ itemId: first[0].itemId, commentId: first[0].id, subtree: true });
  const before = comments(), secondInput = fixture(b); later();
  const result = repository.ingest(secondInput), after = comments();
  for (const previous of before) {
    const next = required(after.find(comment => comment.id === previous.id));
    if (!secondInput.collection.comments.some(comment => comment.sourceId === previous.source.commentId)) expect(next).toEqual(previous);
    else { expect(next.seen).toBe(previous.seen); expect(next.discovery.firstDiscoveryId).toBe(previous.discovery.firstDiscoveryId); expect(next.discovery.lastObservationId).toBe(result.id); }
  }
  const newComments = after.filter(comment => !before.some(previous => previous.id === comment.id));
  expect(newComments.length).toBeGreaterThan(0);
  for (const comment of newComments) expect(comment).toMatchObject({ seen: false, discovery: { firstDiscoveredAt: at, firstDiscoveryId: result.id, lastObservedAt: at } });
  expect(state().items[0].baselineDiscoveryId).not.toBe(result.id);
});

it('updates observed text/metadata including trustworthy zero/false/empty while unknown variants preserve every useful field', () => {
  const input = fixture(), first = input.collection.comments[2];
  repository.ingest(batch(input, [{ ...first, text: observed('hello'), likeCount: observed(12), pinned: observed(true), creator: observed(true) }]));
  const id = comments()[0].id; repository.toggleSeen({ itemId: comments()[0].itemId, commentId: id, subtree: false });
  for (const reason of ['unavailable', 'lossy-default', 'unreliable', 'invalid', 'unsupported'] as const) {
    later(); repository.ingest(batch(input, [{ ...first, text: observed('hello edited'), likeCount: unknown(reason), pinned: unknown(reason), creator: unknown(reason),
      author: { sourceId: unknown(reason), displayName: unknown(reason), handle: unknown(reason), avatarUrl: unknown(reason) }, publication: { instant: unknown(reason), label: unknown(reason), estimated: unknown(reason), precision: 'unknown' } }]));
    expect(comments()[0]).toMatchObject({ id, text: 'hello edited', likeCount: 12, isPinned: true, isCreator: true, seen: true, author: { displayName: observedValue(first.author.displayName) } });
    expect(comments()[0].publication).toMatchObject(first.publication);
  }
  repository.ingest(batch(input, [{ ...first, text: observed(''), likeCount: observed(0), pinned: observed(false), creator: observed(false) }]));
  expect(comments()[0]).toMatchObject({ text: '', likeCount: 0, isPinned: false, isCreator: false, seen: true });
});
function observedValue<T>(field: { status: 'observed'; value: T } | { status: 'unknown'; reason: string }) { return field.status === 'observed' ? field.value : undefined; }

it('scopes comment identities to items and content identities to source kinds, with database uniqueness constraints', () => {
  const video = fixture(), post = fixture('community-thread-a');
  const common = 'identical opaque source ID';
  repository.ingest(batch(video, [{ ...video.collection.comments[0], sourceId: common }]));
  repository.ingest(batch({ ...video, item: { ...video.item, sourceId: 'second-video' } }, [{ ...video.collection.comments[0], sourceId: common }]));
  repository.ingest(batch({ ...post, item: { ...post.item, sourceId: video.item.sourceId } }, [{ ...post.collection.comments[0], sourceId: common }]));
  expect(state().items).toHaveLength(3);
  const all = Object.values(state().comments).flat(); expect(new Set(all.map(comment => comment.id)).size).toBe(3);
  repository.ingest(batch(video, [{ ...video.collection.comments[0], sourceId: common }])); expect(state().items).toHaveLength(3);
  const db = raw();
  expect(() => db.exec(`UPDATE content_items SET source_id = '${video.item.sourceId}' WHERE source_id = 'second-video'`)).toThrow();
  expect(db.prepare('SELECT count(*) AS count FROM comments WHERE source_comment_id = ?').get(common)?.count).toBe(3);
});

it('persists direct-parent evidence and applies Ctrl+click to the complete display subtree', () => {
  repository.ingest(fixture());
  const before = comments(), child = required(before.find(comment => comment.relationship?.kind === 'direct-parent'));
  expect(child.directParentId).toBe(child.parentId); expect(child.parentId).not.toBeNull();
  const changed = repository.toggleSeen({ itemId: child.itemId, commentId: required(child.parentId), subtree: true });
  expect(changed.find(comment => comment.id === child.id)?.seen).toBe(true);
  expect(walkComments(buildCommentTree(changed))).toHaveLength(before.length);
});

it('stores Community containment, images/links and labels without claiming a direct replied-to author or exact timestamp', () => {
  repository.ingest(fixture('community-thread-a'));
  const reply = required(comments().find(comment => comment.relationship?.kind === 'thread-containment'));
  expect(reply.parentId).not.toBeNull(); expect(reply.directParentId).toBeNull(); expect(reply.publishedAt).toBeUndefined();
  expect(comments()[0].publication?.label.status).toBe('observed');
  expect(state().items[0].remote?.images.status).toBe('observed'); expect(state().items[0].remote?.links.status).toBe('observed');
  const before = required(state().items[0].remote);
  const input = fixture('community-lossy'); repository.ingest({ ...input, item: { ...input.item, sourceId: before.sourceId }, collection: { status: 'present', comments: [] } });
  expect(state().items[0].remote).toEqual(before);
});

it.each(['direct-parent', 'thread-containment'] as const)('keeps an unresolved %s and resolves later without identity, seen or discovery changes', kind => {
  const input = fixture(), base = input.collection.comments[0];
  const relationship = kind === 'direct-parent' ? { kind, parentSourceId: 'missing' } : { kind, rootSourceId: 'missing' };
  repository.ingest(batch(input, [{ ...base, sourceId: 'child', relationship }]));
  const first = comments()[0];
  expect(first).toMatchObject({ parentId: null, directParentId: null, relationship, relationshipStatus: 'unresolved' });
  repository.toggleSeen({ itemId: first.itemId, commentId: first.id, subtree: false });
  const before = comments()[0]; later();
  repository.ingest(batch(input, [{ ...base, sourceId: 'missing', relationship: { kind: 'top-level' } }]));
  const child = required(comments().find(comment => comment.id === first.id));
  expect(child.discovery).toEqual(before.discovery); expect(child.seen).toBe(true);
  expect(child.parentId).toBe(required(comments().find(comment => comment.source.commentId === 'missing')).id);
  expect(child.directParentId).toBe(kind === 'direct-parent' ? child.parentId : null);
  expect(child.relationship).toEqual(relationship); expect(child.relationshipStatus).toBe('resolved');
});

it('preserves cyclic source truth and exposes an acyclic deterministic reader forest, including cycles through stored absent comments', () => {
  const input = fixture(), base = input.collection.comments[0];
  repository.ingest(batch(input, [{ ...base, sourceId: 'a', relationship: { kind: 'direct-parent', parentSourceId: 'b' } }]));
  later(); const result = repository.ingest(batch(input, [{ ...base, sourceId: 'b', relationship: { kind: 'direct-parent', parentSourceId: 'a' } },
    { ...base, sourceId: 'c', relationship: { kind: 'direct-parent', parentSourceId: 'a' } }]));
  expect(comments().filter(comment => comment.relationshipStatus === 'cyclic')).toHaveLength(2);
  expect(comments().filter(comment => comment.relationshipStatus === 'cyclic').every(comment => comment.parentId === null)).toBe(true);
  expect(comments().find(comment => comment.source.commentId === 'c')?.parentId).not.toBeNull();
  expect(walkComments(buildCommentTree(comments()))).toHaveLength(3);
  expect(result.issues.filter(issue => issue.code === 'cyclic-relationship')).toHaveLength(2);
});

it('skips every duplicate candidate without overwriting stored data, while independent observations commit and history reports conflicts', () => {
  const input = fixture(), base = input.collection.comments[0]; repository.ingest(batch(input, [base]));
  const before = comments()[0]; later();
  const result = repository.ingest(batch(input, [{ ...base, text: observed('wrong winner 1') }, { ...base, text: observed('wrong winner 2') },
    { ...base, sourceId: 'new', relationship: { kind: 'direct-parent', parentSourceId: base.sourceId } }]));
  expect(comments().find(comment => comment.id === before.id)).toEqual(before);
  expect(result.counts).toEqual({ candidates: 3, skipped: 2, inserted: 1, updated: 0, conflictedIdentities: 1 });
  expect(result.issues).toContainEqual({ code: 'duplicate-identity', severity: 'error', location: '$.collection', sourceId: base.sourceId });
  const count = comments().length;
  const candidate = { ...base, sourceId: 'unknown-duplicate' };
  const duplicate = repository.ingest(batch(input, [candidate, candidate]));
  expect(duplicate.counts.skipped).toBe(2); expect(comments()).toHaveLength(count);
});

it('ingests normalized Community conflict fixtures without arbitrary relationship winners', () => {
  repository.ingest(fixture('community-thread-a')); const before = comments(); later();
  const result = repository.ingest(fixture('community-duplicate'));
  const conflict = required(before.find(comment => comment.source.commentId === 'Ug.reply:02'));
  expect(comments().find(comment => comment.id === conflict.id)).toEqual(conflict);
  expect(result.counts).toMatchObject({ skipped: 2, conflictedIdentities: 1 });
  expect(result.counts.updated).toBeGreaterThan(0);
});

it.each(['yt-limited', 'community-limited'])('accepts %s as the first baseline with true partial coverage and evidence', id => {
  const input = fixture(id), attempt = repository.ingest(input);
  expect(attempt.coverage).toEqual(input.coverage); expect(attempt.coverage.kind).toBe('partial');
  expect(attempt.outcome).toBe('accepted'); expect(state().items[0].baselineDiscoveryId).toBe(attempt.id);
  expect(comments().every(comment => !comment.seen && comment.discovery.firstDiscoveryId === attempt.id)).toBe(true);
});

it('failed normalization changes only history, associates a known target and never establishes a new baseline', () => {
  const input = fixture(); repository.ingest(input); const before = state(); later();
  const failed: NormalizedExtraction = { provenance: input.provenance, issues: [{ code: 'invalid-json', severity: 'error', location: '$' }], coverage: { kind: 'failed', reason: 'parse-failed' } };
  const result = repository.ingest(failed, { sourceKind: input.item.sourceKind, sourceId: input.item.sourceId });
  expect(state()).toEqual(before); expect(result).toMatchObject({ itemId: before.items[0].id, outcome: 'failed', counts: { inserted: 0, updated: 0 } });
  const other = repository.ingest(failed, { sourceKind: 'youtube-video', sourceId: 'never-acquired' });
  expect(other.itemId).toBeUndefined(); expect(state().items).toHaveLength(1); expect(repository.history()).toHaveLength(3);
});

it('records unavailable collections and empty observations without deleting stored comments or advancing their observation facts', () => {
  const input = fixture(); repository.ingest(input); const before = comments(); later();
  const unavailable: NormalizedExtraction = { provenance: input.provenance, issues: input.issues, coverage: input.coverage, item: input.item, collection: { status: 'unavailable', reason: 'disabled' } };
  const result = repository.ingest(unavailable);
  expect(result.collection).toBe('unavailable'); expect(result.counts.candidates).toBe(0); expect(comments()).toEqual(before);
  repository.ingest(batch(input, [])); expect(comments()).toEqual(before);
});

it('a late database failure rolls back item, comment, local-state inserts and history atomically', () => {
  const input = fixture(), base = input.collection.comments[0]; repository.ingest(batch(input, [base]));
  repository.toggleSeen({ itemId: comments()[0].itemId, commentId: comments()[0].id, subtree: false });
  const before = state(), history = repository.history();
  raw().exec(`CREATE TRIGGER fail_merge BEFORE UPDATE ON comments BEGIN SELECT RAISE(ABORT, 'injected merge failure'); END;`);
  later(); expect(() => repository.ingest(batch({ ...input, item: { ...input.item, title: observed('updated title') } }, [
    { ...base, sourceId: 'new', relationship: { kind: 'top-level' } }, { ...base, text: observed('edited') },
  ]))).toThrow('injected merge failure');
  expect(state()).toEqual(before); expect(repository.history()).toEqual(history);
  expect(raw().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('merge never writes existing comment_state, even after a local seen edit before ingestion', () => {
  repository.ingest(fixture()); const first = comments()[0]; repository.toggleSeen({ itemId: first.itemId, commentId: first.id, subtree: false });
  raw().exec(`CREATE TRIGGER forbid_state_update BEFORE UPDATE ON comment_state BEGIN SELECT RAISE(ABORT, 'merge wrote local state'); END;`);
  later(); repository.ingest(fixture()); expect(comments()[0].seen).toBe(true); expect(comments()[1].seen).toBe(false);
});

it('real-style Community fixture, stable IDs, relationships, history and seen survive close/reopen without demo reset', () => {
  repository.ingest(fixture('community-thread-a')); const reply = comments()[1]; repository.toggleSeen({ itemId: reply.itemId, commentId: reply.id, subtree: false });
  later(); repository.ingest(fixture('community-membership-b'));
  const before = state(), history = repository.history();
  handles.splice(handles.indexOf(repository), 1); repository.close(); repository = open(); repository.initializeDemo();
  expect(state()).toEqual(before); expect(repository.history()).toEqual(history);
});

it('authoritative relationship changes update display placement while retaining identity and local state', () => {
  const input = fixture(), base = input.collection.comments[0];
  repository.ingest(batch(input, [{ ...base, sourceId: 'root', relationship: { kind: 'top-level' } }, { ...base, sourceId: 'child', relationship: { kind: 'direct-parent', parentSourceId: 'root' } }]));
  const child = comments()[1]; repository.toggleSeen({ itemId: child.itemId, commentId: child.id, subtree: false });
  later(); repository.ingest(batch(input, [{ ...base, sourceId: 'child', relationship: { kind: 'top-level' }, author: { ...base.author, displayName: observed('renamed'), handle: observed('@changed') } }]));
  expect(comments()[1]).toMatchObject({ id: child.id, parentId: null, directParentId: null, seen: true, author: { displayName: 'renamed', handle: '@changed' }, discovery: { firstDiscoveryId: child.discovery.firstDiscoveryId } });
  repository.ingest(batch(input, [{ ...base, sourceId: 'child', relationship: { kind: 'thread-containment', rootSourceId: 'root' } }]));
  expect(comments()[1]).toMatchObject({ id: child.id, parentId: comments()[0].id, directParentId: null, seen: true });
});

it('enforces same-item accepted history associations and per-item comment uniqueness in SQLite', () => {
  const input = fixture(); const first = repository.ingest(input);
  const second = repository.ingest({ ...input, item: { ...input.item, sourceId: 'different-item' } });
  const db = raw(), child = comments()[0], sibling = comments()[1];
  expect(() => db.prepare('UPDATE comments SET last_attempt_id = ? WHERE id = ?').run(second.id, child.id)).toThrow('Invalid comment evidence/history');
  expect(() => db.prepare('UPDATE content_items SET baseline_attempt_id = ?, baseline_discovery_id = ? WHERE id = ?').run(second.id, second.id, first.itemId ?? '')).toThrow('Invalid item evidence/history');
  expect(() => db.prepare("UPDATE comments SET source_comment_id = ?, remote_json = json_set(remote_json, '$.sourceId', ?) WHERE id = ?").run(sibling.source.commentId, sibling.source.commentId, child.id)).toThrow();
});

it('stores bounded structural diagnostics/provenance and retains reserved complete coverage honestly', () => {
  const input = fixture();
  const attempt = repository.ingest({ ...input, coverage: { kind: 'complete', evidence: ['affirmative fixture evidence'] },
    provenance: { ...input.provenance, evidence: ['control\u0000\ncharacters', 'x'.repeat(1000)] } });
  expect(repository.history()[0]).toEqual(attempt);
  expect(attempt.provenance.evidence).toEqual(['controlcharacters', 'x'.repeat(240)]);
  expect(attempt.coverage).toEqual({ kind: 'complete', evidence: ['affirmative fixture evidence'] });
});

function schemaOne(db: DatabaseSync) {
  // Use the actual ordered schema-1 migration, then populate real legacy columns.
  db.exec('DROP TABLE workspace; DROP TABLE workspace_tabs; DROP TABLE comment_state; DROP TABLE comments; DROP TABLE content_items; DROP TABLE extraction_attempts; DROP TABLE preferences; PRAGMA user_version = 0');
  migrateDatabase(db, migrations.slice(0, 1));
  db.exec(`INSERT INTO content_items VALUES ('old-item',0,'video','opaque-item','title','description',NULL,'author','name',NULL,'2026-09-01T00:00:00Z','old-baseline');
    INSERT INTO comments VALUES ('old-root','old-item',NULL,0,'source-root',NULL,'name',NULL,'root text',NULL,'2026-09-02T00:00:00Z','2026-09-03T00:00:00Z','old-baseline',12,NULL,1);
    INSERT INTO comments VALUES ('old-child','old-item','old-root',1,'source-child',NULL,NULL,NULL,'child text','2026-09-01T00:00:00Z','2026-09-03T00:00:00Z','2026-09-03T00:00:00Z','old-later',NULL,NULL,NULL);
    INSERT INTO comment_state VALUES ('old-root',1),('old-child',0);
    UPDATE preferences SET locale='pl',appearance='dark';`);
}
it('schema 1 to 2 preserves legacy IDs, all remote fields, seen/preferences and synthetic discovery labels', () => {
  const db = raw(); schemaOne(db);
  const items = db.prepare('SELECT * FROM content_items').all(), old = db.prepare('SELECT * FROM comments ORDER BY position').all();
  migrateDatabase(db);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
  expect(db.prepare('SELECT * FROM content_items').all()).toMatchObject(items);
  expect(db.prepare('SELECT * FROM comments ORDER BY position').all()).toMatchObject(old);
  expect(db.prepare('SELECT * FROM comment_state ORDER BY comment_id').all()).toEqual([{ comment_id: 'old-child', seen: 0 }, { comment_id: 'old-root', seen: 1 }]);
  expect(state().preferences).toEqual({ locale: 'pl', appearance: 'dark' });
  expect(comments()[1]).toMatchObject({ id: 'old-child', parentId: 'old-root', directParentId: 'old-root' });
  expect(repository.history().every(attempt => attempt.provenance.backend === 'synthetic-demo')).toBe(true);
  expect(raw().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  repository.initializeDemo(); expect(state().items).toHaveLength(1);
});

it('failure after the actual schema-2 migration rolls back DDL, indexes, history, version and old data', () => {
  const db = raw(); schemaOne(db); const old = db.prepare('SELECT * FROM comments').all();
  expect(() => migrateDatabase(db, [migrations[0], { version: 2, apply: database => { migrations[1].apply(database); throw new Error('injected upgrade failure'); } }])).toThrow('injected upgrade failure');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
  expect(db.prepare('SELECT * FROM comments').all()).toEqual(old);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('extraction_attempts','comment_source_identity')").all()).toEqual([]);
  expect(db.prepare('SELECT seen FROM comment_state WHERE comment_id = ?').get('old-root')?.seen).toBe(1);
  expect(db.prepare('SELECT locale FROM preferences').get()?.locale).toBe('pl');
  migrateDatabase(db); expect(comments()[0].id).toBe('old-root');
});

it('migrates all 24 current schema-1 demo comments with their seen/preferences, ordering and publication values intact', () => {
  const db = raw(); schemaOne(db);
  db.exec('DELETE FROM comment_state; DELETE FROM comments; DELETE FROM content_items;');
  for (const [position, item] of items.entries()) {
    db.prepare('INSERT INTO content_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(item.id, position, item.kind, item.sourceId,
      item.kind === 'video' ? item.title : null, item.kind === 'video' ? item.description ?? null : null, item.kind === 'post' ? item.text : null,
      item.author?.sourceId ?? null, item.author?.displayName ?? null, item.author?.handle ?? null, item.publishedAt ?? null, item.baselineDiscoveryId);
    // Schema 1 uses deferred parent FKs; children may appear before their parents.
    db.exec('BEGIN IMMEDIATE');
    for (const [position, comment] of initialComments[item.id].entries()) {
      db.prepare('INSERT INTO comments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(comment.id, item.id, comment.parentId, position, comment.source.commentId,
        comment.author?.sourceId ?? null, comment.author?.displayName ?? null, comment.author?.handle ?? null, comment.text, comment.publishedAt ?? null,
        comment.discovery.firstDiscoveredAt, comment.discovery.lastObservedAt, comment.discovery.firstDiscoveryId, comment.likeCount ?? null,
        comment.isCreator === undefined ? null : Number(comment.isCreator), comment.isPinned === undefined ? null : Number(comment.isPinned));
      db.prepare('INSERT INTO comment_state VALUES (?,?)').run(comment.id, Number(comment.seen));
    }
    db.exec('COMMIT');
  }
  migrateDatabase(db);
  expect(state().items).toMatchObject(items); expect(state().comments).toMatchObject(initialComments);
  expect(state().preferences).toEqual({ locale: 'pl', appearance: 'dark' });
  expect(repository.history()).toHaveLength(4);
  repository.initializeDemo(); expect(Object.values(state().comments).flat()).toHaveLength(24);
});

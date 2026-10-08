import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository, InvalidSeenTargetError } from './reader-repository';
import { migrateDatabase, migrations } from './migrations';
import { normalizeYtDlp } from '../extractors/yt-dlp';
import { queryComments, defaultQuery } from '../../domain/discussion-query';
import { evaluateTestQuery } from '../../fixtures/query-testing';
import { resolvePublication } from '../../domain/publication-filter';
import { ownPublicationInstant, publicationMatches } from '../../domain/publication-predicate';
import type { BulkSeenRequest } from '../../domain/seen-operation';
import { required } from '../../renderer/testing/required';

let directory: string, file: string, repository: ReaderRepository;
const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-seen-test-')); file = path.join(directory, 'reader.sqlite');
  repository = ReaderRepository.open(file); repository.initializeDemo();
});
afterEach(() => {
  vi.restoreAllMocks(); repository.close();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-seen-test-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function raw<T>(action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON');
  try { return action(db); } finally { db.close(); }
}
const state = () => repository.bootstrap(['en']);
const rows = () => state().comments['video-demo'];
const bulk = (seen: boolean, itemId = 'video-demo') => repository.bulkSeen({ itemId, seen, target: { kind: 'all' } });
function reopen() { repository.close(); repository = ReaderRepository.open(file); }

it('schema 5 migration preserves states, initializes revisions and rolls back/retries safely', () => {
  const before = state();
  raw(db => {
    db.exec('DROP TABLE helper_settings; DROP TABLE seen_operation_entries; DROP TABLE seen_operations; ALTER TABLE comment_state DROP COLUMN revision; PRAGMA user_version=5;');
    const old = db.prepare('SELECT * FROM comment_state').all();
    expect(() => migrateDatabase(db, [...migrations.slice(0, 5), { version: 6, apply: database => {
      migrations[5].apply(database); throw new Error('migration failure');
    } }])).toThrow('migration failure');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
    expect(db.prepare('SELECT * FROM comment_state').all()).toEqual(old);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'seen_oper%'").all()).toEqual([]);
    migrateDatabase(db);
    expect(db.prepare('SELECT * FROM comment_state').all()).toEqual(old.map(row => ({ ...row, revision: 0 })));
  });
  expect(state()).toEqual(before);
});

it.each([true, false])('All assigns %s across stored discussion only; logs changed rows and restores exactly', seen => {
  const before = state(), result = bulk(seen);
  expect(result.targetCount).toBe(rows().length);
  expect(result.changedCount).toBe(before.comments['video-demo'].filter(comment => comment.seen !== seen).length);
  expect(rows().every(comment => comment.seen === seen)).toBe(true);
  expect(state().comments['post-demo']).toEqual(before.comments['post-demo']);
  raw(db => {
    expect(db.prepare('SELECT count(*) AS n FROM seen_operation_entries').get()?.n).toBe(result.changedCount);
    const revisions = new Map(db.prepare('SELECT * FROM comment_state').all().map(row => [row.comment_id, row.revision]));
    for (const comment of before.comments['video-demo']) expect(revisions.get(comment.id)).toBe(comment.seen === seen ? 0 : 1);
  });
  const undo = repository.undoSeen('video-demo');
  expect(undo).toMatchObject({ restored: result.changedCount, skipped: 0, undo: null });
  expect(rows()).toEqual(before.comments['video-demo']);
  expect(() => repository.undoSeen('video-demo')).toThrow();
});

it('matching is the exact frozen applied set, including stale matches and excluding context/raw-only', () => {
  const current = rows().map(comment => ({ ...comment, text: 'same search' }));
  const evaluated = evaluateTestQuery(queryComments(current), { ...defaultQuery, text: 'same search', seen: 'unseen' });
  if (!evaluated.ok) throw new Error('query failed');
  const frozen = evaluated.result.activeMatchIds;
  const first = frozen[0];
  repository.toggleSeen({ itemId: 'video-demo', commentId: first, subtree: false });
  const before = rows();
  const result = repository.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'matching', ids: frozen } });
  expect(result.targetCount).toBe(frozen.length);
  expect(result.changedCount).toBe(frozen.length - 1);
  expect(result.comments).toEqual(before.map(comment => frozen.includes(comment.id) ? { ...comment, seen: true } : comment));
  expect(evaluated.result.rawSearchMatchIds.length).toBeGreaterThan(frozen.length);
});

it.each([
  ['v1', 'v1'], ['v1', 'p1'], ['v1', 'missing'], ['v1', 'bad\0'],
].map(ids => ({ ids })))('rejects malformed/duplicate/cross-item matching IDs $ids without changing recovery or state', ({ ids }) => {
  bulk(true); const before = state();
  expect(() => repository.bulkSeen({ itemId: 'video-demo', seen: false, target: { kind: 'matching', ids } })).toThrow(InvalidSeenTargetError);
  expect(state()).toEqual(before);
});

it.each(['after', 'before', 'between'] as const)('publication %s reuses whole local DST day semantics across all stored rows', scope => {
  const real = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...real, timeZone: 'Europe/Warsaw' });
  const instants = ['2026-03-28T22:59:59Z', '2026-03-28T23:00:00Z', '2026-03-29T21:59:59Z', '2026-03-29T22:00:00Z', null, '2026-03-29'];
  raw(db => {
    const update = db.prepare('UPDATE comments SET published_at=? WHERE id=?');
    rows().slice(0, instants.length).forEach((comment, index) => update.run(instants[index], comment.id));
  });
  const target = { kind: 'publication' as const, ...(scope !== 'before' ? { from: '2026-03-29' } : {}), ...(scope !== 'after' ? { to: '2026-03-29' } : {}) };
  const before = rows(), resolved = resolvePublication({ kind: 'custom', from: target.from, to: target.to }, { now: Date.now(), timeZone: 'Europe/Warsaw' });
  if (!resolved.ok) throw new Error('resolution failed');
  const ids = before.filter(comment => publicationMatches(ownPublicationInstant(comment.publishedAt), resolved.bounds)).map(comment => comment.id);
  const result = repository.bulkSeen({ itemId: 'video-demo', seen: true, target });
  expect(result.targetCount).toBe(ids.length);
  expect(result.comments).toEqual(before.map(comment => ids.includes(comment.id) ? { ...comment, seen: true } : comment));
  expect(ids).not.toContain(before[4].id); expect(ids).not.toContain(before[5].id);
  if (scope === 'between') expect(ids).toEqual([before[1].id, before[2].id]);
});

it.each([{ from: '2026-10-08', to: '2026-10-07' }, { from: '2026-02-30' }, { from: '' }])('invalid publication range %j preserves all state', dates => {
  bulk(true); const before = state();
  expect(() => repository.bulkSeen({ itemId: 'video-demo', seen: false, target: { kind: 'publication', ...dates } })).toThrow(InvalidSeenTargetError);
  expect(state()).toEqual(before);
});

it('estimated/coarse observed publication participates and label-only comments do not', () => {
  const input = normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context);
  const id = required(repository.ingest(input).itemId);
  const before = state().comments[id];
  expect(before.some(comment => comment.publication?.precision === 'coarse' && comment.publication.estimated.status === 'observed' && comment.publication.estimated.value)).toBe(true);
  const result = repository.bulkSeen({ itemId: id, seen: true, target: { kind: 'publication', from: '2000-01-01', to: '2099-12-31' } });
  expect(result.targetCount).toBe(before.filter(comment => ownPublicationInstant(comment.publishedAt) !== undefined).length);
  expect(result.targetCount).toBeGreaterThan(0);
});

it('no-op retains recovery; later successful multi command supersedes only its discussion', () => {
  const first = required(bulk(true).undo);
  const revisions = raw(db => db.prepare('SELECT * FROM comment_state').all());
  expect(bulk(true)).toMatchObject({ changedCount: 0, undo: first });
  expect(raw(db => db.prepare('SELECT * FROM comment_state').all())).toEqual(revisions);
  const other = bulk(true, 'post-demo').undo;
  expect(state().seenUndo['video-demo']).toEqual(first);
  expect(bulk(false).undo?.id).not.toBe(first.id);
  expect(state().seenUndo['post-demo']).toEqual(other);
});

it('a multi-target bulk with one actual transition recovers it; one-target commands retain prior undo', () => {
  bulk(true); repository.toggleSeen({ itemId: 'video-demo', commentId: 'v1', subtree: false });
  const result = bulk(true);
  expect(result.changedCount).toBe(1); expect(result.undo?.changedCount).toBe(1);
  const previous = result.undo;
  repository.bulkSeen({ itemId: 'video-demo', seen: false, target: { kind: 'matching', ids: ['v6'] } });
  expect(state().seenUndo['video-demo']).toEqual(previous);
});

it('mixed subtree recovery restores original mixture and single changed subtree retains prior undo', () => {
  const before = rows();
  const result = repository.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: true });
  expect(result.undo?.kind).toBe('subtree'); expect(result.changedCount).toBeGreaterThan(1);
  expect(repository.undoSeen('video-demo').comments).toEqual(before);
  const previous = bulk(true).undo;
  repository.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: false });
  const single = repository.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: true });
  expect(single.targetCount).toBe(3); expect(single.changedCount).toBe(1);
  expect(state().seenUndo['video-demo']).toEqual(previous);
});

it('partial Undo protects later edits, including away-and-back revisions and unrelated edits across restart', () => {
  const before = rows(), result = bulk(true), changed = before.filter(comment => !comment.seen);
  for (const comment of changed.slice(0, 2)) repository.toggleSeen({ itemId: 'video-demo', commentId: comment.id, subtree: false });
  repository.toggleSeen({ itemId: 'video-demo', commentId: changed[1].id, subtree: false });
  const unrelated = required(before.find(comment => comment.seen));
  repository.toggleSeen({ itemId: 'video-demo', commentId: unrelated.id, subtree: false });
  repository.changeWorkspace('closeTab', 'discussion:video-demo'); reopen();
  expect(state().seenUndo['video-demo']).toEqual(result.undo);
  repository.changeWorkspace('openStoredItem', 'video-demo');
  const undo = repository.undoSeen('video-demo');
  expect(undo).toMatchObject({ restored: result.changedCount - 2, skipped: 2, undo: null });
  expect(undo.comments.find(comment => comment.id === changed[0].id)?.seen).toBe(false);
  expect(undo.comments.find(comment => comment.id === changed[1].id)?.seen).toBe(true);
  expect(undo.comments.find(comment => comment.id === unrelated.id)?.seen).toBe(false);
  reopen(); expect(state().seenUndo['video-demo']).toBeNull();
});

it('all-stale Undo succeeds and consumes recovery without overwriting later state', () => {
  const before = rows(), result = bulk(true);
  for (const comment of before.filter(comment => !comment.seen)) repository.toggleSeen({ itemId: 'video-demo', commentId: comment.id, subtree: false });
  const undo = repository.undoSeen('video-demo');
  expect(undo).toMatchObject({ restored: 0, skipped: result.changedCount, undo: null });
  expect(undo.comments).toEqual(before);
});

it.each(['update', 'entry', 'undo'] as const)('late %s failure rolls back states, revisions and replacement/consumption', phase => {
  bulk(true); const before = state();
  raw(db => db.exec(phase === 'entry' ? "CREATE TRIGGER fail_entry BEFORE INSERT ON seen_operation_entries WHEN NEW.comment_id='v4' BEGIN SELECT RAISE(ABORT,'injected'); END"
    : phase === 'undo' ? "CREATE TRIGGER fail_state BEFORE UPDATE ON comment_state WHEN NEW.comment_id=(SELECT comment_id FROM seen_operation_entries ORDER BY comment_id DESC LIMIT 1) BEGIN SELECT RAISE(ABORT,'injected'); END" : "CREATE TRIGGER fail_state BEFORE UPDATE ON comment_state WHEN NEW.comment_id='v4' BEGIN SELECT RAISE(ABORT,'injected'); END"));
  const revisions = raw(db => db.prepare('SELECT * FROM comment_state').all());
  const entries = raw(db => db.prepare('SELECT * FROM seen_operation_entries').all());
  expect(() => phase === 'undo' ? repository.undoSeen('video-demo') : bulk(false)).toThrow('injected');
  expect(state()).toEqual(before);
  expect(raw(db => db.prepare('SELECT * FROM comment_state').all())).toEqual(revisions);
  expect(raw(db => db.prepare('SELECT * FROM seen_operation_entries').all())).toEqual(entries);
});

it('composite foreign keys reject cross-discussion operation entries', () => {
  const operation = required(bulk(true).undo);
  raw(db => {
    const insert = db.prepare('INSERT INTO seen_operation_entries VALUES (?,?,?,?)');
    expect(() => insert.run(operation.id, 'video-demo', 'p1', 1)).toThrow();
    expect(() => insert.run(operation.id, 'post-demo', 'p1', 1)).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

it('Refresh preserves ownership and later discoveries are outside earlier bulk/Undo; removal cascades recovery', () => {
  const extraction = normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), id = required(repository.ingest(extraction).itemId);
  const before = state().comments[id];
  const result = bulk(true, id);
  repository.ingest(normalizeYtDlp(JSON.stringify({ ...fixture.raw, comments: [...fixture.raw.comments, { ...fixture.raw.comments[0], id: 'post-operation-comment', parent: 'root' }] }), fixture.context));
  expect(state().seenUndo[id]).toEqual(result.undo);
  const newComment = required(state().comments[id].find(comment => comment.source.commentId === 'post-operation-comment'));
  expect(newComment.seen).toBe(false);
  expect(repository.undoSeen(id)).toMatchObject({ restored: result.changedCount, skipped: 0 });
  expect(state().comments[id].filter(comment => comment.id !== newComment.id)).toEqual(before.map(comment => ({ ...comment, discovery: required(state().comments[id].find(row => row.id === comment.id)).discovery })));
  bulk(true, id); repository.removeLibraryItem(id, ['en']);
  raw(db => {
    expect(db.prepare('SELECT * FROM seen_operations WHERE item_id=?').all(id)).toEqual([]);
    expect(db.prepare('SELECT * FROM seen_operation_entries WHERE item_id=?').all(id)).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

it('service validates exact bulk payloads before storage and admits legitimate 50k frozen IDs', async () => {
  const { ReaderService } = await import('../reader-service');
  const { isBulkSeenRequest } = await import('../../shared/reader-api');
  const service = new ReaderService(() => repository, ['en'], () => undefined);
  const valid: BulkSeenRequest = { itemId: 'video-demo', seen: true, target: { kind: 'all' } };
  for (const request of [{ ...valid, sql: 'evil' }, { ...valid, seen: 1 }, { ...valid, target: { kind: 'all', ids: [] } },
    { ...valid, target: { kind: 'publication' } }, { ...valid, target: Object.assign(Object.create({ kind: 'publication' }), { from: '2026-10-08' }) },
    { ...valid, target: { kind: 'matching', ids: ['v1', 'p1'] } },
    { ...valid, target: { kind: 'matching', ids: ['v1', 'v1'] } }]) expect(service.dispatch('bulkSeen', [request])).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('undoSeen', [{ itemId: 'video-demo', extra: true }])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(isBulkSeenRequest({ ...valid, target: { kind: 'matching', ids: Array.from({ length: 50000 }, (_, index) => `id-${index}`) } })).toBe(true);
  expect(isBulkSeenRequest({ ...valid, target: { kind: 'matching', ids: Array.from({ length: 100001 }, (_, index) => `id-${index}`) } })).toBe(false);
});

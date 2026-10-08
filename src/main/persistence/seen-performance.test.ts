import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ReaderRepository } from './reader-repository';
import { normalizeYtDlp } from '../extractors/yt-dlp';
import { resolvePublication } from '../../domain/publication-filter';
import { required } from '../../renderer/testing/required';
import { ownPublicationInstant, publicationMatches } from '../../domain/publication-predicate';

/** Generated disposable SQLite measurements, never arbitrary CI latency budgets.
 * Isolated write/log replay rolls back; end-to-end timings use real commands. */
it.each([10000, 50000])('%i changed comments remain atomic with bounded one-shot recovery', count => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'reader-seen-scale-')), file = path.join(directory, 'reader.sqlite');
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-seen-scale-')) throw new Error('Unsafe cleanup');
  const repository = ReaderRepository.open(file);
  let db: DatabaseSync | undefined;
  try {
    const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
    const generated = Array.from({ length: count }, (_, index) => ({ id: `large-${index}`, parent: index ? 'large-0' : 'root', text: `Generated comment ${index}`, timestamp: 1790856000 }));
    const id = required(repository.ingest(normalizeYtDlp(JSON.stringify({ ...fixture.raw, comments: generated }), fixture.context)).itemId);
    const stored = repository.bootstrap(['en']).comments[id];
    const beginTarget = performance.now();
    const resolved = resolvePublication({ kind: 'custom', from: '2026-10-01', to: '2026-10-01' }, { now: Date.now(), timeZone: 'Europe/Warsaw' });
    if (!resolved.ok) throw new Error('Invalid benchmark dates');
    const targets = stored.filter(comment => publicationMatches(ownPublicationInstant(comment.publishedAt), resolved.bounds));
    const publicationTargetMs = performance.now() - beginTarget;
    expect(targets).toHaveLength(count);
    db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
    const failureId = required(db.prepare('SELECT id FROM comments WHERE item_id=? AND source_comment_id=?').get(id, `large-${count - 1}`)?.id);
    if (typeof failureId !== 'string' || !/^[a-z0-9-]+$/.test(failureId)) throw new Error('Expected generated UUID');
    db.exec(`CREATE TRIGGER fail_large BEFORE UPDATE ON comment_state WHEN NEW.comment_id='${failureId}' BEGIN SELECT RAISE(ABORT,'late large failure'); END`);
    expect(() => repository.bulkSeen({ itemId: id, seen: true, target: { kind: 'all' } })).toThrow('late large failure');
    expect(db.prepare('SELECT sum(seen) AS n FROM comment_state').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM seen_operation_entries').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM seen_operations').get()?.n).toBe(0);
    db.exec('DROP TRIGGER fail_large');
    const beforeBytes = statSync(file).size, beginBulk = performance.now();
    const result = repository.bulkSeen({ itemId: id, seen: true, target: { kind: 'all' } });
    const bulkCommitAckMs = performance.now() - beginBulk;
    expect(result.changedCount).toBe(count); expect(result.undo?.changedCount).toBe(count);
    const recoveryGrowthBytes = statSync(file).size - beforeBytes;
    const entries = db.prepare('SELECT * FROM seen_operation_entries').all();
    expect(entries).toHaveLength(count); expect(db.prepare('SELECT count(*) AS n FROM seen_operations').get()?.n).toBe(1);
    db.exec('BEGIN IMMEDIATE; DELETE FROM seen_operation_entries');
    const insert = db.prepare('INSERT INTO seen_operation_entries VALUES (?,?,?,?)'), beginEntries = performance.now();
    for (const entry of entries) insert.run(entry.operation_id, entry.item_id, entry.comment_id, entry.written_revision);
    const recoveryEntryReplayMs = performance.now() - beginEntries;
    db.exec('ROLLBACK; BEGIN IMMEDIATE');
    const update = db.prepare('UPDATE comment_state SET seen=0,revision=revision+1 WHERE comment_id=?'), beginWrites = performance.now();
    for (const entry of entries) update.run(entry.comment_id);
    const stateWriteReplayMs = performance.now() - beginWrites;
    db.exec('ROLLBACK');
    const beginUndo = performance.now(), undo = repository.undoSeen(id), undoCommitAckMs = performance.now() - beginUndo;
    expect(undo).toMatchObject({ restored: count, skipped: 0, undo: null });
    expect(undo.comments.every(comment => !comment.seen)).toBe(true);
    expect(db.prepare('SELECT count(*) AS n FROM seen_operation_entries').get()?.n).toBe(0);
    const subtree = repository.toggleSeen({ itemId: id, commentId: stored[0].id, subtree: true });
    expect(subtree).toMatchObject({ targetCount: count, changedCount: count, undo: { kind: 'subtree', changedCount: count } });
    expect(repository.undoSeen(id)).toMatchObject({ restored: count, skipped: 0 });
    const matching = repository.bulkSeen({ itemId: id, seen: true, target: { kind: 'matching', ids: stored.map(comment => comment.id) } });
    expect(matching).toMatchObject({ targetCount: count, changedCount: count, undo: { kind: 'matching' } });
    expect(repository.undoSeen(id)).toMatchObject({ restored: count, skipped: 0 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    console.log(JSON.stringify({ seenScale: count, publicationTargetMs, stateWriteReplayMs, recoveryEntryReplayMs, bulkCommitAckMs, undoCommitAckMs, recoveryGrowthBytes }));
  } finally {
    db?.close(); repository.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 60000);

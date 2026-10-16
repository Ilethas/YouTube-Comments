import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository, InvalidSeenTargetError } from './reader-repository';
import { migrations, migrateDatabase } from './migrations';
import { downgradeSelectionFixture } from './testing/schema-10';
import { validateBackup } from './backup-validation';
import { protectBeforeMigration, prepareRestore, recoveryDirectory, installRestore, recoverProfile } from './profile-restore';
import { isBulkSeenRequest, isPreferenceChange } from '../../shared/reader-api';
import type { BulkSeenRequest } from '../../domain/seen-operation';
import { ReaderService } from '../reader-service';

let directory: string, file: string, repo: ReaderRepository;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-selection-'));
  file = path.join(directory, 'reader.sqlite'); repo = ReaderRepository.open(file); repo.initializeDemo();
});
afterEach(() => {
  repo.close();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-selection-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function raw<T>(fn: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON');
  try { return fn(db); } finally { db.close(); }
}
const bootstrap = () => repo.bootstrap(['en']);
const request = (seen: boolean, reason: 'selected' | 'view-prefix' = 'selected', ids = ['v1', 'v2', 'v3']): BulkSeenRequest => ({ itemId: 'video-demo', seen, target: { kind: 'explicit', reason, ids } });

it('defaults to on-demand and includes hidden replies; exact main-owned preferences survive restart without changing other data', () => {
  const before = bootstrap();
  expect(before.preferences).toMatchObject({ selectionControls: 'on-demand', includeCollapsedInPrefix: true });
  repo.updatePreferences({ locale: 'pl' }, ['en']); repo.updatePreferences({ appearance: 'dark' }, ['en']);
  repo.updatePreferences({ translationTarget: 'de' }, ['en']);
  repo.updatePreferences({ selectionControls: 'always' }, ['en']); repo.updatePreferences({ includeCollapsedInPrefix: false }, ['en']);
  repo.close(); repo = ReaderRepository.open(file);
  expect(bootstrap().preferences).toEqual({ locale: 'pl', appearance: 'dark', translationTarget: 'de', selectionControls: 'always', includeCollapsedInPrefix: false });
  expect(bootstrap().comments).toEqual(before.comments);
  for (const bad of [{ selectionControls: 'sometimes' }, { selectionControls: 'always', ids: ['v1'] }, { includeCollapsedInPrefix: 1 }, { includeCollapsedInPrefix: true, locale: 'pl' }]) expect(isPreferenceChange(bad)).toBe(false);
});

it.each(['selected', 'view-prefix'] as const)('%s boolean assignments target only IDs and preserve no-op recovery, discovery and collapse; partial Undo protects later revisions', reason => {
  repo.setDiscussionCollapse({ itemId: 'video-demo', kind: 'comments', ids: ['v1'], collapsed: true });
  const before = bootstrap(), history = repo.history();
  const result = repo.bulkSeen(request(true, reason));
  expect(result).toMatchObject({ targetCount: 3, undo: { kind: reason } });
  expect(result.comments.filter(row => ['v1', 'v2', 'v3'].includes(row.id)).every(row => row.seen)).toBe(true);
  expect(result.comments.filter(row => !['v1', 'v2', 'v3'].includes(row.id))).toEqual(before.comments['video-demo'].filter(row => !['v1', 'v2', 'v3'].includes(row.id)));
  expect(repo.bulkSeen(request(true, reason)).undo).toEqual(result.undo);
  repo.toggleSeen({ itemId: 'video-demo', commentId: 'v3', subtree: false });
  repo.toggleSeen({ itemId: 'video-demo', commentId: 'v3', subtree: false });
  repo.close(); repo = ReaderRepository.open(file);
  const recovered = repo.undoSeen('video-demo');
  expect(recovered.skipped).toBe(1); expect(recovered.comments.find(row => row.id === 'v3')?.seen).toBe(true);
  expect(bootstrap().discussionCollapse).toEqual(before.discussionCollapse); expect(repo.history()).toEqual(history);
  expect(bootstrap().comments['post-demo']).toEqual(before.comments['post-demo']);
  const unread = repo.bulkSeen(request(false, reason));
  expect(unread.comments.filter(row => ['v1', 'v2', 'v3'].includes(row.id)).every(row => !row.seen)).toBe(true);
});

it('rejects duplicate, unowned, removed, oversized or malformed explicit scopes atomically before replacing recovery', () => {
  repo.bulkSeen(request(true)); const before = bootstrap();
  const bad: unknown[] = [request(false, 'selected', ['v1', 'v1']), request(false, 'selected', ['v1', 'p1']),
    request(false, 'view-prefix', ['v1', 'missing']), request(false, 'selected', []),
    { ...request(false), target: { kind: 'explicit', reason: 'arbitrary', ids: ['v1'] } }];
  for (const value of bad) {
    expect(() => repo.bulkSeen(value as BulkSeenRequest)).toThrow(InvalidSeenTargetError); expect(bootstrap()).toEqual(before);
  }
  expect(isBulkSeenRequest(request(true, 'selected', Array.from({ length: 50000 }, (_, index) => `id-${index}`)))).toBe(true);
  expect(isBulkSeenRequest(request(true, 'selected', Array.from({ length: 100001 }, (_, index) => `id-${index}`)))).toBe(false);
  const service = new ReaderService(() => repo, ['en'], vi.fn());
  expect(service.dispatch('bulkSeen', [{ ...request(false), itemId: 'removed' }])).toMatchObject({ error: { code: 'NOT_FOUND' } });
  raw(db => db.exec("CREATE TRIGGER fail_selected BEFORE UPDATE ON comment_state WHEN NEW.comment_id='v2' BEGIN SELECT RAISE(ABORT,'late selected failure'); END"));
  expect(() => repo.bulkSeen(request(false))).toThrow('late selected failure');
  expect(bootstrap()).toEqual(before);
});

it('schema 10 upgrade preserves populated recoverable operations and child entries, with pre-migration safety and immutable staged backup', async () => {
  repo.updatePreferences({ locale: 'pl' }, ['en']); repo.updatePreferences({ appearance: 'dark' }, ['en']);
  repo.updatePreferences({ translationTarget: 'de' }, ['en']);
  repo.setDiscussionCollapse({ itemId: 'video-demo', kind: 'comments', ids: ['v1'], collapsed: true });
  repo.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  repo.toggleSeen({ itemId: 'video-demo', commentId: 'v3', subtree: false });
  repo.toggleSeen({ itemId: 'video-demo', commentId: 'v3', subtree: false });
  const before = bootstrap(), history = repo.history(); repo.close();
  const entries = raw(db => { downgradeSelectionFixture(db); return db.prepare('SELECT * FROM seen_operation_entries').all(); });
  expect(entries.length).toBeGreaterThan(0); expect(validateBackup(file)).toBe(10);
  const bytes = readFileSync(file); await protectBeforeMigration(file);
  const snapshots = readdirSync(recoveryDirectory(file)); expect(snapshots).toHaveLength(1);
  const safety = path.join(recoveryDirectory(file), snapshots[0]); expect(validateBackup(safety)).toBe(10);
  const staged = await prepareRestore(safety, file); expect(validateBackup(path.join(staged, 'candidate.sqlite'))).toBe(11);
  expect(readFileSync(file)).toEqual(bytes);
  repo = ReaderRepository.open(file); expect(bootstrap()).toEqual(before); expect(repo.history()).toEqual(history);
  raw(db => { expect(db.prepare('SELECT * FROM seen_operation_entries').all()).toEqual(entries); expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); });
  expect(repo.undoSeen('video-demo')).toMatchObject({ skipped: 1, restored: entries.length - 1 });
}, 15000);

it('a failure after rebuilding the Undo parent rolls back preferences, parent, entries, constraints and version together', () => {
  repo.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } }); repo.close();
  raw(db => {
    downgradeSelectionFixture(db);
    const entries = db.prepare('SELECT * FROM seen_operation_entries').all(), operations = db.prepare('SELECT * FROM seen_operations').all();
    expect(() => migrateDatabase(db, [...migrations.slice(0, 10), { version: 11, apply: target => { migrations[10].apply(target); throw new Error('migration failed'); } }])).toThrow('migration failed');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);
    expect(db.prepare('SELECT * FROM seen_operation_entries').all()).toEqual(entries);
    expect(db.prepare('SELECT * FROM seen_operations').all()).toEqual(operations);
    expect(db.prepare('PRAGMA table_info(preferences)').all().some(row => row.name === 'selection_controls')).toBe(false);
    migrateDatabase(db); expect(db.prepare('SELECT * FROM seen_operation_entries').all()).toEqual(entries);
  });
  expect(validateBackup(file)).toBe(11); repo = ReaderRepository.open(file);
  expect(repo.undoSeen('video-demo').restored).toBeGreaterThan(0);
});

it('full snapshot restore preserves explicit Undo metadata, both preferences and sparse collapse through restart', async () => {
  repo.bulkSeen(request(false, 'view-prefix'));
  repo.updatePreferences({ selectionControls: 'always' }, ['en']); repo.updatePreferences({ includeCollapsedInPrefix: false }, ['en']);
  repo.setDiscussionCollapse({ itemId: 'video-demo', kind: 'comments', ids: ['v1'], collapsed: true });
  const before = bootstrap(), snapshot = path.join(directory, 'snapshot.sqlite'); await repo.createBackup(snapshot);
  const stage = await prepareRestore(snapshot, file);
  repo.bulkSeen(request(true)); repo.updatePreferences({ includeCollapsedInPrefix: true }, ['en']);
  await repo.createBackup(path.join(stage, 'safety.sqlite')); repo.prepareOffline(); repo.close();
  await installRestore(file, stage); expect(await recoverProfile(file)).toBe('restored');
  repo = ReaderRepository.open(file); expect(bootstrap()).toEqual(before);
  expect(repo.undoSeen('video-demo').restored).toBeGreaterThan(0);
}, 15000);

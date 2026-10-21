import { legacyComparableState , viewVersion } from '../testing/view-identity';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './reader-repository';
import { ReaderService } from '../reader-service';
import { migrations, migrateDatabase } from './migrations';
import { downgradeCustomTranslationFixture } from './testing/schema-10';
import { validateBackup } from './backup-validation';
import { installRestore, prepareRestore, protectBeforeMigration, recoveryDirectory } from './profile-restore';
import { defaultQuery } from '../../domain/discussion-query';

let directory: string, file: string, repo: ReaderRepository;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-custom-translation-'));
  file = path.join(directory, 'reader.sqlite'); repo = ReaderRepository.open(file); repo.initializeDemo();
});
afterEach(() => {
  repo.close();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-custom-translation-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function raw<T>(action: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON');
  try { return action(db); } finally { db.close(); }
}
const prefs = () => repo.preferences(['en']);
it('defaults to app, rejects activation without saved code, preserves code across presets/restart, and rolls back failed atomic saves', () => {
  const before = repo.bootstrap(['en']), service = new ReaderService(() => repo, ['en'], vi.fn());
  expect(prefs().translationTarget).toBe('app'); expect(prefs().customTranslationTarget).toBeUndefined();
  expect(service.dispatch('updatePreferences', [{ translationTarget: 'custom' }])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  for (const code of ['auto', 'https://example.com', 'tl=uk', 'en&text=private', '', 'a'.repeat(36)]) {
    expect(service.dispatch('updatePreferences', [{ translationTarget: 'custom', customTranslationTarget: code }])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    expect(repo.bootstrap(['en'])).toEqual(before);
  }
  expect(service.dispatch('updatePreferences', [{ translationTarget: 'custom', customTranslationTarget: '  uk  ' }])).toMatchObject({ value: { translationTarget: 'custom', customTranslationTarget: 'uk' } });
  repo.updatePreferences({ translationTarget: 'fr' }, ['en']); expect(prefs().customTranslationTarget).toBe('uk');
  repo.updatePreferences({ translationTarget: 'custom' }, ['en']); repo.close(); repo = ReaderRepository.open(file);
  expect(prefs()).toMatchObject({ translationTarget: 'custom', customTranslationTarget: 'uk' });
  const committed = prefs();
  raw(db => db.exec("CREATE TRIGGER fail_custom BEFORE UPDATE ON preferences BEGIN SELECT RAISE(ABORT,'failed custom save'); END"));
  expect(() => repo.updatePreferences({ translationTarget: 'custom', customTranslationTarget: 'zh-TW' }, ['en'])).toThrow('failed custom save');
  expect(prefs()).toEqual(committed);
  expect(() => repo.updatePreferences({ translationTarget: 'custom', customTranslationTarget: 'auto' }, ['en'])).toThrow();
  expect(prefs()).toEqual(committed); expect(repo.bootstrap(['en']).comments).toEqual(before.comments);
});
it('schema 11 migration preserves every preference, content/history/Undo/workspace and views; old backups stage immutably', async () => {
  for (const change of [{ locale: 'pl' }, { appearance: 'dark' }, { translationTarget: 'fr' }, { selectionControls: 'always' }, { includeCollapsedInPrefix: false }] as const) repo.updatePreferences(change, ['en']);
  repo.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  repo.setDiscussionCollapse({ ...viewVersion(repo, 'video-demo', 'collapse'), kind: 'all', collapsed: true });
  repo.saveDiscussionView({ ...viewVersion(repo, 'video-demo', 'intent'), draft: defaultQuery, applied: defaultQuery, sort: 'newest', anchor: { commentId: 'v1', offset: 7 }, selected: 'v2' });
  const before = repo.bootstrap(['en']), history = repo.history(); repo.close();
  raw(downgradeCustomTranslationFixture); expect(validateBackup(file)).toBe(11);
  const bytes = readFileSync(file); await protectBeforeMigration(file);
  const safety = path.join(recoveryDirectory(file), readdirSync(recoveryDirectory(file))[0]); expect(validateBackup(safety)).toBe(11);
  const staged = await prepareRestore(safety, file); expect(validateBackup(path.join(staged, 'candidate.sqlite'))).toBe(15);
  expect(readFileSync(file)).toEqual(bytes);
  repo = ReaderRepository.open(file); expect(legacyComparableState(repo.bootstrap(['en']))).toEqual(legacyComparableState(before)); expect(repo.history()).toEqual(history);
  raw(db => expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]));
}, 30000);
it('migration failure rolls back the table rebuild, all preference fields and version', () => {
  repo.close(); raw(db => {
    downgradeCustomTranslationFixture(db); const before = db.prepare('SELECT * FROM preferences').all();
    expect(() => migrateDatabase(db, [...migrations.slice(0, 11), { version: 12, apply: target => { migrations[11].apply(target); throw new Error('migration failed'); } }])).toThrow();
    expect(db.prepare('SELECT * FROM preferences').all()).toEqual(before); expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(11);
  }); expect(validateBackup(file)).toBe(11); repo = ReaderRepository.open(file);
});
it('backup/restore includes custom targets and semantic query times with no seen changes', async () => {
  repo.updatePreferences({ translationTarget: 'custom', customTranslationTarget: 'mni-Mtei' }, ['en']);
  const query = { ...defaultQuery, publication: { kind: 'custom' as const, from: '2026-10-16', fromTime: '14:30', to: '2026-10-17', toTime: '09:15' } };
  repo.saveDiscussionView({ ...viewVersion(repo, 'video-demo', 'intent'), draft: query, applied: query, sort: 'original', anchor: { commentId: null, offset: 0 }, selected: null });
  const before = repo.bootstrap(['en']), snapshot = path.join(directory, 'backup.sqlite'); await repo.createBackup(snapshot);
  repo.updatePreferences({ translationTarget: 'en' }, ['en']);
  const staged = await prepareRestore(snapshot, file); await repo.createBackup(path.join(staged, 'safety.sqlite'));
  repo.prepareOffline(); repo.close(); await installRestore(file, staged);
  repo = ReaderRepository.open(file); expect(repo.bootstrap(['en'])).toEqual(before); expect(validateBackup(file)).toBe(15);
}, 30000);

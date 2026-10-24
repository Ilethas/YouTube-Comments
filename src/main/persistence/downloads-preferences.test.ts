import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './reader-repository';
import { migrations, migrateDatabase, schemaVersion } from './migrations';
import { validateBackup } from './backup-validation';
import { prepareRestore, protectBeforeMigration, recoveryDirectory } from './profile-restore';
import { isPreferenceChange } from '../../shared/reader-api';

let root: string, file: string, repo: ReaderRepository | undefined;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'reader-download-prefs-')); file = path.join(root, 'reader.sqlite'); });
afterEach(() => {
  repo?.close(); repo = undefined;
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-download-prefs-')) throw Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
});
it('migrates schema 16 additively after a verified exact safety backup and stages older restores', async () => {
  const db = new DatabaseSync(file); migrateDatabase(db, migrations.slice(0, 16));
  db.exec("UPDATE preferences SET locale='pl',appearance='charcoal',notification_dismissal='manual',notification_duration_seconds=30");
  const old = db.prepare('SELECT * FROM preferences').get(); db.close();
  const bytes = readFileSync(file); await protectBeforeMigration(file);
  expect(readFileSync(file)).toEqual(bytes);
  const safety = readdirSync(recoveryDirectory(file)).find(name => name.startsWith('pre-migration-'));
  const backup = path.join(recoveryDirectory(file), String(safety)); expect(validateBackup(backup)).toBe(16); const safetyBytes = readFileSync(backup);
  repo = ReaderRepository.open(file); expect(repo.preferences(['en'])).toMatchObject({ maximumConcurrentDownloads: 3, locale: 'pl', notificationDismissal: 'manual' });
  repo.close(); repo = undefined;
  const migrated = new DatabaseSync(file); expect(migrated.prepare('SELECT * FROM preferences').get()).toEqual({ ...old, maximum_concurrent_downloads: 3 }); migrated.close();
  const staging = await prepareRestore(backup, file); expect(validateBackup(path.join(staging, 'candidate.sqlite'))).toBe(schemaVersion); expect(readFileSync(backup)).toEqual(safetyBytes);
});
it('persists every allowed limit, publishes preferences commits and round trips through backup/reopen', async () => {
  repo = ReaderRepository.open(file); repo.initializeDemo(); const commits: string[] = []; repo.onCommit(commit => commits.push(commit.change.kind));
  for (const limit of [1, 2, 3, 4] as const) expect(repo.updatePreferences({ maximumConcurrentDownloads: limit }, ['en']).maximumConcurrentDownloads).toBe(limit);
  expect(commits).toEqual(['preferences', 'preferences', 'preferences', 'preferences']);
  const state = repo.bootstrap(['en']); const backup = path.join(root, 'backup.sqlite'); await repo.createBackup(backup);
  const staging = await prepareRestore(backup, file); const restored = ReaderRepository.open(path.join(staging, 'candidate.sqlite'));
  expect(restored.bootstrap(['en'])).toEqual(state); restored.close();
  repo.close(); repo = ReaderRepository.open(file); expect(repo.preferences(['en']).maximumConcurrentDownloads).toBe(4);
});
it('rolls back a failing forward migration; validates exact IPC shapes and SQLite bounds', () => {
  const db = new DatabaseSync(file); migrateDatabase(db, migrations.slice(0, 16));
  expect(() => migrateDatabase(db, [...migrations.slice(0, 16), { version: 17, apply: value => { migrations[16].apply(value); throw Error('injected'); } }])).toThrow('injected');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(16);
  expect(Object.hasOwn(db.prepare('SELECT * FROM preferences').get() ?? {}, 'maximum_concurrent_downloads')).toBe(false);
  migrateDatabase(db);
  for (const limit of [0, 5, -1, 1.5, '3', null, true]) {
    expect(isPreferenceChange({ maximumConcurrentDownloads: limit })).toBe(false);
    if (typeof limit === 'number') expect(() => db.prepare('UPDATE preferences SET maximum_concurrent_downloads=?').run(limit)).toThrow();
  }
  for (const limit of [1, 2, 3, 4]) expect(isPreferenceChange({ maximumConcurrentDownloads: limit })).toBe(true);
  expect(isPreferenceChange({ maximumConcurrentDownloads: 3, locale: 'en' })).toBe(false); db.close();
});

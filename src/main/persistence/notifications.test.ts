import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './reader-repository';
import { migrations, migrateDatabase, schemaVersion } from './migrations';
import { validateBackup } from './backup-validation';
import { prepareRestore, protectBeforeMigration, recoveryDirectory } from './profile-restore';
import { defaultNotificationPreferences, notificationDurations } from '../../shared/preferences';
import { isPreferenceChange } from '../../shared/reader-api';

let root: string, file: string, repo: ReaderRepository | undefined;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'reader-notifications-')); file = path.join(root, 'reader.sqlite'); });
afterEach(() => {
  repo?.close(); repo = undefined;
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-notifications-')) throw Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
});
it('migrates v15 additively, preserving preferences/data/topology and an exact verified safety backup', async () => {
  const db = new DatabaseSync(file); migrateDatabase(db, migrations.slice(0, 15));
  db.exec("UPDATE preferences SET locale='pl',appearance='charcoal',translation_target='custom',custom_translation_target='uk',selection_controls='always',include_collapsed_in_prefix=0");
  const rows = (value: DatabaseSync) => value.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='preferences' ORDER BY name").all()
    .map(row => [row.name, value.prepare(`SELECT * FROM ${row.name}`).all()]);
  const before = rows(db), preferences = db.prepare('SELECT * FROM preferences').get(); db.close();
  const bytes = readFileSync(file); await protectBeforeMigration(file); expect(readFileSync(file)).toEqual(bytes);
  const safety = readdirSync(recoveryDirectory(file)).find(name => name.startsWith('pre-migration-'));
  expect(validateBackup(path.join(recoveryDirectory(file), String(safety)))).toBe(15);
  repo = ReaderRepository.open(file); expect(repo.preferences(['en'])).toMatchObject(defaultNotificationPreferences); repo.close(); repo = undefined;
  const migrated = new DatabaseSync(file); expect(rows(migrated)).toEqual(before);
  expect(migrated.prepare('SELECT * FROM preferences').get()).toEqual({ ...preferences, notification_dismissal: 'automatic', notification_duration_seconds: 5, maximum_concurrent_downloads: 3 }); migrated.close();
  expect(validateBackup(file)).toBe(schemaVersion);
});
it('acknowledges both modes and every duration, publishes shared preference commits, reopens and backs up/restores', async () => {
  repo = ReaderRepository.open(file); repo.initializeDemo(); const commits: string[] = []; repo.onCommit(commit => commits.push(commit.change.kind));
  expect(repo.preferences(['en'])).toMatchObject(defaultNotificationPreferences);
  for (const mode of ['manual', 'automatic'] as const) {
    expect(repo.updatePreferences({ notificationDismissal: mode }, ['en']).notificationDismissal).toBe(mode);
    for (const seconds of notificationDurations) expect(repo.updatePreferences({ notificationDurationSeconds: seconds }, ['en']))
      .toMatchObject({ notificationDismissal: mode, notificationDurationSeconds: seconds });
  }
  repo.updatePreferences({ notificationDismissal: 'manual' }, ['en']);
  expect(commits).toHaveLength(13); expect(commits.every(kind => kind === 'preferences')).toBe(true);
  const before = repo.bootstrap(['en']); const backup = path.join(root, 'backup.sqlite'); await repo.createBackup(backup);
  const staging = await prepareRestore(backup, file), candidate = path.join(staging, 'candidate.sqlite');
  expect(validateBackup(candidate)).toBe(schemaVersion);
  const restored = ReaderRepository.open(candidate); expect(restored.preferences(['en'])).toEqual(before.preferences); restored.close();
  repo.close(); repo = ReaderRepository.open(file); expect(repo.bootstrap(['en'])).toEqual(before);
});
it('validates old backups and upgrades only a staged v15 copy', async () => {
  const db = new DatabaseSync(file); migrateDatabase(db, migrations.slice(0, 15)); db.close();
  const live = path.join(root, 'other.sqlite'); ReaderRepository.open(live).close();
  const bytes = readFileSync(file); const staging = await prepareRestore(file, live);
  expect(validateBackup(path.join(staging, 'candidate.sqlite'))).toBe(schemaVersion); expect(readFileSync(file)).toEqual(bytes); expect(validateBackup(file)).toBe(15);
});
it('rolls back a failed forward migration and rejects invalid IPC and SQLite values', () => {
  const db = new DatabaseSync(file); migrateDatabase(db, migrations.slice(0, 15)); const before = db.prepare('SELECT * FROM preferences').get();
  expect(() => migrateDatabase(db, [...migrations.slice(0, 15), { version: 16, apply: value => { migrations[15].apply(value); throw Error('fail'); } }])).toThrow('fail');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(15); expect(db.prepare('SELECT * FROM preferences').get()).toEqual(before);
  migrateDatabase(db);
  for (const value of [0, 4, 31, 3.5, '5', null, true]) {
    expect(isPreferenceChange({ notificationDurationSeconds: value })).toBe(false);
    if (typeof value === 'number') expect(() => db.prepare('UPDATE preferences SET notification_duration_seconds=?').run(value)).toThrow();
  }
  for (const value of ['forever', '', 1, null]) expect(isPreferenceChange({ notificationDismissal: value })).toBe(false);
  expect(isPreferenceChange({ notificationDismissal: 'manual', locale: 'en' })).toBe(false);
  expect(isPreferenceChange({ notificationDismissal: 'manual' })).toBe(true);
  for (const value of notificationDurations) expect(isPreferenceChange({ notificationDurationSeconds: value })).toBe(true);
  expect(() => db.exec("UPDATE preferences SET notification_dismissal='invalid'")).toThrow(); db.close();
});

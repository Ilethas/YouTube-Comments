import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository, StateConflictError } from './reader-repository';
import { migrations, migrateDatabase } from './migrations';
import { validateBackup } from './backup-validation';
import { prepareRestore, protectBeforeMigration, recoveryDirectory } from './profile-restore';
import { builtinThemes, defaultReaderAppearance } from '../../shared/appearance';

let root: string, file: string, repo: ReaderRepository | undefined;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'reader-appearance-db-')); file = path.join(root, 'reader.sqlite'); });
afterEach(() => { repo?.close(); repo = undefined; if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-appearance-db-')) throw Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true }); });
it('preserves v14 preferences, topology and data with verified pre-migration safety', async () => {
  const db = new DatabaseSync(file); migrateDatabase(db, migrations.slice(0, 14));
  db.exec("UPDATE preferences SET locale='pl',appearance='dark',translation_target='custom',custom_translation_target='uk',selection_controls='always',include_collapsed_in_prefix=0");
  const preferences = db.prepare('SELECT * FROM preferences').get(), windows = db.prepare('SELECT * FROM app_windows').all(); db.close();
  const bytes = readFileSync(file); await protectBeforeMigration(file);
  const safety = readdirSync(recoveryDirectory(file)).find(name => name.startsWith('pre-migration-'));
  expect(safety).toBeTruthy(); expect(validateBackup(path.join(recoveryDirectory(file), String(safety)))).toBe(14); expect(readFileSync(file)).toEqual(bytes);
  repo = ReaderRepository.open(file); expect(repo.readerAppearance()).toEqual(defaultReaderAppearance); repo.close(); repo = undefined;
  const migrated = new DatabaseSync(file); expect(migrated.prepare('SELECT * FROM preferences').get()).toEqual(preferences); expect(migrated.prepare('SELECT * FROM app_windows').all()).toEqual(windows); migrated.close();
  expect(validateBackup(file)).toBe(15);
});
it('persists themes and wallpaper intent, publishes preferences, fences stale peers and deletes safely', async () => {
  repo = ReaderRepository.open(file); const commits: string[] = []; repo.onCommit(commit => commits.push(commit.change.kind));
  repo.importTheme(builtinThemes.charcoal, ['en'], 0); const selected = repo.readerAppearance();
  expect(repo.preferences(['en']).appearance).toBe('custom'); expect(selected.themes).toHaveLength(1);
  repo.importWallpaper('a'.repeat(64), ['en'], selected.revision);
  const current = repo.readerAppearance();
  const request = { expectedRevision: current.revision, customThemeId: current.customThemeId, wallpaperEnabled: true, surfaceOpacity: 100, blur: 0 };
  repo.updatePreferences({ appearance: 'charcoal' }, ['en']); repo.updatePreferences({ readerAppearance: request }, ['en']);
  expect(repo.preferences(['en']).appearance).toBe('charcoal');
  expect(() => repo?.updatePreferences({ readerAppearance: request }, ['en'])).toThrow(StateConflictError);
  const backup = path.join(root, 'backup.sqlite'); await repo.createBackup(backup); const before = repo.preferences(['en']);
  const staging = await prepareRestore(backup, file); expect(validateBackup(path.join(staging, 'candidate.sqlite'))).toBe(15);
  repo.close(); repo = ReaderRepository.open(file); expect(repo.preferences(['en'])).toEqual(before);
  repo.updatePreferences({ appearance: 'custom' }, ['en']); repo.updatePreferences({ deleteTheme: { id: String(current.customThemeId), expectedRevision: repo.readerAppearance().revision } }, ['en']);
  expect(repo.preferences(['en']).appearance).toBe('system'); expect(repo.readerAppearance().themes).toEqual([]);
  repo.updatePreferences({ removeWallpaper: { expectedRevision: repo.readerAppearance().revision } }, ['en']); expect(repo.readerAppearance().wallpaperId).toBeNull();
  expect(commits.every(kind => kind === 'preferences')).toBe(true);
});
it('rolls migration 15 back without modifying earlier tables', () => {
  const db = new DatabaseSync(file); migrateDatabase(db, migrations.slice(0, 14));
  const before = db.prepare('SELECT * FROM preferences').all();
  expect(() => migrateDatabase(db, [...migrations.slice(0, 14), { version: 15, apply: value => { migrations[14].apply(value); throw Error('fail'); } }])).toThrow('fail');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(14); expect(db.prepare('SELECT * FROM preferences').all()).toEqual(before);
  expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='reader_appearance'").get()).toBeUndefined(); db.close();
});
it('rejects modified stored theme CSS in a backup and keeps profiles independent', async () => {
  repo = ReaderRepository.open(file); repo.importTheme(builtinThemes.dark, ['en'], 0);
  const other = ReaderRepository.open(path.join(root, 'other.sqlite')); expect(other.readerAppearance()).toEqual(defaultReaderAppearance); other.close();
  repo.close(); repo = undefined;
  const db = new DatabaseSync(file), state = JSON.parse(String(db.prepare('SELECT config_json FROM reader_appearance').get()?.config_json));
  state.themes[0].definition.tokens.text = 'url(https://evil.test)'; db.prepare('UPDATE reader_appearance SET config_json=?').run(JSON.stringify(state)); db.close();
  expect(() => validateBackup(file)).toThrow();
});

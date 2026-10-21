import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository, ViewOwnershipError } from './reader-repository';
import { WindowSessionConflict } from './window-session';
import { migrations, migrateDatabase, schemaVersion } from './migrations';
import { validateBackup } from './backup-validation';
import { protectBeforeMigration, prepareRestore, installRestore, recoverProfile } from './profile-restore';
import type { WindowGeometry } from '../../domain/window-geometry';
const roots: string[] = [];
vi.setConfig({ testTimeout: 30000 });
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-m6-')) throw new Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
} });
function file() { const root = mkdtempSync(path.join(os.tmpdir(), 'reader-m6-')); roots.push(root); return path.join(root, 'reader.sqlite'); }
const geometry: WindowGeometry = { version: 1, normal: { x: -1800, y: 50, width: 1240, height: 900 }, maximized: true, fullscreen: false,
  display: { id: 'negative', workArea: { x: -1920, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.25 } };
it.each([2, 3, 7])('creates %i equal persistent windows with separate placement/active IDs and owned same-item views', count => {
  const repo = ReaderRepository.open(file()); repo.initializeDemo();
  try {
    const store = repo.nativeSession(), first = repo.initialWindowId(), ids = [first];
    for (let i = 1; i < count; i++) {
      const id = repo.createPersistentWindow(); ids.push(id);
      expect(repo.workspace(id)).toEqual({ tabs: [], activeTabId: null, revision: 0 });
      repo.changeWorkspace('openStoredItem', 'video-demo', undefined, id);
      repo.changeWorkspace('openLibrary', undefined, undefined, id);
      repo.changeWorkspace('openSettings', undefined, undefined, id);
    }
    expect(store.read().windowIds).toEqual(ids);
    const views = ids.map(id => Object.keys(repo.viewInstances(id))[0]);
    expect(new Set(views).size).toBe(count);
    expect(() => repo.viewSnapshot(first, views[1])).toThrow(ViewOwnershipError);
    expect(repo.workspace(first).tabs).toHaveLength(2);
    for (const id of ids.slice(1)) expect(repo.workspace(id).tabs).toHaveLength(3);
  } finally { repo.close(); }
});
it('durably excludes ordinary closed windows, retains the last and restores the acknowledged set after a crash', () => {
  const target = file(); let repo = ReaderRepository.open(target);
  const store = repo.nativeSession(), a = repo.initialWindowId(), b = store.create(), c = store.create();
  store.focused(c); store.closed(a);
  expect(store.read().windowIds).toEqual([b, c]);
  store.closed(c); expect(store.read()).toMatchObject({ windowIds: [b], lastFocusedId: b });
  store.closed(b); const expected = store.read(); repo.close();
  repo = ReaderRepository.open(target);
  try { expect(repo.nativeSession().read()).toEqual(expected); expect(repo.initialWindowId()).toBe(b); expect(repo.workspace().tabs).toEqual([]); }
  finally { repo.close(); }
});
it('Quit atomically records only live windows and focus, preserving dormant topology and exact tab IDs', () => {
  const repo = ReaderRepository.open(file()); repo.initializeDemo();
  try {
    const store = repo.nativeSession(), a = repo.initialWindowId(), b = store.create(), c = store.create();
    repo.changeWorkspace('openStoredItem', 'video-demo', undefined, b);
    const topology = repo.workspace(b); store.quit([c, b], b);
    expect(store.read()).toMatchObject({ windowIds: [c, b], lastFocusedId: b });
    expect(repo.workspace(b)).toEqual(topology); expect(repo.workspace(a).tabs).toHaveLength(2);
    store.quit([], undefined); expect(store.read().windowIds).toEqual([c, b]);
  } finally { repo.close(); }
});
it('New Window after macOS last-close replaces the retained dormant set and failed creation restores it', () => {
  const repo = ReaderRepository.open(file());
  try {
    const store = repo.nativeSession(), previous = store.read(), id = store.create(previous.revision, []);
    expect(store.read()).toMatchObject({ windowIds: [id], lastFocusedId: id });
    store.abandon(id, undefined, previous); expect(store.read().windowIds).toEqual(previous.windowIds);
  } finally { repo.close(); }
});
it('crash after provisional allocation and before native registration never adds an invisible restore member', () => {
  const target = file(); let repo = ReaderRepository.open(target);
  const before = repo.nativeSession().read(), provisional = repo.nativeSession().allocate(); repo.close();
  repo = ReaderRepository.open(target);
  try { expect(repo.nativeSession().read()).toEqual(before); expect(repo.workspace(provisional)).toEqual({ tabs: [], activeTabId: null, revision: 0 }); }
  finally { repo.close(); }
});
it('rejects stale membership and geometry CAS without commits, and failed provisional native creation never restores', () => {
  const repo = ReaderRepository.open(file());
  try {
    const store = repo.nativeSession(), initial = store.read(), id = store.create(initial.revision);
    expect(() => store.closed(initial.lastFocusedId, initial.revision)).toThrow(WindowSessionConflict);
    expect(store.saveGeometry(id, geometry, 0)).toBe(1);
    const stamp = repo.stamp();
    expect(() => store.saveGeometry(id, { ...geometry, fullscreen: true }, 0)).toThrow(WindowSessionConflict);
    expect(repo.stamp()).toEqual(stamp); expect(store.geometry(id)).toEqual({ revision: 1, geometry });
    store.abandon(id); expect(store.read().windowIds).toEqual(initial.windowIds);
  } finally { repo.close(); }
});
it('rolls back session and geometry COMMIT failures and rejects malformed backup metadata', () => {
  const target = file(), repo = ReaderRepository.open(target), store = repo.nativeSession(), before = store.read();
  const exec = DatabaseSync.prototype.exec;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) { if (sql === 'COMMIT') throw new Error('injected'); return exec.call(this, sql); });
  try { expect(() => store.create()).toThrow('injected'); expect(store.read()).toEqual(before); }
  finally { vi.restoreAllMocks(); repo.close(); }
  const db = new DatabaseSync(target); db.prepare('UPDATE window_geometry SET geometry_json=?').run('{"version":2}'); db.close();
  expect(() => validateBackup(target)).toThrow('INVALID_BACKUP');
});
it('v13 migration preserves every prior table, protects bytes and upgrades only staged historical backups', async () => {
  const target = file(), db = new DatabaseSync(target); migrateDatabase(db, migrations.slice(0, 13));
  const a = String(db.prepare('SELECT id FROM app_windows').get()?.id);
  db.prepare('INSERT INTO app_windows VALUES (?,NULL,0)').run('historical-dormant');
  const before = db.prepare('SELECT * FROM app_windows').all(); db.close(); const bytes = readFileSync(target);
  expect(validateBackup(target)).toBe(13); await protectBeforeMigration(target); expect(readFileSync(target)).toEqual(bytes);
  const other = path.join(path.dirname(target), 'other.sqlite'); ReaderRepository.open(other).close();
  const staging = await prepareRestore(target, other);
  expect(validateBackup(path.join(staging, 'candidate.sqlite'))).toBe(schemaVersion); expect(readFileSync(target)).toEqual(bytes);
  const repo = ReaderRepository.open(target);
  try { expect(repo.nativeSession().read()).toMatchObject({ windowIds: [a], lastFocusedId: a }); expect(repo.nativeSession().geometry(a)).toEqual({ revision: 0, geometry: null }); }
  finally { repo.close(); }
  const check = new DatabaseSync(target); expect(check.prepare('SELECT * FROM app_windows').all()).toEqual(before);
  expect(() => migrateDatabase(check, migrations.slice(0, 13))).toThrow('Unsupported database schema'); check.close();
});
it('full backup/restore retains the complete session, all independent views, empty workspaces and native state', async () => {
  const target = file(); let repo = ReaderRepository.open(target); repo.initializeDemo();
  const store = repo.nativeSession(), a = repo.initialWindowId(), b = store.create(), c = store.create();
  repo.changeWorkspace('openStoredItem', 'video-demo', undefined, b); store.saveGeometry(b, geometry, 0); store.focused(b);
  const before = store.read(), bTabs = repo.workspace(b), views = repo.viewInstances(b), snapshot = path.join(path.dirname(target), 'backup.sqlite');
  await repo.createBackup(snapshot); store.closed(a); store.closed(b);
  const staged = await prepareRestore(snapshot, target); await repo.createBackup(path.join(staged, 'safety.sqlite')); repo.prepareOffline(); repo.close();
  await installRestore(target, staged); expect(await recoverProfile(target)).toBe('restored'); repo = ReaderRepository.open(target);
  try {
    expect(repo.nativeSession().read()).toEqual(before); expect(repo.workspace(b)).toEqual(bTabs); expect(repo.viewInstances(b)).toEqual(views);
    expect(repo.workspace(c).tabs).toEqual([]); expect(repo.nativeSession().geometry(b)).toEqual({ revision: 1, geometry });
  } finally { repo.close(); }
});
it.each(['ddl', 'commit'])('migration 14 failure at %s preserves the exact v13 bytes and retries safely', stage => {
  const target = file(), db = new DatabaseSync(target); db.exec('PRAGMA foreign_keys=ON'); migrateDatabase(db, migrations.slice(0, 13)); db.close();
  const before = readFileSync(target), raw = new DatabaseSync(target); raw.exec('PRAGMA foreign_keys=ON');
  const exec = DatabaseSync.prototype.exec;
  if (stage === 'commit') vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function(this: DatabaseSync, sql: string) {
    if (sql === 'COMMIT') throw new Error('injected migration commit'); return exec.call(this, sql);
  });
  const last = migrations[13];
  try {
    expect(() => migrateDatabase(raw, [...migrations.slice(0, 13), { version: 14, apply: connection => { last.apply(connection); if (stage === 'ddl') throw new Error('injected DDL'); } }])).toThrow('injected');
    expect(raw.prepare('PRAGMA user_version').get()?.user_version).toBe(13);
    expect(raw.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'window_session%'").all()).toEqual([]);
  } finally { vi.restoreAllMocks(); raw.close(); }
  expect(readFileSync(target)).toEqual(before); expect(validateBackup(target)).toBe(13);
  ReaderRepository.open(target).close(); expect(validateBackup(target)).toBe(schemaVersion);
});

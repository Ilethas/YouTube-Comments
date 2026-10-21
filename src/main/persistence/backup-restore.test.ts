import { historicalRows , viewVersion } from '../testing/view-identity';

import { displayedToggle, displayedUndo } from '../testing/displayed-seen';
import { downgradeSelectionFixture } from './testing/schema-10';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as filesystem from 'node:fs/promises';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ReaderRepository } from './reader-repository';
import { migrations, migrateDatabase } from './migrations';
import { validateBackup } from './backup-validation';
import { createVerifiedBackup, validateBackupDestination } from './sqlite-backup';
import type { BackupTimings } from './sqlite-backup';
import { installRestore, prepareRestore, probeRestoredDatabase, protectBeforeMigration, recoverProfile, recoveryDirectory } from './profile-restore';
import type { RestorePhase } from './profile-restore';
import { defaultQuery } from '../../domain/discussion-query';
import { normalizeYtDlp } from '../extractors/yt-dlp';
import { required } from '../../renderer/testing/required';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
// Filesystem/AV stalls are allowed; these are hang guards, not latency budgets.
vi.setConfig({ testTimeout: 30000 });

let root: string, file: string, repository: ReaderRepository | undefined;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'reader-backup-')); file = path.join(root, 'reader.sqlite');
  repository = ReaderRepository.open(file); repository.initializeDemo();
});
afterEach(() => {
  repository?.close();
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-backup-')) throw new Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
});
function repo(): ReaderRepository { if (!repository) throw new Error('Missing repository'); return repository; }
function close() { repo().prepareOffline(); repo().close(); repository = undefined; }
function rows(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(row => [String(row.name), db.prepare(`SELECT * FROM ${row.name} ORDER BY rowid`).all()])); } finally { db.close(); }
}
function historicalProfileRows(file: string) {
  const actual = rows(file);
  if (!actual.app_windows) return actual;
  const { discussion_view_intent, view_collapse, view_collapse_overrides } = actual;
  const shared = Object.fromEntries(Object.entries(actual).filter(([name]) => !['reader_appearance','window_session','window_restore','window_geometry','app_windows','tab_instances','window_tabs','discussion_views','item_resume_view','discussion_view_intent','view_collapse','view_collapse_overrides'].includes(name)));
  const db = new DatabaseSync(file, { readOnly: true });
  try { return { ...shared, workspace: historicalRows(db, 'workspace'), workspace_tabs: historicalRows(db, 'workspace_tabs'),
    discussion_view_state: discussion_view_intent.map(value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'view_id'))),
    discussion_collapse: view_collapse.map(value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'view_id'))),
    comment_collapse_overrides: view_collapse_overrides.map(value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'view_id'))) }; } finally { db.close(); }
}
function input(count?: number) {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
  return normalizeYtDlp(JSON.stringify(count === undefined ? fixture.raw : { ...fixture.raw, comments: Array.from({ length: count }, (_, i) => ({
    id: `large-${i}`, parent: i % 20 ? `large-${Math.floor(i / 20) * 20}` : 'root', text: `Generated ${i}: ${'Zażółć gęślą jaźń. '.repeat(12)}`, timestamp: 1790856000,
  })) }), fixture.context);
}
function completeState() {
  const first = repo().ingest(input(), undefined, true);
  const next = input();
  if (!next.collection || next.collection.status !== 'present') throw new Error('Missing comments');
  repo().ingest({ ...next, collection: { status: 'present' as const, comments: [...next.collection.comments,
    { ...next.collection.comments[0], sourceId: 'new-comment' }] } });
  const itemId = required(first.itemId);
  repo().ingest({ provenance: next.provenance, coverage: { kind: 'failed', reason: 'test-failure' }, issues: [] }, { sourceKind: 'youtube-video', sourceId: required(next.item).sourceId });
  repo().bulkSeen({ itemId, seen: true, target: { kind: 'all' } });
  const comments = repo().bootstrap(['en']).comments[itemId];
  displayedToggle(repo(), { itemId, commentId: comments[0].id, subtree: false });
  displayedToggle(repo(), { itemId, commentId: comments[0].id, subtree: false });
  repo().saveDiscussionView({ ...viewVersion(repo(), itemId), draft: { ...defaultQuery, text: 'unsaved draft differs' }, applied: { ...defaultQuery, seen: 'seen' },
    sort: 'latest-activity', anchor: { commentId: comments[1].id, offset: -12.5 }, selected: comments[2].id });
  repo().setDiscussionCollapse({ ...viewVersion(repo(), itemId, 'collapse'), kind: 'all', collapsed: true });
  repo().setDiscussionCollapse({ ...viewVersion(repo(), itemId, 'collapse'), kind: 'comments', ids: [comments[0].id], collapsed: false });
  repo().setHelperSelection('yt-dlp', 'C:\\machine\\yt-dlp.exe');
  repo().setHelperSelection('post-archiver', 'C:\\machine\\post-archiver.exe');
  repo().updatePreferences({ locale: 'pl' }, ['en']); repo().updatePreferences({ appearance: 'dark' }, ['en']);
  repo().updatePreferences({ translationTarget: 'de' }, ['en']);
  repo().updatePreferences({ selectionControls: 'always' }, ['en']); repo().updatePreferences({ includeCollapsedInPrefix: false }, ['en']);
  repo().changeWorkspace('openLibrary'); repo().changeWorkspace('openSettings'); repo().changeWorkspace('moveTab', required(repo().workspace().tabs.find(t=>t.kind==='settings')).id, 0);
  return itemId;
}

it('backs up every authoritative table and restores exact data, Undo revisions, NEW, views, workspace and helpers', async () => {
  const item = completeState(), before = rows(file), bytes = readFileSync(file), snapshot = path.join(root, 'snapshot.sqlite');
  await repo().createBackup(snapshot);
  expect(rows(snapshot)).toEqual(before); expect(readFileSync(file)).toEqual(bytes); expect(validateBackup(snapshot)).toBe(15);
  repo().updatePreferences({ appearance: 'light' }, ['en']); displayedUndo(repo(), item); repo().changeWorkspace('closeTab', required(repo().workspace().tabs.find(t=>t.kind==='settings')).id);
  const changed = rows(file), directory = await prepareRestore(snapshot, file);
  await repo().createBackup(path.join(directory, 'safety.sqlite')); close();
  await installRestore(file, directory); expect(await recoverProfile(file)).toBe('restored');
  expect(rows(file)).toEqual(before); expect(rows(path.join(directory, 'safety.sqlite'))).toEqual(changed);
  repository = ReaderRepository.open(file);
  expect(displayedUndo(repo(), item)).toMatchObject({ skipped: 1 });
  repo().removeLibraryItem(item, ['en']); expect(repo().bootstrap(['en']).items.some(row => row.id === item)).toBe(false);
});

it('uses SQLite backup with committed WAL state and produces a standalone snapshot', async () => {
  const raw = new DatabaseSync(file); raw.exec('PRAGMA journal_mode=WAL');
  repo().updatePreferences({ locale: 'pl' }, ['en']);
  const destination = path.join(root, 'wal-snapshot.sqlite'); await repo().createBackup(destination);
  expect(existsSync(destination + '-wal')).toBe(false); expect(rows(destination)).toEqual(rows(file));
  raw.close(); close(); expect(existsSync(file + '-wal')).toBe(false);
});

it('normalizes a standalone WAL-header candidate before installing its file', async () => {
  const snapshot = path.join(root, 'external-wal.sqlite'); await repo().createBackup(snapshot);
  const external = new DatabaseSync(snapshot); external.exec('PRAGMA journal_mode=WAL'); external.close();
  const source = readFileSync(snapshot), directory = await prepareRestore(snapshot, file);
  const candidate = path.join(directory, 'candidate.sqlite'), check = new DatabaseSync(candidate, { readOnly: true });
  try { expect(check.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('delete'); } finally { check.close(); }
  expect(existsSync(candidate + '-wal')).toBe(false); expect(existsSync(candidate + '-shm')).toBe(false);
  expect(readFileSync(snapshot)).toEqual(source);
});

it('publishes exclusively and cleans incomplete output after write and verification failures', async () => {
  const snapshot = path.join(root, 'snapshot.sqlite'); writeFileSync(snapshot, 'valuable-existing');
  await expect(repo().createBackup(snapshot)).rejects.toThrow(); expect(readFileSync(snapshot, 'utf8')).toBe('valuable-existing');
  const raw = new DatabaseSync(file);
  try { await expect(createVerifiedBackup(raw, path.join(root, 'invalid.sqlite'), () => { throw new Error('verify failure'); })).rejects.toThrow('verify failure'); }
  finally { raw.close(); }
  await expect(repo().createBackup(path.join(root, 'missing', 'backup.sqlite'))).rejects.toThrow();
  expect(existsSync(path.join(root, 'invalid.sqlite'))).toBe(false);
  expect(readdirSync(root).some(name => name.includes('.partial'))).toBe(false);
  expect(repo().bootstrap(['en']).items).toHaveLength(2);
});

it.each(['ENOSPC', 'EACCES', 'EPERM'])('handles an actual destination-open %s failure with no partial success', async code => {
  const original = readFileSync(file), destination = path.join(root, 'failed.sqlite');
  const spy = vi.mocked(filesystem.open).mockRejectedValueOnce(Object.assign(new Error('Injected write failure'), { code }));
  try { await expect(repo().createBackup(destination)).rejects.toMatchObject({ code }); }
  finally { spy.mockClear(); }
  expect(readFileSync(file)).toEqual(original); expect(existsSync(destination)).toBe(false);
  expect(readdirSync(root).some(name => name.includes('.partial'))).toBe(false);
});

it('rejects internal destinations, live restore inputs and relative paths', async () => {
  for (const destination of [file, path.join(root, 'recovery.sqlite'), 'relative.sqlite']) await expect(validateBackupDestination(destination, file)).rejects.toThrow();
  await expect(prepareRestore(file, file)).rejects.toThrow('live database');
});

it.each(['text', 'corrupted', 'wrong-app', 'newer', 'foreign-key', 'missing-state', 'unknown-trigger', 'broken-view', 'broken-history'])(
  'rejects %s without changing the current database', async kind => {
    const candidate = path.join(root, 'bad.sqlite'), before = readFileSync(file);
    if (kind === 'text') writeFileSync(candidate, 'not SQLite');
    else if (kind === 'corrupted') { copyFileSync(file, candidate); writeFileSync(candidate, readFileSync(candidate).subarray(0, 200)); }
    else {
      if (kind !== 'wrong-app') copyFileSync(file, candidate);
      const db = new DatabaseSync(candidate);
      try {
        if (kind === 'wrong-app') db.exec('CREATE TABLE wrong(id); PRAGMA user_version=8');
        if (kind === 'newer') db.exec('PRAGMA user_version=999');
        if (kind === 'foreign-key') db.exec("PRAGMA foreign_keys=OFF; INSERT INTO comment_state VALUES ('missing-comment',0,0)");
        if (kind === 'missing-state') db.exec("DELETE FROM comment_state WHERE comment_id='v1'");
        if (kind === 'unknown-trigger') db.exec("CREATE TRIGGER malicious AFTER UPDATE ON preferences BEGIN DELETE FROM comments; END");
        if (kind === 'broken-view') db.prepare('INSERT INTO discussion_view_intent VALUES (?,?,?,?,?,NULL,0,NULL)').run(viewVersion(repo(), 'video-demo').viewId, 'video-demo', '{}', '{}', 'original');
        if (kind === 'broken-history') db.exec("UPDATE content_items SET remote_json=NULL WHERE id='video-demo'");
      } finally { db.close(); }
    }
    await expect(prepareRestore(candidate, file)).rejects.toThrow(kind === 'newer' ? 'NEWER_BACKUP' : 'INVALID_BACKUP');
    expect(readFileSync(file)).toEqual(before);
  });

it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])('recognizes schema %i and migrates only its staged copy', async version => {
  const source = path.join(root, `old-${version}.sqlite`), db = new DatabaseSync(source);
  migrateDatabase(db, migrations.slice(0, version)); db.close(); const original = readFileSync(source);
  expect(validateBackup(source)).toBe(version);
  const directory = await prepareRestore(source, file);
  expect(validateBackup(path.join(directory, 'candidate.sqlite'))).toBe(15); expect(readFileSync(source)).toEqual(original);
});

it.each<RestorePhase>(['intent', 'previous-renamed', 'previous-moved', 'candidate-renamed', 'installed', 'reopened', 'accepted'])(
  'recovers a simulated process interruption after %s deterministically', async phase => {
    const snapshot = path.join(root, 'backup.sqlite'); await repo().createBackup(snapshot);
    repo().updatePreferences({ locale: 'pl' }, ['en']); const previous = rows(file);
    const directory = await prepareRestore(snapshot, file);
    await repo().createBackup(path.join(directory, 'safety.sqlite')); close();
    await expect(installRestore(file, directory, at => { if (at === phase) throw new Error('crash'); })).rejects.toThrow('crash');
    expect(await recoverProfile(file)).toBe(phase === 'accepted' ? 'restored' : 'recovered');
    expect(rows(file)).toEqual(phase === 'accepted' ? rows(snapshot) : previous);
    expect(await recoverProfile(file)).toBe(null); expect(existsSync(path.join(directory, 'safety.sqlite'))).toBe(true);
    probeRestoredDatabase(file);
  });

it.each<RestorePhase>(['rollback-quarantined', 'rollback-installed'])('recovers after another crash during %s', async phase => {
  const snapshot = path.join(root, 'backup.sqlite'); await repo().createBackup(snapshot);
  repo().updatePreferences({ locale: 'pl' }, ['en']); const previous = rows(file);
  const directory = await prepareRestore(snapshot, file); await repo().createBackup(path.join(directory, 'safety.sqlite')); close();
  await expect(installRestore(file, directory, at => { if (at === 'candidate-renamed') throw new Error('crash'); })).rejects.toThrow();
  await expect(recoverProfile(file, at => { if (at === phase) throw new Error('second crash'); })).rejects.toThrow('second crash');
  expect(await recoverProfile(file)).toBe('recovered'); expect(rows(file)).toEqual(previous);
});

it('rolls back when a fully installed candidate cannot reopen, preserving failed candidate evidence', async () => {
  const snapshot = path.join(root, 'backup.sqlite'); await repo().createBackup(snapshot);
  repo().updatePreferences({ locale: 'pl' }, ['en']); const previous = rows(file);
  const directory = await prepareRestore(snapshot, file); await repo().createBackup(path.join(directory, 'safety.sqlite')); close();
  await expect(installRestore(file, directory, undefined, () => { throw new Error('reopen failed'); })).rejects.toThrow('reopen failed');
  expect(await recoverProfile(file)).toBe('recovered'); expect(rows(file)).toEqual(previous);
  expect(readdirSync(directory).some(name => name.startsWith('abandoned-'))).toBe(true);
});

it('recovers an accepted candidate that fails validation on the next startup', async () => {
  const snapshot = path.join(root, 'backup.sqlite'); await repo().createBackup(snapshot);
  repo().updatePreferences({ locale: 'pl' }, ['en']); const previous = rows(file);
  const directory = await prepareRestore(snapshot, file); await repo().createBackup(path.join(directory, 'safety.sqlite')); close();
  await installRestore(file, directory); writeFileSync(file, 'corrupted after installation');
  expect(await recoverProfile(file)).toBe('recovered'); expect(rows(file)).toEqual(previous);
});

it('fails closed when intent metadata disappears after moving the original', async () => {
  const snapshot = path.join(root, 'backup.sqlite'); await repo().createBackup(snapshot);
  const directory = await prepareRestore(snapshot, file); await repo().createBackup(path.join(directory, 'safety.sqlite')); close();
  await expect(installRestore(file, directory, at => { if (at === 'previous-moved') throw new Error('crash'); })).rejects.toThrow();
  rmSync(path.join(directory, 'intent'));
  await expect(recoverProfile(file)).rejects.toThrow('metadata missing'); expect(existsSync(file)).toBe(false);
  expect(validateBackup(path.join(directory, 'previous.sqlite'))).toBe(15);
});

it('preserves populated schema-7 data while staging its known migration', async () => {
  const source = path.join(root, 'populated-v7.sqlite'); await repo().createBackup(source);
  const db = new DatabaseSync(source); downgradeSelectionFixture(db); db.exec('DROP TABLE comment_collapse_overrides; DROP TABLE discussion_collapse; ALTER TABLE preferences DROP COLUMN translation_target; DROP TABLE discussion_view_state; PRAGMA user_version=7'); db.close();
  const original = readFileSync(source), before = historicalProfileRows(source);
  const directory = await prepareRestore(source, file), after = historicalProfileRows(path.join(directory, 'candidate.sqlite'));
  const { discussion_view_state, discussion_collapse, comment_collapse_overrides, ...preserved } = after;
  expect(discussion_collapse).toEqual([]); expect(comment_collapse_overrides).toEqual([]);
  expect(discussion_view_state).toEqual([]);
  expect(preserved).toEqual({ ...before, preferences: before.preferences.map(row => ({ ...row, translation_target: 'app', custom_translation_target: null, selection_controls: 'on-demand', include_collapsed_in_prefix: 1 })) });
  expect(readFileSync(source)).toEqual(original);
});

it('protects populated schema 8 before migration and restores schema-8 backups only through an unchanged source and staged upgrade', async () => {
  completeState();
  const source = path.join(root, 'populated-v8.sqlite'); await repo().createBackup(source);
  const db = new DatabaseSync(source); downgradeSelectionFixture(db); db.exec('DROP TABLE comment_collapse_overrides; DROP TABLE discussion_collapse; ALTER TABLE preferences DROP COLUMN translation_target; PRAGMA user_version=8'); db.close();
  const original = readFileSync(source), before = historicalProfileRows(source);
  expect(validateBackup(source)).toBe(8);
  await protectBeforeMigration(source);
  expect(readFileSync(source)).toEqual(original);
  const snapshots = readdirSync(recoveryDirectory(source)).filter(name => name.startsWith('pre-migration-v8-'));
  expect(snapshots).toHaveLength(1); expect(validateBackup(path.join(recoveryDirectory(source), snapshots[0]))).toBe(8);
  const directory = await prepareRestore(source, file), candidate = path.join(directory, 'candidate.sqlite');
  expect(validateBackup(candidate)).toBe(15); expect(readFileSync(source)).toEqual(original);
  expect(historicalProfileRows(candidate)).toEqual({ ...before, discussion_collapse: [], comment_collapse_overrides: [], preferences: before.preferences.map(row => ({ ...row, translation_target: 'app', custom_translation_target: null, selection_controls: 'on-demand', include_collapsed_in_prefix: 1 })) });
  await repo().createBackup(path.join(directory, 'safety.sqlite')); close();
  await installRestore(file, directory); expect(await recoverProfile(file)).toBe('restored');
  repository = ReaderRepository.open(file);
  expect(repo().preferences(['en'])).toMatchObject({ locale: 'pl', appearance: 'dark', selectionControls: 'on-demand', includeCollapsedInPrefix: true, translationTarget: 'app' });
  repo().updatePreferences({ translationTarget: 'de' }, ['en']); close();
  repository = ReaderRepository.open(file); expect(repo().preferences(['en']).translationTarget).toBe('de');
});

it('fails closed with missing/corrupt safety data and never initializes an empty database', async () => {
  const snapshot = path.join(root, 'backup.sqlite'); await repo().createBackup(snapshot);
  const directory = await prepareRestore(snapshot, file); await repo().createBackup(path.join(directory, 'safety.sqlite')); close();
  await expect(installRestore(file, directory, at => { if (at === 'previous-moved') throw new Error('crash'); })).rejects.toThrow();
  writeFileSync(path.join(directory, 'safety.sqlite'), 'broken');
  await expect(recoverProfile(file)).rejects.toThrow(); expect(existsSync(file)).toBe(false);
  expect(existsSync(path.join(directory, 'previous.sqlite'))).toBe(true);
});

it('preserves a verified pre-migration snapshot before an older profile can migrate', async () => {
  const old = path.join(root, 'old.sqlite'), db = new DatabaseSync(old); migrateDatabase(db, migrations.slice(0, 7)); db.close();
  const original = readFileSync(old); await protectBeforeMigration(old); expect(readFileSync(old)).toEqual(original);
  const snapshots = readdirSync(recoveryDirectory(old)).filter(name => name.startsWith('pre-migration-'));
  expect(snapshots).toHaveLength(1); expect(validateBackup(path.join(recoveryDirectory(old), snapshots[0]))).toBe(7);
  const migrated = ReaderRepository.open(old); migrated.close(); expect(validateBackup(old)).toBe(15);
});

it.each([10000, 50000])('measures complete backup/verification/preflight/safety/install/reopen for %i generated comments', async count => {
  const item = required(repo().ingest(input(count), undefined, true).itemId);
  repo().bulkSeen({ itemId: item, seen: true, target: { kind: 'all' } });
  const snapshot = path.join(root, 'large.sqlite'), begin = performance.now();
  let timings: BackupTimings | undefined;
  await repo().createBackup(snapshot, value => { timings = value; }); const backedUp = performance.now();
  validateBackup(snapshot); const verified = performance.now();
  const directory = await prepareRestore(snapshot, file); const prepared = performance.now();
  await repo().createBackup(path.join(directory, 'safety.sqlite')); const safety = performance.now(); close();
  await installRestore(file, directory); await recoverProfile(file); const installed = performance.now();
  repository = ReaderRepository.open(file); const state = repo().bootstrap(['en']); const reopened = performance.now();
  expect(state.comments[item]).toHaveLength(count);
  console.log(JSON.stringify({ backupScale: count, bytes: statSync(snapshot).size, backupWithVerificationMs: backedUp - begin,
    ...timings,
    verificationMs: verified - backedUp, preflightMs: prepared - verified, safetyMs: safety - prepared,
    installRecoveryMs: installed - safety, reopenBootstrapMs: reopened - installed }));
}, 60000);

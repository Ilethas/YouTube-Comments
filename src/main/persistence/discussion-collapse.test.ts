import { legacyComparableState , viewVersion, viewIdentity } from '../testing/view-identity';

import { displayedToggle, displayedUndo } from '../testing/displayed-seen';
import { downgradeSelectionFixture } from './testing/schema-10';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InvalidDiscussionViewError, ReaderRepository } from './reader-repository';
import { migrations, migrateDatabase } from './migrations';
import { prepareRestore, protectBeforeMigration, recoveryDirectory } from './profile-restore';
import { validateBackup } from './backup-validation';
import { required } from '../../renderer/testing/required';
import { ReaderService } from '../reader-service';
import { normalizeYtDlp } from '../extractors/yt-dlp';

let directory: string, file: string, repo: ReaderRepository;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-collapse-'));
  file = path.join(directory, 'reader.sqlite'); repo = ReaderRepository.open(file); repo.initializeDemo();
});
afterEach(() => {
  repo.close(); vi.restoreAllMocks();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-collapse-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function raw<T>(action: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON');
  try { return action(db); } finally { db.close(); }
}
function restart() { repo.close(); repo = ReaderRepository.open(file); return repo.bootstrap(['en']); }
const all = (collapsed: boolean) => repo.setDiscussionCollapse({ ...viewVersion(repo, 'video-demo', 'collapse'), kind: 'all', collapsed });
const comment = (collapsed: boolean, id = 'v1') => repo.setDiscussionCollapse({ ...viewVersion(repo, 'video-demo', 'collapse'), kind: 'comments', ids: [id], collapsed });
const state = () => repo.bootstrap(['en']).discussionCollapse;

it('fresh/reopened defaults expanded; individual/All/Expand All survive restart and remain independent of other discussion state', () => {
  const before = repo.bootstrap(['en']), history = repo.history();
  expect(state()).toEqual({}); restart(); expect(state()).toEqual({});
  comment(true); expect(restart().discussionCollapse[viewIdentity(repo, 'video-demo')]).toEqual({ defaultCollapsed: false, overrides: ['v1'] });
  repo.changeWorkspace('closeTab', viewIdentity(repo, 'video-demo')); repo.changeWorkspace('openStoredItem', 'video-demo');
  expect(state()[viewIdentity(repo, 'video-demo')].overrides).toEqual(['v1']);
  all(true); expect(restart().discussionCollapse[viewIdentity(repo, 'video-demo')]).toEqual({ defaultCollapsed: true, overrides: [] });
  comment(false); expect(state()[viewIdentity(repo, 'video-demo')]).toEqual({ defaultCollapsed: true, overrides: ['v1'] });
  comment(true); expect(state()[viewIdentity(repo, 'video-demo')].overrides).toEqual([]);
  all(false); expect(restart().discussionCollapse[viewIdentity(repo, 'video-demo')]).toEqual({ defaultCollapsed: false, overrides: [] });
  expect(state()[viewIdentity(repo, 'post-demo')]).toBeUndefined();
  expect(repo.bootstrap(['en']).comments).toEqual(before.comments); expect(repo.history()).toEqual(history);
  expect(repo.bootstrap(['en']).seenUndo).toEqual(before.seenUndo);
  raw(db => {
    expect(db.prepare('SELECT count(*) AS n FROM view_collapse').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM view_collapse_overrides').get()?.n).toBe(0);
  });
});

it('validates exact IPC, item ownership atomically and cascades actual Library removal', () => {
  const service = new ReaderService(() => repo, ['en'], vi.fn());
  expect(service.dispatch('setDiscussionCollapse', [{ itemId: 'video-demo', kind: 'all', collapsed: true, ids: [] }])).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  expect(() => repo.setDiscussionCollapse({ ...viewVersion(repo, 'video-demo', 'collapse'), kind: 'comments', collapsed: true, ids: ['v1', 'p1'] })).toThrow(InvalidDiscussionViewError);
  expect(state()).toEqual({});
  raw(db => expect(() => db.prepare('INSERT INTO view_collapse_overrides VALUES (?,?,?)').run(viewIdentity(repo, 'video-demo'), 'video-demo', 'p1')).toThrow());
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
  const itemId = required(repo.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context)).itemId);
  const ids = repo.bootstrap(['en']).comments[itemId].map(row => row.id);
  repo.setDiscussionCollapse({ ...viewVersion(repo, itemId, 'collapse'), kind: 'all', collapsed: true });
  repo.setDiscussionCollapse({ ...viewVersion(repo, itemId, 'collapse'), kind: 'comments', ids: [ids[0]], collapsed: false });
  repo.removeLibraryItem(itemId, ['en']); expect(state()[itemId]).toBeUndefined();
  raw(db => expect(db.prepare('SELECT * FROM view_collapse_overrides WHERE item_id=?').all(itemId)).toEqual([]));
});

it('invalid default is ignored per discussion, invalid unowned overrides are ignored and next assignment repairs corrupt state', () => {
  all(true); comment(false);
  raw(db => {
    db.exec('PRAGMA ignore_check_constraints=ON');
    db.prepare('UPDATE view_collapse SET default_collapsed=9 WHERE item_id=?').run('video-demo');
    db.exec('PRAGMA foreign_keys=OFF'); db.prepare('INSERT INTO view_collapse_overrides VALUES (?,?,?)').run(viewIdentity(repo, 'post-demo'), 'post-demo', 'v1');
  });
  expect(state()[viewIdentity(repo, 'video-demo')]).toBeUndefined(); expect(state()[viewIdentity(repo, 'post-demo')]).toBeUndefined();
  expect(repo.bootstrap(['en']).comments['video-demo'].length).toBeGreaterThan(0);
  comment(true); expect(state()[viewIdentity(repo, 'video-demo')]).toEqual({ defaultCollapsed: false, overrides: ['v1'] });
});

it('schema 9 migrates additively with pre-migration safety; staged old backup migrates without changing its bytes', async () => {
  const before = repo.bootstrap(['en']), history = repo.history();
  repo.close();
  const db = new DatabaseSync(file);
  downgradeSelectionFixture(db); db.exec('DROP TABLE comment_collapse_overrides; DROP TABLE discussion_collapse; PRAGMA user_version=9'); db.close();
  const bytes = readFileSync(file);
  expect(validateBackup(file)).toBe(9);
  await protectBeforeMigration(file);
  const snapshots = readdirSync(recoveryDirectory(file)); expect(snapshots).toHaveLength(1);
  expect(validateBackup(path.join(recoveryDirectory(file), snapshots[0]))).toBe(9);
  expect(readFileSync(file)).toEqual(bytes);
  const staged = await prepareRestore(path.join(recoveryDirectory(file), snapshots[0]), file);
  expect(validateBackup(path.join(staged, 'candidate.sqlite'))).toBe(15);
  expect(readFileSync(file)).toEqual(bytes);
  repo = ReaderRepository.open(file);
  expect(legacyComparableState(repo.bootstrap(['en']))).toEqual(legacyComparableState(before)); expect(repo.history()).toEqual(history);
  expect(state()).toEqual({});
}, 30000); // Filesystem/AV hang guard, matching the backup suite; not a latency budget.

it('migration failure rolls back only schema 10 and preserves the prior profile', () => {
  raw(db => {
    downgradeSelectionFixture(db); db.exec('DROP TABLE comment_collapse_overrides; DROP TABLE discussion_collapse; PRAGMA user_version=9');
    const comments = db.prepare('SELECT * FROM comments').all();
    expect(() => migrateDatabase(db, [...migrations.slice(0, 9), { version: 10, apply: target => { migrations[9].apply(target); throw new Error('injected'); } }])).toThrow('injected');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
    expect(db.prepare('SELECT * FROM comments').all()).toEqual(comments);
    migrateDatabase(db);
  });
});

it('stored subtree/matching bulk and revision-safe Undo include hidden descendants with no expansion writes', () => {
  all(true); const initial = repo.bootstrap(['en']), collapse = state();
  displayedToggle(repo, { itemId: 'video-demo', commentId: 'v1', subtree: true });
  expect(state()).toEqual(collapse);
  const after = repo.bootstrap(['en']);
  expect(after.comments['video-demo'].filter(row => row.parentId === 'v1').every(row => row.seen === required(after.comments['video-demo'].find(row => row.id === 'v1')).seen)).toBe(true);
  const undo = after.seenUndo['video-demo'];
  if (undo) displayedUndo(repo, 'video-demo');
  repo.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'matching', ids: ['v1', 'v2', 'v3'] } });
  expect(repo.bootstrap(['en']).comments['video-demo'].filter(row => ['v1', 'v2', 'v3'].includes(row.id)).every(row => row.seen)).toBe(true);
  displayedUndo(repo, 'video-demo'); expect(state()).toEqual(collapse);
  expect(repo.bootstrap(['en']).comments['video-demo'].map(row => row.id)).toEqual(initial.comments['video-demo'].map(row => row.id));
});

it('accepted Refresh retains sparse preferences and new descendants inherit All without per-comment records', () => {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
  const itemId = required(repo.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context)).itemId);
  const original = repo.bootstrap(['en']).comments[itemId], root = required(original.find(row => row.parentId === null));
  repo.setDiscussionCollapse({ ...viewVersion(repo, itemId, 'collapse'), kind: 'all', collapsed: true });
  const observation = normalizeYtDlp(JSON.stringify({ ...fixture.raw, comments: [{ id: 'new-collapse-reply', parent: root.source.commentId, text: 'New reply' }] }), fixture.context);
  repo.ingest(observation);
  const refreshed = repo.bootstrap(['en']);
  expect(refreshed.discussionCollapse[viewIdentity(repo, itemId)]).toEqual({ defaultCollapsed: true, overrides: [] });
  expect(refreshed.comments[itemId]).toHaveLength(original.length + 1);
  expect(refreshed.comments[itemId].find(row => row.source.commentId === 'new-collapse-reply')).toMatchObject({ parentId: root.id, seen: false });
  expect(refreshed.comments[itemId].filter(row => original.some(old => old.id === row.id)).map(row => row.id)).toEqual(original.map(row => row.id));
});

import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './reader-repository';
import { migrateDatabase, migrations } from './migrations';
import { discussionTab } from '../../domain/workspace';
import { ReaderService } from '../reader-service';
import { normalizeYtDlp } from '../extractors/yt-dlp';

let directory: string, file: string, repository: ReaderRepository;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-workspace-test-'));
  file = path.join(directory, 'reader.sqlite');
  repository = ReaderRepository.open(file);
  repository.initializeDemo();
});
afterEach(() => {
  repository.close();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-workspace-test-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
const state = () => repository.bootstrap(['en']);
function restart() { repository.close(); repository = ReaderRepository.open(file); }

it('closes without deleting or changing comments, seen, preferences or history, then reopens the same identity', () => {
  repository.toggleSeen({ itemId: 'video-demo', commentId: 'v1', subtree: false });
  const before = state(), history = repository.history();
  repository.changeWorkspace('closeTab', discussionTab('video-demo').id);
  restart();
  expect(state()).toEqual({ ...before, workspace: { tabs: ['post-demo'].map(discussionTab), activeTabId: discussionTab('post-demo').id, revision: before.workspace.revision + 1 } });
  expect(repository.history()).toEqual(history);
  repository.changeWorkspace('openStoredItem', 'video-demo');
  restart();
  expect(state().workspace).toMatchObject({ tabs: ['post-demo', 'video-demo'].map(discussionTab), activeTabId: discussionTab('video-demo').id });
  expect(state().items).toEqual(before.items);
  expect(state().comments).toEqual(before.comments);
  expect(repository.history()).toEqual(history);
});

it('persists order/active selection and allows closing every tab without reseeding on restart', () => {
  repository.changeWorkspace('activateTab', discussionTab('post-demo').id);
  restart();
  expect(state().workspace.activeTabId).toBe(discussionTab('post-demo').id);
  repository.changeWorkspace('closeTab', discussionTab('post-demo').id);
  expect(state().workspace.activeTabId).toBe(discussionTab('video-demo').id);
  repository.changeWorkspace('closeTab', discussionTab('video-demo').id);
  restart(); repository.initializeDemo();
  expect(state().workspace).toMatchObject({ tabs: [].map(discussionTab), activeTabId: null });
  expect(state().items).toHaveLength(2);
  repository.changeWorkspace('openStoredItem', 'post-demo');
  repository.changeWorkspace('openStoredItem', 'video-demo');
  repository.changeWorkspace('activateTab', discussionTab('post-demo').id);
  restart();
  expect(state().workspace).toMatchObject({ tabs: ['post-demo', 'video-demo'].map(discussionTab), activeTabId: discussionTab('post-demo').id });
});

it('closing active chooses right before left, while closing a background tab leaves active unchanged', () => {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
  const attempt = repository.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), undefined, true);
  const third = attempt.itemId as string;
  repository.changeWorkspace('activateTab', discussionTab('post-demo').id);
  repository.changeWorkspace('closeTab', discussionTab('post-demo').id);
  expect(state().workspace).toMatchObject({ tabs: ['video-demo', third].map(discussionTab), activeTabId: discussionTab(third).id });
  repository.changeWorkspace('openStoredItem', 'post-demo');
  repository.changeWorkspace('closeTab', discussionTab('video-demo').id);
  expect(state().workspace.activeTabId).toBe(discussionTab('post-demo').id);
  repository.changeWorkspace('closeTab', discussionTab('post-demo').id);
  expect(state().workspace.activeTabId).toBe(discussionTab(third).id);
});

it('acquiring a closed existing URL reopens one tab using existing state; Refresh preserves newer selection/closure', async () => {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
  const extraction = normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context);
  const service = new ReaderService(() => repository, ['en'], () => undefined, async () => ({ extraction }));
  const url = 'https://youtu.be/VidDemo_001';
  const first = await service.dispatch('acquire', [{ url }]);
  if (!first.ok) throw new Error('Expected acquisition');
  const id = first.value.summary.itemId, comment = first.value.state.comments[id][0];
  repository.toggleSeen({ itemId: id, commentId: comment.id, subtree: false });
  repository.changeWorkspace('closeTab', discussionTab(id).id);
  const second = await service.dispatch('acquire', [{ url }]);
  if (!second.ok) throw new Error('Expected reopen');
  expect(second.value.summary.itemId).toBe(id);
  expect(second.value.state.items).toHaveLength(3);
  expect(second.value.state.workspace.tabs.filter(tab => tab.id === discussionTab(id).id)).toHaveLength(1);
  expect(second.value.state.comments[id][0]).toMatchObject({ id: comment.id, seen: true });
  repository.changeWorkspace('activateTab', discussionTab('video-demo').id);
  const before = state().workspace;
  await service.dispatch('refresh', [{ itemId: id }]);
  expect(state().workspace).toEqual(before);
  repository.changeWorkspace('closeTab', discussionTab(id).id);
  const closed = state().workspace;
  await service.dispatch('refresh', [{ itemId: id }]);
  expect(state().workspace).toEqual(closed);
});

function removeAttemptOrder(db: DatabaseSync) {
  db.exec('DROP TABLE seen_operation_entries; DROP TABLE seen_operations; ALTER TABLE comment_state DROP COLUMN revision;');
  db.exec('DROP TRIGGER assign_attempt_order; DROP INDEX latest_accepted_attempt; DROP INDEX extraction_attempt_order; ALTER TABLE extraction_attempts DROP COLUMN attempt_order;');
}

it('schema 2 migration opens stored items and preserves every existing row including old avatar-less JSON', () => {
  repository.toggleSeen({ itemId: 'post-demo', commentId: state().comments['post-demo'][0].id, subtree: false });
  repository.updatePreferences({ locale: 'pl' }, ['en']);
  repository.close();
  const db = new DatabaseSync(file);
  try {
    removeAttemptOrder(db);
    db.exec("DROP TABLE workspace; DROP TABLE workspace_tabs; PRAGMA user_version = 2; UPDATE comments SET remote_json = json_remove(remote_json, '$.author.avatarUrl'); UPDATE content_items SET remote_json = json_remove(remote_json, '$.author.avatarUrl');");
    const tables = ['content_items', 'comments', 'comment_state', 'preferences', 'extraction_attempts'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    migrateDatabase(db);
    expect(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all())).toMatchObject(before);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(6);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); repository = ReaderRepository.open(file); }
  expect(state().workspace).toEqual({ tabs: ['video-demo', 'post-demo'].map(discussionTab), activeTabId: discussionTab('video-demo').id, revision: 0 });
  expect(state().comments['video-demo'][0].remote?.author.avatarUrl).toEqual({ status: 'unknown', reason: 'unavailable' });
  expect(state().preferences.locale).toBe('pl');
});

it('workspace migration failure rolls back tables/version and preserves all library data', () => {
  const db = new DatabaseSync(file);
  try {
    removeAttemptOrder(db);
    db.exec('DROP TABLE workspace; DROP TABLE workspace_tabs; PRAGMA user_version = 2;');
    const before = db.prepare('SELECT * FROM comments').all();
    expect(() => migrateDatabase(db, [...migrations.slice(0, 2), { version: 3, apply: database => {
      migrations[2].apply(database); throw new Error('injected workspace migration failure');
    } }])).toThrow('injected workspace migration failure');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'workspace%'").all()).toEqual([]);
    expect(db.prepare('SELECT * FROM comments').all()).toEqual(before);
    migrateDatabase(db);
  } finally { db.close(); }
});

it('a failed workspace write rolls back order/selection with no content mutations', () => {
  const db = new DatabaseSync(file);
  try { db.exec("CREATE TRIGGER fail_workspace BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'injected failure'); END"); }
  finally { db.close(); }
  const before = state();
  expect(() => repository.changeWorkspace('closeTab', discussionTab('video-demo').id)).toThrow('injected failure');
  expect(state()).toEqual(before);
});

it('persists mixed singleton order/active identity and app close/reopen across restart', () => {
  repository.changeWorkspace('openLibrary');
  repository.changeWorkspace('openSettings');
  repository.changeWorkspace('openLibrary');
  repository.changeWorkspace('openSettings');
  expect(state().workspace.tabs.map(tab => tab.id)).toEqual(['discussion:video-demo', 'discussion:post-demo', 'library', 'settings']);
  repository.changeWorkspace('moveTab', 'library', 1);
  repository.changeWorkspace('moveTab', 'settings', 0);
  restart();
  expect(state().workspace.tabs.map(tab => tab.id)).toEqual(['settings', 'discussion:video-demo', 'library', 'discussion:post-demo']);
  expect(state().workspace.activeTabId).toBe('settings');
  repository.changeWorkspace('closeTab', 'settings');
  expect(state().workspace.activeTabId).toBe('discussion:video-demo');
  repository.changeWorkspace('closeTab', 'library');
  repository.changeWorkspace('openLibrary');
  expect(state().workspace.tabs.at(-1)?.id).toBe('library');
  const before = state();
  for (const index of [-1, 99, 0.5]) expect(() => repository.changeWorkspace('moveTab', 'library', index)).toThrow();
  expect(state()).toEqual(before);
});

it.each([false, true])('schema 3 → 4 preserves exact workspace (empty=%s) and every Library record', empty => {
  repository.close();
  const db = new DatabaseSync(file);
  try {
    removeAttemptOrder(db);
    db.exec(`DROP TABLE workspace; DROP TABLE workspace_tabs; PRAGMA user_version=2;`);
    migrations[2].apply(db);
    if (empty) db.exec('UPDATE workspace SET active_item_id=NULL; DELETE FROM workspace_tabs;');
    else db.exec("UPDATE workspace SET active_item_id='post-demo',revision=19; UPDATE workspace_tabs SET position=position+10; UPDATE workspace_tabs SET position=CASE item_id WHEN 'post-demo' THEN 0 ELSE 1 END;");
    db.exec('PRAGMA user_version=3;');
    const tables = ['content_items', 'comments', 'comment_state', 'extraction_attempts', 'preferences'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    migrateDatabase(db);
    expect(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all())).toMatchObject(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); repository = ReaderRepository.open(file); }
  expect(state().workspace).toEqual(empty ? { tabs: [], activeTabId: null, revision: 0 }
    : { tabs: ['post-demo', 'video-demo'].map(discussionTab), activeTabId: 'discussion:post-demo', revision: 19 });
});

it('schema 4 migration rollback preserves old workspace and retry succeeds with foreign keys on', () => {
  repository.close();
  const db = new DatabaseSync(file);
  try {
    removeAttemptOrder(db);
    db.exec('PRAGMA foreign_keys=ON; DROP TABLE workspace; DROP TABLE workspace_tabs; PRAGMA user_version=2;');
    migrations[2].apply(db); db.exec('PRAGMA user_version=3;');
    expect(() => migrateDatabase(db, [...migrations.slice(0, 3), { version: 4, apply: database => {
      migrations[3].apply(database); throw new Error('late migration failure');
    } }])).toThrow('late migration failure');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
    expect(db.prepare('SELECT item_id FROM workspace_tabs ORDER BY position').all().map(row => row.item_id)).toEqual(['video-demo', 'post-demo']);
    migrateDatabase(db);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); repository = ReaderRepository.open(file); }
});

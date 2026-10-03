import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './reader-repository';
import { migrateDatabase, migrations } from './migrations';
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
  repository.changeWorkspace('closeTab', 'video-demo');
  restart();
  expect(state()).toEqual({ ...before, workspace: { openItemIds: ['post-demo'], activeItemId: 'post-demo', revision: before.workspace.revision + 1 } });
  expect(repository.history()).toEqual(history);
  repository.changeWorkspace('openStoredItem', 'video-demo');
  restart();
  expect(state().workspace).toMatchObject({ openItemIds: ['post-demo', 'video-demo'], activeItemId: 'video-demo' });
  expect(state().items).toEqual(before.items);
  expect(state().comments).toEqual(before.comments);
  expect(repository.history()).toEqual(history);
});

it('persists order/active selection and allows closing every tab without reseeding on restart', () => {
  repository.changeWorkspace('activateTab', 'post-demo');
  restart();
  expect(state().workspace.activeItemId).toBe('post-demo');
  repository.changeWorkspace('closeTab', 'post-demo');
  expect(state().workspace.activeItemId).toBe('video-demo');
  repository.changeWorkspace('closeTab', 'video-demo');
  restart(); repository.initializeDemo();
  expect(state().workspace).toMatchObject({ openItemIds: [], activeItemId: null });
  expect(state().items).toHaveLength(2);
  repository.changeWorkspace('openStoredItem', 'post-demo');
  repository.changeWorkspace('openStoredItem', 'video-demo');
  repository.changeWorkspace('activateTab', 'post-demo');
  restart();
  expect(state().workspace).toMatchObject({ openItemIds: ['post-demo', 'video-demo'], activeItemId: 'post-demo' });
});

it('closing active chooses right before left, while closing a background tab leaves active unchanged', () => {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
  const attempt = repository.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), undefined, true);
  const third = attempt.itemId as string;
  repository.changeWorkspace('activateTab', 'post-demo');
  repository.changeWorkspace('closeTab', 'post-demo');
  expect(state().workspace).toMatchObject({ openItemIds: ['video-demo', third], activeItemId: third });
  repository.changeWorkspace('openStoredItem', 'post-demo');
  repository.changeWorkspace('closeTab', 'video-demo');
  expect(state().workspace.activeItemId).toBe('post-demo');
  repository.changeWorkspace('closeTab', 'post-demo');
  expect(state().workspace.activeItemId).toBe(third);
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
  repository.changeWorkspace('closeTab', id);
  const second = await service.dispatch('acquire', [{ url }]);
  if (!second.ok) throw new Error('Expected reopen');
  expect(second.value.summary.itemId).toBe(id);
  expect(second.value.state.items).toHaveLength(3);
  expect(second.value.state.workspace.openItemIds.filter(tab => tab === id)).toHaveLength(1);
  expect(second.value.state.comments[id][0]).toMatchObject({ id: comment.id, seen: true });
  repository.changeWorkspace('activateTab', 'video-demo');
  const before = state().workspace;
  await service.dispatch('refresh', [{ itemId: id }]);
  expect(state().workspace).toEqual(before);
  repository.changeWorkspace('closeTab', id);
  const closed = state().workspace;
  await service.dispatch('refresh', [{ itemId: id }]);
  expect(state().workspace).toEqual(closed);
});

it('schema 2 migration opens stored items and preserves every existing row including old avatar-less JSON', () => {
  repository.toggleSeen({ itemId: 'post-demo', commentId: state().comments['post-demo'][0].id, subtree: false });
  repository.updatePreferences({ locale: 'pl' }, ['en']);
  repository.close();
  const db = new DatabaseSync(file);
  try {
    db.exec("DROP TABLE workspace; DROP TABLE workspace_tabs; PRAGMA user_version = 2; UPDATE comments SET remote_json = json_remove(remote_json, '$.author.avatarUrl'); UPDATE content_items SET remote_json = json_remove(remote_json, '$.author.avatarUrl');");
    const tables = ['content_items', 'comments', 'comment_state', 'preferences', 'extraction_attempts'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    migrateDatabase(db);
    expect(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); repository = ReaderRepository.open(file); }
  expect(state().workspace).toEqual({ openItemIds: ['video-demo', 'post-demo'], activeItemId: 'video-demo', revision: 0 });
  expect(state().comments['video-demo'][0].remote?.author.avatarUrl).toEqual({ status: 'unknown', reason: 'unavailable' });
  expect(state().preferences.locale).toBe('pl');
});

it('workspace migration failure rolls back tables/version and preserves all library data', () => {
  const db = new DatabaseSync(file);
  try {
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
  expect(() => repository.changeWorkspace('closeTab', 'video-demo')).toThrow('injected failure');
  expect(state()).toEqual(before);
});

import { required } from '../../renderer/testing/required';
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync , readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository, StateConflictError, ViewOwnershipError } from './reader-repository';
import { migrateDatabase, migrations, schemaVersion } from './migrations';
import { downgradeWindowFixture } from './testing/schema-12';
import { viewVersion, viewIdentity } from '../testing/view-identity';
import { defaultQuery } from '../../domain/discussion-query';
import { normalizeYtDlp } from '../extractors/yt-dlp';
import { validateBackup } from './backup-validation';
import { prepareRestore, protectBeforeMigration, recoveryDirectory } from './profile-restore';


const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) { if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-m4-')) throw new Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true }); } });
const sharedTables = ['content_items', 'comments', 'comment_state', 'seen_operations', 'seen_operation_entries', 'extraction_attempts', 'preferences', 'helper_settings'];
const rows = (db: DatabaseSync, table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const upgradedRows = (table: string, before: ReturnType<typeof rows>) => table === 'preferences'
  ? before.map(row => ({ ...row, notification_dismissal: 'automatic', notification_duration_seconds: 5 })) : before;
function fixture(empty = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-m4-')); roots.push(root);
  const file = path.join(root, 'reader.sqlite');
  const repo = ReaderRepository.open(file); repo.initializeDemo();
  const source = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
  const third = required(repo.ingest(normalizeYtDlp(JSON.stringify(source.raw), source.context), undefined, false).itemId);
  repo.ingest(normalizeYtDlp(JSON.stringify(source.raw), source.context));
  repo.bulkSeen({ itemId: 'video-demo', target: { kind: 'all' }, seen: true });
  repo.toggleSeen({ itemId: 'video-demo', commentId: 'v1', subtree: false, seen: false });
  repo.toggleSeen({ itemId: 'video-demo', commentId: 'v1', subtree: false, seen: true });
  repo.updatePreferences({ translationTarget: 'custom', customTranslationTarget: 'pt-BR' }, ['en']);
  repo.setHelperSelection('yt-dlp', 'C:\\installed separately\\yt-dlp.exe');
  for (const itemId of ['video-demo', third]) {
    const comments = repo.bootstrap(['en']).comments[itemId];
    repo.saveDiscussionView({ ...viewVersion(repo, itemId), draft: { ...defaultQuery, text: 'draft differs' }, applied: { ...defaultQuery, text: 'camera' }, sort: 'latest-activity',
      anchor: { commentId: required(comments.at(-1)).id, offset: -37.125 }, selected: comments[0].id });
  }
  for (const itemId of ['video-demo', 'post-demo', third]) {
    repo.setDiscussionCollapse({ ...viewVersion(repo, itemId, 'collapse'), kind: 'all', collapsed: true });
    repo.setDiscussionCollapse({ ...viewVersion(repo, itemId, 'collapse'), kind: 'comments', ids: [repo.bootstrap(['en']).comments[itemId][0].id], collapsed: false });
  }
  repo.changeWorkspace('openLibrary'); repo.changeWorkspace('openSettings');
  repo.changeWorkspace('moveTab', required(repo.workspace().tabs.find(t => t.kind === 'settings')).id, 1);
  repo.changeWorkspace('activateTab', required(repo.workspace().tabs.find(t => t.kind === 'library')).id);
  if (empty) for (const tab of repo.workspace().tabs) repo.changeWorkspace('closeTab', tab.id);
  repo.close();
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON'); downgradeWindowFixture(db);
  // Preserve noncanonical whitespace in authoritative legacy JSON and a nonzero
  // header offset: migration must not run the normalizing save-intent path.
  db.prepare("UPDATE discussion_view_state SET draft_query_json='  '||draft_query_json||'  ',anchor_comment_id=NULL,anchor_offset=19.5 WHERE item_id='video-demo'").run();
  const before = Object.fromEntries([...sharedTables, 'workspace', 'workspace_tabs', 'discussion_view_state', 'discussion_collapse', 'comment_collapse_overrides'].map(t => [t, rows(db, t)]));
  db.close(); return { file, root, before, third };
}

it.each([false, true])('losslessly maps every durable field and dormant instance, empty=%s', empty => {
  const f = fixture(empty), db = new DatabaseSync(f.file); db.exec('PRAGMA foreign_keys=ON');
  try {
    migrateDatabase(db);
    expect(validateBackup(f.file)).toBe(schemaVersion);
    for (const table of sharedTables) expect(rows(db, table), table).toEqual(upgradedRows(table, f.before[table]));
    const window = rows(db, 'app_windows')[0], instances = rows(db, 'tab_instances');
    expect(rows(db, 'app_windows')).toHaveLength(1);
    expect(window.topology_revision).toBe(f.before.workspace[0].revision);
    const mapping = new Map(instances.filter(t => t.kind === 'discussion').map(t => [t.item_id, t.id]));
    expect(mapping.size).toBe(f.before.content_items.length);
    for (const [itemId, id] of mapping) {
      expect(id).toMatch(/^[a-f0-9-]{36}$/); expect(id).not.toContain(String(itemId));
      expect(db.prepare('SELECT * FROM item_resume_view WHERE item_id=?').get(itemId)).toEqual({ window_id: window.id, item_id: itemId, view_id: id });
      const old = f.before.discussion_view_state.find(r => r.item_id === itemId);
      expect(db.prepare('SELECT * FROM discussion_view_intent WHERE view_id=?').get(id)).toEqual(old ? { view_id: id, ...old } : undefined);
      const collapse = f.before.discussion_collapse.find(r => r.item_id === itemId);
      expect(db.prepare('SELECT * FROM view_collapse WHERE view_id=?').get(id)).toEqual(collapse ? { view_id: id, ...collapse } : undefined);
      expect(db.prepare('SELECT item_id,comment_id FROM view_collapse_overrides WHERE view_id=? ORDER BY comment_id').all(id)).toEqual(f.before.comment_collapse_overrides.filter(r => r.item_id === itemId).sort((a,b) => String(a.comment_id).localeCompare(String(b.comment_id))));
    }
    const placed = db.prepare('SELECT p.*,t.item_id FROM window_tabs p JOIN tab_instances t ON t.id=p.tab_id ORDER BY p.position').all();
    expect(placed.map(t => ({ kind: t.kind, item_id: t.item_id, position: t.position }))).toEqual(f.before.workspace_tabs.map(({ kind,item_id,position }) => ({ kind,item_id,position })));
    const active = f.before.workspace_tabs.find(t => t.id === f.before.workspace[0].active_tab_id);
    expect(window.active_tab_id).toBe(active ? required(placed.find(t => t.kind === active.kind && t.item_id === active.item_id)).tab_id : null);
    expect(db.prepare('SELECT 1 FROM window_tabs WHERE tab_id=?').get(required(mapping.get(f.third)))).toBeUndefined();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => migrateDatabase(db, migrations.slice(0, 12))).toThrow('Unsupported database schema');
  } finally { db.close(); }
});

it.each(['ddl', 'intent', 'collapse', 'drop', 'commit'])('migration failure at %s rolls back schema, data, version and file bytes; retry succeeds', stage => {
  const f = fixture(), bytes = readFileSync(f.file), db = new DatabaseSync(f.file); db.exec('PRAGMA foreign_keys=ON');
  const exec = db.exec.bind(db), prepare = db.prepare.bind(db);
  let injected = false;
  vi.spyOn(db, 'exec').mockImplementation(sql => {
    if (!injected && (stage === 'ddl' && sql.includes('CREATE TABLE app_windows') || stage === 'drop' && sql.startsWith('DROP TABLE comment_collapse') || stage === 'commit' && sql === 'COMMIT')) {
      injected = true; if (stage !== 'commit') exec(sql); throw new Error('Injected M4 failure');
    } return exec(sql);
  });
  vi.spyOn(db, 'prepare').mockImplementation(sql => {
    if (!injected && (stage === 'intent' && sql.startsWith('INSERT INTO discussion_view_intent') || stage === 'collapse' && sql.startsWith('INSERT INTO view_collapse_overrides'))) { injected = true; throw new Error('Injected M4 failure'); }
    return prepare(sql);
  });
  try {
    expect(() => migrateDatabase(db)).toThrow('Injected M4 failure');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);
    for (const [table, expected] of Object.entries(f.before)) expect(rows(db, table)).toEqual(expected);
    expect(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='app_windows'").get()).toBeUndefined();
  } finally { vi.restoreAllMocks(); db.close(); }
  expect(readFileSync(f.file)).toEqual(bytes);
  const restarted = ReaderRepository.open(f.file); try { expect(restarted.bootstrap(['en']).items).toHaveLength(3); } finally { restarted.close(); }
});

it('SQLite rejects forged topology and cross-item state, permits same-item instances and cascades all on deletion', () => {
  const f = fixture(), repo = ReaderRepository.open(f.file), a = repo.initialWindowId(), b = repo.createPersistentWindow();
  repo.changeWorkspace('openStoredItem', 'video-demo', undefined, b);
  repo.close();
  const db = new DatabaseSync(f.file); db.exec('PRAGMA foreign_keys=ON');
  try {
    const av = required(required(db.prepare("SELECT view_id FROM item_resume_view WHERE window_id=? AND item_id='video-demo'").get(a)).view_id);
    const bv = required(required(db.prepare("SELECT view_id FROM item_resume_view WHERE window_id=? AND item_id='video-demo'").get(b)).view_id);
    expect(av).not.toBe(bv);
    db.prepare("INSERT INTO tab_instances VALUES ('dormant-library',?,'library',NULL)").run(b);
    expect(() => db.exec("UPDATE tab_instances SET kind='discussion',item_id='post-demo' WHERE id='dormant-library'")).toThrow('immutable');
    expect(() => db.prepare("INSERT INTO window_tabs VALUES (?,?,'discussion',98)").run(a,av)).toThrow();
    expect(() => db.prepare("INSERT INTO window_tabs VALUES (?,?,'discussion',99)").run(b,av)).toThrow();
    expect(() => db.prepare("INSERT INTO window_tabs VALUES (?,?,'discussion',0)").run(a,bv)).toThrow();
    expect(() => db.prepare('UPDATE app_windows SET active_tab_id=? WHERE id=?').run(bv,a)).toThrow();
    expect(() => db.prepare("INSERT INTO tab_instances VALUES ('forged-library',?,'library',NULL)").run(a)).toThrow();
    expect(() => db.prepare("INSERT INTO tab_instances VALUES ('forged-settings',?,'settings',NULL)").run(a)).toThrow();
    expect(() => db.prepare("INSERT INTO discussion_views(view_id,item_id) VALUES ('missing','video-demo')").run()).toThrow();
    expect(() => db.prepare("UPDATE discussion_view_intent SET item_id='post-demo' WHERE view_id=?").run(av)).toThrow();
    expect(() => db.prepare("UPDATE discussion_view_intent SET anchor_comment_id='p1' WHERE view_id=?").run(av)).toThrow();
    expect(() => db.prepare("UPDATE discussion_view_intent SET selected_comment_id='p1' WHERE view_id=?").run(av)).toThrow();
    expect(() => db.prepare("UPDATE discussion_views SET item_id='post-demo' WHERE view_id=?").run(av)).toThrow();
    expect(() => db.prepare('DELETE FROM discussion_views WHERE view_id=?').run(av)).toThrow('requires its view');
    expect(() => db.prepare("INSERT INTO view_collapse_overrides VALUES (?,'video-demo','p1')").run(av)).toThrow();
    expect(() => db.prepare("INSERT INTO view_collapse_overrides VALUES (?,'post-demo','p1')").run(av)).toThrow();
    // Same-window duplicate instance is representable without any new UI.
    db.prepare("INSERT INTO tab_instances VALUES ('duplicate',?,'discussion','video-demo')").run(a);

    expect(() => db.prepare("INSERT INTO window_tabs VALUES (?,'duplicate','discussion',0)").run(a)).toThrow();
    db.prepare("INSERT INTO window_tabs VALUES (?,'duplicate','discussion',99)").run(a);
    // Isolate the topology cascade from legacy content/history cycles.
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON; DELETE FROM comment_state WHERE comment_id IN (SELECT id FROM comments WHERE item_id='video-demo'); DELETE FROM content_items WHERE id='video-demo'; DELETE FROM comments WHERE item_id='video-demo'; DELETE FROM extraction_attempts WHERE item_id='video-demo'; COMMIT;");
    expect(db.prepare("SELECT * FROM discussion_views WHERE item_id='video-demo'").all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

it('independent owners, separate CAS lanes and dormant reopen retain distinct intent and collapse', () => {
  const f = fixture(), repo = ReaderRepository.open(f.file), a = repo.initialWindowId(), b = repo.createPersistentWindow();
  try {
    repo.changeWorkspace('openStoredItem', 'video-demo', undefined, b);
    const av = viewIdentity(repo, 'video-demo'), bv = Object.keys(repo.viewInstances(b))[0];
    const request = { viewId: bv, expectedRevision: 0, draft: { ...defaultQuery, text: 'independent' }, applied: defaultQuery, sort: 'oldest' as const, anchor: { commentId: 'v1', offset: 5 }, selected: 'v2' };
    const stamp = repo.stamp();
    expect(() => repo.saveDiscussionView(request, a)).toThrow(ViewOwnershipError); expect(repo.stamp()).toEqual(stamp);
    repo.saveDiscussionView(request, b);
    const beforeStale = repo.stamp();
    expect(() => repo.saveDiscussionView(request,b)).toThrow(StateConflictError);
    expect(repo.stamp()).toEqual(beforeStale);
    repo.setDiscussionCollapse({ viewId: bv, expectedRevision: 0, kind: 'all', collapsed: false }, b);
    expect(() => repo.setDiscussionCollapse({ viewId: bv, expectedRevision: 0, kind: 'all', collapsed: true }, b)).toThrow(StateConflictError);
    repo.changeWorkspace('closeTab', bv, undefined, b);
    repo.changeWorkspace('openStoredItem', 'video-demo', undefined, b);
    expect(repo.workspace(b).activeTabId).toBe(bv);
    expect(repo.bootstrap(['en'], b).discussionViews[bv].draft.text).toBe('independent');
    expect(repo.bootstrap(['en'], a).discussionViews[av].draft.text).toBe('draft differs');
    expect(repo.bootstrap(['en'], a).comments).toEqual(repo.bootstrap(['en'], b).comments);
    expect(() => repo.changeWorkspace('closeTab', av, undefined, b)).toThrow(ViewOwnershipError);
    expect(() => repo.changeWorkspace('closeTab', bv, undefined, b, 0)).toThrow(StateConflictError);
  } finally { repo.close(); }
});

it('verified v12 startup safety and staged restore preserve the selected source and all authoritative data', async () => {
  const f = fixture(), bytes = readFileSync(f.file);
  expect(validateBackup(f.file)).toBe(12);
  await protectBeforeMigration(f.file);
  const safety = path.join(recoveryDirectory(f.file), readdirSync(recoveryDirectory(f.file))[0]);
  expect(validateBackup(safety)).toBe(12); expect(readFileSync(f.file)).toEqual(bytes);
  const safetyBytes = readFileSync(safety);
  const staged = await prepareRestore(safety, f.file);
  expect(validateBackup(path.join(staged,'candidate.sqlite'))).toBe(schemaVersion);
  expect(readFileSync(safety)).toEqual(safetyBytes); expect(readFileSync(f.file)).toEqual(bytes);
  const db = new DatabaseSync(path.join(staged,'candidate.sqlite'));
  try { for (const table of sharedTables) expect(rows(db,table)).toEqual(upgradedRows(table, f.before[table])); } finally { db.close(); }
}, 60000);

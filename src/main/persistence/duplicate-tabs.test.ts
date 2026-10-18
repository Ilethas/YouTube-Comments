import { required } from '../../renderer/testing/required';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ReaderRepository, StateConflictError, ViewOwnershipError } from './reader-repository';
import { defaultQuery } from '../../domain/discussion-query';
import { validateBackup } from './backup-validation';
import { prepareRestore } from './profile-restore';
const roots: string[] = [], repositories: ReaderRepository[] = [];
afterEach(() => { vi.restoreAllMocks(); repositories.splice(0).forEach(r => r.close()); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'reader-m5-')); roots.push(root);
  const repo = ReaderRepository.open(path.join(root, 'reader.sqlite')); repositories.push(repo); repo.initializeDemo();
  const window = repo.initialWindowId(), source = required(repo.workspace().tabs.find(t => t.kind === 'discussion' && t.itemId === 'video-demo')).id;
  repo.saveDiscussionView({ viewId: source, expectedRevision: 0, draft: { ...defaultQuery, text: 'unsaved Apply draft' }, applied: { ...defaultQuery, seen: 'unseen' }, sort: 'newest', anchor: { commentId: 'v2', offset: 31.25 }, selected: 'v3' });
  repo.setDiscussionCollapse({ viewId: source, expectedRevision: 0, kind: 'all', collapsed: true });
  repo.setDiscussionCollapse({ viewId: source, expectedRevision: 1, kind: 'comments', ids: ['v2'], collapsed: false });
  const request = () => ({ sourceViewId: source, expectedRevision: repo.workspace().revision, ...repo.viewInstances(repo.initialWindowId())[source] });
  return { root, repo, window, source, request };
}
it('duplicates only semantic records into a new adjacent active identity with zero independent CAS lanes', () => {
  const { repo, source, window, request } = fixture(), before = repo.bootstrap(['en']), original = repo.viewSnapshot(window, source);
  const clone = repo.duplicateTab(request()), id = clone.view.viewId;
  expect(id).toMatch(/^[a-f0-9-]{36}$/); expect(id).not.toBe(source);
  expect(clone.view.instance).toEqual({ itemId: 'video-demo', intentRevision: 0, collapseRevision: 0 });
  expect(clone.view.intent).toEqual(original.intent); expect(clone.view.collapse).toEqual(original.collapse);
  expect(repo.viewSnapshot(window, source)).toEqual({ ...original, ...repo.stamp() });
  expect(clone.workspace.tabs.findIndex(t => t.id === id)).toBe(before.workspace.tabs.findIndex(t => t.id === source) + 1);
  expect(clone.workspace.activeTabId).toBe(id); expect(clone.workspace.revision).toBe(before.workspace.revision + 1);
  expect(clone.view).toMatchObject(repo.stamp());
  expect(repo.bootstrap(['en']).items).toEqual(before.items); expect(repo.bootstrap(['en']).comments).toEqual(before.comments);
  repo.saveDiscussionView({ ...required(clone.view.intent), viewId: id, expectedRevision: 0, sort: 'oldest' });
  repo.setDiscussionCollapse({ viewId: id, expectedRevision: 0, kind: 'all', collapsed: false });
  expect(repo.viewSnapshot(window, source).intent).toEqual(original.intent); expect(repo.viewSnapshot(window, source).collapse).toEqual(original.collapse);
  expect(repo.viewSnapshot(window, id).intent?.sort).toBe('oldest'); expect(repo.viewSnapshot(window, id).collapse?.defaultCollapsed).toBe(false);
});
it.each(['topology', 'intent', 'collapse'] as const)('rejects stale %s without any partial clone or notification', lane => {
  const { repo, source, request } = fixture(), stale = request();
  if (lane === 'topology') repo.changeWorkspace('openLibrary');
  if (lane === 'intent') repo.saveDiscussionView({ ...required(repo.viewSnapshot(repo.initialWindowId(), source).intent), viewId: source, expectedRevision: 1 });
  if (lane === 'collapse') repo.setDiscussionCollapse({ viewId: source, expectedRevision: 2, kind: 'all', collapsed: false });
  const before = repo.bootstrap(['en']), stamp = repo.stamp(), notify = vi.fn(); repo.onCommit(notify);
  expect(() => repo.duplicateTab(stale)).toThrow(StateConflictError);
  expect(repo.bootstrap(['en'])).toEqual(before); expect(repo.stamp()).toEqual(stamp); expect(notify).not.toHaveBeenCalled();
});
it('rejects wrong-owner, singleton and dormant sources; scoped hydration checks retained ownership', () => {
  const { repo, source, window, request } = fixture(), other = repo.createPersistentWindow();
  expect(() => repo.duplicateTab({ ...request(), expectedRevision: repo.workspace(other).revision }, other)).toThrow(ViewOwnershipError);
  expect(() => repo.viewSnapshot(other, source)).toThrow(ViewOwnershipError);
  for (const command of ['openLibrary', 'openSettings'] as const) {
    const state = repo.changeWorkspace(command);
    expect(() => repo.duplicateTab({ ...request(), sourceViewId: required(state.activeTabId) })).toThrow(ViewOwnershipError);
  }
  repo.changeWorkspace('closeTab', source);
  expect(() => repo.duplicateTab(request())).toThrow(ViewOwnershipError);
  expect(repo.viewSnapshot(window, source).intent).toBeDefined();
});
it('Library Open prefers last activated local open view, deterministic first open fallback, then retained dormant resume', () => {
  const { repo, source, request } = fixture(), clone = repo.duplicateTab(request()).view.viewId;
  const open = () => repo.changeWorkspace('openStoredItem', 'video-demo').activeTabId;
  repo.changeWorkspace('openLibrary'); expect(open()).toBe(clone);
  repo.changeWorkspace('activateTab', source); repo.changeWorkspace('openLibrary'); expect(open()).toBe(source);
  repo.changeWorkspace('closeTab', source); expect(open()).toBe(clone);
  repo.changeWorkspace('closeTab', clone); expect(open()).toBe(clone);
  const peer = repo.createPersistentWindow(); repo.changeWorkspace('openStoredItem', 'video-demo', undefined, peer);
  expect(repo.workspace(peer).activeTabId).not.toBe(clone); expect(open()).toBe(clone);
});
it('all duplicate and dormant instances cascade on removal while shared seen/Undo remains item scoped', () => {
  const { repo, source, request } = fixture(), id = repo.duplicateTab(request()).view.viewId;
  const bulk = repo.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  expect(repo.bootstrap(['en']).seenUndo['video-demo']?.id).toBe(bulk.undo?.id);
  repo.changeWorkspace('closeTab', source); repo.removeLibraryItem('video-demo', ['en']);
  expect(repo.viewInstances(repo.initialWindowId())[source]).toBeUndefined(); expect(repo.viewInstances(repo.initialWindowId())[id]).toBeUndefined();
  expect(repo.workspace().tabs.some(t => t.id === id)).toBe(false);
  expect(() => repo.saveDiscussionView({ ...defaultIntent(), viewId: id, expectedRevision: 0 })).toThrow(ViewOwnershipError);
});
function defaultIntent() { return { draft: defaultQuery, applied: defaultQuery, sort: 'original' as const, anchor: { commentId: null, offset: 0 }, selected: null }; }
it.each(['copy', 'commit'])('failed %s rolls back identity, seed, placement, active tab and resume pointer', stage => {
  const { repo, request } = fixture(), db = (repo as unknown as { db: DatabaseSync }).db;
  const before = repo.bootstrap(['en']), pointers = db.prepare('SELECT * FROM item_resume_view').all(), stamp = repo.stamp();
  if (stage === 'copy') { const prepare = db.prepare.bind(db); vi.spyOn(db, 'prepare').mockImplementation(sql => { if (sql.startsWith('INSERT INTO view_collapse_overrides SELECT')) throw new Error('injected copy'); return prepare(sql); }); }
  else { const exec = db.exec.bind(db); vi.spyOn(db, 'exec').mockImplementation(sql => { if (sql === 'COMMIT') throw new Error('injected commit'); return exec(sql); }); }
  expect(() => repo.duplicateTab(request())).toThrow('injected'); vi.restoreAllMocks();
  expect(repo.bootstrap(['en'])).toEqual(before); expect(repo.stamp()).toEqual(stamp); expect(db.prepare('SELECT * FROM item_resume_view').all()).toEqual(pointers);
  expect(repo.duplicateTab(request()).view.viewId).toBeTruthy();
});
it('schema-13 verified backup and staged restore retain open order, active, dormant identities, seeds and shared rows exactly', async () => {
  const { repo, root, source, request } = fixture();
  const id = repo.duplicateTab(request()).view.viewId; repo.changeWorkspace('closeTab', source); repo.changeWorkspace('moveTab', id, 0);
  repo.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  const before = repo.bootstrap(['en']), backup = path.join(root, 'snapshot.sqlite'); await repo.createBackup(backup);
  expect(validateBackup(backup)).toBe(13);
  const stage = await prepareRestore(backup, path.join(root, 'reader.sqlite'));
  const restored = ReaderRepository.open(path.join(stage, 'candidate.sqlite')); repositories.push(restored);
  expect(restored.bootstrap(['en'])).toEqual(before); expect(restored.viewInstances(restored.initialWindowId())[source]).toBeDefined();
  expect(restored.changeWorkspace('openStoredItem', 'video-demo').activeTabId).toBe(id);
}, 30000);

it('never merges successive duplicates, and preserves absent optional rows when the source has no semantic saves', () => {
  const { repo, window } = fixture();
  const source = required(repo.workspace().tabs.find(t => t.kind === 'discussion' && t.itemId === 'post-demo')).id;
  const duplicate = () => repo.duplicateTab({ sourceViewId: source, expectedRevision: repo.workspace().revision, intentRevision: 0, collapseRevision: 0 });
  const a = duplicate(), b = duplicate(); expect(a.view.viewId).not.toBe(b.view.viewId);
  for (const id of [source, a.view.viewId, b.view.viewId]) {
    expect(repo.viewSnapshot(window, id).intent).toBeUndefined(); expect(repo.viewSnapshot(window, id).collapse).toBeUndefined();
  }
  expect(repo.workspace().tabs.filter(t => t.kind === 'discussion' && t.itemId === 'post-demo')).toHaveLength(3);
});

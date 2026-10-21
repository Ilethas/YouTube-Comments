import { schemaVersion } from './migrations';
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ReaderRepository } from './reader-repository';
import { ReaderService } from '../reader-service';
import { defaultQuery } from '../../domain/discussion-query';
import type { TransferRequest } from '../../shared/tab-transfer';
import { validateBackup } from './backup-validation';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repos: ReaderRepository[] = [], roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); repos.splice(0).forEach(r => r.close()); for (const root of roots.splice(0)) rmSync(root, { recursive: true }); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-m7-')); roots.push(root);
  const file = path.join(root, 'reader.sqlite'), repo = ReaderRepository.open(file); repos.push(repo); repo.initializeDemo();
  const a = repo.initialWindowId(), b = repo.createPersistentWindow(), c = repo.createPersistentWindow();
  const tab = repo.workspace(a).tabs.find(t => t.kind === 'discussion'); if (!tab || tab.kind !== 'discussion') throw Error('fixture');
  const intent = { draft: { ...defaultQuery, text: 'unapplied' }, applied: defaultQuery, sort: 'oldest' as const, anchor: { commentId: 'v1', offset: -23.25 }, selected: 'v2' };
  repo.saveDiscussionView({ viewId: tab.id, expectedRevision: 0, ...intent }, a);
  repo.setDiscussionCollapse({ viewId: tab.id, expectedRevision: 0, kind: 'all', collapsed: true }, a);
  repo.setDiscussionCollapse({ viewId: tab.id, expectedRevision: 1, kind: 'comments', ids: ['v1'], collapsed: false }, a);
  const request = (source = a, target = b, id = tab.id): TransferRequest => {
    const view = repo.viewInstances(source)[id];
    return { tabId: id, expectedRevision: repo.workspace(source).revision,
      destination: { windowId: target, expectedRevision: repo.workspace(target).revision, beforeTabId: null },
      intentRevision: view?.intentRevision ?? null, collapseRevision: view?.collapseRevision ?? null, ownerGeneration: view?.ownerGeneration ?? null, handoff: null };
  };
  return { repo, file, root, a, b, c, tab, request, intent };
}
it('atomically transfers the SAME view with exact private rows, order/active/revisions; same-item destination never merges', async () => {
  const f = fixture(), { repo, a, b, tab } = f;
  repo.changeWorkspace('openStoredItem', tab.itemId, undefined, b);
  const existing = repo.workspace(b).activeTabId, before = repo.viewSnapshot(a, tab.id), source = repo.workspace(a), target = repo.workspace(b);
  const shared = repo.bootstrap(['en'], a).comments, commits: unknown[] = []; repo.onCommit(c => commits.push(c));
  expect(repo.transferTab(a, b, f.request(), () => undefined)).toEqual({ tabId: tab.id, mergedIntoTabId: null });
  expect(repo.workspace(a)).toMatchObject({ revision: source.revision + 1, activeTabId: source.tabs[1].id });
  expect(repo.workspace(b)).toEqual({ tabs: [...target.tabs, tab], activeTabId: tab.id, revision: target.revision + 1 });
  const moved = repo.viewSnapshot(b, tab.id);
  expect(moved.intent).toEqual(before.intent); expect(moved.collapse).toEqual(before.collapse);
  expect(moved.instance).toMatchObject({ intentRevision: before.instance.intentRevision + 1, collapseRevision: before.instance.collapseRevision + 1 });
  expect(moved.instance.ownerGeneration).toBeTypeOf('string'); expect(repo.viewInstances(b)[existing ?? '']).toBeDefined();
  expect(repo.bootstrap(['en'], a).comments).toEqual(shared); expect(commits).toHaveLength(1);
  const backup = path.join(f.root, 'snapshot.sqlite'); await repo.createBackup(backup); expect(validateBackup(backup)).toBe(schemaVersion);
}, 60000); // Filesystem contention is independent of the protocol's bounded deadline.
it.each(['source', 'target', 'neighbor', 'guard'])('rejects %s conflicts without any partial ownership or notification', conflict => {
  const { repo, a, b, request, tab } = fixture(), command = request(), source = repo.workspace(a), target = repo.workspace(b);
  const invalid = conflict === 'source' ? { ...command, expectedRevision: command.expectedRevision + 1 } : conflict === 'target'
    ? { ...command, destination: { windowId: b, expectedRevision: 999, beforeTabId: null } } : conflict === 'neighbor'
      ? { ...command, destination: { windowId: b, expectedRevision: 0, beforeTabId: 'missing' } } : command;
  const observer = vi.fn(); repo.onCommit(observer);
  expect(() => repo.transferTab(a, b, invalid, () => { if (conflict === 'guard') throw Error('barrier'); })).toThrow();
  expect(repo.workspace(a)).toEqual(source); expect(repo.workspace(b)).toEqual(target); expect(repo.ownedView(a, tab.id)).toBe(tab.itemId); expect(observer).not.toHaveBeenCalled();
});
it('A → B → A revokes old A intent/collapse/checkpoints even with the new CAS counters', () => {
  const { repo, a, b, request, tab, intent } = fixture(), old = request();
  repo.transferTab(a, b, request(), () => undefined);
  const bGeneration = repo.viewInstances(b)[tab.id].ownerGeneration;
  repo.transferTab(b, a, request(b, a), () => undefined);
  const current = repo.viewInstances(a)[tab.id]; expect(current.ownerGeneration).not.toBe(bGeneration);
  expect(() => repo.saveDiscussionView({ ...intent, viewId: tab.id, expectedRevision: current.intentRevision, ...(old.ownerGeneration ? { ownerGeneration: old.ownerGeneration } : {}) }, a)).toThrow('generation');
  expect(() => repo.setDiscussionCollapse({ viewId: tab.id, expectedRevision: current.collapseRevision, kind: 'all', collapsed: false }, a)).toThrow('generation');
  repo.saveDiscussionView({ ...intent, viewId: tab.id, expectedRevision: current.intentRevision, ownerGeneration: current.ownerGeneration }, a);
  const service = new ReaderService(() => repo, ['en'], () => undefined), caller = { windowId: a, rendererLease: 'current-A', isCurrent: () => true };
  const oldCheckpoint = { kind: 'view' as const, request: { ...intent, viewId: tab.id, expectedRevision: current.intentRevision + 1 } };
  expect(service.profileCheckpointAllowed(oldCheckpoint, caller)).toBe(false);
  expect(service.drainCheckpoint(caller, oldCheckpoint)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
it.each(['library', 'settings'] as const)('%s preserves identity when absent and merges into an existing dormant singleton', kind => {
  const { repo, a, b, c, request } = fixture(), operation = kind === 'library' ? 'openLibrary' : 'openSettings';
  const first = repo.changeWorkspace(operation, undefined, undefined, a).activeTabId; if (!first) throw Error('fixture');
  const destination = repo.changeWorkspace(operation, undefined, undefined, c).activeTabId; if (!destination) throw Error('fixture');
  repo.changeWorkspace('closeTab', destination, undefined, c);
  expect(repo.transferTab(a, b, request(a, b, first), () => undefined)).toEqual({ tabId: first, mergedIntoTabId: null });
  expect(repo.transferTab(b, c, request(b, c, first), () => undefined)).toEqual({ tabId: destination, mergedIntoTabId: destination });
  expect(repo.workspace(c).activeTabId).toBe(destination); expect(repo.workspace(b).tabs).toHaveLength(0);
});
it.each(['owner', 'lanes', 'source-placement', 'target-placement', 'commit'])('failure at %s rolls back rows, generations and both topologies', stage => {
  const { repo, file, a, b, tab, request } = fixture(), db = (repo as unknown as { db: DatabaseSync }).db;
  const before = repo.bootstrap(['en'], a), prepare = db.prepare.bind(db), exec = db.exec.bind(db), observer = vi.fn(); repo.onCommit(observer);
  vi.spyOn(db, 'prepare').mockImplementation(sql => {
    if (stage === 'owner' && sql.startsWith('UPDATE tab_instances') || stage === 'lanes' && sql.startsWith('UPDATE discussion_views SET intent_revision=intent_revision+1,')
      || stage === 'source-placement' && sql.startsWith('INSERT INTO window_tabs') || stage === 'target-placement' && sql.startsWith('UPDATE app_windows SET active_tab_id')) throw Error('injected');
    return prepare(sql);
  });
  vi.spyOn(db, 'exec').mockImplementation(sql => { if (stage === 'commit' && sql === 'COMMIT') throw Error('injected'); return exec(sql); });
  expect(() => repo.transferTab(a, b, request(), () => undefined)).toThrow('injected');
  expect(repo.bootstrap(['en'], a)).toEqual(before); expect(repo.workspace(b).tabs).toHaveLength(0); expect(observer).not.toHaveBeenCalled();
  expect(repo.ownerAuthority(tab.id)).toEqual({}); expect(validateBackup(file)).toBe(schemaVersion);
});
it('crash/reopen before and after COMMIT keeps the sole durable owner; source can remain empty and dormant pointers survive', () => {
  const { repo, file, a, b, tab, request } = fixture();
  for (const other of repo.workspace(a).tabs) if (other.id !== tab.id) repo.changeWorkspace('closeTab', other.id, undefined, a);
  expect(repo.ownedView(a, tab.id)).toBe(tab.itemId);
  repo.transferTab(a, b, request(), () => undefined);
  expect(repo.workspace(a).tabs).toEqual([]);
  repo.close(); repos.splice(repos.indexOf(repo), 1);
  const reopened = ReaderRepository.open(file); repos.push(reopened);
  expect(reopened.ownedView(b, tab.id)).toBe(tab.itemId); expect(() => reopened.ownedView(a, tab.id)).toThrow();
  expect(validateBackup(file)).toBe(schemaVersion);
});

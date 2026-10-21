import { required } from '../renderer/testing/required';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { ReaderService } from './reader-service';
import { ReaderRepository } from './persistence/reader-repository';
import { ProfileOperationCoordinator } from './profile-operation-coordinator';
import type { ProfileEvent, DrainCommand } from '../shared/profile-operation';
import { defaultQuery } from '../domain/discussion-query';
import type { DataBackupDialogs } from './data-backup-dialogs';
import { validateBackup } from './persistence/backup-validation';
import type { ReaderCallerContext } from './caller-context';

// Filesystem/antivirus contention is not a correctness deadline. Protocol hang
// guards have deterministic fake-timer tests in the coordinator suite.
vi.setConfig({ testTimeout: 60000 });
const roots: string[] = [], services: ReaderService[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) await service.shutdown();
  for (const root of roots.splice(0)) { if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-m3-db-')) throw new Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true }); }
});
function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-m3-db-')); roots.push(root);
  const file = path.join(root, 'profile', 'reader.sqlite'), backup = path.join(root, 'backup.sqlite');
  const alive = [true, true];
  const events: ProfileEvent[][] = [[], []];
  const dialogs: DataBackupDialogs = { save: vi.fn(async () => backup), select: vi.fn(async () => backup), confirm: vi.fn(async () => true) };
  const restart = vi.fn();
  let repository!: ReaderRepository;
  const service = new ReaderService(() => { repository = ReaderRepository.open(file); repository.initializeDemo(); return repository; }, ['en'], () => undefined, undefined, {}, undefined, undefined, { databasePath: file, dialogs, restart });
  services.push(service);
  const windowIds = [repository.initialWindowId(), repository.createPersistentWindow()];
  repository.changeWorkspace('openStoredItem', 'post-demo', undefined, windowIds[1]);
  const callers: ReaderCallerContext[] = alive.map((_, index) => ({ windowId: windowIds[index], rendererLease: randomUUID(), isCurrent: () => alive[index] }));
  const lifecycle = new ProfileOperationCoordinator(() => callers.filter(c => c.isCurrent()), (caller, event) => { events[callers.indexOf(caller)].push(event); },
    () => service.profileStamp(), (caller, command) => service.drainCheckpoint(caller, command), 15000,
    (command, caller) => service.profileCheckpointAllowed(command, caller));
  service.attachLifecycle(lifecycle);
  function drain(index: number) {
    const event = lifecycle.current(); if (!event) throw new Error('No operation');
    const command: DrainCommand = { kind: 'view', request: { viewId: required(Object.entries(repository.viewInstances(windowIds[index])).find(([,v]) => v.itemId === (index === 0 ? 'video-demo' : 'post-demo')))[0], expectedRevision: required(Object.values(repository.viewInstances(windowIds[index])).find(v => v.itemId === (index === 0 ? 'video-demo' : 'post-demo'))).intentRevision, draft: { ...defaultQuery, text: `pending-${index}` }, applied: defaultQuery,
      sort: 'newest', selected: null, anchor: { commentId: null, offset: 0 } } };
    const plan = lifecycle.plan(callers[index], { operationId: event.operationId, profileEpoch: event.profileEpoch }, [command]);
    if (!plan.ok) throw new Error('Plan denied');
    const result = lifecycle.command(callers[index], plan.value, 0, command);
    lifecycle.ack(callers[index], plan.value, result.ok); return result;
  }
  function resume() { const event = lifecycle.current(); if (!event) return; callers.forEach(c => lifecycle.resume(c, { operationId: event.operationId, profileEpoch: event.profileEpoch })); }
  return { root, file, backup, service, repository, lifecycle, alive, callers, events, dialogs, restart, drain, resume };
}
it('snapshots both pending checkpoints only after the second participant; new mutations reject while sealed drains commit in M2 order', async () => {
  const s = setup(), commits: number[] = [];
  s.service.onSharedCommit(event => commits.push(event.commitRevision));
  const operation = s.service.dispatch('createBackup', [], s.callers[0]);
  expect(s.lifecycle.phase).toBe('DRAINING'); s.drain(1);
  expect(() => s.service.claimWindowIdentity(true)).toThrow('Profile busy');
  expect(s.dialogs.save).not.toHaveBeenCalled();
  expect(s.service.dispatch('toggleSeen', [{ itemId: 'video-demo', commentId: 'v1', seen: false, subtree: false }], s.callers[0])).toMatchObject({ error: { code: 'DATA_BUSY' } });
  expect(s.service.dispatch('getSharedMetadata', [], s.callers[1]).ok).toBe(true);
  s.drain(0); expect(await operation).toMatchObject({ value: { status: 'created' } });
  expect(commits).toEqual([4, 5]);
  const copy = ReaderRepository.open(s.backup);
  try { const state = copy.bootstrap(['en'], s.callers[0].windowId), peer = copy.bootstrap(['en'], s.callers[1].windowId); expect(Object.values(state.discussionViews)[0].draft.text).toBe('pending-0'); expect(Object.values(peer.discussionViews)[0].draft.text).toBe('pending-1'); } finally { copy.close(); }
  expect(s.service.transfersAllowed(s.callers[0])).toBe(false);
  expect(s.service.transfersAllowed(s.callers[1])).toBe(false);
  s.resume(); expect(s.lifecycle.blocks(s.callers[1])).toBe(false);
  expect(s.service.transfersAllowed(s.callers[0])).toBe(true);
});
it('failed COMMIT publishes nothing, aborts preflight, preserves storage and permits a reconciled retry', async () => {
  const s = setup(), before = s.repository.stamp(), events = vi.fn(); s.service.onSharedCommit(events);
  const exec = DatabaseSync.prototype.exec;
  let fail = true;
  const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    if (fail && sql === 'COMMIT') { fail = false; throw new Error('Injected COMMIT failure'); }
    return exec.call(this, sql);
  });
  const first = s.service.dispatch('createBackup', [], s.callers[0]);
  expect(s.drain(0).ok).toBe(false); expect(await first).toMatchObject({ error: { code: 'DATA_WRITE_FAILED' } });
  expect(s.repository.stamp()).toEqual(before); expect(events).not.toHaveBeenCalled(); expect(s.dialogs.save).not.toHaveBeenCalled();
  spy.mockRestore(); s.resume(); const retry = s.service.dispatch('createBackup', [], s.callers[0]); s.drain(0); s.drain(1);
  expect(await retry).toMatchObject({ value: { status: 'created' } }); s.resume();
});
it('native cancellation and failed snapshot release safely, then a later backup succeeds', async () => {
  const s = setup(); vi.mocked(s.dialogs.save).mockResolvedValueOnce(undefined);
  const cancelled = s.service.dispatch('createBackup', [], s.callers[0]); s.drain(0); s.drain(1);
  expect(await cancelled).toMatchObject({ value: { status: 'cancelled' } }); s.resume();
  const spy = vi.spyOn(s.repository, 'createBackup').mockRejectedValueOnce(new Error('Verification failure'));
  const failed = s.service.dispatch('createBackup', [], s.callers[0]); s.drain(0); s.drain(1);
  expect(await failed).toMatchObject({ error: { code: 'DATA_WRITE_FAILED' } }); s.resume(); spy.mockRestore();
  const retry = s.service.dispatch('createBackup', [], s.callers[1]); s.drain(1); s.drain(0);
  expect(await retry).toMatchObject({ value: { status: 'created' } }); s.resume();
});
it('origin loss during selection cancels globally without a snapshot or reparenting', async () => {
  const s = setup(); let choose!: (value: string) => void;
  vi.mocked(s.dialogs.save).mockImplementationOnce(() => new Promise(resolve => { choose = resolve; }));
  const pending = s.service.dispatch('createBackup', [], s.callers[0]); s.drain(0); s.drain(1);
  await vi.waitFor(() => expect(choose).toBeTypeOf('function'));
  s.alive[0] = false; s.lifecycle.lost(s.callers[0]); choose(s.backup);
  expect(await pending).toMatchObject({ value: { status: 'cancelled' } }); s.resume();
  expect(s.lifecycle.phase).toBe('RELEASED'); expect(s.dialogs.save).toHaveBeenCalledWith('en', s.callers[0]);
});
it('confirmed restore replaces offline with all old commands fenced and a fresh repository epoch on reopen', async () => {
  const s = setup(), oldEpoch = s.repository.stamp().profileEpoch;
  const backup = s.service.dispatch('createBackup', [], s.callers[0]); s.drain(0); s.drain(1); await backup; s.resume();
  const restore = s.service.dispatch('restoreBackup', [], s.callers[1]); s.drain(0); s.drain(1);
  expect(await restore).toMatchObject({ value: { status: 'restarting' } });
  expect(s.lifecycle.phase).toBe('RESTARTING');
  expect(s.service.dispatch('saveDiscussionView', [{ itemId: 'video-demo' }], s.callers[0])).toMatchObject({ error: { code: 'DATA_BUSY' } });
  expect(validateBackup(s.file)).toBe(15);
  const reopened = ReaderRepository.open(s.file); try { expect(reopened.stamp().profileEpoch).not.toBe(oldEpoch); } finally { reopened.close(); }
});

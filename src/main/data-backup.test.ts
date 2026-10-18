import { required } from '../renderer/testing/required';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderService } from './reader-service';
import { ReaderRepository } from './persistence/reader-repository';
import type { DataBackupDialogs } from './data-backup-dialogs';
import { validateBackup } from './persistence/backup-validation';
import { recoveryDirectory } from './persistence/profile-restore';
import { defaultQuery } from '../domain/discussion-query';
import type { ExtractLive } from './live-extraction';

// Real SQLite/filesystem work may be delayed by Windows scanning or suite load.
// This is a hang guard; no test asserts an arbitrary operation-time threshold.
vi.setConfig({ testTimeout: 30000 });

let root: string, file: string, service: ReaderService;
let dialogs: DataBackupDialogs, restart: ReturnType<typeof vi.fn>;
let diagnostics: unknown[];
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'reader-data-service-')); file = path.join(root, 'profile', 'reader.sqlite');
  dialogs = { save: vi.fn(async () => path.join(root, 'snapshot.sqlite')), select: vi.fn(async () => path.join(root, 'snapshot.sqlite')), confirm: vi.fn(async () => true) };
  restart = vi.fn();
  diagnostics = [];
});
afterEach(async () => {
  await service?.shutdown();
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-data-service-')) throw new Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
});
function start(extract?: ExtractLive, checkpoint?: (phase: string) => void) {
  service = new ReaderService(() => { const repo = ReaderRepository.open(file); repo.initializeDemo(); return repo; }, ['en'], error => diagnostics.push(error), extract, {}, undefined, undefined,
    { databasePath: file, dialogs, restart, checkpoint });
}
it('requires payload-free semantic intents and respects cancelled Save/Open/confirmation', async () => {
  start(); const before = readFileSync(file);
  for (const operation of ['createBackup', 'restoreBackup'] as const) {
    expect(await service.dispatch(operation, [{ path: 'evil' }])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  }
  vi.mocked(dialogs.save).mockResolvedValueOnce(undefined);
  expect(await service.dispatch('createBackup', [])).toMatchObject({ value: { status: 'cancelled' } });
  vi.mocked(dialogs.select).mockResolvedValueOnce(undefined);
  expect(await service.dispatch('restoreBackup', [])).toMatchObject({ value: { status: 'cancelled' } });
  await service.dispatch('createBackup', []); vi.mocked(dialogs.confirm).mockResolvedValueOnce(false);
  expect(await service.dispatch('restoreBackup', [])).toMatchObject({ value: { status: 'cancelled' } });
  expect(readFileSync(file)).toEqual(before); expect(restart).not.toHaveBeenCalled();
});
it('commits earlier seen/view writes before backup, rejects stale writes and concurrent operations', async () => {
  start();
  service.dispatch('toggleSeen', [{ itemId: 'video-demo', commentId: 'v1', subtree: false, seen: false }]);
  const bootstrap = service.dispatch('bootstrap', []); if (!bootstrap.ok) throw new Error('No bootstrap');
  const viewId = required(Object.entries(bootstrap.value.viewInstances).find(([,v]) => v.itemId === 'video-demo'))[0];
  service.dispatch('saveDiscussionView', [{ viewId, expectedRevision: 0, draft: { ...defaultQuery, text: 'draft' }, applied: defaultQuery,
    sort: 'newest', anchor: { commentId: 'v1', offset: 22 }, selected: 'v2' }]);
  let choose!: (file: string) => void;
  vi.mocked(dialogs.save).mockImplementationOnce(() => new Promise(resolve => { choose = resolve; }));
  const operation = service.dispatch('createBackup', []);
  expect(service.dispatch('toggleSeen', [{ itemId: 'video-demo', commentId: 'v1', subtree: false, seen: false }])).toMatchObject({ error: { code: 'DATA_BUSY' } });
  expect(await service.dispatch('restoreBackup', [])).toMatchObject({ error: { code: 'DATA_BUSY' } });
  await vi.waitFor(() => expect(choose).toBeTypeOf('function')); choose(path.join(root, 'snapshot.sqlite')); await operation;
  const snapshot = ReaderRepository.open(path.join(root, 'snapshot.sqlite'));
  try {
    const state = snapshot.bootstrap(['en']); expect(state.comments['video-demo'].find(c => c.id === 'v1')?.seen).toBe(false);
    expect(state.discussionViews[viewId]).toMatchObject({ draft: { text: 'draft' }, sort: 'newest', anchor: { offset: 22 } });
  } finally { snapshot.close(); }
});
it('handles destination write/permission/disk failures with a stable code', async () => {
  start();
  for (const code of ['ENOSPC', 'EACCES', 'EPERM']) {
    vi.mocked(dialogs.save).mockRejectedValueOnce(Object.assign(new Error('private'), { code }));
    expect(await service.dispatch('createBackup', [])).toEqual({ ok: false, error: { code: 'DATA_WRITE_FAILED' } });
  }
  vi.mocked(dialogs.save).mockResolvedValueOnce(file);
  expect(await service.dispatch('createBackup', [])).toMatchObject({ error: { code: 'DATA_WRITE_FAILED' } });
});
it.each(['staged', 'safety'])('keeps current data usable after failure at %s before replacement', async phase => {
  start(undefined, at => { if (at === phase) throw new Error('Injected failure'); });
  await service.dispatch('createBackup', []); const previous = readFileSync(file);
  expect(await service.dispatch('restoreBackup', [])).toMatchObject({ error: { code: 'RESTORE_FAILED' } });
  expect(readFileSync(file)).toEqual(previous); expect(service.dispatch('bootstrap', []).ok).toBe(true);
  expect(service.dispatch('toggleSeen', [{ itemId: 'video-demo', commentId: 'v1', subtree: false, seen: false }]).ok).toBe(true);
  expect(restart).not.toHaveBeenCalled();
});
it('aborts when safety snapshot fails without closing or replacing the current connection', async () => {
  start(); await service.dispatch('createBackup', []);
  const actual = ReaderRepository.prototype.createBackup;
  const spy = vi.spyOn(ReaderRepository.prototype, 'createBackup').mockImplementation(function (this: ReaderRepository, destination) {
    return destination.endsWith('safety.sqlite') ? Promise.reject(new Error('ENOSPC')) : actual.call(this, destination);
  });
  try {
    const previous = readFileSync(file);
    expect(await service.dispatch('restoreBackup', [])).toMatchObject({ error: { code: 'RESTORE_FAILED' } });
    expect(readFileSync(file)).toEqual(previous); expect(service.dispatch('bootstrap', []).ok).toBe(true);
  } finally { spy.mockRestore(); }
});
it('settles active acquisition and blocks stale IPC until restart, with a separate verified safety copy', async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const extract: ExtractLive = async (_target, signal) => {
    started(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { error: 'ACQUISITION_FAILED', extraction: { provenance: { backend: 'test', version: '1', evidence: [] }, coverage: { kind: 'failed', reason: 'aborted' }, issues: [] } };
  };
  start(extract); expect(await service.dispatch('createBackup', [])).toMatchObject({ value: { status: 'created' } });
  const acquisition = service.dispatch('acquire', [{ url: 'https://www.youtube.com/watch?v=abcdefghijk' }]); await ready;
  expect(await service.dispatch('createBackup', [])).toMatchObject({ error: { code: 'DATA_BUSY' } });
  const restored = await service.dispatch('restoreBackup', []);
  expect(restored, diagnostics.map(error => error instanceof Error ? error.stack : String(error)).join('\n')).toMatchObject({ value: { status: 'restarting' } }); await acquisition;
  expect(service.dispatch('toggleSeen', [{ itemId: 'video-demo', commentId: 'v1', subtree: false, seen: false }])).toMatchObject({ error: { code: 'DATA_BUSY' } });
  await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  const directory = path.join(recoveryDirectory(file), readdirSync(recoveryDirectory(file))[0]);
  expect(validateBackup(path.join(directory, 'safety.sqlite'))).toBe(13); expect(validateBackup(file)).toBe(13);
});
it('settles an in-flight backup before shutdown closes the database', async () => {
  start(); let finish!: (file: string) => void;
  vi.mocked(dialogs.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const backup = service.dispatch('createBackup', []); await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  const shutdown = service.shutdown(); finish(path.join(root, 'cancelled.sqlite'));
  expect(await backup).toMatchObject({ value: { status: 'cancelled' } }); await shutdown;
});

it('captures data-operation origin, cancels before confirmation, and completes confirmed restore after origin loss', async () => {
  let current = true, expireAt: string | undefined;
  const caller = { windowId: 'origin', rendererLease: 'lease', isCurrent: () => current };
  start(undefined, phase => { if (phase === expireAt) current = false; });
  await service.dispatch('createBackup', [], caller);
  expect(dialogs.save).toHaveBeenCalledWith('en', caller);
  expireAt = 'staged';
  expect(await service.dispatch('restoreBackup', [], caller)).toMatchObject({ value: { status: 'cancelled' } });
  expect(dialogs.select).toHaveBeenCalledWith('en', caller); expect(dialogs.confirm).not.toHaveBeenCalled();
  current = true; expireAt = 'safety';
  expect(await service.dispatch('restoreBackup', [], caller)).toMatchObject({ value: { status: 'restarting' } });
  expect(current).toBe(false); expect(dialogs.confirm).toHaveBeenCalledWith('en', caller);
  await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
});

it('does not create a backup if origin dies during native selection', async () => {
  start(); let current = true;
  const caller = { windowId: 'origin', rendererLease: 'lease', isCurrent: () => current };
  vi.mocked(dialogs.save).mockImplementationOnce(async () => { current = false; return path.join(root, 'snapshot.sqlite'); });
  expect(await service.dispatch('createBackup', [], caller)).toMatchObject({ value: { status: 'cancelled' } });
  expect(readdirSync(root)).not.toContain('snapshot.sqlite');
});

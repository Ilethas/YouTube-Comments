import { required } from '../renderer/testing/required';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DownloadManager } from './download-manager';
import { ReaderRepository } from './persistence/reader-repository';
import { normalizeYtDlp } from './extractors/yt-dlp';
import type { ExtractLive } from './live-extraction';
import type { ReaderCallerContext } from './caller-context';
import { downloadActive, downloadPending, isDownloadsSnapshot } from '../shared/downloads';
import type { DownloadsSnapshot } from '../shared/downloads';
import type { Result } from '../shared/reader-api';
import { ReaderService } from './reader-service';

function value<T>(result: Result<T>): T { if (!result.ok) throw Error(result.error.code); return result.value; }
const url = (n: number) => `https://www.youtube.com/watch?v=Video_${String(n).padStart(5, '0')}`;
const raw = JSON.parse(readFileSync(path.join(__dirname, 'extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
let repositoryClosed = false;
let root: string, repo: ReaderRepository, manager: DownloadManager;
let starts: string[], signals: Map<string, AbortSignal>, finish: Map<string, (failed?: boolean) => void>;
const extract: ExtractLive = async (target, signal, advance, report) => {
  starts.push(target.sourceId); signals.set(target.sourceId, signal); advance?.('fetching'); report?.({ fetched: 1755, estimatedTotal: 8721 });
  const failed = await new Promise<boolean>(resolve => {
    finish.set(target.sourceId, (failed = false) => resolve(failed));
    if (signal.aborted) resolve(true); else signal.addEventListener('abort', () => resolve(true), { once: true });
  });
  advance?.('processing');
  return failed ? { error: 'ACQUISITION_FAILED', extraction: { provenance: raw.context.provenance, issues: [], coverage: { kind: 'failed', reason: 'execution-failure' } } }
    : { extraction: normalizeYtDlp(JSON.stringify({ ...raw.raw, id: target.sourceId }), raw.context) };
};
const submit = (n: number, caller?: ReaderCallerContext) => value(manager.submit({ kind: 'acquire', url: url(n) }, caller)).job;
const jobs = () => manager.snapshot().jobs;
const wait = async (test: () => boolean) => vi.waitFor(() => expect(test()).toBe(true), { interval: 2 });
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'reader-downloads-')); repo = ReaderRepository.open(path.join(root, 'reader.sqlite'));
  repositoryClosed = false; starts = []; signals = new Map(); finish = new Map(); manager = new DownloadManager(repo, ['en'], extract);
});
afterEach(async () => {
  await manager.close(); if (!repositoryClosed) repo.close();
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-downloads-')) throw Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
});
it.each([1, 2, 3, 4] as const)('enforces %i slots and FIFO, including failure releasing a slot', async limit => {
  repo.updatePreferences({ maximumConcurrentDownloads: limit }, ['en']);
  const submitted = Array.from({ length: 8 }, (_, i) => submit(i));
  expect(starts).toEqual([]); // submission never waits for helper execution
  await wait(() => starts.length === limit);
  expect(jobs().filter(downloadActive)).toHaveLength(limit); expect(jobs().filter(j => j.state === 'queued')).toHaveLength(8 - limit);
  finish.get(submitted[0].sourceId)?.(true);
  await wait(() => starts.length === limit + 1);
  expect(starts).toEqual(submitted.slice(0, limit + 1).map(j => j.sourceId));
  expect(jobs().find(j => j.operationId === submitted[0].operationId)?.state).toBe('failed');
});
it('raises the limit immediately; lowering it keeps children alive and waits for enough slots', async () => {
  repo.updatePreferences({ maximumConcurrentDownloads: 1 }, ['en']);
  Array.from({ length: 8 }, (_, i) => submit(i)); await wait(() => starts.length === 1);
  repo.updatePreferences({ maximumConcurrentDownloads: 4 }, ['en']); manager.schedule(); await wait(() => starts.length === 4);
  repo.updatePreferences({ maximumConcurrentDownloads: 2 }, ['en']); manager.schedule();
  expect([...signals.values()].every(s => !s.aborted)).toBe(true);
  for (const source of starts.slice(0, 2)) finish.get(source)?.();
  await wait(() => jobs().filter(j => j.state === 'completed').length === 2);
  expect(starts).toHaveLength(4);
  finish.get(starts[2])?.(); await wait(() => starts.length === 5);
});
it('deduplicates canonical variants across callers and mixed intents; joins Acquire to Refresh', async () => {
  const a: ReaderCallerContext = { windowId: repo.initialWindowId(), rendererLease: 'a', isCurrent: () => true };
  const b: ReaderCallerContext = { windowId: repo.createPersistentWindow(), rendererLease: 'b', isCurrent: () => true };
  const first = submit(1, a); await wait(() => starts.length === 1); finish.get(first.sourceId)?.(); await wait(() => jobs()[0].state === 'completed');
  const itemId = required(jobs()[0].itemId);
  const refresh = value(manager.submit({ kind: 'refresh', itemId }, a));
  const same = value(manager.submit({ kind: 'acquire', url: `https://youtu.be/${first.sourceId}?list=ignored&t=7` }, b));
  expect(same.reused).toBe(true); expect(same.job.operationId).toBe(refresh.job.operationId); expect(same.job.kind).toBe('refresh');
  expect(value(manager.submit({ kind: 'refresh', itemId }, b)).job.operationId).toBe(refresh.job.operationId);
  await wait(() => starts.length === 2); finish.get(first.sourceId)?.(); await wait(() => jobs().every(j => !downloadPending(j)));
  expect(repo.workspace(b.windowId).tabs.some(t => t.kind === 'discussion' && t.itemId === itemId)).toBe(true);
  expect(starts).toHaveLength(2); expect(repo.history()).toHaveLength(2);
});
it('cancels queued entries without starting them and rejects stale identities after retry', async () => {
  repo.updatePreferences({ maximumConcurrentDownloads: 1 }, ['en']);
  const first = submit(0), queued = submit(1); expect(manager.cancel(queued.operationId).ok).toBe(true);
  const retried = value(manager.retry(queued.operationId)).job; expect(retried.operationId).not.toBe(queued.operationId);
  expect(manager.cancel(queued.operationId).ok).toBe(false);
  await wait(() => starts.length === 1); finish.get(first.sourceId)?.(); await wait(() => starts.length === 2);
  expect(jobs().find(j => j.operationId === retried.operationId)?.state).toBe('fetching');
  expect(repo.history()).toHaveLength(1); // queue cancellation is not an extraction attempt
});
it('cancels only the selected active child, records a preserving failure, and automatically starts another', async () => {
  const submitted = Array.from({ length: 4 }, (_, i) => submit(i)); await wait(() => starts.length === 3);
  expect(manager.cancel(submitted[0].operationId).ok).toBe(true);
  expect(signals.get(submitted[0].sourceId)?.aborted).toBe(true); expect(signals.get(submitted[1].sourceId)?.aborted).toBe(false);
  await wait(() => starts.length === 4);
  expect(jobs()[0].state).toBe('cancelled'); expect(repo.history()[0].coverage).toMatchObject({ kind: 'failed', reason: 'user-cancelled' });
});
it('holds a cancelled slot until extractor child cleanup fully settles', async () => {
  await manager.close(); repo.updatePreferences({ maximumConcurrentDownloads: 1 }, ['en']);
  let release!: () => void;
  manager = new DownloadManager(repo, ['en'], async (target, signal) => {
    starts.push(target.sourceId);
    await new Promise<void>(resolve => { release = resolve; });
    expect(signal.aborted).toBe(true);
    return { extraction: { provenance: raw.context.provenance, issues: [], coverage: { kind: 'failed', reason: 'execution-failure' } } };
  });
  const first = submit(0); const second = submit(1); await wait(() => starts.length === 1);
  manager.cancel(first.operationId); await new Promise(resolve => setImmediate(resolve)); expect(starts).toHaveLength(1);
  manager.cancel(second.operationId); release(); await wait(() => jobs().every(j => !downloadPending(j)));
});
it('fans out identical bounded safe revisions and safe final results', async () => {
  const a: DownloadsSnapshot[] = [], b: DownloadsSnapshot[] = [];
  manager.onChanged(v => a.push(v)); manager.onChanged(v => b.push(v));
  const one = submit(1), two = submit(2); await wait(() => starts.length === 2);
  expect(a).toEqual(b); expect(a.every(isDownloadsSnapshot)).toBe(true);
  expect(a.every((v, i) => !i || v.revision > a[i - 1].revision)).toBe(true);
  finish.get(one.sourceId)?.(); finish.get(two.sourceId)?.(); await wait(() => jobs().every(j => j.state === 'completed'));
  expect(a).toEqual(b); expect(manager.snapshot()).toEqual(a.at(-1));
  expect(JSON.stringify(a)).not.toMatch(/stderr|executable|arguments|remote_json|provenance/);
});
it('old executor stage/count callbacks and cancellation cannot affect a newer same-source attempt', async () => {
  await manager.close();
  const callbacks: { stage: Parameters<ExtractLive>[2]; report: Parameters<ExtractLive>[3]; finish: () => void }[] = [];
  manager = new DownloadManager(repo, ['en'], async (target, signal, stage, report) => {
    stage?.('fetching');
    await new Promise<void>(resolve => { callbacks.push({ stage, report, finish: resolve }); signal.addEventListener('abort', () => resolve(), { once: true }); });
    return { extraction: normalizeYtDlp(JSON.stringify({ ...raw.raw, id: target.sourceId }), raw.context) };
  });
  const first = submit(1); await wait(() => callbacks.length === 1); callbacks[0].finish();
  await wait(() => jobs()[0].state === 'completed');
  const second = submit(1); await wait(() => callbacks.length === 2); const before = manager.snapshot();
  callbacks[0].stage?.('saving'); callbacks[0].report?.({ fetched: 100, estimatedTotal: 200 });
  expect(manager.cancel(first.operationId).ok).toBe(false); expect(manager.snapshot()).toEqual(before);
  expect(jobs().find(j => j.operationId === second.operationId)?.state).toBe('fetching');
  callbacks[1].finish(); await wait(() => jobs().every(j => !downloadPending(j)));
});
it('preserves manual seen and recovery while independent refreshes commit in serialized transactions', async () => {
  const first = submit(1), second = submit(2); await wait(() => starts.length === 2);
  finish.get(first.sourceId)?.(); finish.get(second.sourceId)?.(); await wait(() => jobs().every(j => j.state === 'completed'));
  const ids = jobs().map(j => required(j.itemId));
  const recoveries = ids.map(itemId => repo.bulkSeen({ itemId, seen: true, target: { kind: 'all' } }).undo);
  ids.forEach(itemId => value(manager.submit({ kind: 'refresh', itemId })));
  await wait(() => starts.length === 4);
  ids.forEach(itemId => { const comment = repo.bootstrap(['en']).comments[itemId][0]; repo.toggleSeen({ itemId, commentId: comment.id, seen: false, subtree: false }); });
  finish.get(first.sourceId)?.(); finish.get(second.sourceId)?.(); await wait(() => jobs().every(j => j.state === 'completed'));
  const snapshot = repo.bootstrap(['en']);
  ids.forEach((id, i) => { expect(snapshot.comments[id][0].seen).toBe(false); expect(snapshot.comments[id].slice(1).every(c => c.seen)).toBe(true); expect(snapshot.seenUndo[id]).toEqual(recoveries[i]); });
  expect(repo.history()).toHaveLength(4);
});
it('survives originating tab close/lease loss and saves to Library without opening a peer tab', async () => {
  let authorized = true;
  const origin = { windowId: repo.initialWindowId(), rendererLease: 'lease', isCurrent: () => authorized };
  const peer = repo.createPersistentWindow(), before = repo.workspace(peer);
  const job = submit(1, origin); await wait(() => starts.length === 1); authorized = false;
  finish.get(job.sourceId)?.(); await wait(() => jobs()[0].state === 'completed');
  expect(repo.bootstrap(['en']).items).toHaveLength(1); expect(repo.workspace(peer)).toEqual(before); expect(repo.workspace(origin.windowId).tabs).toEqual([]);
});
it('shutdown revokes queued scheduler callbacks and drains every active child without writing accepted history', async () => {
  Array.from({ length: 8 }, (_, i) => submit(i)); await wait(() => starts.length === 3);
  await manager.close(); expect(starts).toHaveLength(3); expect(jobs().every(j => j.state === 'cancelled')).toBe(true);
  expect([...signals.values()].every(s => s.aborted)).toBe(true); expect(repo.history()).toEqual([]);
  expect(manager.submit({ kind: 'acquire', url: url(9) })).toMatchObject({ error: { code: 'DATA_BUSY' } });
});
it('shutdown before the scheduling microtask starts no children', async () => {
  submit(1); submit(2); await manager.close(); expect(starts).toEqual([]);
});
it('bounds pending work to 128 and recent settled history to 32', async () => {
  for (let i = 0; i < 128; i++) submit(i);
  expect(manager.submit({ kind: 'acquire', url: url(128) })).toMatchObject({ error: { code: 'ACQUISITION_BUSY' } });
  for (const job of jobs()) manager.cancel(job.operationId);
  expect(jobs()).toHaveLength(32); expect(isDownloadsSnapshot(manager.snapshot())).toBe(true);
});
it('validates submission/cancellation/retry arity, leases, safe snapshots and protects queued stored items', async () => {
  await manager.close(); const service = new ReaderService(() => repo, ['en'], vi.fn(), extract);
  for (const request of [{ kind: 'acquire', url: url(1), executable: 'bad' }, { kind: 'refresh', itemId: 'x', url: url(1) }, { kind: 'other', url: url(1) }])
    expect(service.dispatch('submitDownload', [request])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('getDownloads', [{}])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('cancelDownload', [{ operationId: 'x', pid: 1 }])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('retryDownload', [])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  const revoked = { windowId: repo.initialWindowId(), rendererLease: 'old', isCurrent: () => false };
  for (const operation of ['dismissDownload', 'clearFinishedDownloads'] as const) {
    expect(service.dispatch(operation, operation === 'dismissDownload' ? [{ operationId: 'old' }] : [], revoked)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(service.dispatch(operation, [{ operationId: 'x', extra: true }])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  }
  expect(service.dispatch('dismissDownload', [])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('dismissDownload', [{ operationId: 'missing' }])).toMatchObject({ error: { code: 'NOT_FOUND' } });
  expect(service.dispatch('submitDownload', [{ kind: 'acquire', url: url(1) }], revoked)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  const accepted = value(service.dispatch('submitDownload', [{ kind: 'acquire', url: url(1) }])).job;
  await wait(() => starts.length === 1); finish.get(accepted.sourceId)?.();
  await wait(() => value(service.dispatch('getDownloads', [])).jobs[0].state === 'completed');
  const itemId = required(value(service.dispatch('getDownloads', [])).jobs[0].itemId);
  service.dispatch('submitDownload', [{ kind: 'refresh', itemId }]);
  expect(service.dispatch('removeLibraryItem', [{ itemId }])).toMatchObject({ error: { code: 'ACQUISITION_BUSY' } });
  expect(isDownloadsSnapshot(value(service.dispatch('getDownloads', [])))).toBe(true);
  await service.shutdown(); repositoryClosed = true;
});
it('dismisses completed/failed/cancelled projections and clears only settled entries without any repository change', async () => {
  const a: DownloadsSnapshot[] = [], b: DownloadsSnapshot[] = [];
  manager.onChanged(v => a.push(v)); manager.onChanged(v => b.push(v));
  const one = submit(1), two = submit(2), three = submit(3), queued = submit(4), running = submit(5);
  manager.cancel(three.operationId);
  await wait(() => starts.length === 3);
  expect(manager.dismiss(one.operationId).ok).toBe(false);
  expect(manager.dismiss(running.operationId).ok).toBe(false);
  finish.get(one.sourceId)?.(); finish.get(two.sourceId)?.(true);
  await wait(() => jobs().filter(j => !downloadPending(j)).length === 3);
  const itemId = required(jobs().find(j => j.operationId === one.operationId)?.itemId);
  repo.bulkSeen({ itemId, seen: true, target: { kind: 'all' } });
  const before = repo.bootstrap(['en']), history = repo.history(), stamp = repo.stamp();
  expect(manager.dismiss(queued.operationId).ok).toBe(false);
  for (const job of [one, two, three]) {
    const revision = manager.snapshot().revision;
    expect(manager.dismiss(job.operationId).ok).toBe(true);
    expect(manager.snapshot().revision).toBeGreaterThan(revision);
    expect(manager.dismiss(job.operationId)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(manager.retry(job.operationId).ok).toBe(false);
  }
  const cancelled = submit(6); manager.cancel(cancelled.operationId);
  expect(manager.clearFinished().ok).toBe(true);
  expect(jobs().every(downloadPending)).toBe(true);
  expect(jobs()).toHaveLength(2);
  expect(repo.bootstrap(['en'])).toEqual(before); expect(repo.history()).toEqual(history); expect(repo.stamp()).toEqual(stamp);
  expect(a).toEqual(b); expect(a.every(isDownloadsSnapshot)).toBe(true);
  const revision = manager.snapshot().revision; manager.clearFinished(); expect(manager.snapshot().revision).toBe(revision);
});
it('publishes sanitized per-job early titles beside progress, fences late callbacks and retains stored titles', async () => {
  await manager.close();
  const callbacks = new Map<string, NonNullable<Parameters<ExtractLive>[4]>>();
  manager = new DownloadManager(repo, ['en'], (target, signal, stage, progress, title) => {
    callbacks.set(target.sourceId, required(title)); return extract(target, signal, stage, progress);
  });
  const one = submit(1), two = submit(2); await wait(() => starts.length === 2);
  callbacks.get(one.sourceId)?.('  <b>Title</b>\u0000\n\u202e' + 'x'.repeat(250));
  const updated = required(jobs().find(j => j.operationId === one.operationId));
  expect(updated.label.startsWith('<b>Title</b>')).toBe(true); expect(updated.label).toHaveLength(178);
  expect(updated.comments).toEqual({ fetched: 1755, estimatedTotal: 8721 }); expect(updated.sourceId).toBe(one.sourceId);
  callbacks.get(two.sourceId)?.('Second title'); expect(jobs()[1].label).toBe('Second title');
  expect(isDownloadsSnapshot(manager.snapshot())).toBe(true);
  manager.cancel(two.operationId); const afterCancel = manager.snapshot(); callbacks.get(two.sourceId)?.('late'); expect(manager.snapshot()).toEqual(afterCancel);
  finish.get(one.sourceId)?.(); await wait(() => jobs().every(j => !downloadPending(j)));
  const stored = jobs()[0], refresh = value(manager.submit({ kind: 'refresh', itemId: required(stored.itemId) })).job;
  await wait(() => starts.length === 3); const before = manager.snapshot(); callbacks.get(one.sourceId)?.('Replace known title');
  expect(manager.snapshot()).toEqual(before); expect(jobs().find(j => j.operationId === refresh.operationId)?.label).toBe(stored.label);
});

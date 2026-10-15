import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReaderRepository } from './persistence/reader-repository';
import { AcquisitionService } from './acquisition-service';
import { createLiveExtractor } from './live-extraction';
import type { ExecuteProcess, ProcessOutcome, ProcessRequest } from './helper-process';
import type { AcquisitionNotification, AcquisitionProgress } from '../shared/acquisition';
import { isAcquisitionNotification } from '../shared/acquisition';
import { defaultQuery } from '../domain/discussion-query';
import { normalizeYtDlp } from './extractors/yt-dlp';
import { ReaderService } from './reader-service';
import { isNewDiscovery } from '../domain/discussion';
const video = 'https://www.youtube.com/watch?v=VidDemo_001';
const post = 'https://www.youtube.com/post/UgkDemoPost_0123456789';
const success = (stdout = ''): ProcessOutcome => ({ status: 'exited', exitCode: 0, stdout, stderr: '' });
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let directory: string, repo: ReaderRepository;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'reader-progress-')); repo = ReaderRepository.open(path.join(directory, 'reader.sqlite')); });
afterEach(async () => { repo.close(); await rm(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });
async function payload(community: boolean) { return JSON.parse(await readFile(path.join(__dirname, 'extractors/__fixtures__', community ? 'community-thread-a.json' : 'yt-nested-a.json'), 'utf8')).raw; }
async function output(request: ProcessRequest, community: boolean, discovery = false) {
  if (request.arguments.includes('--version')) return success(community ? 'post-archiver 0.4.0' : '2026.08.19');
  const data = await payload(community);
  if (discovery) {
    const comments = community ? data.posts[0].comments : data.comments;
    comments.push({ ...comments[0], id: 'later-discovered', replies: [] });
  }
  const raw = JSON.stringify(data);
  if (!community) return success(raw);
  if (!request.cwd) throw new Error('Expected workspace');
  await writeFile(path.join(request.cwd, 'output/posts_unknown_20261003_120000.json'), raw);
  return success();
}
function extract(execute: ExecuteProcess) { return createLiveExtractor({ execute, resolve: async () => 'C:/private/helper.exe', temporaryRoot: directory }); }
it('cancel and current-status commands enforce exact arity/identity-only requests', async () => {
  const service = new ReaderService(() => repo, ['en']);
  for (const args of [[], [null], [{}], [{ operationId: '' }], [{ operationId: 'safe', pid: 123 }], [{ operationId: 'safe' }, {}]])
    expect(service.dispatch('cancelAcquisition', args)).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('cancelAcquisition', [{ operationId: 'completed-id' }])).toMatchObject({ error: { code: 'NOT_FOUND' } });
  expect(service.dispatch('getAcquisitionProgress', [])).toEqual({ ok: true, value: null });
  expect(service.dispatch('getAcquisitionProgress', [{}])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
});
it.each([false, true])('ordered safe stages, stable opaque identity and settlement for Community=%s', async community => {
  const notifications: AcquisitionNotification[] = [];
  const service = new AcquisitionService(repo, ['en'], extract(request => output(request, community)), value => notifications.push(value));
  const first = await service.acquire(community ? post : video);
  expect(first.ok).toBe(true);
  const stages = notifications.filter((n): n is AcquisitionProgress => !('settled' in n));
  expect(stages.map(n => n.stage)).toEqual(['checking-helper', 'preparing', 'fetching', 'processing', 'saving']);
  expect(new Set(notifications.map(n => n.operationId)).size).toBe(1);
  expect(notifications.every(isAcquisitionNotification)).toBe(true);
  expect(stages.at(-1)?.cancellable).toBe(false);
  expect(JSON.stringify(notifications)).not.toMatch(/private|executable|stderr|arguments|cwd|cookies/);
  expect(notifications.at(-1)).toEqual({ operationId: stages[0].operationId, settled: true });
  expect(service.current()).toBeNull();
  await service.acquire(community ? post : video);
  expect(notifications.at(-1)?.operationId).not.toBe(stages[0].operationId);
});
it.each([false, true])('fetch cancellation awaits child settlement, preserves all state and cleans Community=%s', async community => {
  let blocking = false, discovery = false;
  const entered = gate<ProcessRequest>(), closed = gate<ProcessOutcome>();
  const execute: ExecuteProcess = async request => {
    if (blocking && !request.arguments.includes('--version')) { entered.resolve(request); return closed.promise; }
    return output(request, community, discovery);
  };
  const service = new AcquisitionService(repo, ['en'], extract(execute));
  const first = await service.acquire(community ? post : video);
  if (!first.ok) throw new Error('Expected acquisition');
  const itemId = first.value.summary.itemId;
  // Establish a post-baseline accepted attempt before cancellation, then local state.
  discovery = true;
  await service.refresh(itemId);
  repo.bulkSeen({ itemId, seen: true, target: { kind: 'all' } });
  repo.saveDiscussionView({ itemId, draft: { ...defaultQuery, text: 'draft' }, applied: defaultQuery,
    sort: 'oldest', anchor: { commentId: first.value.state.comments[itemId][0].id, offset: 12 }, selected: null });
  const before = repo.bootstrap(['en']), history = repo.history(itemId);
  expect(before.comments[itemId].some(comment => comment.source?.commentId === 'later-discovered')).toBe(true);
  const item = before.items.find(item => item.id === itemId); if (!item) throw new Error('Expected stored item');
  expect(before.comments[itemId].filter(comment => isNewDiscovery(item, comment))).toHaveLength(1);
  blocking = true;
  const pending = service.refresh(itemId);
  const child = await entered.promise;
  const current = service.current(); if (!current) throw new Error('Expected progress');
  const oldId = current.operationId;
  expect(service.cancel(oldId)).toEqual({ ok: true, value: null });
  expect(child.signal?.aborted).toBe(true);
  let settled = false; void pending.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  if (community) { if (!child.cwd) throw new Error('Expected workspace'); expect(await readdir(child.cwd)).toContain('output'); }
  closed.resolve({ ...success(), status: 'aborted' });
  expect(await pending).toEqual({ ok: false, error: { code: 'ACQUISITION_CANCELLED' } });
  expect(repo.bootstrap(['en'])).toEqual(before);
  expect(repo.history(itemId).slice(0, -1)).toEqual(history);
  expect(repo.history(itemId).at(-1)).toMatchObject({ outcome: 'failed', coverage: { kind: 'failed', reason: 'user-cancelled' } });
  expect((await readdir(directory)).filter(name => name.startsWith('youtube-comments-acquisition-'))).toEqual([]);
  expect(service.cancel(oldId)).toMatchObject({ error: { code: 'NOT_FOUND' } });
  blocking = false;
  expect((await service.refresh(itemId)).ok).toBe(true);
});
it('cancellation during an active version probe reaches the child signal and awaits close', async () => {
  const entered = gate<ProcessRequest>(), closed = gate<ProcessOutcome>();
  const service = new AcquisitionService(repo, ['en'], extract(request => { entered.resolve(request); return closed.promise; }));
  const pending = service.acquire(video), child = await entered.promise;
  expect(child.arguments).toContain('--version');
  const current = service.current(); if (!current) throw new Error('Expected current operation');
  service.cancel(current.operationId);
  expect(child.signal?.aborted).toBe(true);
  closed.resolve({ ...success(), status: 'aborted' });
  expect(await pending).toMatchObject({ error: { code: 'ACQUISITION_CANCELLED' } });
  expect(repo.bootstrap(['en']).items).toEqual([]);
});
it.each(['checking-helper', 'preparing', 'processing'] as const)('cancellation in %s prevents new item/tab and records only failed target history', async stage => {
  const before = repo.bootstrap(['en']);
  const service = new AcquisitionService(repo, ['en'], extract(request => output(request, false)), n => {
    if (!('settled' in n) && n.stage === stage) service.cancel(n.operationId);
  });
  expect(await service.acquire(video)).toMatchObject({ error: { code: 'ACQUISITION_CANCELLED' } });
  expect(repo.bootstrap(['en'])).toEqual(before);
  expect(repo.history()).toHaveLength(1);
  expect(repo.history()[0]).toMatchObject({ outcome: 'failed', coverage: { reason: 'user-cancelled' } });
});
it('old operation cancellation cannot abort the next operation, including after saving begins', async () => {
  let oldId = '';
  const attempts: unknown[] = [];
  const service = new AcquisitionService(repo, ['en'], extract(request => output(request, false)), n => {
    if ('settled' in n) return;
    if (!oldId) oldId = n.operationId;
    else if (n.operationId !== oldId) attempts.push(service.cancel(oldId));
    if (n.stage === 'saving') attempts.push(service.cancel(n.operationId));
  });
  expect((await service.acquire(video)).ok).toBe(true);
  expect((await service.acquire(video)).ok).toBe(true);
  expect(attempts.every(result => JSON.stringify(result) === JSON.stringify({ ok: false, error: { code: 'NOT_FOUND' } }))).toBe(true);
  expect(repo.history().every(attempt => attempt.outcome === 'accepted')).toBe(true);
});
it('monotonic stage timings distinguish merge and bootstrap without sleeps', async () => {
  let now = 0;
  const raw = JSON.stringify(await payload(false));
  const ingest = repo.ingest.bind(repo), bootstrap = repo.bootstrap.bind(repo);
  vi.spyOn(repo, 'ingest').mockImplementation((...args) => { const value = ingest(...args); now += 50; return value; });
  vi.spyOn(repo, 'bootstrap').mockImplementation((...args) => { const value = bootstrap(...args); now += 60; return value; });
  const service = new AcquisitionService(repo, ['en'], async (_target, _signal, stage) => {
    if (!stage) throw new Error('Expected stage callback');
    now += 10; stage('preparing'); now += 20; stage('fetching'); now += 30; stage('processing'); now += 40;
    return { extraction: normalizeYtDlp(raw, { provenance: { backend: 'yt-dlp', version: 'test', evidence: [] } }) };
  }, undefined, () => now, () => 'opaque-test-id');
  const result = await service.acquire(video);
  expect(result).toMatchObject({ ok: true, value: { operationId: 'opaque-test-id', timings: {
    targetMs: 0, helperMs: 10, preparationMs: 20, fetchMs: 30, processingMs: 40, savingMs: 50, bootstrapMs: 60, totalMs: 210,
  } } });
  if (!result.ok) throw new Error('Expected accepted result');
  expect(await service.refresh(result.value.summary.itemId)).toMatchObject({ ok: true, value: { timings: { targetMs: 60, totalMs: 270 } } });
});
it('queued cancellation after normalized output wins the final checkpoint before Saving', async () => {
  const raw = JSON.stringify(await payload(false));
  let saving = false;
  const service = new AcquisitionService(repo, ['en'], async () => {
    const current = service.current(); if (!current) throw new Error('Expected operation');
    setImmediate(() => service.cancel(current.operationId));
    return { extraction: normalizeYtDlp(raw, { provenance: { backend: 'yt-dlp', version: 'test', evidence: [] } }) };
  }, n => { if (!('settled' in n) && n.stage === 'saving') saving = true; });
  expect(await service.acquire(video)).toMatchObject({ error: { code: 'ACQUISITION_CANCELLED' } });
  expect(saving).toBe(false);
  expect(repo.bootstrap(['en']).items).toEqual([]);
  expect(repo.history()[0].outcome).toBe('failed');
});
it('shutdown waits for child close and workspace cleanup without accepted or cancelled history', async () => {
  const entered = gate<ProcessRequest>(), closed = gate<ProcessOutcome>();
  const service = new AcquisitionService(repo, ['en'], extract(async request => {
    if (request.arguments.includes('--version')) return output(request, true);
    entered.resolve(request); return closed.promise;
  }));
  const pending = service.acquire(post), child = await entered.promise;
  const shutdown = service.close();
  expect(child.signal?.aborted).toBe(true);
  let settled = false; void shutdown.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  closed.resolve({ ...success(), status: 'aborted' });
  await shutdown; await pending;
  expect((await readdir(directory)).filter(name => name.startsWith('youtube-comments-acquisition-'))).toEqual([]);
  expect(repo.history()).toEqual([]);
});

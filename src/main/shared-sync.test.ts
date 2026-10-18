import { viewVersion } from './testing/view-identity';
import { required } from '../renderer/testing/required';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './persistence/reader-repository';
import { ReaderService } from './reader-service';
import { readerChannels } from '../shared/reader-api';
import type { ReaderOperation, Result } from '../shared/reader-api';
import type { SharedCommit, SharedSnapshot } from '../shared/reader-sync';
import { createReaderBridge } from '../preload/reader-bridge';
import { ReaderReplica } from '../renderer/reader-replica';
import { DiscussionViewSession } from '../renderer/discussion-view-session';
import { defaultQuery, evaluateDiscussionQuery } from '../domain/discussion-query';
import { normalizeYtDlp } from './extractors/yt-dlp';

let directory: string, file: string, repository: ReaderRepository, service: ReaderService;
let replicas: ReaderReplica[];
let helperVersion: string;
const fixture = JSON.parse(readFileSync(path.join(__dirname, 'extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-m2-test-')); file = path.join(directory, 'reader.sqlite');
  repository = ReaderRepository.open(file); repository.initializeDemo();
    helperVersion = '2026.08.19';
  const executable = path.join(directory, 'yt-dlp.exe'); writeFileSync(executable, 'test-only placeholder');
  service = new ReaderService(() => repository, ['en'], () => undefined, undefined, {
    environment: { YOUTUBE_COMMENTS_YTDLP_EXE: executable }, platform: 'win32',
    execute: async () => ({ status: 'exited', exitCode: 0, stdout: helperVersion, stderr: '' }),
  });
  replicas = [];
});
afterEach(async () => {
  for (const replica of replicas) replica.stop();
  await service.shutdown();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-m2-test-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
const state = () => repository.bootstrap(['en']);
const request = (seen: boolean) => ({ itemId: 'video-demo', commentId: 'v3', subtree: false, seen });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function participant() {
  let paused = false;
  const held: SharedCommit[] = [];
  let listener: ((event: unknown) => void) | undefined;
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    const operation = (Object.keys(readerChannels) as ReaderOperation[]).find(key => readerChannels[key] === channel);
    return service.dispatch(required(operation), args);
  });
  const transport = createReaderBridge(invoke, undefined, receive => {
    listener = receive;
    return service.onSharedCommit(event => { if (paused) held.push(event); else receive(event); });
  });
  const replica = new ReaderReplica(transport); replicas.push(replica);
  return { replica, transport, invoke, held, deliver: (e: unknown) => listener?.(e), pause: () => { paused = true; } };
}
const settle = async (replica: ReaderReplica) => { await replica.reconcile(repository.stamp()); };

it('orders each successful outer commit once; failures roll back revision, rows and notification', () => {
  const events: SharedCommit[] = [];
  repository.onCommit(event => events.push(event));
  repository.onCommit(() => { throw new Error('Destroyed recipient'); });
  const after = vi.fn(); repository.onCommit(after);
  const revision = repository.stamp().commitRevision;
  repository.toggleSeen(request(true));
  repository.updatePreferences({ translationTarget: 'custom', customTranslationTarget: 'uk' }, ['en']);
  repository.changeWorkspace('openSettings');
  expect(events.map(e => e.commitRevision)).toEqual([revision + 1, revision + 2, revision + 3]);
  expect(events[0].change).toMatchObject({ kind: 'seen', values: [{ id: 'v3', seen: true }] });
  expect(after).toHaveBeenCalledTimes(3);
  const before = state(), stamp = repository.stamp();
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER fail_m2 BEFORE UPDATE ON comment_state BEGIN SELECT RAISE(ABORT, 'injected'); END"); db.close();
  expect(() => repository.bulkSeen({ itemId: 'video-demo', seen: false, target: { kind: 'all' } })).toThrow('injected');
  expect(repository.stamp()).toEqual(stamp); expect(state()).toEqual(before); expect(events).toHaveLength(3);
});

it('a deferred foreign-key failure at COMMIT publishes nothing and preserves the previous recovery', () => {
  repository.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  const before = state(), stamp = repository.stamp(), events = vi.fn(); repository.onCommit(events);
  const db = new DatabaseSync(file);
  db.exec("CREATE TRIGGER fail_commit_m2 AFTER UPDATE ON comment_state BEGIN UPDATE app_windows SET active_tab_id='missing-tab'; END"); db.close();
  expect(() => repository.toggleSeen(request(false))).toThrow(/FOREIGN KEY/);
  expect(repository.stamp()).toEqual(stamp); expect(state()).toEqual(before); expect(events).not.toHaveBeenCalled();
});

it('revision exhaustion rejects before BEGIN and never wraps or publishes', () => {
  const before = state(), events = vi.fn(); repository.onCommit(events);
  Object.defineProperty(repository, 'commitRevision', { value: Number.MAX_SAFE_INTEGER });
  expect(() => repository.toggleSeen(request(true))).toThrow('Revision exhausted');
  expect(state()).toEqual(before); expect(repository.stamp().commitRevision).toBe(Number.MAX_SAFE_INTEGER);
  expect(events).not.toHaveBeenCalled();
});

it('two independent replicas converge; two captured same-state assignments never invert twice', async () => {
  const a = participant(), b = participant(); await Promise.all([a.replica.start(), b.replica.start()]);
  const capturedA = request(true), capturedB = request(true);
  await a.replica.api.toggleSeen(capturedA); await b.replica.api.toggleSeen(capturedB);
  await Promise.all([settle(a.replica), settle(b.replica)]);
  expect(a.replica.current).toEqual(state()); expect(b.replica.current).toEqual(state());
  expect(state().comments['video-demo'].find(c => c.id === 'v3')?.seen).toBe(true);
  // Small checkbox events do not fetch a full profile or any scoped content.
  expect(a.invoke.mock.calls.filter(call => call[0] === readerChannels.getSharedSnapshot)).toHaveLength(1);
});

it('command envelopes preceding notifications reconcile without full-profile reads for local saves', async () => {
  const a = participant(); await a.replica.start(); a.pause();
  await a.replica.api.toggleSeen(request(true));
  await a.replica.api.toggleSeen(request(false));
  await a.replica.api.saveDiscussionView({ ...viewVersion(repository, 'video-demo'), draft: defaultQuery, applied: defaultQuery,
    sort: 'original', anchor: { commentId: null, offset: 0 }, selected: null });
  expect(a.replica.current.comments).toEqual(state().comments);
  expect(a.invoke.mock.calls.filter(call => call[0] === readerChannels.getSharedSnapshot)).toHaveLength(1);
  for (const event of a.held.reverse()) a.deliver(event);
  await settle(a.replica);
  expect(a.invoke.mock.calls.filter(call => call[0] === readerChannels.getSharedSnapshot)).toHaveLength(1);
});

it('committed content waits for the existing DATA_BUSY preflight instead of failing or guessing state', async () => {
  const a = participant(), attempted = deferred<void>();
  let blocked = false, acknowledged = false;
  const replica = new ReaderReplica({ ...a.transport, getSharedSnapshot: async request => {
    if (blocked) { attempted.resolve(); return { ok: false, error: { code: 'DATA_BUSY' } }; }
    return a.transport.getSharedSnapshot(request);
  } });
  replicas.push(replica); await replica.start(); blocked = true;
  repository.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), undefined, true);
  const reply = replica.reconcile(repository.stamp()).then(() => { acknowledged = true; });
  await attempted.promise; await Promise.resolve();
  expect(acknowledged).toBe(false); expect(replica.current.items).toHaveLength(2);
  blocked = false; await reply;
  expect(acknowledged).toBe(true); expect(replica.current).toEqual(state());
});

it('a delayed successful reply cannot overwrite newer seen, preference, Undo or removal', async () => {
  const a = participant(); await a.replica.start();
  const original = a.transport.toggleSeen;
  const wait = deferred<Awaited<ReturnType<typeof original>>>();
  // Inject delayed replies through the main-only test transport.
  const transport = { ...a.transport, toggleSeen: async (r: Parameters<typeof original>[0]) => { const result = await original(r); await wait.promise; return result; } };
  const replica = new ReaderReplica(transport); replicas.push(replica); await replica.start();
  const late = replica.api.toggleSeen(request(true)); await Promise.resolve();
  repository.toggleSeen(request(false));
  repository.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  repository.updatePreferences({ translationTarget: 'custom', customTranslationTarget: 'uk-UA' }, ['en']);
  repository.removeLibraryItem('video-demo', ['en']);
  await settle(replica); wait.resolve({ ok: true, value: { comments: [], targetCount: 0, changedCount: 0, undo: null } });
  const reply = await late;
  expect(replica.current).toEqual(state());
  expect(reply.ok && reply.value.comments).toEqual([]);
  expect(replica.current.preferences.customTranslationTarget).toBe('uk-UA');
  expect(replica.current.items.some(i => i.id === 'video-demo')).toBe(false);
});

it('handles duplicates, reordering and gaps by authoritative recovery without guessing', async () => {
  const a = participant(); await a.replica.start(); a.pause();
  repository.toggleSeen(request(true)); repository.toggleSeen(request(false));
  a.deliver(a.held[1]); a.deliver(a.held[0]); a.deliver(a.held[1]);
  await settle(a.replica);
  expect(a.replica.current).toEqual(state()); expect(a.replica.stamp?.commitRevision).toBe(repository.stamp().commitRevision);
});

it('registers before bootstrap and ignores events already included in a delayed snapshot', async () => {
  const a = participant();
  const wait = deferred<Result<SharedSnapshot>>();
  const transport = { ...a.transport, getSharedSnapshot: vi.fn(() => wait.promise) };
  const replica = new ReaderReplica(transport); replicas.push(replica);
  const start = replica.start();
  repository.toggleSeen(request(true));
  wait.resolve({ ok: true, value: { ...repository.stamp(), state: state() } });
  await start; await settle(replica);
  expect(replica.current).toEqual(state()); expect(transport.getSharedSnapshot).toHaveBeenCalledTimes(1);
});

it('bounded queue overflow coalesces into a snapshot and recovers from the current revision', async () => {
  const a = participant(), wait = deferred<Result<SharedSnapshot>>();
  const transport = { ...a.transport, getSharedSnapshot: vi.fn().mockImplementationOnce(() => wait.promise).mockImplementation(a.transport.getSharedSnapshot) };
  const replica = new ReaderReplica(transport); replicas.push(replica); const start = replica.start();
  for (let n = 0; n < 80; n++) repository.toggleSeen(request(n % 2 === 0));
  wait.resolve({ ok: true, value: { ...repository.stamp(), state: state() } }); await start; await settle(replica);
  expect(replica.current).toEqual(state()); expect(transport.getSharedSnapshot.mock.calls.length).toBeLessThanOrEqual(2);
});

it('coalesces watermark polls while a previous check is still pending', async () => {
  const a = participant(), gate = deferred<Awaited<ReturnType<typeof a.transport.getSharedMetadata>>>();
  const metadata = vi.fn(() => gate.promise);
  const replica = new ReaderReplica({ ...a.transport, getSharedMetadata: metadata }); replicas.push(replica); await replica.start();
  const checks = Array.from({ length: 100 }, () => replica.check());
  expect(metadata).toHaveBeenCalledTimes(1);
  gate.resolve(await a.transport.getSharedMetadata()); await Promise.all(checks);
  expect(replica.current).toEqual(state());
});

it('discarded renderer incarnations cannot install an old pending bootstrap after restart', async () => {
  const a = participant(), gate = deferred<Result<SharedSnapshot>>();
  const old = { ...repository.stamp(), state: state() };
  const getSharedSnapshot = vi.fn().mockImplementationOnce(() => gate.promise).mockImplementation(a.transport.getSharedSnapshot);
  const replica = new ReaderReplica({ ...a.transport, getSharedSnapshot }); replicas.push(replica);
  const first = replica.start(); await Promise.resolve(); replica.stop();
  repository.toggleSeen(request(true));
  const restart = replica.start(); gate.resolve({ ok: true, value: old });
  await Promise.all([first, restart]);
  expect(replica.current).toEqual(state()); expect(replica.stamp?.commitRevision).toBe(repository.stamp().commitRevision);
});

it('polling detects a lost final notification/subscription and reload reconstructs without a log', async () => {
  const a = participant(); await a.replica.start(); a.pause(); repository.toggleSeen(request(true));
  await a.replica.check(); expect(a.replica.current).toEqual(state());
  a.replica.stop(); const b = participant(); await b.replica.start(); expect(b.replica.current).toEqual(state());
  const obsolete = { ...repository.stamp(), profileEpoch: '00000000-0000-0000-0000-000000000000', commitRevision: 9999, change: { kind: 'removed', itemId: 'video-demo' } };
  b.deliver(obsolete); expect(b.replica.current.items).toHaveLength(2);
});

it('main restart/reopen replaces epoch; obsolete events and replies cannot replace the new replica', async () => {
  const a = participant(); await a.replica.start(); const old = repository.stamp();
  await service.shutdown(); repository = ReaderRepository.open(file);
  service = new ReaderService(() => repository, ['en'], () => undefined);
  repository.toggleSeen(request(true));
  await a.replica.check(); expect(a.replica.stamp?.profileEpoch).not.toBe(old.profileEpoch);
  await a.replica.reconcile({ ...old, commitRevision: 9000 });
  a.replica.receive({ ...old, commitRevision: 9000, change: { kind: 'removed', itemId: 'video-demo' } });
  expect(a.replica.current).toEqual(state());
});

it('stale expected Undo cannot consume a replacement; partial away-and-back Undo remains revision owned', async () => {
  const a = participant(), b = participant(); await Promise.all([a.replica.start(), b.replica.start()]);
  const first = await a.replica.api.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  if (!first.ok || !first.value.undo) throw new Error('Missing recovery');
  const expectedOperationId = first.value.undo.id;
  await b.replica.api.bulkSeen({ itemId: 'video-demo', seen: false, target: { kind: 'all' } });
  const before = state(), stamp = repository.stamp();
  const conflict = await a.replica.api.undoSeen({ itemId: 'video-demo', expectedOperationId });
  expect(conflict).toMatchObject({ ok: false, error: { code: 'UNDO_CONFLICT' } });
  expect(repository.stamp()).toEqual(stamp); expect(state()).toEqual(before); expect(a.replica.current).toEqual(before);
  repository.toggleSeen(request(true)); repository.toggleSeen(request(false));
  const undo = await b.replica.api.undoSeen({ itemId: 'video-demo', expectedOperationId: required(before.seenUndo['video-demo']).id });
  expect(undo.ok && undo.value.skipped).toBe(1); expect(state().comments['video-demo'].find(c => c.id === 'v3')?.seen).toBe(false);
  expect(state().seenUndo['video-demo']).toBeNull();
});

it('peer seen keeps frozen applied IDs, draft, sort and selection while live seen changes', async () => {
  const a = participant(); await a.replica.start();
  const session = new DiscussionViewSession(a.replica.current.comments['video-demo'], { evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: () => undefined });
  session.edit({ ...defaultQuery, seen: 'unseen' }); await session.apply(a.replica.current.comments['video-demo']);
  session.setSort('newest'); const result = session.state.result, sort = session.state.sort;
  session.edit({ ...session.state.draft, text: 'unapplied' }); const draft = session.state.draft;
  const unsubscribe = a.replica.subscribe(() => session.seenChanged());
  repository.toggleSeen(request(true)); await settle(a.replica);
  expect(session.state.result).toBe(result); expect(session.state.sort).toBe(sort); expect(session.state.draft).toBe(draft); expect(session.state.seenStale).toBe(true);
  unsubscribe(); session.dispose();
});

it('successful ingestion is ordered with preferences and explicit seen; delayed removed snapshots cannot resurrect', async () => {
  const a = participant(); await a.replica.start();
  repository.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), undefined, true);
  repository.updatePreferences({ appearance: 'dark' }, ['en']); await settle(a.replica);
  expect(a.replica.current).toEqual(state());
  const itemId = required(state().items.find(i => !i.isDemo)).id;
  const previous = { ...repository.stamp(), state: state() };
  repository.removeLibraryItem(itemId, ['en']); await settle(a.replica);
  await a.replica.reconcile(previous); expect(a.replica.current.items.some(i => i.id === itemId)).toBe(false);
});

it('a changed helper status invalidates every replica without status-query feedback loops', async () => {
  const a = participant(), b = participant(); await Promise.all([a.replica.start(), b.replica.start()]);
  const invalidation = vi.fn(); a.replica.api.onSharedCommit(invalidation); b.replica.api.onSharedCommit(invalidation);
  await a.replica.api.getHelperStatus({ kind: 'yt-dlp' }); const stamp = repository.stamp();
  helperVersion = '2026.10.18';
  await a.replica.api.getHelperStatus({ kind: 'yt-dlp' }); await Promise.all([settle(a.replica), settle(b.replica)]);
  expect(repository.stamp().commitRevision).toBe(stamp.commitRevision + 1);
  expect(invalidation.mock.calls.filter(([event]) => event.change.kind === 'helpers')).toHaveLength(2);
  await b.replica.api.getHelperStatus({ kind: 'yt-dlp' });
  expect(repository.stamp().commitRevision).toBe(stamp.commitRevision + 1);
});

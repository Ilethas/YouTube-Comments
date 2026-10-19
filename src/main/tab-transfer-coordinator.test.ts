import { afterEach, expect, it, vi } from 'vitest';
import { ReaderRepository } from './persistence/reader-repository';
import { TabTransferCoordinator } from './tab-transfer-coordinator';
import type { TransferWindows } from './tab-transfer-coordinator';
import type { ReaderCallerContext } from './caller-context';
import type { TransferEvent, TransferRequest } from '../shared/tab-transfer';
import { defaultQuery, queryComments, unrestrictedView } from '../domain/discussion-query';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { required } from '../renderer/testing/required';

const cleanup: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); cleanup.splice(0).forEach(f => f()); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-m7-coordinator-')), repo = ReaderRepository.open(path.join(root, 'reader.sqlite'));
  cleanup.push(() => { repo.close(); rmSync(root, { recursive: true }); }); repo.initializeDemo();
  let available = true, liveA = true, liveB = true;
  const a: ReaderCallerContext = { windowId: repo.initialWindowId(), rendererLease: 'a-lease', isCurrent: () => liveA };
  const b: ReaderCallerContext = { windowId: repo.createPersistentWindow(), rendererLease: 'b-lease', isCurrent: () => liveB };
  const c: ReaderCallerContext = { windowId: repo.createPersistentWindow(), rendererLease: 'c-lease', isCurrent: () => true };
  const tab = repo.workspace(a.windowId).tabs.find(t => t.kind === 'discussion'); if (!tab || tab.kind !== 'discussion') throw Error('fixture');
  const intent = { draft: defaultQuery, applied: defaultQuery, sort: 'original' as const, anchor: { commentId: null, offset: 0 }, selected: null };
  repo.saveDiscussionView({ viewId: tab.id, expectedRevision: 0, ...intent }, a.windowId);
  const result = unrestrictedView(queryComments(repo.itemSnapshot(tab.itemId).comments));
  const request: TransferRequest = { tabId: tab.id, expectedRevision: repo.workspace(a.windowId).revision,
    destination: { windowId: b.windowId, expectedRevision: 0, beforeTabId: null }, intentRevision: 1, collapseRevision: 0, ownerGeneration: null,
    handoff: { version: 1, viewId: tab.id, itemId: tab.itemId, intent, result, runtimeApplied: defaultQuery, restoreFailed: false, error: null, stamp: repo.stamp(), orderedIds: result.visibleCommentIds,
      mostLikedAvailable: false, seenStale: false, bulkSelected: [], bulkAnchor: null, selectionMode: false, discoveryId: null } };
  const events: { caller: ReaderCallerContext; event: TransferEvent }[] = [];
  let onPrepare: (() => void) | undefined;
  const windows: TransferWindows = { eligible: () => [a, b, c].filter(c => c.isCurrent()), send: (caller, event) => { events.push({ caller, event }); if (event.kind === 'prepare') onPrepare?.(); },
    focus: vi.fn(), create: vi.fn(() => ({ windowId: c.windowId, dispose: vi.fn() })) };
  const coordinator = new TabTransferCoordinator(repo, windows, () => available, 100);
  const preparation = async () => { await vi.waitFor(() => expect(events.some(e => e.event.kind === 'prepare')).toBe(true)); return required(events.find(e => e.event.kind === 'prepare')).event.token; };
  const move = (caller: ReaderCallerContext, value: unknown) => {
    const r = value as TransferRequest;
    const begun = coordinator.begin(caller, { tabId: r.tabId, expectedRevision: r.expectedRevision, destination: r.destination });
    return begun.ok ? coordinator.move(caller, { token: begun.value.token, request: value }).finally(() => { coordinator.cancel(caller, begun.value); }) : Promise.resolve(begun);
  };
  return { repo, a, b, c, tab, request, windows, coordinator, events, preparation, move,
    barrier: () => { available = false; coordinator.cancelAll(); }, loseA: () => { liveA = false; }, loseB: () => { liveB = false; },
    readyAutomatically: () => { onPrepare = () => { const event = events.at(-1); if (event) coordinator.ready(event.caller, { token: event.event.token, accept: true }); }; } };
}
it('prepares without authority, commits once, publishes topology and rejects replay/forged/wrong-lease readiness', async () => {
  const f = fixture(), before = f.repo.workspace(f.a.windowId), moving = f.move(f.a, f.request), token = await f.preparation();
  expect(f.repo.workspace(f.a.windowId)).toEqual(before); expect(f.repo.workspace(f.b.windowId).tabs).toHaveLength(0);
  expect(f.coordinator.destinations(f.c)).toEqual([]);
  expect(f.coordinator.ready(f.a, { token, accept: true }).ok).toBe(false);
  expect(f.coordinator.ready({ ...f.b }, { token, accept: true }).ok).toBe(false);
  expect(f.coordinator.ready(f.b, { token: 'forged', accept: true }).ok).toBe(false);
  expect(f.coordinator.ready(f.b, { token, accept: true }).ok).toBe(true);
  expect((await moving).ok).toBe(true);
  expect(f.coordinator.ready(f.b, { token, accept: true }).ok).toBe(false);
  expect((await f.move(f.a, f.request)).ok).toBe(false);
  expect(f.windows.focus).toHaveBeenCalledWith(f.b);
  expect(f.coordinator.liveHandoffs(f.b)[f.tab.id]).toEqual(f.request.handoff);
  expect(f.coordinator.liveHandoffs(f.a)).toEqual({});
});
it.each(['timeout', 'source-death', 'target-death', 'reject', 'barrier', 'seen', 'removed', 'source-topology', 'target-topology', 'cancel-source', 'cancel-target'])('%s before commit preserves source or authoritative removal and discards provisional readiness', async kind => {
  const f = fixture(), moving = f.move(f.a, f.request), token = await f.preparation();
  if (kind === 'source-death') f.loseA();
  if (kind === 'target-death') f.loseB();
  if (kind === 'reject') f.coordinator.ready(f.b, { token, accept: false });
  if (kind === 'barrier') f.barrier();
  if (kind === 'seen') f.repo.toggleSeen({ itemId: f.tab.itemId, commentId: 'v1', seen: true, subtree: false });
  if (kind === 'removed') f.repo.removeLibraryItem(f.tab.itemId, ['en'], f.a.windowId);
  if (kind === 'source-topology') { f.repo.changeWorkspace('openLibrary', undefined, undefined, f.a.windowId); f.coordinator.ready(f.b, { token, accept: true }); }
  if (kind === 'target-topology') { f.repo.changeWorkspace('openSettings', undefined, undefined, f.b.windowId); f.coordinator.ready(f.b, { token, accept: true }); }
  if (kind === 'cancel-source') f.coordinator.cancel(f.a, { token });
  if (kind === 'cancel-target') f.coordinator.cancel(f.b, { token });
  expect((await moving).ok).toBe(false);
  expect(f.repo.workspace(f.b.windowId).tabs.some(t => t.id === f.tab.id)).toBe(false);
  if (kind !== 'removed') expect(f.repo.ownedView(f.a.windowId, f.tab.id)).toBe(f.tab.itemId);
  expect(f.coordinator.ready(f.b, { token, accept: true }).ok).toBe(false);
});
it('overlapping same-view and simultaneous reverse transfers conflict without deadlock', async () => {
  const f = fixture(), first = f.move(f.a, f.request), token = await f.preparation();
  expect((await f.move(f.a, f.request)).ok).toBe(false);
  expect((await f.move(f.b, { ...f.request, destination: { windowId: f.a.windowId, expectedRevision: f.request.expectedRevision, beforeTabId: null } })).ok).toBe(false);
  f.coordinator.ready(f.b, { token, accept: true }); expect((await first).ok).toBe(true);
});
it('new-window construction failure keeps source; failed new readiness invokes cleanup; successful new window uses same transaction', async () => {
  const f = fixture(), dispose = vi.fn();
  vi.mocked(f.windows.create).mockImplementationOnce(() => { throw Error('creation failed'); });
  expect((await f.move(f.a, { ...f.request, destination: 'new' })).ok).toBe(false);
  vi.mocked(f.windows.create).mockReturnValue({ windowId: f.c.windowId, dispose });
  const moving = f.move(f.a, { ...f.request, destination: 'new' }), token = await f.preparation();
  f.coordinator.ready(f.c, { token, accept: false }); expect((await moving).ok).toBe(false); expect(dispose).toHaveBeenCalledOnce();
  f.readyAutomatically(); expect((await f.move(f.a, { ...f.request, destination: 'new' })).ok).toBe(true);
  expect(f.repo.ownedView(f.c.windowId, f.tab.id)).toBe(f.tab.itemId);
});
it('cross-epoch, malformed/oversized handoffs and a foreign comment identity fail closed', async () => {
  const f = fixture();
  for (const [request, code] of [[{ ...f.request, extra: true }, 'INVALID_REQUEST'], [{ ...f.request, handoff: { ...f.request.handoff, version: 99 } }, 'INVALID_REQUEST'],
    [{ ...f.request, handoff: { ...f.request.handoff, stamp: { profileEpoch: '00000000-0000-0000-0000-000000000000', commitRevision: 1 } } }, 'STATE_CONFLICT'],
    [{ ...f.request, handoff: { ...f.request.handoff, bulkSelected: Array(100001).fill('v1') } }, 'INVALID_REQUEST'],
    [{ ...f.request, handoff: { ...f.request.handoff, result: { ...f.request.handoff?.result, rawSearchMatchIds: ['foreign'] } } }, 'FORBIDDEN']]) {
    expect(await f.move(f.a, request)).toMatchObject({ ok: false, error: { code } });
  }
  expect(f.repo.ownedView(f.a.windowId, f.tab.id)).toBe(f.tab.itemId);
});
it('recipient failure after COMMIT cannot roll ownership back', async () => {
  const f = fixture(); f.readyAutomatically();
  const send = f.windows.send;
  f.windows.send = (caller, event) => { if (event.kind === 'committed') throw Error('dead'); send(caller, event); };
  expect((await f.move(f.a, f.request)).ok).toBe(true);
  expect(f.repo.ownedView(f.b.windowId, f.tab.id)).toBe(f.tab.itemId);
});
it('reservations are main-issued, exact-source and endpoint bound, expire before submission and cannot cancel a later move', async () => {
  const f = fixture(), start = { tabId: f.request.tabId, expectedRevision: f.request.expectedRevision, destination: f.request.destination };
  const first = f.coordinator.begin(f.a, start); if (!first.ok) throw Error('reservation');
  expect((await f.coordinator.move(f.c, { token: first.value.token, request: f.request })).ok).toBe(false);
  expect((await f.coordinator.move(f.a, { token: 'forged', request: f.request })).ok).toBe(false);
  expect((await f.coordinator.move(f.a, { token: first.value.token, request: { ...f.request, destination: 'new' } })).ok).toBe(false);
  expect(f.coordinator.cancel(f.c, first.value).ok).toBe(false);
  expect(f.coordinator.cancel(f.a, first.value).ok).toBe(true);
  const second = f.coordinator.begin(f.a, start); if (!second.ok) throw Error('reservation');
  expect(f.coordinator.cancel(f.a, first.value).ok).toBe(false);
  f.readyAutomatically(); expect((await f.coordinator.move(f.a, { token: second.value.token, request: f.request })).ok).toBe(true);
  expect((await f.coordinator.move(f.a, { token: second.value.token, request: f.request })).ok).toBe(false);
});
it('a pre-submission reservation deadline revokes its token and releases the source for retry', async () => {
  const f = fixture(), start = { tabId: f.request.tabId, expectedRevision: f.request.expectedRevision, destination: f.request.destination };
  const first = f.coordinator.begin(f.a, start); if (!first.ok) throw Error('reservation');
  await vi.waitFor(() => expect(f.events.some(e => e.event.kind === 'cancelled')).toBe(true));
  expect((await f.coordinator.move(f.a, { token: first.value.token, request: f.request })).ok).toBe(false);
  const retry = f.coordinator.begin(f.a, start); expect(retry.ok).toBe(true); f.coordinator.cancelAll();
});
it('adoption releases transient memory only for the current issued owner and document', async () => {
  const f = fixture(); f.readyAutomatically(); expect((await f.move(f.a, f.request)).ok).toBe(true);
  const ownerGeneration = required(f.repo.ownerAuthority(f.tab.id).ownerGeneration);
  expect(f.coordinator.adopted(f.a, { viewId: f.tab.id, ownerGeneration }).ok).toBe(false);
  expect(f.coordinator.adopted({ ...f.b }, { viewId: f.tab.id, ownerGeneration }).ok).toBe(false);
  expect(f.coordinator.adopted(f.b, { viewId: f.tab.id, ownerGeneration: 'obsolete' }).ok).toBe(false);
  expect(f.coordinator.adopted(f.b, { viewId: f.tab.id, ownerGeneration }).ok).toBe(true);
  expect(f.coordinator.liveHandoffs(f.b)).toEqual({});
});

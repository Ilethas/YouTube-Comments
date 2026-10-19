import { randomUUID } from 'node:crypto';
import type { ReaderCallerContext } from './caller-context';
import type { ReaderRepository } from './persistence/reader-repository';
import { StateConflictError, ViewOwnershipError } from './persistence/reader-repository';
import type { Result } from '../shared/reader-api';
import type { LiveViewHandoff, TransferDestination, TransferEvent, TransferRequest, TransferStart } from '../shared/tab-transfer';
import { exactTransferKeys, isTransferRequest, isTransferStart } from '../shared/tab-transfer';
import { isViewIdentity } from '../domain/discussion-view';

interface Reservation {
  readonly token: string;
  readonly source: ReaderCallerContext;
  readonly start: TransferStart;
  readonly target?: ReaderCallerContext;
  readonly epoch: string;
  readonly revision: number;
  readonly expires: number;
  readonly generation?: string;
  timer?: ReturnType<typeof setTimeout>;
  executing: boolean;
  cancelled: boolean;
}
interface Transfer {
  readonly reservation: Reservation;
  readonly token: string;
  readonly source: ReaderCallerContext;
  readonly epoch: string;
  readonly request: TransferRequest;
  readonly expires: number;
  target?: ReaderCallerContext;
  phase: 'PREPARING' | 'SOURCE_FROZEN' | 'TARGET_READY' | 'COMMITTING' | 'COMMITTED';
  reject?: () => void;
  ready?: () => void;
  provisional?: { windowId: string; dispose: () => void };
}
export interface TransferWindows {
  eligible(includeProvisional?: boolean): readonly ReaderCallerContext[];
  send(caller: ReaderCallerContext, event: TransferEvent): void;
  focus(caller: ReaderCallerContext): void;
  create(): { windowId: string; dispose: () => void };
  exists?(windowId: string): boolean;
}
/** Main-owned one-use rendezvous. Locks both windows during preparation, never
 * keeps a SQL transaction open across IPC, and treats committed DB ownership as
 * final even if notification delivery or a renderer subsequently fails. */
export class TabTransferCoordinator {
  private readonly reservations = new Map<string, Reservation>();
  private readonly pending = new Map<string, Transfer>();
  private readonly handoffs = new Map<string, { caller: ReaderCallerContext; value: LiveViewHandoff }>();
  private readonly itemChanges = new Map<string, number>();
  constructor(private readonly repository: ReaderRepository, private readonly windows: TransferWindows,
    private readonly allowed: () => boolean, private readonly deadlineMs = 30000, private readonly now: () => number = Date.now) {
    repository.onCommit(commit => {
      if ('itemId' in commit.change) {
        this.itemChanges.set(commit.change.itemId, commit.commitRevision);
        if (commit.change.kind === 'removed') for (const [id, entry] of this.handoffs) if (entry.value.itemId === commit.change.itemId) this.handoffs.delete(id);
        for (const op of this.pending.values()) if (op.phase !== 'COMMITTED' && op.request.handoff?.itemId === commit.change.itemId) op.reject?.();
      }
    });
  }
  destinations(source: ReaderCallerContext): readonly TransferDestination[] {
    if (!source.isCurrent() || !this.allowed()) return [];
    const reserved = new Set([...this.reservations.values()].filter(r => !r.cancelled).flatMap(r => [r.source.windowId, ...(r.target ? [r.target.windowId] : [])]));
    return this.windows.eligible().map((caller, i) => ({ caller, number: i + 1 })).filter(v => v.caller !== source && !reserved.has(v.caller.windowId))
      .map(({ caller, number }) => ({ windowId: caller.windowId, number, revision: this.repository.workspace(caller.windowId).revision }));
  }
  liveHandoffs(caller: ReaderCallerContext): Readonly<Record<string, LiveViewHandoff>> {
    const entries: [string, LiveViewHandoff][] = [];
    for (const [id, value] of this.handoffs) {
      if (!value.caller.isCurrent()) { this.handoffs.delete(id); continue; }
      if (value.caller !== caller) continue;
      try { if (this.repository.ownedView(caller.windowId, id) === value.value.itemId) entries.push([id, { ...value.value, seenStale: value.value.seenStale || value.value.intent.applied.seen !== 'all' && (this.itemChanges.get(value.value.itemId) ?? 0) > value.value.stamp.commitRevision }]); } catch { /* Not yet committed or removed. */ }
    }
    return Object.fromEntries(entries);
  }
  /** Reserve before source checkpointing: one token, exact source/target document
   * incarnations, topology and ownership generation. No renderer-selected ID
   * establishes source authority. Reservations expire even before submission. */
  begin(source: ReaderCallerContext, value: unknown): Result<{ token: string }> {
    if (!isTransferStart(value)) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    if (!this.allowed()) return { ok: false, error: { code: 'DATA_BUSY' } };
    if (!source.isCurrent() || !this.windows.eligible().includes(source)) return { ok: false, error: { code: 'FORBIDDEN' } };
    try {
      const state = this.repository.workspace(source.windowId);
      if (state.revision !== value.expectedRevision || !state.tabs.some(t => t.id === value.tabId)) throw new StateConflictError('Source changed');
      const target = value.destination === 'new' ? undefined : this.windows.eligible().find(c => value.destination !== 'new' && c.windowId === value.destination.windowId);
      if (value.destination !== 'new' && (!target || target === source || this.repository.workspace(target.windowId).revision !== value.destination.expectedRevision)) throw new StateConflictError('Destination changed');
      const reserved = [...this.reservations.values()].some(r => !r.cancelled && [r.source, r.target].some(c => c === source || !!target && c === target));
      if (reserved) throw new StateConflictError('Window reserved');
      const token = randomUUID(), reservation: Reservation = { token, source, target, start: structuredClone(value),
        epoch: this.repository.profileEpoch, revision: this.repository.stamp().commitRevision, expires: this.now() + this.deadlineMs, executing: false, cancelled: false,
        generation: this.repository.ownerAuthority(value.tabId).ownerGeneration };
      this.reservations.set(token, reservation);
      reservation.timer = setTimeout(() => this.cancelReservation(reservation), this.deadlineMs);
      return { ok: true, value: { token } };
    } catch (error) { return { ok: false, error: { code: error instanceof StateConflictError ? 'STATE_CONFLICT' : 'FORBIDDEN' } }; }
  }
  private sendSafely(caller: ReaderCallerContext, event: TransferEvent): void { try { this.windows.send(caller, event); } catch { /* Dead recipients cannot affect ownership. */ } }
  private cancelReservation(reservation: Reservation): void {
    if (reservation.cancelled || this.pending.get(reservation.token)?.phase === 'COMMITTED') return;
    reservation.cancelled = true; clearTimeout(reservation.timer);
    const op = this.pending.get(reservation.token);
    op?.reject?.();
    this.sendSafely(reservation.source, { kind: 'cancelled', token: reservation.token, tabId: reservation.start.tabId });
    if (op?.target) this.sendSafely(op.target, { kind: 'cancelled', token: reservation.token, tabId: reservation.start.tabId });
    // Hidden uncommitted natives disappear before M3 captures participants.
    const provisional = op?.provisional; if (op) op.provisional = undefined;
    try { provisional?.dispose(); } catch { /* Native cleanup cannot authorize or block a profile drain. */ }
    if (!reservation.executing) this.reservations.delete(reservation.token);
  }
  /** Synchronous revocation precedes M3's exact drain manifest capture. */
  cancelAll(): void { for (const reservation of this.reservations.values()) this.cancelReservation(reservation); }
  cancel(caller: ReaderCallerContext, value: unknown): Result<null> {
    if (!exactTransferKeys(value, ['token']) || !isViewIdentity(value.token)) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const reservation = this.reservations.get(value.token), op = this.pending.get(value.token);
    if (!reservation || !caller.isCurrent() || caller !== reservation.source && caller !== (op?.target ?? reservation.target)) return { ok: false, error: { code: 'FORBIDDEN' } };
    this.cancelReservation(reservation); return { ok: true, value: null };
  }
  adopted(caller: ReaderCallerContext, value: unknown): Result<null> {
    if (!exactTransferKeys(value, ['viewId', 'ownerGeneration']) || !isViewIdentity(value.viewId) || !isViewIdentity(value.ownerGeneration)) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    try {
      if (!caller.isCurrent()) throw new ViewOwnershipError();
      this.repository.ownedView(caller.windowId, value.viewId); this.repository.validateOwnerAuthority(value.viewId, value.ownerGeneration);
      const entry = this.handoffs.get(value.viewId);
      if (entry && entry.caller !== caller) throw new ViewOwnershipError();
      this.handoffs.delete(value.viewId); return { ok: true, value: null };
    } catch { return { ok: false, error: { code: 'FORBIDDEN' } }; }
  }
  ready(caller: ReaderCallerContext, value: unknown): Result<null> {
    if (!exactTransferKeys(value, ['token', 'accept']) || !isViewIdentity(value.token) || typeof value.accept !== 'boolean') return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const op = this.pending.get(value.token);
    if (!op || op.target !== caller || op.phase !== 'SOURCE_FROZEN' || !this.current(op)) return { ok: false, error: { code: 'FORBIDDEN' } };
    if (value.accept) { op.phase = 'TARGET_READY'; op.ready?.(); } else op.reject?.();
    return { ok: true, value: null };
  }
  private current(op: Transfer): boolean {
    return this.pending.get(op.token) === op && !op.reservation.cancelled && this.now() < op.expires && op.epoch === this.repository.profileEpoch && this.allowed()
      && op.source.isCurrent() && (!op.target || op.target.isCurrent() && this.windows.eligible(true).includes(op.target));
  }
  private validateHandoff(op: Transfer): void {
    const h = op.request.handoff;
    if (!h) return;
    if (h.viewId !== op.request.tabId || this.repository.ownedView(op.source.windowId, h.viewId) !== h.itemId
      || h.stamp.profileEpoch !== op.epoch || h.stamp.commitRevision < op.reservation.revision || h.stamp.commitRevision > this.repository.stamp().commitRevision
      || (this.itemChanges.get(h.itemId) ?? 0) > h.stamp.commitRevision) throw new StateConflictError('Shared item changed');
    const owned = this.repository.ownedCommentIds(h.itemId);
    const all = [...h.result.rawSearchMatchIds, ...h.result.visibleCommentIds, ...h.bulkSelected,
      ...(h.intent.anchor.commentId ? [h.intent.anchor.commentId] : [])];
    if (all.some(id => !owned.has(id))) throw new ViewOwnershipError('Foreign handoff identity');
    const saved = this.repository.viewSnapshot(op.source.windowId, h.viewId).intent;
    if (JSON.stringify(saved) !== JSON.stringify(h.intent)) throw new StateConflictError('Final intent not acknowledged');
  }
  async move(source: ReaderCallerContext, submission: unknown): Promise<Result<{ tabId: string; mergedIntoTabId: string | null }>> {
    if (!exactTransferKeys(submission, ['token', 'request']) || !isViewIdentity(submission.token) || !isTransferRequest(submission.request)) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const request = submission.request, reservation = this.reservations.get(submission.token);
    if (!reservation || reservation.source !== source || reservation.cancelled || reservation.executing || !source.isCurrent()
      || reservation.epoch !== this.repository.profileEpoch || this.now() >= reservation.expires) return { ok: false, error: { code: 'FORBIDDEN' } };
    if (!this.allowed()) return { ok: false, error: { code: 'DATA_BUSY' } };
    const expected = reservation.start, actualDestination = request.destination, expectedDestination = expected.destination;
    const sameDestination = expectedDestination === 'new' ? actualDestination === 'new' : actualDestination !== 'new'
      && actualDestination.windowId === expectedDestination.windowId && actualDestination.expectedRevision === expectedDestination.expectedRevision
      && actualDestination.beforeTabId === expectedDestination.beforeTabId;
    if (expected.tabId !== request.tabId || expected.expectedRevision !== request.expectedRevision || !sameDestination
      || (request.ownerGeneration ?? undefined) !== reservation.generation) return { ok: false, error: { code: 'FORBIDDEN' } };
    reservation.executing = true;
    const op: Transfer = { reservation, token: reservation.token, source, epoch: reservation.epoch, request: structuredClone(request), expires: reservation.expires, phase: 'PREPARING' };
    this.pending.set(op.token, op);
    let timer: ReturnType<typeof setInterval> | undefined;
    const previousHandoff = this.handoffs.get(request.tabId);
    let installedHandoff = false;
    try {
      const sourceState = this.repository.workspace(source.windowId), tab = sourceState.tabs.find(t => t.id === request.tabId);
      if (!tab || sourceState.revision !== request.expectedRevision) throw new StateConflictError('Source topology changed');
      if (tab.kind === 'discussion' && !request.handoff || tab.kind !== 'discussion' && request.handoff !== null) throw new StateConflictError('Missing live source');
      this.validateHandoff(op);
      let fail!: () => void;
      const cancelled = new Promise<never>((_resolve, reject) => { fail = () => reject(new StateConflictError('Transfer cancelled')); });
      op.reject = fail;
      void cancelled.catch(() => undefined);
      // Every wait races the same bounded cancellation; callbacks never outlive
      // the operation and cannot re-enter a consumed transaction.
      timer = setInterval(() => { if (!this.current(op)) fail(); }, Math.min(100, this.deadlineMs));
      let targetId: string;
      if (request.destination === 'new') { op.provisional = this.windows.create(); targetId = op.provisional.windowId; }
      else targetId = request.destination.windowId;
      if (targetId === source.windowId || [...this.pending.values()].some(other => other !== op && (other.source.windowId === targetId || other.target?.windowId === targetId))) throw new StateConflictError('Destination reserved');
      const waitTarget = async (): Promise<ReaderCallerContext> => {
        for (;;) {
          const target = this.windows.eligible(true).find(c => c.windowId === targetId);
          if (target) return target;
          if (this.windows.exists?.(targetId) === false) throw new StateConflictError('Destination construction lost');
          if (request.destination !== 'new') throw new StateConflictError('Destination unavailable');
          await new Promise<void>(resolve => setTimeout(resolve, 25));
          if (!this.current(op)) throw new StateConflictError('Destination unavailable');
        }
      };
      op.target = await Promise.race([waitTarget(), cancelled]);
      if (reservation.target && reservation.target !== op.target) throw new ViewOwnershipError('Destination incarnation changed');
      const target = op.target;
      const destination = request.destination === 'new' ? { windowId: targetId, expectedRevision: this.repository.workspace(targetId).revision, beforeTabId: null } : request.destination;
      op.phase = 'SOURCE_FROZEN';
      const ready = new Promise<void>(resolve => { op.ready = resolve; });
      this.windows.send(target, { kind: 'prepare', token: op.token, tabKind: tab.kind, handoff: request.handoff });
      await Promise.race([ready, cancelled]);
      if (!this.current(op) || (op.phase as string) !== 'TARGET_READY') throw new StateConflictError('Readiness expired');
      this.validateHandoff(op);
      op.phase = 'COMMITTING';
      if (request.handoff && [...this.handoffs.values()].reduce((n, h) => n + JSON.stringify(h.value).length, JSON.stringify(request.handoff).length) > 64 * 1024 * 1024) throw new StateConflictError('Handoff memory bound');
      if (request.handoff) { this.handoffs.set(request.tabId, { caller: target, value: request.handoff }); installedHandoff = true; }
      const result = this.repository.transferTab(source.windowId, targetId, { ...request, destination }, () => {
        if (!this.current(op) || op.phase !== 'COMMITTING') throw new StateConflictError('Transfer revoked');
      });
      op.phase = 'COMMITTED';
      for (const caller of [source, target]) { try { this.windows.send(caller, { kind: 'committed', token: op.token, tabId: result.tabId }); } catch { /* DB ownership is final. */ } }
      try { this.windows.focus(target); } catch { /* A committed destination can recover by reload. */ }
      return { ok: true, value: result, sync: this.repository.latestCommit() };
    } catch (error) {
      if (op.phase !== 'COMMITTED') {
        if (installedHandoff) { if (previousHandoff) this.handoffs.set(request.tabId, previousHandoff); else this.handoffs.delete(request.tabId); }
        if (op.target) { try { this.windows.send(op.target, { kind: 'cancelled', token: op.token, tabId: request.tabId }); } catch { /* Dead destination. */ } }
        try { op.provisional?.dispose(); } catch { /* Native compensation remains fenced by M6. */ }
      }
      return { ok: false, error: { code: error instanceof ViewOwnershipError ? 'FORBIDDEN' : error instanceof StateConflictError ? 'STATE_CONFLICT' : 'STORAGE_UNAVAILABLE' } };
    } finally { clearInterval(timer); clearTimeout(reservation.timer); this.pending.delete(op.token); this.reservations.delete(op.token); }
  }
}

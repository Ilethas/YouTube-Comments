import { randomUUID } from 'node:crypto';
import type { ReaderCallerContext } from './caller-context';
import type { ReaderRepository } from './persistence/reader-repository';
import { StateConflictError, ViewOwnershipError } from './persistence/reader-repository';
import type { Result } from '../shared/reader-api';
import type { LiveViewHandoff, TransferDestination, TransferEvent, TransferRequest, TransferStart } from '../shared/tab-transfer';
import { exactTransferKeys, isTransferRequest, isTransferStart, isDragToken } from '../shared/tab-transfer';
import { acceptsOutsideDetach } from './tab-drag-outcome';
import type { DragNativeSample } from './tab-drag-outcome';
import { isViewIdentity, isRevision } from '../domain/discussion-view';

interface Reservation {
  readonly token: string;
  readonly source: ReaderCallerContext;
  start: TransferStart;
  target?: ReaderCallerContext;
  readonly epoch: string;
  readonly revision: number;
  readonly expires: number;
  readonly generation?: string;
  timer?: ReturnType<typeof setTimeout>;
  executing: boolean;
  cancelled: boolean;
  gesture?: { id: string; started: boolean; ended: boolean; bound: boolean; notified: boolean;
    hotspot: { x: number; y: number }; hover: Map<ReaderCallerContext, { sequence: number; inside: boolean; at: number }> };
  position?: { x: number; y: number; cursor: { x: number; y: number } };
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
  create(position?: { x: number; y: number; cursor: { x: number; y: number } }): { windowId: string; dispose: () => void };
  sampleDrag?(source: ReaderCallerContext): DragNativeSample & { zoom: number; inset: { x: number; y: number } };
  exists?(windowId: string): boolean;
  acceptsDrop?(caller: ReaderCallerContext): boolean;
}
/** Main-owned one-use rendezvous. Locks both windows during preparation, never
 * keeps a SQL transaction open across IPC, and treats committed DB ownership as
 * final even if notification delivery or a renderer subsequently fails. */
export class TabTransferCoordinator {
  private readonly reservations = new Map<string, Reservation>();
  private readonly pending = new Map<string, Transfer>();
  private readonly handoffs = new Map<string, { caller: ReaderCallerContext; value: LiveViewHandoff }>();
  private readonly itemChanges = new Map<string, number>();
  private activeGesture?: Reservation;
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
  /** Lightweight source reservation. No session checkpoint, input freeze or native
   * construction occurs until a target is bound and the source drag has ended. */
  prepareDrag(source: ReaderCallerContext, value: unknown): Result<{ token: string; gestureId: string }> {
    if (!exactTransferKeys(value, ['tabId', 'expectedRevision', 'hotspot']) || !exactTransferKeys(value.hotspot, ['x', 'y'])
      || ![value.hotspot.x, value.hotspot.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 2000)) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const result = this.begin(source, { tabId: value.tabId, expectedRevision: value.expectedRevision, destination: 'new' });
    if (!result.ok) return result;
    const r = this.reservations.get(result.value.token);
    if (!r) return { ok: false, error: { code: 'FORBIDDEN' } };
    r.gesture = { id: randomUUID(), started: false, ended: false, bound: false, notified: false,
      hotspot: value.hotspot as { x: number; y: number }, hover: new Map() };
    return { ok: true, value: { token: r.token, gestureId: r.gesture.id } };
  }
  private validGesture(r?: Reservation): r is Reservation & { gesture: NonNullable<Reservation['gesture']> } {
    return !!r?.gesture && !r.cancelled && !r.executing && r.source.isCurrent() && this.windows.eligible().includes(r.source)
      && this.allowed() && r.epoch === this.repository.profileEpoch && this.now() < r.expires
      && this.repository.workspace(r.source.windowId).revision === r.start.expectedRevision;
  }
  startDrag(source: ReaderCallerContext, value: unknown): Result<null> {
    if (!exactTransferKeys(value, ['token']) || !isDragToken(value.token)) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const r = this.reservations.get(value.token);
    if (!this.validGesture(r) || r.source !== source || r.gesture.started) return { ok: false, error: { code: 'FORBIDDEN' } };
    if (this.activeGesture) this.cancelReservation(this.activeGesture);
    this.activeGesture = r; r.gesture.started = true;
    for (const caller of this.windows.eligible()) this.sendSafely(caller, { kind: 'drag-started', token: r.gesture.id });
    return { ok: true, value: null };
  }
  hoverDrag(caller: ReaderCallerContext, value: unknown): Result<null> {
    if (!(exactTransferKeys(value, ['gestureId', 'sequence', 'inside']) || exactTransferKeys(value, ['gestureId', 'sequence', 'inside', 'cancel']) && value.cancel === true) || !isDragToken(value.gestureId) || !isRevision(value.sequence) || typeof value.inside !== 'boolean') return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const r = this.activeGesture;
    if (r?.gesture) for (const c of r.gesture.hover.keys()) if (!c.isCurrent() || c.windowId === caller.windowId && c !== caller) r.gesture.hover.delete(c);
    if (!this.validGesture(r) || r.gesture.id !== value.gestureId || !caller.isCurrent() || !this.windows.eligible().includes(caller)
      || value.sequence <= (r.gesture.hover.get(caller)?.sequence ?? -1)) return { ok: false, error: { code: 'FORBIDDEN' } };
    if (value.cancel === true) {
      const previous = r.gesture.hover.get(caller);
      if (caller !== r.source && (!previous?.inside || this.now() - previous.at >= 800)) return { ok: false, error: { code: 'FORBIDDEN' } };
      this.cancelReservation(r);
    } else r.gesture.hover.set(caller, { sequence: value.sequence, inside: value.inside, at: this.now() });
    return { ok: true, value: null };
  }
  private notifyOffer(r: Reservation): void {
    const g = r.gesture;
    if (!g || !g.bound || !g.ended || g.notified) return;
    g.notified = true;
    this.clearDragHover(r);
    this.sendSafely(r.source, { kind: 'offered', token: r.token, start: r.start });
  }
  offerDrag(caller: ReaderCallerContext, value: unknown): Result<null> {
    if (!exactTransferKeys(value, ['token', 'expectedRevision', 'beforeTabId']) || !isDragToken(value.token) || !isRevision(value.expectedRevision)
      || !(value.beforeTabId === null || isViewIdentity(value.beforeTabId))) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const r = this.reservations.get(value.token);
    if (!this.validGesture(r) || !r.gesture.started || r.gesture.bound || !caller.isCurrent() || caller === r.source || !this.windows.eligible().includes(caller) || this.windows.acceptsDrop?.(caller) === false) return { ok: false, error: { code: 'FORBIDDEN' } };
    const target = this.repository.workspace(caller.windowId);
    if (target.revision !== value.expectedRevision || value.beforeTabId !== null && !target.tabs.some(t => t.id === value.beforeTabId)
      || [...this.reservations.values()].some(other => other !== r && !other.cancelled && (other.source === caller || other.target === caller))) {
      this.cancelReservation(r); return { ok: false, error: { code: 'STATE_CONFLICT' } };
    }
    r.target = caller; r.start = { ...r.start, destination: { windowId: caller.windowId, expectedRevision: value.expectedRevision, beforeTabId: value.beforeTabId } };
    r.gesture.bound = true; this.notifyOffer(r);
    return { ok: true, value: null };
  }
  endDrag(source: ReaderCallerContext, value: unknown): Result<null> {
    if (!exactTransferKeys(value, ['token', 'outcome']) || !isDragToken(value.token) || !['unclaimed', 'cancel', 'local'].includes(String(value.outcome))) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const r = this.reservations.get(value.token);
    if (!this.validGesture(r) || r.source !== source || !r.gesture.started || r.gesture.ended) return { ok: false, error: { code: 'FORBIDDEN' } };
    r.gesture.ended = true;
    if (value.outcome !== 'unclaimed') { this.cancelReservation(r); return { ok: true, value: null }; }
    if (!r.gesture.bound) {
      const recent = [...r.gesture.hover].some(([c, h]) => c.isCurrent() && h.inside && this.now() - h.at < 800);
      const sample = this.windows.sampleDrag?.(source);
      if (sample && acceptsOutsideDetach(sample, recent)) {
        r.position = { x: Math.round(sample.cursor.x - r.gesture.hotspot.x * sample.zoom - sample.inset.x),
          y: Math.round(sample.cursor.y - r.gesture.hotspot.y * sample.zoom - sample.inset.y), cursor: sample.cursor };
        r.gesture.bound = true; // Existing 'new' destination, never a guessed peer.
      }
      // An end can reach main before a peer's drop IPC. Retain a guarded unbound
      // ticket until its deadline so that genuine recipient offer can still win.
    }
    this.notifyOffer(r);
    return { ok: true, value: null };
  }
  private clearDragHover(r: Reservation): void {
    if (!r.gesture) return;
    if (this.activeGesture === r) this.activeGesture = undefined;
    for (const caller of this.windows.eligible()) this.sendSafely(caller, { kind: 'drag-cleared', token: r.gesture.id });
    r.gesture.hover.clear();
  }
  /** A delivered native Escape is evidence; absence of this callback is not. */
  cancelObservedDrag(caller: ReaderCallerContext): boolean {
    const r = this.activeGesture;
    if (!this.validGesture(r) || !caller.isCurrent()) return false;
    const hover = r.gesture.hover.get(caller);
    if (caller !== r.source && (!hover?.inside || this.now() - hover.at >= 800)) return false;
    this.cancelReservation(r); return true;
  }
  private sendSafely(caller: ReaderCallerContext, event: TransferEvent): void { try { this.windows.send(caller, event); } catch { /* Dead recipients cannot affect ownership. */ } }
  private cancelReservation(reservation: Reservation): void {
    if (reservation.cancelled || this.pending.get(reservation.token)?.phase === 'COMMITTED') return;
    reservation.cancelled = true; clearTimeout(reservation.timer);
    this.clearDragHover(reservation);
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
      || reservation.gesture && (!reservation.gesture.bound || !reservation.gesture.ended || !reservation.gesture.notified)
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
      if (request.destination === 'new') { op.provisional = this.windows.create(reservation.position); targetId = op.provisional.windowId; }
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

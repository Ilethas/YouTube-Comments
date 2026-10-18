import type { ErrorCode, ReaderApi, ReaderState, Result } from '../shared/reader-api';
import { isSharedCommit, isSharedStamp } from '../shared/reader-sync';
import type { SharedChange, SharedCommit, SharedSnapshot, SharedStamp } from '../shared/reader-sync';

type Listener = (state: ReaderState, change?: SharedChange) => void;
class ReplicaReadError extends Error { constructor(readonly code: ErrorCode) { super('Replica read unavailable'); } }
/** One bounded reconciliation path for events, command watermarks and recovery.
 * Reading intent stays in DiscussionViewSession, outside this shared replica. */
export class ReaderReplica {
  private snapshotError: ErrorCode = 'STORAGE_UNAVAILABLE';
  private snapshot?: SharedSnapshot;
  private queue: SharedCommit[] = [];
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private checking?: Promise<void>;
  private busyRetry?: Promise<void>;
  private recover = false;
  private stopped = false;
  private incarnation = 0;
  private readonly listeners = new Set<Listener>();
  private readonly retiredEpochs = new Set<string>();
  readonly api: ReaderApi;

  constructor(private readonly transport: ReaderApi) {
    // Responses supply counts/feedback only. Shared values always come back from
    // the same reconciled replica used by peer notifications.
    this.api = new Proxy({ ...transport }, { get: (target, key: keyof ReaderApi) => {
      if (key === 'onSharedCommit') return (listener: (event: SharedCommit) => void) => this.subscribe((_state, change) => {
        if (this.snapshot) listener({ profileEpoch: this.snapshot.profileEpoch, commitRevision: this.snapshot.commitRevision, change: change ?? { kind: 'helpers' } });
      });
      if (key === 'bootstrap') return async () => {
        try { await this.start(); return { ok: true, value: this.current }; }
        catch { return { ok: false, error: { code: this.snapshotError } }; }
      };
      const method = target[key];
      if (typeof method !== 'function' || key === 'onAcquisitionProgress') return method;
      return async (...args: unknown[]) => {
        const result = await (method as (...values: unknown[]) => Promise<Result<unknown>>)(...args);
        // IPC replies may beat event delivery. Reuse the same bounded commit
        // envelope rather than fetching a whole profile after every local save.
        if (isSharedCommit(result.sync)) this.receive(result.sync);
        if (result.sync) await this.reconcile(result.sync);
        if (!result.ok || !this.snapshot) return result;
        const state = this.current;
        const itemId = (args[0] as { itemId?: string } | undefined)?.itemId;
        if (key === 'toggleSeen' || key === 'bulkSeen' || key === 'undoSeen') return { ...result, value: {
          ...(result.value as object), comments: itemId ? state.comments[itemId] ?? [] : [], undo: itemId ? state.seenUndo[itemId] ?? null : null } };
        if (key === 'updatePreferences') return { ...result, value: state.preferences };
        if (key === 'removeLibraryItem') return { ...result, value: state };
        if (key === 'acquire' || key === 'refresh') return { ...result, value: { ...(result.value as object), state } };
        if (['openLibrary', 'openSettings', 'openStoredItem', 'activateTab', 'closeTab', 'moveTab'].includes(key)) return { ...result, value: state.workspace };
        return result;
      };
    } }) as ReaderApi;
  }
  get current(): ReaderState { if (!this.snapshot) throw new Error('Replica unavailable'); return this.snapshot.state; }
  get stamp(): SharedStamp | undefined { return this.snapshot ? { profileEpoch: this.snapshot.profileEpoch, commitRevision: this.snapshot.commitRevision } : undefined; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(change?: SharedChange): void { for (const listener of this.listeners) { try { listener(this.current, change); } catch { /* A consumer cannot stop shared reconciliation. */ } } }
  async start(): Promise<void> {
    if (!this.unsubscribe) {
      this.stopped = false; this.incarnation++;
      // Install local event receiver before invoking the authoritative snapshot.
      this.unsubscribe = this.transport.onSharedCommit(value => this.receive(value));
      this.recover = true;
      this.timer = setInterval(() => { void this.check().catch(() => undefined); }, 2000);
    }
    await this.availableDrain();
    if (this.recover) await this.availableDrain();
    if (!this.snapshot) throw new Error('Replica unavailable');
  }
  stop(): void {
    this.stopped = true; this.incarnation++; this.recover = true; this.unsubscribe?.(); this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.queue = [];
  }
  /** Invalid/duplicate/obsolete events never become shared state. Lost final
   * events/subscriptions are detected by the periodic small metadata watermark. */
  receive(value: unknown): void {
    if (this.stopped) return;
    if (!isSharedCommit(value)) { this.recover = true; void this.drain().catch(() => undefined); return; }
    if (this.snapshot && value.profileEpoch !== this.snapshot.profileEpoch) return;
    if (this.snapshot && value.commitRevision <= this.snapshot.commitRevision) return;
    if (this.queue.length >= 64) { this.queue = []; this.recover = true; }
    else this.queue.push(value);
    void this.drain().catch(() => undefined);
  }
  check(): Promise<void> {
    if (this.checking) return this.checking;
    this.checking = this.checkCurrent().finally(() => { this.checking = undefined; });
    return this.checking;
  }
  private async checkCurrent(): Promise<void> {
    const result = await this.transport.getSharedMetadata();
    if (!result.ok) throw new ReplicaReadError(result.error.code);
    if (result.ok && isSharedStamp(result.value)) await this.reconcile(result.value);
  }
  async reconcile(stamp: SharedStamp): Promise<void> {
    if (!isSharedStamp(stamp) || this.stopped) return;
    if (this.snapshot?.profileEpoch !== stamp.profileEpoch) {
      // A command reply from an obsolete main incarnation has no authority.
      // Confirm the live epoch with a fresh query before allowing replacement.
      if (this.retiredEpochs.has(stamp.profileEpoch)) return;
      const live = await this.transport.getSharedMetadata();
      if (!live.ok && live.error.code === 'DATA_BUSY') { this.recover = true; await this.availableDrain(); return this.reconcile(stamp); }
      if (!live.ok || live.value.profileEpoch !== stamp.profileEpoch) return;
      this.recover = true;
    } else if (stamp.commitRevision > this.snapshot.commitRevision) {
      await this.availableDrain();
      if (stamp.commitRevision > (this.snapshot?.commitRevision ?? -1)) this.recover = true;
    }
    await this.availableDrain();
  }
  /** An accepted ingestion can finish during the existing native-dialog barrier.
   * Its committed response must wait for readable state, never report a failed
   * acquisition merely because snapshot IPC is temporarily DATA_BUSY. */
  private async availableDrain(): Promise<void> {
    while (!this.stopped) {
      try { await this.drain(); return; }
      catch (error) {
        if (!(error instanceof ReplicaReadError) || error.code !== 'DATA_BUSY') throw error;
        if (!this.busyRetry) this.busyRetry = new Promise<void>(resolve => setTimeout(resolve, 200))
          .finally(() => { this.busyRetry = undefined; });
        await this.busyRetry;
      }
    }
  }
  private drain(): Promise<void> {
    if (this.running) return this.running;
    // Start after installing the in-flight promise, including all synchronous
    // event bursts. Successful drains also take work queued at settlement.
    this.running = Promise.resolve().then(() => this.run()).then(() => {
      this.running = undefined;
      if (!this.stopped && (this.recover || this.queue.length)) return this.drain();
    }, error => { this.running = undefined; throw error; });
    return this.running;
  }
  private async run(): Promise<void> {
    const incarnation = this.incarnation;
    while (!this.stopped && (this.recover || this.queue.length)) {
      if (this.recover || !this.snapshot) {
        this.recover = false;
        // Replace the narrow listener before recovery too: a lost registration
        // must not leave the replica permanently dependent on polling.
        this.unsubscribe?.();
        this.unsubscribe = this.transport.onSharedCommit(value => this.receive(value));
        const result = await this.transport.getSharedSnapshot();
        if (!result.ok || !('state' in result.value) || !isSharedStamp(result.value)) {
          this.snapshotError = result.ok ? 'STORAGE_UNAVAILABLE' : result.error.code;
          this.recover = true; throw new ReplicaReadError(this.snapshotError);
        }
        if (this.stopped || incarnation !== this.incarnation) return;
        const next = result.value, previous = this.snapshot;
        if (this.retiredEpochs.has(next.profileEpoch)) return;
        if (!previous || next.profileEpoch !== previous.profileEpoch || next.commitRevision >= previous.commitRevision) {
          if (previous && next.profileEpoch !== previous.profileEpoch) {
            this.retiredEpochs.add(previous.profileEpoch);
            if (this.retiredEpochs.size > 8) { const oldest = this.retiredEpochs.values().next().value; if (oldest) this.retiredEpochs.delete(oldest); }
          }
          this.snapshot = next; this.publish();
        }
        this.queue = this.queue.filter(e => e.profileEpoch === this.snapshot?.profileEpoch && e.commitRevision > this.snapshot.commitRevision);
        continue;
      }
      const event = this.queue.shift();
      if (!event) continue;
      const current = this.snapshot;
      if (event.profileEpoch !== current.profileEpoch || event.commitRevision <= current.commitRevision) continue;
      if (event.commitRevision !== current.commitRevision + 1) { this.recover = true; continue; }
      const change = event.change;
      let state = current.state;
      if (change.kind === 'seen') {
        const rows = state.comments[change.itemId];
        if (!rows) { this.recover = true; continue; }
        const values = new Map(change.values.map(v => [v.id, v.seen]));
        const owned = new Set(rows.map(c => c.id));
        if (change.values.some(v => !owned.has(v.id))) { this.recover = true; continue; }
        state = { ...state, comments: { ...state.comments, [change.itemId]: rows.map(c => values.has(c.id) ? { ...c, seen: values.get(c.id) ?? c.seen } : c) },
          seenUndo: { ...state.seenUndo, [change.itemId]: change.undo } };
      } else if (change.kind === 'item' || change.kind === 'removed' || change.kind === 'seen-invalidation') {
        const result = await this.transport.getSharedSnapshot({ itemId: change.itemId });
        if (!result.ok || !isSharedStamp(result.value) || 'state' in result.value || result.value.profileEpoch !== event.profileEpoch || result.value.commitRevision !== event.commitRevision) {
          this.recover = true; continue;
        }
        if (this.stopped || incarnation !== this.incarnation) return;
        const scope = result.value, item = scope.item;
        const items = item ? state.items.some(i => i.id === scope.itemId) ? state.items.map(i => i.id === scope.itemId ? item : i) : [...state.items, item] : state.items.filter(i => i.id !== scope.itemId);
        const comments = { ...state.comments }, seenUndo = { ...state.seenUndo };
        if (scope.item) { comments[scope.itemId] = scope.comments; seenUndo[scope.itemId] = scope.undo; }
        else { delete comments[scope.itemId]; delete seenUndo[scope.itemId]; }
        state = { ...state, items, comments, seenUndo, workspace: scope.workspace };
      } else if (change.kind === 'preferences' || change.kind === 'workspace') {
        const result = await this.transport.getSharedMetadata();
        if (!result.ok || !isSharedStamp(result.value) || result.value.profileEpoch !== event.profileEpoch || result.value.commitRevision !== event.commitRevision) { this.recover = true; continue; }
        if (this.stopped || incarnation !== this.incarnation) return;
        state = { ...state, preferences: result.value.preferences, workspace: result.value.workspace };
      }
      this.snapshot = { profileEpoch: event.profileEpoch, commitRevision: event.commitRevision, state };
      this.publish(change);
    }
  }
}

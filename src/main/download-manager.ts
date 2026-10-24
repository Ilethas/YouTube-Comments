import { randomUUID } from 'node:crypto';
import { downloadLabel as label } from './download-label';
import { AcquisitionService } from './acquisition-service';
import { parseAcquisitionTarget } from './acquisition-target';
import type { AcquisitionTarget } from './acquisition-target';
import type { ReaderCallerContext } from './caller-context';
import type { ExtractLive } from './live-extraction';
import type { ReaderRepository } from './persistence/reader-repository';
import type { AcquisitionNotification, AcquisitionProgress } from '../shared/acquisition';
import type { AcquisitionResult, Result } from '../shared/reader-api';
import { downloadActive, downloadPending } from '../shared/downloads';
import type { DownloadJob, DownloadSubmission, DownloadsSnapshot, SubmitDownloadRequest } from '../shared/downloads';

interface Entry {
  job: DownloadJob;
  target: AcquisitionTarget;
  origin?: ReaderCallerContext;
  openOrigins: Map<string, ReaderCallerContext>;
  executor?: AcquisitionService;
  completion: Promise<Result<AcquisitionResult>>;
  resolve: (result: Result<AcquisitionResult>) => void;
}
/** Profile-owned FIFO scheduler. Slots include child cleanup, normalization and
 * synchronous ingestion. The existing AcquisitionService remains the executor. */
export class DownloadManager {
  private readonly entries = new Map<string, Entry>();
  private revision = 0;
  private stopping = false;
  private scheduled = false;
  private readonly observers = new Set<(value: DownloadsSnapshot) => void>();
  constructor(private readonly repository: ReaderRepository, private readonly languages: readonly string[],
    private readonly extract: ExtractLive, private readonly progress: (value: AcquisitionNotification) => void = () => undefined,
    private readonly nextRevision?: () => number) { this.revision = nextRevision?.() ?? 0; }
  onChanged(listener: (value: DownloadsSnapshot) => void): () => void { this.observers.add(listener); return () => { this.observers.delete(listener); }; }
  snapshot(): DownloadsSnapshot { return { profileEpoch: this.repository.stamp().profileEpoch, revision: this.revision, jobs: [...this.entries.values()].map(e => e.job) }; }
  busy(): boolean { return [...this.entries.values()].some(e => downloadPending(e.job)); }
  owns(sourceKind: string | undefined, sourceId: string): boolean {
    return [...this.entries.values()].some(e => downloadPending(e.job) && e.target.sourceKind === sourceKind && e.target.sourceId === sourceId);
  }
  current(): AcquisitionProgress | null { return [...this.entries.values()].map(e => e.executor?.current()).find(p => !!p) ?? null; }
  private changed(): void {
    // Keep all pending jobs, but only the most recent 32 settled entries.
    const settled = [...this.entries.values()].filter(e => !downloadPending(e.job)).sort((a, b) => (b.job.completedAt ?? 0) - (a.job.completedAt ?? 0));
    for (const e of settled.slice(32)) this.entries.delete(e.job.operationId);
    this.revision = this.nextRevision?.() ?? this.revision + 1;
    const value = this.snapshot();
    for (const listener of this.observers) { try { listener(value); } catch { /* Recipients never own jobs. */ } }
  }
  /** Also called after an acknowledged preference update. No callback may start
   * work after shutdown, or resurrect a cancelled queue entry. */
  schedule(): void {
    if (this.scheduled || this.stopping || ![...this.entries.values()].some(e => e.job.state === 'queued')) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.stopping) return;
      const limit = this.repository.preferences(this.languages).maximumConcurrentDownloads;
      let running = [...this.entries.values()].filter(e => downloadActive(e.job)).length;
      for (const entry of this.entries.values()) {
        if (running >= limit) break;
        if (entry.job.state !== 'queued') continue;
        running++;
        void this.run(entry);
      }
    });
  }
  submit(request: SubmitDownloadRequest, caller?: ReaderCallerContext): Result<DownloadSubmission> {
    if (this.stopping) return { ok: false, error: { code: 'DATA_BUSY' } };
    try {
      if (caller && !caller.isCurrent()) return { ok: false, error: { code: 'FORBIDDEN' } };
      const stored = request.kind === 'refresh' ? this.repository.getStoredItem(request.itemId) : undefined;
      if (request.kind === 'refresh' && !stored) return { ok: false, error: { code: 'NOT_FOUND' } };
      const target = parseAcquisitionTarget(request.kind === 'acquire' ? request.url : stored?.sourceKind === 'youtube-video'
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(stored.sourceId)}` : stored?.sourceKind === 'youtube-community-post' ? `https://www.youtube.com/post/${encodeURIComponent(stored.sourceId)}` : '');
      if (!target) return { ok: false, error: { code: request.kind === 'refresh' ? 'NOT_REFRESHABLE' : 'INVALID_REQUEST' } };
      const existing = [...this.entries.values()].find(e => downloadPending(e.job) && e.target.sourceKind === target.sourceKind && e.target.sourceId === target.sourceId);
      if (existing) {
        if (request.kind === 'acquire' && caller) existing.openOrigins.set(caller.windowId, caller);
        return { ok: true, value: { job: existing.job, reused: true } };
      }
      if ([...this.entries.values()].filter(e => downloadPending(e.job)).length >= 128) return { ok: false, error: { code: 'ACQUISITION_BUSY' } };
      const item = stored ?? this.repository.bootstrap(this.languages, caller?.windowId).items.find(i => i.sourceKind === target.sourceKind && i.sourceId === target.sourceId);
      const job: DownloadJob = { operationId: randomUUID(), sourceKind: target.sourceKind, sourceId: target.sourceId,
        kind: request.kind, ...(item ? { itemId: item.id } : {}), label: label(item ? item.kind === 'video' ? item.title : item.text : target.sourceId) || target.sourceId,
        state: 'queued', createdAt: Date.now(), cancellable: true };
      let resolve!: Entry['resolve'];
      const entry: Entry = { job, target, origin: caller, openOrigins: new Map(), completion: new Promise(done => { resolve = done; }), resolve: result => resolve(result) };
      this.entries.set(job.operationId, entry); this.changed(); this.schedule();
      return { ok: true, value: { job, reused: false } };
    } catch { return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
  }
  cancel(operationId: string): Result<null> {
    const entry = this.entries.get(operationId);
    if (!entry || !entry.job.cancellable) return { ok: false, error: { code: 'NOT_FOUND' } };
    if (entry.job.state !== 'queued') return entry.executor?.cancel(operationId) ?? { ok: false, error: { code: 'NOT_FOUND' } };
    entry.job = { ...entry.job, state: 'cancelled', cancellable: false, completedAt: Date.now() };
    entry.resolve({ ok: false, error: { code: 'ACQUISITION_CANCELLED' } });
    entry.resolve = () => undefined;
    entry.openOrigins.clear(); entry.origin = undefined; this.changed(); this.schedule(); return { ok: true, value: null };
  }
  retry(operationId: string, caller?: ReaderCallerContext): Result<DownloadSubmission> {
    const entry = this.entries.get(operationId);
    if (!entry || !['failed', 'cancelled'].includes(entry.job.state)) return { ok: false, error: { code: 'NOT_FOUND' } };
    return this.submit(entry.job.kind === 'refresh' && entry.job.itemId ? { kind: 'refresh', itemId: entry.job.itemId } : { kind: 'acquire', url: entry.target.url }, caller);
  }
  /** Dismiss only session projections; durable extraction/history is untouched. */
  dismiss(operationId: string): Result<null> {
    const entry = this.entries.get(operationId);
    if (!entry || downloadPending(entry.job)) return { ok: false, error: { code: 'NOT_FOUND' } };
    this.entries.delete(operationId); this.changed(); return { ok: true, value: null };
  }
  clearFinished(): Result<null> {
    let changed = false;
    for (const [id, entry] of this.entries) if (!downloadPending(entry.job)) { this.entries.delete(id); changed = true; }
    if (changed) this.changed();
    return { ok: true, value: null };
  }
  /** Compatibility for trusted callers/tests. Production renderers submit and
   * reconcile repository commits without an extraction-long IPC invocation. */
  async acquire(url: string, caller?: ReaderCallerContext): Promise<Result<AcquisitionResult>> { return this.wait(this.submit({ kind: 'acquire', url }, caller)); }
  async refresh(itemId: string, caller?: ReaderCallerContext): Promise<Result<AcquisitionResult>> { return this.wait(this.submit({ kind: 'refresh', itemId }, caller)); }
  private wait(result: Result<DownloadSubmission>): Promise<Result<AcquisitionResult>> {
    if (!result.ok) return Promise.resolve(result);
    return this.entries.get(result.value.job.operationId)?.completion ?? Promise.resolve({ ok: false, error: { code: 'NOT_FOUND' } });
  }
  private async run(entry: Entry): Promise<void> {
    entry.job = { ...entry.job, state: 'checking-helper', startedAt: Date.now() };
    const executor = new AcquisitionService(this.repository, this.languages, this.extract, value => {
      try { this.progress(value); } catch { /* Compatibility recipient may close. */ }
      if ('settled' in value) return;
      const previous = { ...entry.job };
      Reflect.deleteProperty(previous, 'comments');
      entry.job = { ...previous, state: value.stage, startedAt: value.startedAt, cancellable: value.cancellable,
        ...(value.comments ? { comments: value.comments } : {}) };
      this.changed();
    }, undefined, () => entry.job.operationId, title => {
      // Stored discussions retain their known title throughout Refresh/Acquire.
      if (entry.job.itemId || !downloadActive(entry.job)) return;
      const safe = label(title);
      if (!safe || safe === entry.job.label) return;
      entry.job = { ...entry.job, label: safe }; this.changed();
    });
    entry.executor = executor;
    const result = await (entry.job.kind === 'acquire' ? executor.acquire(entry.target.url, entry.origin) : executor.refresh(entry.job.itemId ?? '', entry.origin));
    if (result.ok && !this.stopping) {
      for (const caller of entry.openOrigins.values()) {
        if (!caller.isCurrent()) continue;
        try { this.repository.changeWorkspace('openStoredItem', result.value.summary.itemId, undefined, caller.windowId); } catch { /* A lost origin never loses the Library result. */ }
      }
    }
    entry.openOrigins.clear(); entry.origin = undefined; entry.executor = undefined;
    const item = result.ok ? this.repository.getStoredItem(result.value.summary.itemId) : undefined;
    const state = result.ok ? 'completed' : result.error.code === 'ACQUISITION_CANCELLED' || this.stopping ? 'cancelled' : 'failed';
    entry.job = { ...entry.job, state, cancellable: false, completedAt: Date.now(), ...(result.ok
      ? { itemId: result.value.summary.itemId, coverage: result.value.summary.coverage, ...(item ? { label: label(item.kind === 'video' ? item.title : item.text) || entry.target.sourceId } : {}) }
      : state === 'failed' ? { failure: result.error.code === 'HELPER_UNAVAILABLE' ? 'HELPER_UNAVAILABLE' : result.error.code === 'STORAGE_UNAVAILABLE' ? 'STORAGE_UNAVAILABLE' : 'ACQUISITION_FAILED' } : {}) };
    this.changed(); entry.resolve(result); entry.resolve = () => undefined;
    // Only compatibility waiters keep the large result. Recent jobs retain
    // their small safe projection, never 32 historical full-profile snapshots.
    // Drop the resolver too: its promise capability can retain the full result.
    entry.completion = Promise.resolve({ ok: false, error: { code: 'NOT_FOUND' } });
    this.schedule();
  }
  async close(): Promise<void> {
    this.stopping = true;
    for (const entry of this.entries.values()) if (entry.job.state === 'queued') this.cancel(entry.job.operationId);
    await Promise.all([...this.entries.values()].map(e => e.executor?.close()));
    await Promise.all([...this.entries.values()].map(e => e.completion));
  }
}

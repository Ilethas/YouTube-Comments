import type { ReaderCallerContext } from './caller-context';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import type { AcquisitionResult, Result } from '../shared/reader-api';
import type { AcquisitionNotification, AcquisitionProgress, AcquisitionStage, AcquisitionTimings } from '../shared/acquisition';
import type { ReaderRepository } from './persistence/reader-repository';
import { parseAcquisitionTarget } from './acquisition-target';
import type { AcquisitionTarget } from './acquisition-target';
import type { ExtractLive } from './live-extraction';

/** One global remote operation. Cancellation linearizes before synchronous ingest;
 * progress observers cannot interrupt an accepted transaction. */
export class AcquisitionService {
  private active?: { progress: AcquisitionProgress; controller: AbortController };
  private activeTarget?: AcquisitionTarget;
  private readonly lifecycle = new AbortController();
  private completion: Promise<void> = Promise.resolve();
  constructor(private readonly repository: ReaderRepository, private readonly languages: readonly string[],
    private readonly extract: ExtractLive, private readonly notify: (value: AcquisitionNotification) => void = () => undefined,
    private readonly clock: () => number = () => performance.now(), private readonly operationId: () => string = randomUUID) {}
  owns(sourceKind: string | undefined, sourceId: string): boolean {
    return this.activeTarget?.sourceKind === sourceKind && this.activeTarget?.sourceId === sourceId;
  }
  current(): AcquisitionProgress | null { return this.active?.progress ?? null; }
  /** Exact identity prevents an old click from cancelling a newer child. */
  cancel(operationId: string): Result<null> {
    if (!this.active || this.active.progress.operationId !== operationId || !this.active.progress.cancellable)
      return { ok: false, error: { code: 'NOT_FOUND' } };
    this.active.controller.abort();
    this.active.progress = { ...this.active.progress, cancellable: false };
    this.emit(this.active.progress);
    return { ok: true, value: null };
  }
  private emit(value: AcquisitionNotification): void { try { this.notify(value); } catch { /* Window closure cannot affect persistence. */ } }
  async acquire(url: string, caller?: ReaderCallerContext): Promise<Result<AcquisitionResult>> {
    const started = this.clock();
    const target = parseAcquisitionTarget(url);
    if (!target) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    return this.run(target, true, started, undefined, caller);
  }
  async refresh(itemId: string, caller?: ReaderCallerContext): Promise<Result<AcquisitionResult>> {
    const started = this.clock();
    if (this.active) return { ok: false, error: { code: 'ACQUISITION_BUSY' } };
    try {
      // Retained intentionally: measure existing pre-Refresh full repository read.
      const item = this.repository.bootstrap(this.languages, caller?.windowId).items.find(item => item.id === itemId);
      if (!item) return { ok: false, error: { code: 'NOT_FOUND' } };
      const url = item.sourceKind === 'youtube-video' ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.sourceId)}`
        : item.sourceKind === 'youtube-community-post' ? `https://www.youtube.com/post/${encodeURIComponent(item.sourceId)}` : '';
      const target = parseAcquisitionTarget(url);
      if (!target) return { ok: false, error: { code: 'NOT_REFRESHABLE' } };
      return this.run(target, false, started, itemId, caller);
    } catch { return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
  }
  private async run(target: AcquisitionTarget, openTab: boolean, started: number, itemId?: string, caller?: ReaderCallerContext): Promise<Result<AcquisitionResult>> {
    if (this.active) return { ok: false, error: { code: 'ACQUISITION_BUSY' } };
    if (this.lifecycle.signal.aborted) return { ok: false, error: { code: 'ACQUISITION_FAILED' } };
    const operationId = this.operationId(), controller = new AbortController();
    this.active = { controller, progress: { operationId, kind: openTab ? 'acquire' : 'refresh', sourceKind: target.sourceKind,
      ...(itemId ? { itemId } : {}), stage: 'checking-helper', startedAt: Date.now(), cancellable: true } };
    this.activeTarget = target;
    let settled!: () => void;
    this.completion = new Promise(resolve => { settled = resolve; });
    const durations = { helperMs: 0, preparationMs: 0, fetchMs: 0, processingMs: 0, savingMs: 0, bootstrapMs: 0 };
    let stage: AcquisitionStage = 'checking-helper', stageStarted = this.clock();
    const targetMs = stageStarted - started;
    const key = { 'checking-helper': 'helperMs', preparing: 'preparationMs', fetching: 'fetchMs', processing: 'processingMs', saving: 'savingMs' } as const;
    const advance = (next: AcquisitionStage) => {
      const now = this.clock(); durations[key[stage]] += now - stageStarted; stageStarted = now; stage = next;
      if (this.active) {
        this.active.progress = { ...this.active.progress, stage: next, cancellable: next !== 'saving' && !controller.signal.aborted };
        this.emit(this.active.progress);
      }
    };
    const signal = AbortSignal.any([this.lifecycle.signal, controller.signal]);
    this.emit(this.active.progress);
    try {
      let result;
      try { result = await this.extract(target, signal, advance); }
      catch { result = { error: 'ACQUISITION_FAILED' as const, extraction: { provenance: {
        backend: target.sourceKind === 'youtube-video' ? 'yt-dlp' : 'post-archiver-improved', version: 'unverified', evidence: [] },
        issues: [], coverage: { kind: 'failed' as const, reason: 'execution-failure' } } }; }
      // Give queued cancellation IPC a checkpoint after synchronous normalization.
      await setImmediate();
      if (this.lifecycle.signal.aborted) return { ok: false, error: { code: 'ACQUISITION_FAILED' } };
      if (controller.signal.aborted) {
        this.repository.ingest({ provenance: result.extraction.provenance, issues: [],
          coverage: { kind: 'failed', reason: 'user-cancelled' } }, target, false);
        return { ok: false, error: { code: 'ACQUISITION_CANCELLED' } };
      }
      // Linearization point: no await between this transition and atomic ingest.
      advance('saving');
      const attempt = this.repository.ingest(result.extraction, target, openTab && (!caller || caller.isCurrent()), caller?.windowId);
      durations.savingMs += this.clock() - stageStarted;
      if (result.error || attempt.coverage.kind === 'failed' || !attempt.itemId) return { ok: false, error: { code: result.error ?? 'ACQUISITION_FAILED' } };
      const bootstrapStarted = this.clock();
      const state = this.repository.bootstrap(this.languages, caller?.windowId);
      durations.bootstrapMs = this.clock() - bootstrapStarted;
      const timings: AcquisitionTimings = { targetMs, ...durations, totalMs: this.clock() - started };
      return { ok: true, sync: this.repository.latestCommit() ?? this.repository.stamp(), value: { operationId, timings, state, summary: {
        itemId: attempt.itemId, coverage: attempt.coverage.kind, inserted: attempt.counts.inserted,
        updated: attempt.counts.updated, warnings: attempt.issues.length,
      } } };
    } catch { return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
    finally { this.active = undefined; this.activeTarget = undefined; this.emit({ operationId, settled: true }); settled(); }
  }
  close(): Promise<void> { this.lifecycle.abort(); return this.completion; }
}

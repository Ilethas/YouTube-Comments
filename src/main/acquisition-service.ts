import type { AcquisitionResult, Result } from '../shared/reader-api';
import type { ReaderRepository } from './persistence/reader-repository';
import { parseAcquisitionTarget } from './acquisition-target';
import type { AcquisitionTarget } from './acquisition-target';
import type { ExtractLive } from './live-extraction';

/** Temporary single-live-operation scheduler; local repository operations remain
 * available while helpers run. Merge reads current remote evidence at commit. */
export class AcquisitionService {
  private busy = false;
  private activeTarget?: AcquisitionTarget;
  /** Canonical source ownership is set before awaiting the helper. */
  owns(sourceKind: string | undefined, sourceId: string): boolean {
    return this.activeTarget?.sourceKind === sourceKind && this.activeTarget?.sourceId === sourceId;
  }
  private readonly lifecycle = new AbortController();
  private settled?: () => void;
  private completion: Promise<void> = Promise.resolve();
  constructor(private readonly repository: ReaderRepository, private readonly languages: readonly string[],
    private readonly extract: ExtractLive) {}

  async acquire(url: string): Promise<Result<AcquisitionResult>> {
    const target = parseAcquisitionTarget(url);
    if (!target) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    return this.run(target, true);
  }
  async refresh(itemId: string): Promise<Result<AcquisitionResult>> {
    if (this.busy) return { ok: false, error: { code: 'ACQUISITION_BUSY' } };
    try {
      const item = this.repository.bootstrap(this.languages).items.find(item => item.id === itemId);
      if (!item) return { ok: false, error: { code: 'NOT_FOUND' } };
      const url = item.sourceKind === 'youtube-video' ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.sourceId)}`
        : item.sourceKind === 'youtube-community-post' ? `https://www.youtube.com/post/${encodeURIComponent(item.sourceId)}` : '';
      const target = parseAcquisitionTarget(url);
      if (!target) return { ok: false, error: { code: 'NOT_REFRESHABLE' } };
      return this.run(target, false);
    } catch { return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
  }
  private async run(target: AcquisitionTarget, openTab: boolean): Promise<Result<AcquisitionResult>> {
    if (this.busy) return { ok: false, error: { code: 'ACQUISITION_BUSY' } };
    if (this.lifecycle.signal.aborted) return { ok: false, error: { code: 'ACQUISITION_FAILED' } };
    this.busy = true;
    this.activeTarget = target;
    this.completion = new Promise(resolve => { this.settled = resolve; });
    try {
      let result;
      try { result = await this.extract(target, this.lifecycle.signal); }
      catch {
        result = { error: 'ACQUISITION_FAILED' as const, extraction: { provenance: {
          backend: target.sourceKind === 'youtube-video' ? 'yt-dlp' : 'post-archiver-improved', version: 'unverified', evidence: [] },
          issues: [], coverage: { kind: 'failed' as const, reason: 'execution-failure' } } };
      }
      if (this.lifecycle.signal.aborted) return { ok: false, error: { code: 'ACQUISITION_FAILED' } };
      const attempt = this.repository.ingest(result.extraction, target, openTab);
      if (result.error || attempt.coverage.kind === 'failed' || !attempt.itemId) return { ok: false, error: { code: result.error ?? 'ACQUISITION_FAILED' } };
      return { ok: true, value: { state: this.repository.bootstrap(this.languages), summary: {
        itemId: attempt.itemId, coverage: attempt.coverage.kind, inserted: attempt.counts.inserted,
        updated: attempt.counts.updated, warnings: attempt.issues.length,
      } } };
    } catch { return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
    finally { this.activeTarget = undefined; this.busy = false; this.settled?.(); }
  }
  close(): Promise<void> { this.lifecycle.abort(); return this.completion; }
}

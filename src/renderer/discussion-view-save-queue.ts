import type { Result } from '../shared/reader-api';

export const draftSaveDelay = 400;
export const scrollSaveDelay = 250;
export const intentSaveDelay = 50;

/** One serialized writer per discussion. Timer callbacks never carry stale partial
 * snapshots: every dispatch reads the latest complete semantic intent. Failed
 * acknowledgments remain dirty for the next edit/flush, without a retry loop. */
export class DiscussionViewSaveQueue {
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private acknowledged = 0;
  private running?: Promise<void>;
  private ready = false;
  private disposed = false;
  private paused = false;
  constructor(private readonly saveLatest: () => Promise<Result<null>>, private readonly feedback: (failed: boolean) => void) {}

  schedule(delay: number): void {
    if (this.disposed) return;
    this.revision++;
    clearTimeout(this.timer);
    if (this.paused) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.disposed || this.paused) return this.running ?? Promise.resolve();
    this.ready = true;
    if (this.running) return this.running;
    const run = async () => {
      while (!this.disposed && !this.paused && this.ready && this.acknowledged < this.revision) {
        this.ready = false;
        const revision = this.revision;
        try {
          const result = await this.saveLatest();
          if (this.disposed) return;
          if (result.ok) { this.acknowledged = revision; this.feedback(false); }
          else this.feedback(true);
        } catch { if (!this.disposed) this.feedback(true); }
      }
    };
    this.running = run().finally(() => {
      this.running = undefined;
      // A flush can arrive in the microtask gap after the loop completes but
      // before this finalizer. Drain that intent too, including on tab close.
      if (!this.disposed && !this.paused && this.ready && this.acknowledged < this.revision) return this.flush();
    });
    return this.running;
  }
  pause(): void { this.paused = true; clearTimeout(this.timer); this.timer = undefined; }
  async settled(): Promise<void> { await this.running; }
  get dirty(): boolean { return this.acknowledged < this.revision; }
  checkpoint(): (success: boolean) => void {
    const revision = this.revision;
    return success => { if (success) this.acknowledged = revision; this.feedback(!success); };
  }
  resume(): void { this.paused = false; }
  dispose(): void { this.disposed = true; clearTimeout(this.timer); }
}

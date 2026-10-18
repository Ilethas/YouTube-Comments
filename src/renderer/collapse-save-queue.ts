import type { CollapseChange } from '../domain/discussion-collapse';
import type { Result } from '../shared/reader-api';

/** FIFO idempotent assignments. Failed commands stay queued for the next explicit
 * edit/flush. Backup/tab-close flushes include every accepted expansion command. */
export class CollapseSaveQueue {
  private pending: CollapseChange[] = [];
  private running?: Promise<void>;
  private disposed = false;
  private paused = false;
  constructor(private readonly save: (change: CollapseChange) => Promise<Result<null>>, private readonly feedback: (failed: boolean) => void) {}
  schedule(change: CollapseChange): void { this.pending.push(change); void this.flush(); }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.disposed || this.paused || !this.pending.length) return Promise.resolve();
    let failed = false;
    this.running = (async () => {
      while (!this.disposed && !this.paused && this.pending.length) {
        try {
          const result = await this.save(this.pending[0]);
          if (this.disposed) return;
          if (!result.ok) { failed = true; this.feedback(true); return; }
          this.pending.shift(); this.feedback(false);
        } catch { failed = true; if (!this.disposed) this.feedback(true); return; }
      }
    })().finally(() => {
      this.running = undefined;
      // An edit can arrive after the loop empties but before this finalizer.
      // Include it in the same awaited flush, without retrying failed writes.
      if (!failed && !this.disposed && !this.paused && this.pending.length) return this.flush();
    });
    return this.running;
  }
  pause(): void { this.paused = true; }
  async settled(): Promise<void> { await this.running; }
  get dirty(): boolean { return this.pending.length > 0; }
  checkpoint(): (success: boolean) => void {
    const pending = [...this.pending];
    return success => {
      if (success && pending.every((change, index) => this.pending[index] === change)) this.pending.splice(0, pending.length);
      this.feedback(!success);
    };
  }
  resume(): void { this.paused = false; }
  dispose(): void { this.disposed = true; }
}

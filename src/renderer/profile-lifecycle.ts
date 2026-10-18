import type { DrainCommand, ProfileEvent, ProfileLifecycleApi } from '../shared/profile-operation';
import type { Result } from '../shared/reader-api';
export interface Checkpoint { readonly command: DrainCommand; readonly accept: (result: Result<unknown>) => void }

/** Renderer half of the fixed protocol. Freeze happens synchronously on receipt;
 * a separate release path can reconcile even when preparation is stuck/failed. */
export class RendererProfileLifecycle {
  private current?: ProfileEvent;
  private readonly prepared = new Set<string>();
  private stopped = false;
  private unsubscribe?: () => void;
  constructor(private readonly api: ProfileLifecycleApi, private readonly hooks: {
    freeze: (event: ProfileEvent) => void;
    checkpoints: () => Promise<readonly Checkpoint[]>;
    settled: () => Promise<boolean>;
    reconcile: () => Promise<void>;
    release: (failed: boolean) => void;
    releaseFailure: () => void;
  }) {}
  start(): void {
    this.unsubscribe = this.api.onEvent(event => this.receive(event));
    // Subscribe first. A late current response must never overwrite a release.
    const observed = this.current;
    void this.api.current().then(result => { if (this.current === observed && result.ok && result.value) this.receive(result.value); }).catch(() => undefined);
  }
  stop(): void { this.stopped = true; this.unsubscribe?.(); }
  private receive(event: ProfileEvent): void {
    if (this.stopped) return;
    if (this.current?.operationId === event.operationId && this.current.phase === 'RELEASED' && event.phase !== 'RELEASED') return;
    this.current = event;
    if (event.phase === 'RELEASED') { void this.release(event); return; }
    this.hooks.freeze(event);
    if (event.phase === 'DRAINING' && !this.prepared.has(event.operationId)) {
      this.prepared.add(event.operationId);
      if (this.prepared.size > 64) { const oldest = this.prepared.values().next().value; if (oldest) this.prepared.delete(oldest); }
      void this.drain(event).catch(() => undefined);
    }
  }
  private valid(event: ProfileEvent): boolean { return !this.stopped && this.current?.operationId === event.operationId && this.current.phase === 'DRAINING'; }
  private async drain(event: ProfileEvent): Promise<void> {
    const identity = { operationId: event.operationId, profileEpoch: event.profileEpoch };
    let entries: readonly Checkpoint[] = [], success = false;
    try {
      const [checkpoints, accepted, settled] = await Promise.all([this.hooks.checkpoints(), this.api.settleAccepted(), this.hooks.settled()]);
      entries = checkpoints; success = accepted && settled;
    } catch { success = false; }
    if (!this.valid(event)) return;
    if (!success) { await this.api.refuse(identity); return; }
    const planned = await this.api.plan(identity, success ? entries.map(entry => entry.command) : []);
    if (!this.valid(event)) return;
    if (!planned.ok) { await this.api.refuse(identity); return; }
    const grant = planned.value;
    try {
      for (let sequence = 0; success && sequence < entries.length; sequence++) {
        if (!this.valid(event)) return;
        const result = await this.api.command(grant, sequence, entries[sequence].command);
        entries[sequence].accept(result); success = result.ok;
      }
    } catch { success = false; }
    if (this.valid(event)) await this.api.ack(grant, success);
  }
  private async release(event: ProfileEvent): Promise<void> {
    try {
      await this.hooks.reconcile();
      if (this.stopped || this.current !== event) return;
      const result = await this.api.resume({ operationId: event.operationId, profileEpoch: event.profileEpoch });
      if (!this.stopped && this.current === event) {
        if (result.ok) this.hooks.release(event.failed); else this.hooks.releaseFailure();
      }
    } catch { if (this.current === event && !this.stopped) this.hooks.releaseFailure(); }
  }
  retryRelease(): void { if (this.current?.phase === 'RELEASED') void this.release(this.current); }
}

import { defaultQuery, queryComments, unrestrictedView } from '../domain/discussion-query';
import type { DiscussionQuery, DiscussionViewResult, QueryErrorCode } from '../domain/discussion-query';
import type { Comment } from '../domain/discussion';
import type { QueryExecutor } from './query-worker-client';

/** Transient singleton-discussion state; durable comments are owned by main. */
export interface DiscussionViewState {
  readonly draft: DiscussionQuery;
  readonly applied: DiscussionQuery;
  readonly result: DiscussionViewResult;
  readonly pending: boolean;
  readonly error?: QueryErrorCode;
  readonly seenStale: boolean;
  readonly selected?: string;
}
/** Promotions happen only after a complete successful evaluation. Refresh reads
 * applied criteria at invocation, preserving controls and errors without emptying results. */
export class DiscussionViewSession {
  state: DiscussionViewState;
  private readonly listeners = new Set<() => void>();
  /** Stable subscription functions let a panel observe only its own session. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = (): DiscussionViewState => this.state;
  private changed(): void {
    this.onChanged();
    for (const listener of this.listeners) listener();
  }
  private generation = 0;
  private seenRevision = 0;
  private disposed = false;
  constructor(comments: readonly Comment[], private readonly executor: QueryExecutor, private readonly onChanged: () => void = () => undefined) {
    this.state = { draft: defaultQuery, applied: defaultQuery, result: unrestrictedView(queryComments(comments)), pending: false, seenStale: false };
  }
  edit(draft: DiscussionQuery): void { this.state = { ...this.state, draft }; this.changed(); }
  select(selected: string): void { this.state = { ...this.state, selected }; this.changed(); }
  seenChanged(): void {
    this.seenRevision++;
    if (this.state.applied.seen !== 'all') { this.state = { ...this.state, seenStale: true }; this.changed(); }
  }
  async apply(comments: readonly Comment[], refresh = false): Promise<void> {
    const criteria = refresh ? this.state.applied : this.state.draft;
    const generation = ++this.generation, seenRevision = this.seenRevision;
    this.state = { ...this.state, pending: true, error: undefined }; this.changed();
    let outcome;
    try { outcome = await this.executor.evaluate(queryComments(comments), criteria); }
    catch { outcome = { ok: false as const, error: 'QUERY_FAILED' as const }; }
    if (this.disposed || generation !== this.generation) return;
    if (outcome.ok) {
      this.state = { ...this.state, applied: criteria, result: outcome.result, pending: false, error: undefined,
        seenStale: criteria.seen !== 'all' && seenRevision !== this.seenRevision,
        selected: this.state.selected && outcome.result.visibleCommentIds.includes(this.state.selected) ? this.state.selected : undefined };
    } else this.state = { ...this.state, pending: false, error: outcome.error };
    this.changed();
  }
  dispose(): void { this.disposed = true; this.generation++; this.executor.dispose(); }
}

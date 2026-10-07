import { defaultQuery, queryComments, unrestrictedView } from '../domain/discussion-query';
import { resolveDiscussionQuery } from '../domain/discussion-query-resolution';
import type { DiscussionQuery, DiscussionViewResult, QueryErrorCode } from '../domain/discussion-query';
import type { Comment, ContentItem } from '../domain/discussion';
import type { QueryEvaluationTime } from '../domain/publication-filter';
import { systemQueryEvaluationTime } from './query-evaluation-time';
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
  readonly scrollRequest?: ReaderScrollRequest;
}
/** Session-only presentation intent. An anchor offset is relative to the row top. */
export interface ReaderScrollRequest {
  readonly revision: number;
  readonly kind: 'navigate' | 'apply' | 'refresh';
  readonly id?: string;
  readonly offset?: number;
}
export interface ReaderScrollAnchor { readonly id?: string; readonly offset: number }
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
  private scrollRevision = 0;
  private captureAnchor?: () => ReaderScrollAnchor | undefined;
  /** The mounted reader reports its data-resolved visible anchor, never DOM targets. */
  attachReader(capture: () => ReaderScrollAnchor | undefined): () => void {
    this.captureAnchor = capture;
    return () => { if (this.captureAnchor === capture) this.captureAnchor = undefined; };
  }
  constructor(comments: readonly Comment[], private readonly executor: QueryExecutor, private readonly onChanged: () => void = () => undefined,
    private readonly evaluationTime: () => QueryEvaluationTime = systemQueryEvaluationTime) {
    this.state = { draft: defaultQuery, applied: defaultQuery, result: unrestrictedView(queryComments(comments)), pending: false, seenStale: false };
  }
  edit(draft: DiscussionQuery): void { this.state = { ...this.state, draft }; this.changed(); }
  select(selected: string): void {
    this.state = { ...this.state, selected, scrollRequest: { revision: ++this.scrollRevision, kind: 'navigate', id: selected } }; this.changed();
  }
  seenChanged(): void {
    this.seenRevision++;
    if (this.state.applied.seen !== 'all') { this.state = { ...this.state, seenStale: true }; this.changed(); }
  }
  async apply(comments: readonly Comment[], refresh = false, item?: ContentItem): Promise<void> {
    const criteria = refresh ? this.state.applied : this.state.draft;
    const generation = ++this.generation, seenRevision = this.seenRevision;
    this.state = { ...this.state, pending: true, error: undefined }; this.changed();
    let outcome;
    try {
      const resolved = resolveDiscussionQuery(criteria, this.evaluationTime());
      outcome = resolved.ok ? await this.executor.evaluate(queryComments(comments, item), resolved.query) : resolved;
    }
    catch { outcome = { ok: false as const, error: 'QUERY_FAILED' as const }; }
    if (this.disposed || generation !== this.generation) return;
    if (outcome.ok) {
      // Capture at completion: scrolling while the worker runs remains respected.
      const anchor = refresh ? this.captureAnchor?.() : undefined;
      const visible = new Set(outcome.result.visibleCommentIds);
      const selected = this.state.selected && visible.has(this.state.selected) ? this.state.selected : undefined;
      const keptAnchor = anchor && (anchor.id === undefined || visible.has(anchor.id)) ? anchor : undefined;
      this.state = { ...this.state, applied: criteria, result: outcome.result, pending: false, error: undefined,
        seenStale: criteria.seen !== 'all' && seenRevision !== this.seenRevision,
        selected,
        scrollRequest: { revision: ++this.scrollRevision, kind: refresh ? 'refresh' : 'apply',
          id: refresh ? keptAnchor ? keptAnchor.id : selected : outcome.result.restrictive ? outcome.result.orderedMatchIds[0] : undefined,
          offset: keptAnchor?.offset } };
    } else this.state = { ...this.state, pending: false, error: outcome.error };
    this.changed();
  }
  dispose(): void { this.disposed = true; this.generation++; this.executor.dispose(); }
}

import { defaultQuery, queryComments, unrestrictedView } from '../domain/discussion-query';
import { resolveDiscussionQuery } from '../domain/discussion-query-resolution';
import type { DiscussionQuery, DiscussionViewResult, QueryErrorCode } from '../domain/discussion-query';
import type { Comment, ContentItem } from '../domain/discussion';
import type { QueryEvaluationTime } from '../domain/publication-filter';
import { systemQueryEvaluationTime } from './query-evaluation-time';
import type { QueryExecutor } from './query-worker-client';
import type { DiscussionSort } from './discussion-sort';
import { projectReaderRows } from './discussion-presentation';
import type { ReaderPresentation } from './discussion-presentation';

/** Transient singleton-discussion state; durable comments are owned by main. */
export interface DiscussionViewState {
  readonly sort: DiscussionSort;
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
  readonly kind: 'navigate' | 'apply' | 'refresh' | 'sort';
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
  private presentationCache?: { comments: readonly Comment[]; result: DiscussionViewResult; sort: DiscussionSort; value: ReaderPresentation };
  /** Share one projection across controls, navigation, reader and ruler. Draft,
   * selection and pending-state notifications reuse the same immutable value. */
  presentation(comments: readonly Comment[]): ReaderPresentation {
    const { result, sort } = this.state, cached = this.presentationCache;
    if (cached?.comments === comments && cached.result === result && cached.sort === sort) return cached.value;
    // Committed Refresh metadata reaches React before worker completion. Keep the
    // accepted order until that result is promoted so capture still sees the same
    // reading context; incidental seen acknowledgments also need no key rebuild.
    const retained = cached?.result === result && cached.sort === sort ? cached.value : undefined;
    const value = projectReaderRows(comments, result, sort, retained);
    this.presentationCache = { comments, result, sort, value };
    return value;
  }
  /** Capture identity before explicit reorder; retain selection without navigating
   * to a match. No attached/valid anchor means discussion start. */
  setSort(sort: DiscussionSort): void {
    if (this.state.sort === sort) return;
    const anchor = this.captureAnchor?.();
    const kept = anchor?.id !== undefined && this.state.result.visibleCommentIds.includes(anchor.id) ? anchor : undefined;
    this.state = { ...this.state, sort, scrollRequest: { revision: ++this.scrollRevision, kind: 'sort', id: kept?.id, offset: kept?.offset ?? 0 } };
    this.changed();
  }
  /** The mounted reader reports its data-resolved visible anchor, never DOM targets. */
  attachReader(capture: () => ReaderScrollAnchor | undefined): () => void {
    this.captureAnchor = capture;
    return () => { if (this.captureAnchor === capture) this.captureAnchor = undefined; };
  }
  constructor(comments: readonly Comment[], private readonly executor: QueryExecutor, private readonly onChanged: () => void = () => undefined,
    private readonly evaluationTime: () => QueryEvaluationTime = systemQueryEvaluationTime) {
    this.state = { sort: 'original', draft: defaultQuery, applied: defaultQuery, result: unrestrictedView(queryComments(comments)), pending: false, seenStale: false };
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
      const presentation = projectReaderRows(comments, outcome.result, this.state.sort);
      this.presentationCache = { comments, result: outcome.result, sort: this.state.sort, value: presentation };
      this.state = { ...this.state, applied: criteria, result: outcome.result, pending: false, error: undefined,
        seenStale: criteria.seen !== 'all' && seenRevision !== this.seenRevision,
        selected,
        scrollRequest: { revision: ++this.scrollRevision, kind: refresh ? 'refresh' : 'apply',
          id: refresh ? keptAnchor ? keptAnchor.id : selected : outcome.result.restrictive ? presentation.orderedMatchIds[0] : undefined,
          offset: keptAnchor?.offset } };
    } else this.state = { ...this.state, pending: false, error: outcome.error };
    this.changed();
  }
  dispose(): void { this.disposed = true; this.generation++; this.executor.dispose(); }
}

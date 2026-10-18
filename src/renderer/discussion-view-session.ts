import { expandedDiscussion, changeCollapse } from '../domain/discussion-collapse';
import { toggleBulkSelection } from './comment-selection';
import type { DiscussionCollapse, CollapseChange } from '../domain/discussion-collapse';
import { projectCollapsedRows, collapsedAncestors } from './discussion-collapse';
import type { CollapsedPresentation } from './discussion-collapse';
import { CollapseSaveQueue } from './collapse-save-queue';
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
import { boundedAnchor } from '../domain/discussion-view';
import type { DiscussionViewIntent } from '../domain/discussion-view';
import type { Result } from '../shared/reader-api';
import { DiscussionViewSaveQueue, draftSaveDelay, intentSaveDelay } from './discussion-view-save-queue';

/** Live singleton-discussion state; only semantic intent is persisted by main. */
export interface DiscussionViewState {
  readonly bulkSelected: ReadonlySet<string>;
  readonly selectionMode: boolean;
  readonly collapse: DiscussionCollapse;
  readonly collapseSaveFailed?: boolean;
  readonly sort: DiscussionSort;
  readonly draft: DiscussionQuery;
  readonly applied: DiscussionQuery;
  readonly result: DiscussionViewResult;
  readonly pending: boolean;
  readonly restoring?: boolean;
  readonly restoreFailed?: boolean;
  readonly saveFailed?: boolean;
  readonly error?: QueryErrorCode;
  readonly seenStale: boolean;
  readonly selected?: string;
  readonly scrollRequest?: ReaderScrollRequest;
}
/** Session-only presentation intent. An anchor offset is relative to the row top. */
export interface ReaderScrollRequest {
  readonly revision: number;
  readonly kind: 'navigate' | 'apply' | 'refresh' | 'sort' | 'restore' | 'collapse';
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
  private currentComments: readonly Comment[];
  private bulkAnchor?: string;
  /** Session-only bulk identity, independent of durable navigation selection. */
  setSelectionMode(selectionMode: boolean): void {
    this.state = { ...this.state, selectionMode, bulkSelected: selectionMode ? this.state.bulkSelected : new Set() };
    if (!selectionMode) this.bulkAnchor = undefined;
    this.changed();
  }
  clearBulkSelection(): void {
    this.bulkAnchor = undefined;
    this.state = { ...this.state, bulkSelected: new Set() }; this.changed();
  }
  toggleBulk(id: string, shift: boolean): void {
    const displayed = this.displayed(this.currentComments);
    if (!displayed.indexById.has(id)) return;
    const bulkSelected = toggleBulkSelection(this.state.bulkSelected, id, this.bulkAnchor, shift, displayed);
    if (!shift || this.bulkAnchor === undefined || !displayed.indexById.has(this.bulkAnchor)) this.bulkAnchor = id;
    this.state = { ...this.state, selectionMode: true, bulkSelected }; this.changed();
  }
  /** Assign only expandable selected IDs; no descendant enumeration or reveal. */
  collapseSelected(collapsed: boolean): void {
    const complete = this.presentation(this.currentComments);
    const ids = [...this.state.bulkSelected].filter(id => {
      const index = complete.indexById.get(id); return index !== undefined && complete.rows[index].hasChildren;
    });
    if (ids.length) this.setCollapsed({ kind: 'comments', ids, collapsed });
  }
  private generation = 0;
  private seenRevision = 0;
  private disposed = false;
  private draining = false;
  private scrollRevision = 0;
  /** Explicit header scrolling supersedes an unfinished sort/collapse reveal,
   * retaining logical navigation selection, criteria and settled-anchor saving. */
  scrollToStart(): void {
    this.state = { ...this.state, scrollRequest: { revision: ++this.scrollRevision, kind: 'restore', offset: 0 } };
    this.changed();
  }
  private captureAnchor?: () => ReaderScrollAnchor | undefined;
  private readerMountedBefore = false;
  private anchor: DiscussionViewIntent['anchor'] = { commentId: null, offset: 0 };
  private durableApplied: DiscussionQuery = defaultQuery;
  private readonly saveQueue?: DiscussionViewSaveQueue;
  private readonly collapseQueue?: CollapseSaveQueue;
  private collapsedCache?: { complete: ReaderPresentation; state: DiscussionCollapse; value: CollapsedPresentation };
  private readonly saved?: DiscussionViewIntent;
  private restoreStarted = false;
  private restoreTask?: Promise<void>;
  private presentationCache?: { comments: readonly Comment[]; result: DiscussionViewResult; sort: DiscussionSort; value: ReaderPresentation };
  /** Share one projection across controls, navigation, reader and ruler. Draft,
   * selection and pending-state notifications reuse the same immutable value. */
  presentation(comments: readonly Comment[]): ReaderPresentation {
    this.currentComments = comments;
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
  /** Cached independent visible projection; complete order/counts never shrink. */
  displayed(comments: readonly Comment[]): CollapsedPresentation {
    const complete = this.presentation(comments), state = this.state.collapse, cached = this.collapsedCache;
    if (cached?.complete === complete && cached.state === state) return cached.value;
    const value = projectCollapsedRows(complete, state);
    this.collapsedCache = { complete, state, value }; return value;
  }
  /** Manual changes retain hidden selection and restore a hidden anchor to its
   * visible hiding ancestor. Navigation alone opens ancestors of its exact ID. */
  setCollapsed(change: CollapseChange): void {
    if (this.state.restoring) return;
    const anchor = this.captureAnchor?.() ?? { id: this.anchor.commentId ?? undefined, offset: this.anchor.offset };
    this.state = { ...this.state, collapse: changeCollapse(this.state.collapse, change) };
    const projected = this.displayed(this.currentComments);
    const id = anchor.id === undefined ? undefined : projected.representativeById.get(anchor.id);
    const offset = id === anchor.id ? anchor.offset : 0;
    this.state = { ...this.state, scrollRequest: { revision: ++this.scrollRevision, kind: 'collapse', id, offset } };
    this.anchor = boundedAnchor(id, offset);
    this.collapseQueue?.schedule(change); this.saveQueue?.schedule(intentSaveDelay); this.changed();
  }
  private revealAncestors(id: string): void {
    const complete = this.presentation(this.currentComments);
    if (!complete) return;
    const ids = collapsedAncestors(id, complete, this.state.collapse);
    if (!ids.length) return;
    const change = { kind: 'comments' as const, ids, collapsed: false };
    this.state = { ...this.state, collapse: changeCollapse(this.state.collapse, change) };
    this.collapseQueue?.schedule(change);
  }
  /** Capture identity before explicit reorder; retain selection without navigating
   * to a match. No attached/valid anchor means discussion start. */
  setSort(sort: DiscussionSort): void {
    if (this.state.restoring) return;
    if (this.state.sort === sort) return;
    const anchor = this.captureAnchor?.();
    const kept = anchor?.id !== undefined && this.state.result.visibleCommentIds.includes(anchor.id) ? anchor : undefined;
    this.state = { ...this.state, sort, scrollRequest: { revision: ++this.scrollRevision, kind: 'sort', id: kept?.id, offset: kept?.offset ?? 0 } };
    this.anchor = boundedAnchor(kept?.id, kept?.offset ?? 0);
    this.saveQueue?.schedule(intentSaveDelay);
    this.changed();
  }
  /** The mounted reader reports its data-resolved visible anchor, never DOM targets. */
  attachReader(capture: () => ReaderScrollAnchor | undefined): () => void {
    this.captureAnchor = capture;
    if (this.readerMountedBefore && !this.state.restoring) {
      // Closing unmounts the virtualizer, while the discussion session survives.
      // Reopening uses the last settled data anchor, not an old navigation request.
      this.state = { ...this.state, scrollRequest: { revision: ++this.scrollRevision, kind: 'restore',
        id: this.anchor.commentId ?? undefined, offset: this.anchor.offset } };
      this.changed();
    }
    this.readerMountedBefore = true;
    return () => { if (this.captureAnchor === capture) this.captureAnchor = undefined; };
  }
  constructor(comments: readonly Comment[], private readonly executor: QueryExecutor, private readonly onChanged: () => void = () => undefined,
    private readonly evaluationTime: () => QueryEvaluationTime = systemQueryEvaluationTime,
    persistence?: { readonly collapse?: DiscussionCollapse; readonly saveCollapse?: (change: CollapseChange) => Promise<Result<null>>; readonly saved?: DiscussionViewIntent; readonly save?: (intent: DiscussionViewIntent) => Promise<Result<null>> }) {
    this.currentComments = comments;
    this.saved = persistence?.saved;
    const saved = this.saved;
    this.anchor = saved?.anchor ?? this.anchor;
    this.durableApplied = saved?.applied ?? defaultQuery;
    this.state = { bulkSelected: new Set(), selectionMode: false, collapse: persistence?.collapse ?? expandedDiscussion, sort: saved?.sort ?? 'original', draft: saved?.draft ?? defaultQuery, applied: this.durableApplied,
      result: unrestrictedView(saved ? [] : queryComments(comments)), pending: !!saved, restoring: !!saved, seenStale: false };
    if (persistence?.saveCollapse) this.collapseQueue = new CollapseSaveQueue(persistence.saveCollapse, failed => {
      if (!!this.state.collapseSaveFailed === failed) return;
      this.state = { ...this.state, collapseSaveFailed: failed }; this.changed();
    });
    const save = persistence?.save;
    if (save) this.saveQueue = new DiscussionViewSaveQueue(() => save(this.persistentIntent()), failed => {
      if (!!this.state.saveFailed === failed) return;
      this.state = { ...this.state, saveFailed: failed }; this.changed();
    });
  }
  /** Fresh resolver/worker evaluation is lazy and idempotent under StrictMode. */
  restore(comments: readonly Comment[], item?: ContentItem): Promise<void> {
    if (!this.saved) return Promise.resolve();
    if (this.restoreStarted) return this.restoreTask ?? Promise.resolve();
    this.restoreStarted = true;
    this.restoreTask = this.apply(comments, false, item, true);
    return this.restoreTask;
  }
  /** A committed Refresh arriving during initial reconstruction must still
   * reevaluate its current durable rows after that reconstruction completes. */
  async refresh(comments: readonly Comment[], item?: ContentItem): Promise<void> {
    if (this.state.restoring) await this.restore(comments, item);
    await this.apply(comments, true, item);
  }
  persistentIntent(): DiscussionViewIntent {
    return { draft: this.state.draft, applied: this.durableApplied, sort: this.state.sort, anchor: this.anchor, selected: this.state.selected ?? null };
  }
  /** Called only after idle/virtual reveal settles, never once per scroll pixel. */
  readerSettled(): void {
    if (this.state.restoring || this.draining) return;
    const captured = this.captureAnchor?.();
    if (!captured) return;
    const next = boundedAnchor(captured.id, captured.offset);
    if (next.commentId === this.anchor.commentId && next.offset === this.anchor.offset) return;
    this.anchor = next;
    this.saveQueue?.schedule(intentSaveDelay);
  }
  /** Before leaving/closing, capture the useful current data anchor and coalesce. */
  flush(): Promise<void> {
    this.readerSettled();
    return Promise.all([this.saveQueue?.flush(), this.collapseQueue?.flush()]).then(() => undefined);
  }
  /** Freeze asynchronous timers before waiting for accepted worker intent. The
   * checkpoint uses the captured logical anchor, never an unmount side effect. */
  freeze(capture = true): void {
    if (capture) this.readerSettled();
    this.draining = true; this.saveQueue?.pause(); this.collapseQueue?.pause();
  }
  async drainCheckpoints(itemId: string): Promise<readonly import('./profile-lifecycle').Checkpoint[]> {
    if (this.state.pending) await new Promise<void>(resolve => {
      const unsubscribe = this.subscribe(() => { if (!this.state.pending) { unsubscribe(); resolve(); } });
    });
    await Promise.all([this.saveQueue?.settled(), this.collapseQueue?.settled()]);
    const entries: import('./profile-lifecycle').Checkpoint[] = [];
    if (this.collapseQueue?.dirty) {
      const accept = this.collapseQueue.checkpoint(), collapse = this.state.collapse;
      entries.push({ command: { kind: 'collapse', request: { itemId, kind: 'all', collapsed: collapse.defaultCollapsed } },
        accept: result => { if (!result.ok || !collapse.overrides.length) accept(result.ok); } });
      if (collapse.overrides.length) entries.push({ command: { kind: 'collapse', request: { itemId, kind: 'comments', ids: collapse.overrides, collapsed: !collapse.defaultCollapsed } }, accept: result => accept(result.ok) });
    }
    if (this.saveQueue?.dirty) {
      const accept = this.saveQueue.checkpoint();
      entries.push({ command: { kind: 'view', request: { itemId, ...this.persistentIntent() } }, accept: result => accept(result.ok) });
    }
    return entries;
  }
  resume(): void { this.draining = false; this.saveQueue?.resume(); this.collapseQueue?.resume(); }
  edit(draft: DiscussionQuery): void {
    if (this.state.restoring) return;
    this.state = { ...this.state, draft }; this.saveQueue?.schedule(draftSaveDelay); this.changed();
  }
  select(selected: string): void {
    if (this.state.restoring || !this.state.result.visibleCommentIds.includes(selected)) return;
    this.revealAncestors(selected);
    this.saveQueue?.schedule(intentSaveDelay);
    this.state = { ...this.state, selected, scrollRequest: { revision: ++this.scrollRevision, kind: 'navigate', id: selected } }; this.changed();
  }
  seenChanged(): void {
    this.seenRevision++;
    if (this.state.applied.seen !== 'all') { this.state = { ...this.state, seenStale: true }; this.changed(); }
  }
  async apply(comments: readonly Comment[], refresh = false, item?: ContentItem, restore = false): Promise<void> {
    if (this.disposed) return;
    if (this.state.restoring && !restore) return;
    const restoreIntent = restore ? this.saved : undefined;
    const criteria = restoreIntent?.applied ?? (refresh ? this.state.applied : this.state.draft);
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
      const anchor = refresh ? this.captureAnchor?.() ?? (this.readerMountedBefore
        ? { id: this.anchor.commentId ?? undefined, offset: this.anchor.offset } : undefined) : undefined;
      const visible = new Set(outcome.result.visibleCommentIds);
      const bulkSelected = new Set([...this.state.bulkSelected].filter(id => visible.has(id)));
      if (this.bulkAnchor && !visible.has(this.bulkAnchor)) this.bulkAnchor = undefined;
      const candidate = restore ? this.saved?.selected : this.state.selected;
      const selected = candidate && visible.has(candidate) ? candidate : undefined;
      const keptAnchor = anchor && (anchor.id === undefined || visible.has(anchor.id)) ? anchor : undefined;
      this.currentComments = comments;
      const presentation = projectReaderRows(comments, outcome.result, this.state.sort);
      this.presentationCache = { comments, result: outcome.result, sort: this.state.sort, value: presentation };
      const restoredAnchor = restoreIntent ? restorationAnchor(restoreIntent.anchor, selected, presentation, outcome.result.restrictive) : undefined;
      this.state = { ...this.state, applied: criteria, result: outcome.result, pending: false, error: undefined,
        restoring: false, restoreFailed: false, seenStale: criteria.seen !== 'all' && seenRevision !== this.seenRevision,
        selected, bulkSelected,
        scrollRequest: { revision: ++this.scrollRevision, kind: restore ? 'restore' : refresh ? 'refresh' : 'apply',
          id: restore ? restoredAnchor?.commentId ?? undefined : refresh ? keptAnchor ? keptAnchor.id : selected : outcome.result.restrictive ? presentation.orderedMatchIds[0] : undefined,
          offset: restore ? restoredAnchor?.offset : keptAnchor?.offset } };
      this.durableApplied = criteria;
      const request = this.state.scrollRequest;
      this.anchor = boundedAnchor(request?.id, request?.offset ?? 0);
      if (!restore) this.saveQueue?.schedule(intentSaveDelay);
    } else if (restore) {
      const result = unrestrictedView(queryComments(comments, item));
      this.state = { ...this.state, result, applied: defaultQuery, draft: criteria, pending: false, restoring: false,
        restoreFailed: true, error: undefined, seenStale: false, selected: undefined,
        scrollRequest: { revision: ++this.scrollRevision, kind: 'restore', offset: 0 } };
      this.anchor = { commentId: null, offset: 0 };
      // The original durable applied intent remains available for the next restart.
      console.warn('DISCUSSION_VIEW_RESTORE_FAILED', outcome.error);
    } else this.state = { ...this.state, pending: false, error: outcome.error };
    this.changed();
  }
  dispose(): void { this.disposed = true; this.generation++; this.saveQueue?.dispose(); this.collapseQueue?.dispose(); this.executor.dispose(); }
}

/** Restore top explicitly; otherwise use displayed identities in current sorted
 * order. Selection restoration is independent and never requests DOM focus. */
export function restorationAnchor(anchor: DiscussionViewIntent['anchor'], selected: string | undefined,
  presentation: ReaderPresentation, restrictive: boolean): DiscussionViewIntent['anchor'] {
  if (anchor.commentId === null) return { commentId: null, offset: 0 };
  if (presentation.indexById.has(anchor.commentId)) return boundedAnchor(anchor.commentId, anchor.offset);
  if (selected && presentation.indexById.has(selected)) return boundedAnchor(selected, 0);
  return boundedAnchor(restrictive ? presentation.orderedMatchIds[0] : undefined, 0);
}

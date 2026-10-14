import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DiscussionPanel } from '../renderer/DiscussionPanel';
import { DiscussionViewSession } from '../renderer/discussion-view-session';
import { createQueryExecutor } from '../renderer/query-executor';
import { navigateDiscussion } from '../renderer/discussion-navigation';
import { generateDiscussion } from './large-discussions';
import type { GeneratedDiscussionOptions } from './large-discussions';
import { toggleSeen } from '../domain/discussion';
import type { Comment, ContentItem } from '../domain/discussion';
import { queryComments, unrestrictedView } from '../domain/discussion-query';
import { projectReaderRows } from '../renderer/discussion-presentation';
import { required } from '../renderer/testing/required';
import type { Locale } from '../renderer/i18n';
import type { SeenUndoDescriptor } from '../domain/seen-operation';
import type { SeenFeedback } from '../renderer/BulkSeenControls';
import type { DiscussionSort } from '../renderer/discussion-sort';
import { dateTestComment, dateTestItem } from '../fixtures/date-discussion';
import '../index.css';

const root = createRoot(required(document.getElementById('root')));
let comments: readonly Comment[] = [], item: ContentItem, session: DiscussionViewSession;
let locale: Locale = 'en';
let undo: SeenUndoDescriptor | null = null, feedback: SeenFeedback | undefined;
interface EvaluationGeometryProbe { rows?: ReadonlyMap<string | undefined, number> }
let evaluationGeometryProbe: EvaluationGeometryProbe | undefined;
const mountedTops = () => new Map([...document.querySelectorAll<HTMLElement>('.virtual-comment')].map(row => [row.dataset.commentId, row.getBoundingClientRect().top]));
const offlineBulk = async () => false; // Profiling injects acknowledgments below, never main commands.
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function render() {
  flushSync(() => root.render(<div className="app-shell"><main className="reader-panel" id="profile-panel" tabIndex={0}>
    <DiscussionPanel item={item} comments={comments} session={session} locale={locale} saving={false} refreshDisabled={false}
      coverageLimited={false} onRefresh={noop} onToggle={toggle}
      undo={undo} feedback={feedback} onBulk={offlineBulk} onUndo={noop} onBulkModal={noop} />
  </main></div>));
}
function noop() { /* Offline harness only. */ }
function toggle(_itemId: string, id: string, subtree: boolean) { comments = toggleSeen(comments, id, subtree); session.seenChanged(); render(); }
const stats = () => {
  const panel = required(document.getElementById('profile-panel')), article = document.querySelector<HTMLElement>('[data-selected=true]');
  const rect = article?.getBoundingClientRect(), viewport = panel.getBoundingClientRect();
  return { rows: document.querySelectorAll('.comment').length, nodes: document.querySelectorAll('*').length, scroll: panel.scrollTop,
    rulerNodes: document.querySelector('.discussion-ruler')?.querySelectorAll('*').length ?? 0,
    rulerBuckets: Number((document.querySelector<HTMLElement>('.discussion-ruler'))?.dataset.bucketCount ?? 0),
    exactSelectedMounted: !!article, exactSelectedVisible: !!rect && rect.bottom > viewport.top && rect.top < viewport.bottom };
};
const profile = {
  async load(options: (GeneratedDiscussionOptions & { sortingEvidence?: boolean }) | { item: ContentItem; comments: readonly Comment[] }) {
    session?.dispose(); flushSync(() => root.render(null));
    const data = 'count' in options ? generateDiscussion(options) : options;
    comments = 'sortingEvidence' in options && options.sortingEvidence ? data.comments.map((comment, index) => ({ ...comment,
      publishedAt: new Date(Date.parse('2025-01-01T00:00:00Z') + index * 1000).toISOString() })) : data.comments;
    item = data.item;
    undo = null; feedback = undefined;
    const start = performance.now();
    const result = unrestrictedView(queryComments(comments));
    const identityViewMs = performance.now() - start, beginProjection = performance.now();
    projectReaderRows(comments, result);
    const projectionMs = performance.now() - beginProjection;
    const executor = createQueryExecutor();
    session = new DiscussionViewSession(comments, {
      async evaluate(rows, query) {
        const outcome = await executor.evaluate(rows, query);
        // Refresh's contract captures at completion, after pending status reflow.
        if (evaluationGeometryProbe) evaluationGeometryProbe.rows = mountedTops();
        return outcome;
      },
      dispose: () => executor.dispose(),
    });
    const begin = performance.now(); render(); await paint();
    return { count: comments.length, identityViewMs, projectionMs, renderPaintMs: performance.now() - begin, ...stats(), visible: result.visibleCommentIds.length };
  },
  async toggle() { const id = required(required(document.querySelector<HTMLElement>('.comment-branch')).dataset.commentId);
    const start = performance.now(); toggle(item.id, id, false); await paint(); return { ms: performance.now() - start, ...stats() }; },
  async bulkAcknowledgment() {
    const original = comments, result = session.state.result, start = performance.now();
    // Measure renderer acknowledgment/reconciliation+paint separately from SQLite.
    const seen = new Map(comments.map(comment => [comment.id, true]));
    comments = comments.map(comment => comment.seen === seen.get(comment.id) ? comment : { ...comment, seen: true });
    const changed = original.filter(comment => !comment.seen).length;
    undo = { id: 'profile-operation', itemId: item.id, kind: 'all', targetSeen: true, targetCount: comments.length, changedCount: changed, createdAt: '2026-10-08T12:00:00Z' };
    feedback = { kind: 'marked', seen: true, count: changed };
    session.seenChanged(); render(); await paint();
    if (session.state.result !== result) throw new Error('Bulk recomputed applied membership');
    const bulk = { ms: performance.now() - start, ...stats() }, undoStart = performance.now();
    const previous = new Map(original.map(comment => [comment.id, comment.seen]));
    comments = comments.map(comment => comment.seen === previous.get(comment.id) ? comment : { ...comment, seen: required(previous.get(comment.id)) });
    undo = null; feedback = { kind: 'undo', count: changed, skipped: 0 };
    session.seenChanged(); render(); await paint();
    if (session.state.result !== result) throw new Error('Undo recomputed applied membership');
    return { bulk, undo: { ms: performance.now() - undoStart, ...stats() } };
  },
  async restore() {
    session.readerSettled();
    const saved = session.persistentIntent(), before = mountedTops();
    session.dispose(); flushSync(() => root.render(null));
    const executor = createQueryExecutor(); let queryMs = 0;
    const started = performance.now();
    session = new DiscussionViewSession(comments, {
      async evaluate(rows, query) { const start = performance.now(); const result = await executor.evaluate(rows, query); queryMs = performance.now() - start; return result; },
      dispose: () => executor.dispose(),
    }, undefined, undefined, { saved });
    render(); await session.restore(comments, item);
    for (let i = 0; i < 8; i++) await paint();
    const row = saved.anchor.commentId ? document.getElementById(`comment-${saved.anchor.commentId}`)?.closest('.virtual-comment') : undefined;
    const anchorDelta = saved.anchor.commentId && row ? row.getBoundingClientRect().top - required(before.get(saved.anchor.commentId)) : 0;
    if (Math.abs(anchorDelta) > 2 || session.state.sort !== saved.sort || session.state.restoreFailed) throw new Error('Restart reconstruction/anchor regression');
    return { queryMs, reconstructionPaintMs: performance.now() - started, anchorDelta, sort: saved.sort, ...stats() };
  },
  async apply(text = 'PROFILE_MATCH', refresh = false) {
    if (!refresh) session.edit({ ...session.state.draft, text });
    const start = performance.now(); await session.apply(comments, refresh, item); await paint();
    return { ms: performance.now() - start, matches: session.state.result.matchCount, visible: session.state.result.visibleCommentIds.length, error: session.state.error, ...stats() };
  },
  async navigate(direction: 1 | -1 = -1, kind: 'match' | 'unseen' = 'match') {
    const start = performance.now(); navigateDiscussion(session, comments, kind, direction); await paint();
    const ms = performance.now() - start;
    for (let i = 0; i < 10 && !stats().exactSelectedVisible; i++) await paint();
    return { ms, settledMs: performance.now() - start, selected: session.state.selected, ...stats() };
  },
  async sort(mode: DiscussionSort) {
    const before = new Map([...document.querySelectorAll<HTMLElement>('.virtual-comment')].map(row => [row.dataset.commentId, row.getBoundingClientRect().top]));
    const selected = session.state.selected, result = session.state.result, original = comments, start = performance.now();
    // Exercise the actual accessible select, including React event dispatch.
    const control = required(document.querySelector<HTMLSelectElement>('.discussion-sort select'));
    const setter = required(Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set);
    flushSync(() => { setter.call(control, mode); control.dispatchEvent(new Event('change', { bubbles: true })); });
    const request = session.state.scrollRequest;
    for (let i = 0; i < 8; i++) await paint();
    const anchor = request?.id ? document.getElementById(`comment-${request.id}`)?.closest('.virtual-comment') : undefined;
    const anchorDelta = request?.id && anchor ? anchor.getBoundingClientRect().top - required(before.get(request.id)) : 0;
    if (Math.abs(anchorDelta) > 2) throw new Error(`Sort anchor moved by ${anchorDelta}px`);
    if (session.state.result !== result || comments !== original || session.state.selected !== selected) throw new Error('Sort changed membership, comments or selection');
    return { mode: session.state.sort, ms: performance.now() - start, anchorId: request?.id, anchorDelta, first: session.presentation(comments).orderedIds[0], ...stats() };
  },
  async sortingSemantics() {
    const old = dateTestComment('old', '2025-01-01T00:00:00Z', { likeCount: 0 });
    const reply = dateTestComment('recent-reply', '2026-10-01T00:00:00Z', { parentId: 'old', likeCount: 999 });
    const newest = dateTestComment('new', '2026-09-20T00:00:00Z', { likeCount: 10 });
    await profile.load({ item: dateTestItem, comments: [old, reply, newest, dateTestComment('unknown')] });
    const expected = { original: ['old', 'recent-reply', 'new', 'unknown'], newest: ['new', 'old', 'recent-reply', 'unknown'],
      oldest: ['old', 'recent-reply', 'new', 'unknown'], 'most-liked': ['new', 'old', 'recent-reply', 'unknown'], 'latest-activity': ['old', 'recent-reply', 'new', 'unknown'] };
    for (const mode of Object.keys(expected) as DiscussionSort[]) {
      await profile.sort(mode);
      if (JSON.stringify(session.presentation(comments).orderedIds) !== JSON.stringify(expected[mode])) throw new Error(`Wrong ${mode} presentation`);
    }
    await profile.apply('needle');
    if (session.state.sort !== 'latest-activity') throw new Error('Apply reset sorting');
    await profile.apply('', true);
    if (session.state.sort !== 'latest-activity') throw new Error('Refresh reset sorting');
    await profile.toggle();
    if (session.presentation(comments).orderedIds[0] !== 'old') throw new Error('Seen reordered');
    return { modes: 5, retainedOnApplyRefresh: true, seenIndependent: true };
  },
  async refreshSortingMetadata() {
    const first = session.presentation(comments).orderedIds[0], mode = session.state.sort;
    comments = comments.map((comment, index) => ({ ...comment,
      publishedAt: new Date(Date.parse('2025-01-01T00:00:00Z') + (comments.length - index) * 1000).toISOString() }));
    // Like the app, commit live metadata before worker evaluation is promoted.
    const probe: EvaluationGeometryProbe = {};
    evaluationGeometryProbe = probe;
    try { render(); await session.apply(comments, true, item); }
    finally { evaluationGeometryProbe = undefined; }
    for (let i = 0; i < 8; i++) await paint();
    const request = session.state.scrollRequest;
    const anchor = request?.id ? document.getElementById(`comment-${request.id}`)?.closest('.virtual-comment') : undefined;
    if (!anchor || !request?.id) throw new Error('Refresh lost its visible anchor');
    const anchorDelta = anchor.getBoundingClientRect().top - required(probe.rows?.get(request.id));
    if (Math.abs(anchorDelta) > 2 || session.state.sort !== mode || session.presentation(comments).orderedIds[0] === first)
      throw new Error(`Refresh sort rekey/anchor regression: ${JSON.stringify({ anchorDelta, mode, actualMode: session.state.sort, first, after: session.presentation(comments).orderedIds[0], anchorId: request.id })}`);
    return { mode, anchorDelta, error: session.state.error, ...stats() };
  },
  async rulerNavigate(category: 'unseen' | 'match' | 'new' = 'new') {
    const ruler = required(document.querySelector<HTMLElement>('.discussion-ruler'));
    const path = ruler.querySelector(`.ruler-${category}`)?.getAttribute('d') ?? '';
    const starts = [...path.matchAll(/M\d+,([\d.]+)/g)];
    const y = Number(starts.at(-1)?.[1]) + 1;
    if (!Number.isFinite(y)) throw new Error('Ruler category marker missing');
    const before = comments, rect = ruler.getBoundingClientRect(), start = performance.now();
    ruler.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + ['unseen', 'match', 'new'].indexOf(category) * 6 + 3, clientY: rect.top + y }));
    await paint();
    for (let i = 0; i < 15 && !stats().exactSelectedVisible; i++) await paint();
    if (before !== comments) throw new Error('Ruler changed seen');
    return { ms: performance.now() - start, selected: session.state.selected, ...stats() };
  },
  async rulerReflowCheck() {
    const ruler = required(document.querySelector<HTMLElement>('.discussion-ruler'));
    const before = ruler.getBoundingClientRect();
    const unseen = Number(ruler.dataset.unseenCount), matches = ruler.dataset.matchCount, newCount = ruler.dataset.newCount;
    await profile.toggle();
    if (Math.abs(unseen - Number(ruler.dataset.unseenCount)) !== 1) throw new Error('Unseen marker count did not update');
    if (matches !== ruler.dataset.matchCount || newCount !== ruler.dataset.newCount) throw new Error('Seen altered frozen match/NEW');
    await profile.toggle();
    await profile.locale('pl');
    ruler.focus(); await paint();
    if (!ruler.getAttribute('aria-label')?.includes('Przegląd dyskusji')) throw new Error('Ruler localization failed');
    await profile.locale('en');
    const shell = required(document.querySelector<HTMLElement>('.app-shell'));
    shell.style.width = '800px'; shell.style.height = '650px'; await paint(); await paint();
    const resized = ruler.getBoundingClientRect();
    if (resized.height === before.height || resized.left === before.left) throw new Error('Ruler did not follow viewport resize');
    shell.style.width = ''; shell.style.height = ''; await paint(); await paint();
    return { originalHeight: before.height, resizedHeight: resized.height, returnedHeight: ruler.getBoundingClientRect().height, ...stats() };
  },
  async rulerSemanticCheck() {
    await profile.load({ count: 3, shape: 'shallow', roots: 1, seenRatio: 0, matchIndexes: [0, 1], newIndexes: [1] });
    await profile.toggle(); // raw root fails Unseen; reply matches, sibling is context
    session.edit({ ...session.state.draft, text: 'PROFILE_MATCH', seen: 'unseen' });
    await session.apply(comments); await paint();
    const ruler = required(document.querySelector<HTMLElement>('.discussion-ruler'));
    if (ruler.dataset.matchCount !== '1' || ruler.dataset.unseenCount !== '2' || ruler.dataset.newCount !== '1') throw new Error('Raw/context/overlap ruler regression');
    return { matches: 1, unseen: 2, new: 1, rawHitContext: !!document.querySelector('.raw-match-badge'),
      paths: ['unseen', 'match', 'new'].map(category => ruler.querySelector(`.ruler-${category}`)?.getAttribute('d')) };
  },
  async scroll(fraction: number) { const panel = required(document.getElementById('profile-panel'));
    const start = performance.now(); panel.scrollTop = (panel.scrollHeight - panel.clientHeight) * fraction; await paint();
    return { ms: performance.now() - start, ...stats() }; },
  async switch() { const panel = required(document.getElementById('profile-panel')), start = performance.now(); panel.hidden = true; await paint(); panel.hidden = false; await paint(); return { ms: performance.now() - start, ...stats() }; },
  stats,
  async locale(value: Locale) { locale = value; render(); await paint(); },
  async realCheck() {
    const original = comments, before = new Map(comments.map(row => [row.id, row.seen]));
    const rootId = session.state.result.visibleCommentIds[0];
    toggle(item.id, rootId, false);
    if (comments.filter(row => row.seen !== before.get(row.id)).length !== 1) throw new Error('Normal seen regression');
    // Query one real stored text fragment through the actual worker; no content is logged.
    const needle = original.at(-1)?.text.slice(0, 20) ?? '';
    const query = await profile.apply(needle);
    const navigation = await profile.navigate();
    comments = original; session.seenChanged(); session.edit({ ...session.state.draft, text: '' });
    await session.apply(comments); render(); await paint();
    return { storedCount: original.length, queryMatches: query.matches, completeTreeRows: query.visible,
      exactTargetVisible: navigation.exactSelectedVisible, seenChanges: 1, restored: stats() };
  },
  async sanitize() {
    for (const element of document.querySelectorAll('h1,.item-description,.item-meta strong,.comment-byline strong')) element.textContent = 'Example discussion / reader';
    for (const element of document.querySelectorAll('.comment-text')) element.textContent = 'Representative comment text.\nPreserved nested reading layout.';
    for (const element of document.querySelectorAll('.comment-byline .muted,.item-meta span')) element.textContent = '@example';
    await paint();
  },
  layout() {
    const rows = [...document.querySelectorAll<HTMLElement>('.virtual-comment')];
    const gaps = rows.slice(1).flatMap((row, index) => Number(row.dataset.index) === Number(rows[index].dataset.index) + 1
      ? [row.getBoundingClientRect().top - rows[index].getBoundingClientRect().bottom] : []);
    return { largestGap: Math.max(0, ...gaps), largestOverlap: Math.max(0, ...gaps.map(gap => -gap)) };
  },
};
Object.assign(window, { profile });

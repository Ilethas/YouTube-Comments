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
import '../index.css';

const root = createRoot(required(document.getElementById('root')));
let comments: readonly Comment[] = [], item: ContentItem, session: DiscussionViewSession;
let locale: Locale = 'en';
const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function render() {
  flushSync(() => root.render(<div className="app-shell"><main className="reader-panel" id="profile-panel" tabIndex={0}>
    <DiscussionPanel item={item} comments={comments} session={session} locale={locale} saving={false} refreshDisabled={false}
      coverageLimited={false} onRefresh={noop} onToggle={toggle} />
  </main></div>));
}
function noop() { /* Offline harness only. */ }
function toggle(_itemId: string, id: string, subtree: boolean) { comments = toggleSeen(comments, id, subtree); session.seenChanged(); render(); }
const stats = () => {
  const panel = required(document.getElementById('profile-panel')), article = document.querySelector<HTMLElement>('[data-selected=true]');
  const rect = article?.getBoundingClientRect(), viewport = panel.getBoundingClientRect();
  return { rows: document.querySelectorAll('.comment').length, nodes: document.querySelectorAll('*').length, scroll: panel.scrollTop,
    exactSelectedMounted: !!article, exactSelectedVisible: !!rect && rect.bottom > viewport.top && rect.top < viewport.bottom };
};
const profile = {
  async load(options: GeneratedDiscussionOptions | { item: ContentItem; comments: readonly Comment[] }) {
    session?.dispose(); flushSync(() => root.render(null));
    const data = 'count' in options ? generateDiscussion(options) : options;
    comments = data.comments; item = data.item;
    const start = performance.now();
    const result = unrestrictedView(queryComments(comments));
    const identityViewMs = performance.now() - start, beginProjection = performance.now();
    projectReaderRows(comments, result);
    const projectionMs = performance.now() - beginProjection;
    session = new DiscussionViewSession(comments, createQueryExecutor());
    const begin = performance.now(); render(); await paint();
    return { count: comments.length, identityViewMs, projectionMs, renderPaintMs: performance.now() - begin, ...stats(), visible: result.visibleCommentIds.length };
  },
  async toggle() { const id = required(required(document.querySelector<HTMLElement>('.comment-branch')).dataset.commentId);
    const start = performance.now(); toggle(item.id, id, false); await paint(); return { ms: performance.now() - start, ...stats() }; },
  async apply(text = 'PROFILE_MATCH', refresh = false) {
    if (!refresh) session.edit({ ...session.state.draft, text });
    const start = performance.now(); await session.apply(comments, refresh); await paint();
    return { ms: performance.now() - start, matches: session.state.result.matchCount, visible: session.state.result.visibleCommentIds.length, error: session.state.error, ...stats() };
  },
  async navigate(direction: 1 | -1 = -1, kind: 'match' | 'unseen' = 'match') {
    const start = performance.now(); navigateDiscussion(session, comments, kind, direction); await paint();
    const ms = performance.now() - start;
    for (let i = 0; i < 10 && !stats().exactSelectedVisible; i++) await paint();
    return { ms, settledMs: performance.now() - start, selected: session.state.selected, ...stats() };
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

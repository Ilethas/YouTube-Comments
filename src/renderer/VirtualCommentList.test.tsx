import { evaluateTestQuery } from '../fixtures/query-testing';
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { DiscussionPanel } from './DiscussionPanel';
import { DiscussionViewSession } from './discussion-view-session';
import { generateDiscussion } from '../development/large-discussions';
import { defaultQuery, evaluateDiscussionQuery, queryComments } from '../domain/discussion-query';
import { toggleSeen } from '../domain/discussion';
import type { Comment, ContentItem } from '../domain/discussion';
import { navigateDiscussion } from './discussion-navigation';
import { completeReaderLimit, readerOverscan, VirtualCommentList } from './VirtualCommentList';
import { installReaderLayout } from './testing/reader-layout';
import { required } from './testing/required';

let layout: ReturnType<typeof installReaderLayout>;
beforeEach(() => { layout = installReaderLayout(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.__readerWork; });
const executor = () => ({ evaluate: vi.fn(async (rows: Parameters<typeof evaluateDiscussionQuery>[0], query: Parameters<typeof evaluateDiscussionQuery>[1]) => evaluateDiscussionQuery(rows, query)), dispose: vi.fn() });
function mount(comments: readonly Comment[], restrictive = false, suppliedItem?: ContentItem) {
  const data = generateDiscussion({ count: 0 }), engine = executor(), session = new DiscussionViewSession(comments, engine);
  if (restrictive) {
    const applied = { ...defaultQuery, text: 'PROFILE_MATCH', seen: 'unseen' as const };
    const outcome = evaluateTestQuery(queryComments(comments), applied);
    if (!outcome.ok) throw new Error('Invalid query');
    session.state = { ...session.state, applied, draft: applied, result: outcome.result };
  }
  let current = comments;
  let item = suppliedItem ?? data.item;
  let locale: 'en' | 'pl' = 'en';
  const onToggle = vi.fn((_itemId: string, id: string, subtree: boolean) => {
    current = toggleSeen(current, id, subtree); session.seenChanged(); update();
  });
  const content = () => <main className="reader-panel" tabIndex={0}><DiscussionPanel item={item} comments={current} session={session}
    locale={locale} saving={false} refreshDisabled={false} coverageLimited={false} onRefresh={vi.fn()} onToggle={onToggle} /></main>;
  const rendered = render(content());
  function update() { rendered.rerender(content()); }
  const panel = required(rendered.container.querySelector<HTMLElement>('main'));
  const rows = () => [...panel.querySelectorAll<HTMLElement>('.virtual-comment')];
  const scroll = (top: number) => act(() => { panel.scrollTop = top; fireEvent.scroll(panel); });
  return { ...rendered, session, panel, rows, scroll, current: () => current, onToggle, engine,
    setLocale(value: 'en' | 'pl') { locale = value; update(); },
    async refresh(nextComments: readonly Comment[], nextItem: ContentItem) { current = nextComments; item = nextItem; update(); await session.apply(current, true, item); } };
}

it('row gestures include unmounted descendants with frozen applied views and live unseen/NEW ruler evidence', () => {
  const data = generateDiscussion({ count: 10000, roots: 1, seenRatio: 0, matchIndexes: [0], newIndexes: [9999] });
  const reader = mount(data.comments, true, data.item), frozen = reader.session.state.result;
  const root = required(document.getElementById('comment-generated-0'));
  expect(document.getElementById('comment-generated-9999')).toBeNull(); expect(reader.rows().length).toBeLessThan(30);
  fireEvent.click(required(root.querySelector('.comment-text')), { shiftKey: true, ctrlKey: true });
  expect(reader.onToggle).toHaveBeenCalledExactlyOnceWith(data.item.id, 'generated-0', true);
  expect(reader.current().every(comment => comment.seen)).toBe(true);
  expect(reader.session.state.result).toBe(frozen); expect(reader.session.state.seenStale).toBe(true);
  const ruler = required(reader.panel.querySelector<HTMLElement>('.discussion-ruler'));
  expect(ruler.dataset.unseenCount).toBe('0'); expect(ruler.dataset.newCount).toBe('1');
  fireEvent.click(required(root.querySelector('.comment-text')), { shiftKey: true });
  expect(reader.current()[0].seen).toBe(false); expect(reader.current().slice(1).every(comment => comment.seen)).toBe(true);
  expect(reader.session.state.result).toBe(frozen); expect(reader.rows().length).toBeLessThan(30);
});

it('distant date/NEW matches retain bounded complete-tree DOM, navigation and independent context NEW ruler lane', async () => {
  const data = generateDiscussion({ count: 10000, roots: 1, newIndexes: [5000, 9999] });
  const comments = data.comments.map((comment, index) => ({ ...comment,
    publishedAt: index === 9999 ? '2026-10-07T12:00:00Z' : '2001-01-01T00:00:00Z' }));
  const reader = mount(comments, false, data.item);
  reader.session.edit({ ...defaultQuery, publication: { kind: 'custom', from: '2026-10-07', to: '2026-10-07' } });
  await act(() => reader.session.apply(comments, false, data.item));
  expect(reader.session.state.result.activeMatchIds).toEqual(['generated-9999']);
  expect(reader.session.state.result.visibleCommentIds).toHaveLength(10000);
  await waitFor(() => expect(document.getElementById('comment-generated-9999')).not.toBeNull());
  expect(reader.rows().length).toBeLessThan(30);
  const frozen = reader.session.state.result;
  act(() => navigateDiscussion(reader.session, comments, 'match', -1));
  await waitFor(() => expect(document.activeElement?.id).toBe('comment-generated-9999'));
  expect(reader.onToggle).not.toHaveBeenCalled();
  const ruler = required(reader.panel.querySelector<HTMLElement>('.discussion-ruler'));
  expect(ruler.dataset.matchCount).toBe('1');
  expect(ruler.dataset.newCount).toBe('2'); // includes the unrelated NEW context row
  expect(ruler.querySelectorAll('path')).toHaveLength(3);
  expect(ruler.querySelector('.ruler-match')?.getAttribute('d')).not.toBe('');
  expect(ruler.querySelector('.ruler-new')?.getAttribute('d')).not.toBe('');
  reader.session.edit({ ...reader.session.state.draft, discovery: 'new' });
  expect(reader.session.state.result).toBe(frozen);
  await act(() => reader.session.apply(comments, false, data.item));
  expect(reader.session.state.result.activeMatchIds).toEqual(['generated-9999']);
  expect(reader.rows().length).toBeLessThan(30);
  expect(ruler.dataset.newCount).toBe('2');
});

it.each([10000, 50000])('%i ruler has constant DOM, reaches distant unmounted NEW by pointer/keyboard, and never saves seen', async count => {
  const data = generateDiscussion({ count, shape: 'flat', seenRatio: 0, newIndexes: [count - 1] });
  const reader = mount(data.comments, false, data.item);
  const ruler = required(reader.panel.querySelector<HTMLElement>('.discussion-ruler'));
  expect(ruler.querySelectorAll('path')).toHaveLength(3);
  expect(ruler.querySelectorAll('*').length).toBeLessThan(10);
  expect(Number(ruler.dataset.bucketCount)).toBeLessThanOrEqual(Math.ceil(596 / 3));
  expect(document.getElementById(`comment-generated-${count - 1}`)).toBeNull();
  const newPath = required(ruler.querySelector('.ruler-new')).getAttribute('d') ?? '';
  const y = Number(/M13,([\d.]+)/.exec(newPath)?.[1]) + 1.5;
  // Controlled test layout supplies the fixed ruler's rectangle explicitly.
  vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({ top: 2, left: 980, width: 18, height: 596 } as DOMRect);
  fireEvent.click(ruler, { clientX: 994, clientY: y + 2 });
  await waitFor(() => expect(document.activeElement?.id).toBe(`comment-generated-${count - 1}`));
  expect(reader.rows().length).toBeLessThan(30);
  expect(required(document.getElementById(`comment-generated-${count - 1}`)).querySelector('.new-badge')).not.toBeNull();
  act(() => reader.panel.focus()); reader.scroll(0);
  act(() => ruler.focus());
  fireEvent.keyDown(ruler, { key: 'End' }); fireEvent.keyDown(ruler, { key: 'ArrowRight' }); fireEvent.keyDown(ruler, { key: 'ArrowRight' });
  fireEvent.keyDown(ruler, { key: 'Enter' });
  await waitFor(() => expect(document.activeElement?.id).toBe(`comment-generated-${count - 1}`));
  expect(reader.onToggle).not.toHaveBeenCalled();
});

it('seen acknowledgment changes unseen lane immediately while NEW/applied match persist, and accepted Refresh/Apply recompute scope', async () => {
  const data = generateDiscussion({ count: 1, shape: 'flat', seenRatio: 0, matchIndexes: [0], newIndexes: [0] });
  const reader = mount(data.comments, true, data.item);
  const path = (category: string) => reader.panel.querySelector(`.ruler-${category}`)?.getAttribute('d');
  const frozen = reader.session.state.result;
  expect(path('unseen')).not.toBe(''); expect(path('match')).not.toBe(''); expect(path('new')).not.toBe('');
  const article = required(document.getElementById('comment-generated-0'));
  fireEvent.click(required(article.querySelector('input')));
  expect(path('unseen')).toBe(''); expect(path('match')).not.toBe(''); expect(path('new')).not.toBe('');
  expect(article.querySelector('.new-badge')).not.toBeNull(); expect(reader.session.state.result).toBe(frozen);
  await act(() => reader.session.apply(reader.current()));
  expect(path('new')).toBe(''); // Same NEW identity, excluded by newly applied Unseen view.
  await act(() => reader.refresh([...reader.current(), { ...data.comments[0], id: 'added', text: 'PROFILE_MATCH',
    discovery: { ...data.comments[0].discovery, firstDiscoveryId: 'next-refresh' } }], { ...data.item, latestAcceptedDiscoveryId: 'next-refresh' }));
  expect(path('unseen')).not.toBe(''); expect(path('match')).not.toBe(''); expect(path('new')).not.toBe('');
  expect(reader.session.state.result.activeMatchIds).toEqual(['added']);
  expect(document.getElementById('comment-added')?.querySelector('.new-badge')).not.toBeNull();
});

it('10k rows mount viewport plus overscan, scroll replaces distant rows, and selection survives unmount/remount', async () => {
  const comments = generateDiscussion({ count: 10000, shape: 'mixed' }).comments;
  const reader = mount(comments);
  expect(reader.rows().length).toBeLessThan(Math.ceil(600 / 76) + 2 * readerOverscan + 2);
  expect(reader.rows()[0].dataset.commentId).toBe('generated-0');
  expect(reader.panel.querySelector('ol ol')).toBeNull();
  act(() => reader.session.select('generated-9999'));
  await waitFor(() => expect(document.activeElement?.id).toBe('comment-generated-9999'));
  expect(reader.panel.querySelector('[data-selected=true]')?.id).toBe('comment-generated-9999');
  expect(reader.rows().some(row => row.dataset.commentId === 'generated-0')).toBe(false);
  // Focused inputs/articles remain mounted while focused; selection alone does not pin.
  act(() => reader.panel.focus()); reader.scroll(0);
  expect(document.getElementById('comment-generated-9999')).toBeNull();
  expect(reader.session.state.selected).toBe('generated-9999');
  act(() => reader.session.select('generated-9999'));
  await waitFor(() => expect(document.activeElement?.id).toBe('comment-generated-9999'));
  expect(reader.rows().length).toBeLessThan(30);
  expect(reader.onToggle).not.toHaveBeenCalled();
});

it('measured variable heights reposition later rows and reflow invalidates offscreen cached sizes', () => {
  const reader = mount(generateDiscussion({ count: 10000, shape: 'flat', textLength: 100 }).comments);
  const second = () => required(reader.rows().find(row => row.dataset.index === '1'));
  const before = second().style.transform;
  act(() => layout.setHeight('generated-0', 350));
  expect(second().style.transform).not.toBe(before);
  expect(second().style.transform).toBe('translateY(350px)');
  const oldTotal = required(reader.panel.querySelector<HTMLElement>('.virtual-reader')).style.height;
  act(() => layout.resize(420));
  expect(required(reader.panel.querySelector<HTMLElement>('.virtual-reader')).style.height).not.toBe(oldTotal);
  expect(reader.rows().length).toBeLessThan(30);
  // The first measured box did not resize. Cache invalidation must still restore
  // its known DOM height without waiting for a nonexistent resize notification.
  expect(second().style.transform).toBe('translateY(350px)');
});

it('overscan is configurable and a focused checkbox adds at most one retained row', () => {
  const comments = generateDiscussion({ count: 10000, shape: 'flat', textLength: 10 }).comments;
  const session = new DiscussionViewSession(comments, executor());
  const content = (overscan: number) => <main className="reader-panel"><div className="reading-column"><VirtualCommentList
    itemId="generated" comments={comments} result={session.state.result} session={session} locale="en" disabled={false}
    now={0} onToggle={vi.fn()} overscan={overscan} /></div></main>;
  const view = render(content(0));
  const count = view.container.querySelectorAll('.comment').length;
  view.rerender(content(8));
  expect(view.container.querySelectorAll('.comment').length).toBe(count + 8);
  const checkbox = required(view.container.querySelector<HTMLInputElement>('input'));
  act(() => checkbox.focus());
  const panel = required(view.container.querySelector('main'));
  act(() => { panel.scrollTop = 400000; fireEvent.scroll(panel); });
  expect(checkbox.isConnected).toBe(true); expect(document.activeElement).toBe(checkbox);
  expect(view.container.querySelectorAll('.comment').length).toBeLessThan(40);
  act(() => checkbox.blur());
  expect(checkbox.isConnected).toBe(false);
});
it('locale invalidation remeasures mounted boxes even if they emit no resize entries', () => {
  const reader = mount(generateDiscussion({ count: 154, shape: 'flat', textLength: 10 }).comments);
  act(() => layout.setHeight('generated-0', 350));
  act(() => reader.setLocale('pl'));
  expect(reader.rows()[1].style.transform).toBe('translateY(350px)');
  expect(reader.rows()[0].getAttribute('aria-setsize')).toBe('154');
  expect(reader.rows()[153].getAttribute('aria-posinset')).toBe('154');
});
it('Apply removing a focused navigation article returns keyboard focus to the reader', async () => {
  const comments = generateDiscussion({ count: 154 }).comments, reader = mount(comments);
  act(() => reader.session.select('generated-153'));
  await waitFor(() => expect(document.activeElement?.id).toBe('comment-generated-153'));
  act(() => reader.session.edit({ ...defaultQuery, text: 'not present' }));
  await act(() => reader.session.apply(comments));
  expect(document.activeElement).toBe(reader.panel); expect(reader.rows()).toHaveLength(0);
});

it('mounted normal and Ctrl clicks change data including unmounted descendants, retaining applied Unseen membership', async () => {
  const comments = generateDiscussion({ count: 10000, roots: 1, shape: 'shallow', seenRatio: 0, matchIndexes: [0, 9999] }).comments;
  const reader = mount(comments, true), result = reader.session.state.result;
  const checkbox = required(required(document.getElementById('comment-generated-0')).querySelector('input'));
  fireEvent.click(checkbox);
  expect(reader.current()[0].seen).toBe(true); expect(reader.current()[9999].seen).toBe(false);
  expect(reader.session.state.result).toBe(result);
  // Restore root then assign seen to complete subtree in one data operation.
  fireEvent.click(checkbox); fireEvent.click(checkbox, { ctrlKey: true });
  expect(reader.current().every(row => row.seen)).toBe(true);
  expect(reader.session.state.result).toBe(result); expect(reader.session.state.result.matchCount).toBe(2);
  expect(reader.rows().length).toBeLessThan(30);
  await act(() => reader.session.apply(reader.current()));
  expect(reader.session.state.result.matchCount).toBe(0); expect(reader.rows()).toHaveLength(0);
});

it('filtered whole-thread far/deep match and unseen navigation resolve data and wrap without DOM discovery', async () => {
  const comments = generateDiscussion({ count: 10000, roots: 1, shape: 'mixed', maxDepth: 40, seenRatio: 1, matchIndexes: [0, 9999] }).comments
    .map((row, index) => index === 0 || index === 9999 ? { ...row, seen: false } : row);
  const reader = mount(comments, true);
  expect(reader.session.state.result.visibleCommentIds).toHaveLength(10000);
  expect(reader.session.state.result.matchCount).toBe(2); expect(reader.session.state.result.threadCount).toBe(1);
  expect(document.getElementById('comment-generated-9999')).toBeNull();
  const reveal = async (kind: 'match' | 'unseen', direction: 1 | -1, id: string) => {
    act(() => navigateDiscussion(reader.session, reader.current(), kind, direction));
    await waitFor(() => expect(document.activeElement?.id).toBe(`comment-${id}`));
    expect(reader.session.state.selected).toBe(id);
  };
  await reveal('match', -1, 'generated-9999');
  await reveal('match', 1, 'generated-0');
  await reveal('unseen', -1, 'generated-9999');
  await reveal('unseen', 1, 'generated-0');
  expect(reader.rows().length).toBeLessThan(30); expect(reader.onToggle).not.toHaveBeenCalled();
});

it('only visually changed mounted articles rerender after a normal seen acknowledgment', () => {
  window.__readerWork = {};
  const reader = mount(generateDiscussion({ count: 10000, shape: 'flat' }).comments);
  window.__readerWork = {};
  fireEvent.click(required(reader.panel.querySelector('.seen-control input')));
  expect(window.__readerWork['comment:generated']).toBe(1);
});
it('Apply reveals the first active match, unrestricted/empty Apply starts at top, Refresh retains the visible identity', async () => {
  const comments = generateDiscussion({ count: 10000, roots: 1, shape: 'shallow', matchIndexes: [9999] }).comments;
  const reader = mount(comments);
  reader.session.edit({ ...defaultQuery, text: 'PROFILE_MATCH' });
  await act(() => reader.session.apply(comments));
  await waitFor(() => expect(document.getElementById('comment-generated-9999')).toBeTruthy());
  expect(reader.panel.scrollTop).toBeGreaterThan(500000);
  act(() => reader.panel.focus()); reader.scroll(100000);
  const visibleBefore = required(reader.rows().find(row => row.getBoundingClientRect().bottom > 0 && row.getBoundingClientRect().top <= 0));
  const id = visibleBefore.dataset.commentId;
  const beforeTop = visibleBefore.getBoundingClientRect().top;
  reader.session.edit({ ...reader.session.state.draft, text: 'preserved draft' });
  await act(() => reader.session.apply(comments, true));
  await waitFor(() => {
    const anchor = required(reader.rows().find(row => row.dataset.commentId === id));
    expect(anchor.getBoundingClientRect().top).toBeCloseTo(beforeTop, 5);
  });
  expect(reader.session.state.draft.text).toBe('preserved draft');
  act(() => layout.resize(450));
  await waitFor(() => expect(reader.rows().find(row => row.dataset.commentId === id)?.getBoundingClientRect().top).toBeCloseTo(beforeTop, 5));
  reader.session.edit({ ...defaultQuery }); await act(() => reader.session.apply(comments));
  expect(reader.panel.scrollTop).toBe(0);
  reader.session.edit({ ...defaultQuery, text: 'not present anywhere' }); await act(() => reader.session.apply(comments));
  expect(reader.panel.scrollTop).toBe(0); expect(reader.rows()).toHaveLength(0);
});

it('small discussions retain at most the constant complete-reading ceiling', () => {
  const reader = mount(generateDiscussion({ count: 154, shape: 'shallow' }).comments);
  expect(reader.rows()).toHaveLength(154); expect(reader.rows().length).toBeLessThanOrEqual(completeReaderLimit);
  const article = required(reader.panel.querySelector('article'));
  expect(article.getAttribute('aria-label')).toBeTruthy();
  expect(required(article.querySelector('input')).getAttribute('aria-label')).toContain('Mark');
  expect(required(article.querySelector('time')).getAttribute('aria-label')).toBeTruthy();
});

it.each([10000, 50000])('%i sorted trees retain anchor identity/offset, bounded rows and ruler, and distant reveal in sorted order', async count => {
  const data = generateDiscussion({ count, shape: 'shallow', roots: count / 20, seenRatio: 0, newIndexes: [0] });
  const comments = data.comments.map((row, index) => ({ ...row, publishedAt: new Date(Date.parse('2025-01-01T00:00:00Z') + index * 1000).toISOString() }));
  const reader = mount(comments, false, data.item);
  reader.scroll(100000);
  const anchor = required(reader.rows().find(row => row.getBoundingClientRect().top <= 0 && row.getBoundingClientRect().bottom > 0));
  const id = anchor.dataset.commentId, top = anchor.getBoundingClientRect().top;
  act(() => reader.session.select(required(id))); // selection remains independent of the later anchor
  act(() => reader.panel.focus()); reader.scroll(100000);
  fireEvent.change(reader.getByLabelText('Sort'), { target: { value: 'newest' } });
  await waitFor(() => expect(reader.rows().find(row => row.dataset.commentId === id)?.getBoundingClientRect().top).toBeCloseTo(top, 4));
  expect(reader.session.state.selected).toBe(id);
  expect(reader.rows().length).toBeLessThan(30); expect(reader.engine.evaluate).not.toHaveBeenCalled();
  const presentation = reader.session.presentation(reader.current());
  expect(presentation.rows[0].id).toBe(`generated-${count - 20}`);
  expect(presentation.rows[1].parentId).toBe(`generated-${count - 20}`);
  expect(presentation.rows[1].depth).toBe(1);
  const ruler = required(reader.panel.querySelector<HTMLElement>('.discussion-ruler'));
  expect(ruler.querySelectorAll('*').length).toBeLessThan(10); expect(ruler.dataset.newCount).toBe('1');
  // Original first root is now in the last tree, unmounted at the retained anchor.
  expect(document.getElementById('comment-generated-0')).toBeNull();
  const y = Number(/M13,([\d.]+)/.exec(ruler.querySelector('.ruler-new')?.getAttribute('d') ?? '')?.[1]) + 1.5;
  vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({ top: 2, left: 980, width: 18, height: 596 } as DOMRect);
  fireEvent.click(ruler, { clientX: 994, clientY: y + 2 });
  await waitFor(() => expect(document.activeElement?.id).toBe('comment-generated-0'));
  expect(reader.rows().length).toBeLessThan(30);
  act(() => reader.session.select(required(presentation.orderedIds.at(-1))));
  act(() => navigateDiscussion(reader.session, reader.current(), 'unseen', 1));
  await waitFor(() => expect(document.activeElement?.id).toBe(`comment-generated-${count - 20}`));
  expect(reader.onToggle).not.toHaveBeenCalled();
});

it('Most liked disables accessibly for unknown display roots, retains selected mode after Apply, and localizes help', async () => {
  const data = generateDiscussion({ count: 4, shape: 'flat' });
  const reader = mount(data.comments);
  fireEvent.change(reader.getByLabelText('Sort'), { target: { value: 'most-liked' } });
  const unknown = data.comments.map(row => ({ ...row, likeCount: undefined }));
  await act(() => reader.refresh(unknown, data.item));
  expect((reader.getByRole('option', { name: 'Most liked' }) as HTMLOptionElement).disabled).toBe(true);
  expect((reader.getByLabelText('Sort') as HTMLSelectElement).value).toBe('most-liked');
  expect(reader.session.presentation(unknown).orderedIds).toEqual(reader.session.state.result.visibleCommentIds);
  expect(reader.getByText('Like counts are unavailable for these conversations.').id).toBe(reader.getByLabelText('Sort').getAttribute('aria-describedby'));
  reader.setLocale('pl');
  expect(reader.getByLabelText('Sortowanie')).toBeTruthy();
  expect(reader.getByText('Liczby polubień są niedostępne dla tych rozmów.')).toBeTruthy();
});

it('Refresh metadata cannot reorder ahead of anchor capture; promotion rekeys trees and retains the scrolled identity', async () => {
  const data = generateDiscussion({ count: 10000, shape: 'shallow', roots: 500 });
  const comments = data.comments.map((row, index) => ({ ...row, likeCount: index }));
  const reader = mount(comments, false, data.item);
  fireEvent.change(reader.getByLabelText('Sort'), { target: { value: 'most-liked' } });
  reader.scroll(100000);
  const anchor = required(reader.rows().find(row => row.getBoundingClientRect().top <= 0 && row.getBoundingClientRect().bottom > 0));
  const id = anchor.dataset.commentId, top = anchor.getBoundingClientRect().top;
  const before = reader.session.presentation(reader.current()).orderedIds;
  const updated = comments.map(row => ({ ...row, likeCount: 10000 - (row.likeCount ?? 0) }));
  // mount.refresh deliberately renders committed props before starting evaluation,
  // reproducing the application's main acknowledgment -> worker promotion path.
  await act(() => reader.refresh(updated, data.item));
  expect(reader.session.presentation(updated).orderedIds).not.toEqual(before);
  await waitFor(() => expect(reader.rows().find(row => row.dataset.commentId === id)?.getBoundingClientRect().top).toBeCloseTo(top, 4));
  expect(reader.session.state.sort).toBe('most-liked'); expect(reader.rows().length).toBeLessThan(30);
});

it('sort anchor capture accounts for header reflow before ResizeObserver delivers the changed list origin', async () => {
  const data = generateDiscussion({ count: 10000, shape: 'flat' });
  const comments = data.comments.map((row, index) => ({ ...row, likeCount: index }));
  const reader = mount(comments);
  reader.scroll(100000);
  layout.setMargin(296, false);
  const anchor = required(reader.rows().find(row => row.getBoundingClientRect().top <= 0 && row.getBoundingClientRect().bottom > 0));
  const id = anchor.dataset.commentId, top = anchor.getBoundingClientRect().top;
  fireEvent.change(reader.getByLabelText('Sort'), { target: { value: 'most-liked' } });
  act(() => layout.notify());
  await waitFor(() => expect(reader.rows().find(row => row.dataset.commentId === id)?.getBoundingClientRect().top).toBeCloseTo(top, 4));
  expect(reader.session.state.scrollRequest?.id).toBe(id);
});

it('hidden readers retain cached anchor geometry rather than display-none zero rectangles during Refresh', async () => {
  const reader = mount(generateDiscussion({ count: 10000, shape: 'flat' }).comments);
  reader.scroll(100000);
  const anchor = required(reader.rows().find(row => row.getBoundingClientRect().top <= 0 && row.getBoundingClientRect().bottom > 0));
  const id = anchor.dataset.commentId, offset = -anchor.getBoundingClientRect().top;
  const list = required(reader.panel.querySelector<HTMLElement>('.virtual-reader'));
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 } as DOMRect);
  await act(() => reader.session.apply(reader.current(), true));
  expect(reader.session.state.scrollRequest).toMatchObject({ kind: 'refresh', id, offset });
});

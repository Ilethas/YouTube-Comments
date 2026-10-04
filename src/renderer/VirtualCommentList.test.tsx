// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { DiscussionPanel } from './DiscussionPanel';
import { DiscussionViewSession } from './discussion-view-session';
import { generateDiscussion } from '../development/large-discussions';
import { defaultQuery, evaluateDiscussionQuery, queryComments } from '../domain/discussion-query';
import { toggleSeen } from '../domain/discussion';
import type { Comment } from '../domain/discussion';
import { navigateDiscussion } from './discussion-navigation';
import { completeReaderLimit, readerOverscan, VirtualCommentList } from './VirtualCommentList';
import { installReaderLayout } from './testing/reader-layout';
import { required } from './testing/required';

let layout: ReturnType<typeof installReaderLayout>;
beforeEach(() => { layout = installReaderLayout(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.__readerWork; });
const executor = () => ({ evaluate: vi.fn(async (rows: Parameters<typeof evaluateDiscussionQuery>[0], query: typeof defaultQuery) => evaluateDiscussionQuery(rows, query)), dispose: vi.fn() });
function mount(comments: readonly Comment[], restrictive = false) {
  const data = generateDiscussion({ count: 0 }), engine = executor(), session = new DiscussionViewSession(comments, engine);
  if (restrictive) {
    const applied = { ...defaultQuery, text: 'PROFILE_MATCH', seen: 'unseen' as const };
    const outcome = evaluateDiscussionQuery(queryComments(comments), applied);
    if (!outcome.ok) throw new Error('Invalid query');
    session.state = { ...session.state, applied, draft: applied, result: outcome.result };
  }
  let current = comments;
  let locale: 'en' | 'pl' = 'en';
  const onToggle = vi.fn((_itemId: string, id: string, subtree: boolean) => {
    current = toggleSeen(current, id, subtree); session.seenChanged(); update();
  });
  const content = () => <main className="reader-panel" tabIndex={0}><DiscussionPanel item={data.item} comments={current} session={session}
    locale={locale} saving={false} refreshDisabled={false} coverageLimited={false} onRefresh={vi.fn()} onToggle={onToggle} /></main>;
  const rendered = render(content());
  function update() { rendered.rerender(content()); }
  const panel = required(rendered.container.querySelector<HTMLElement>('main'));
  const rows = () => [...panel.querySelectorAll<HTMLElement>('.virtual-comment')];
  const scroll = (top: number) => act(() => { panel.scrollTop = top; fireEvent.scroll(panel); });
  return { ...rendered, session, panel, rows, scroll, current: () => current, onToggle, engine,
    setLocale(value: 'en' | 'pl') { locale = value; update(); } };
}

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

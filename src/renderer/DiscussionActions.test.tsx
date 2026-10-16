// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscussionPanel } from './DiscussionPanel';
import { DiscussionViewSession } from './discussion-view-session';
import { installReaderLayout } from './testing/reader-layout';
import { required } from './testing/required';
import { generateDiscussion } from '../development/large-discussions';
import { defaultQuery, evaluateDiscussionQuery } from '../domain/discussion-query';
import type { BulkSeenRequest } from '../domain/seen-operation';
import { translator } from './i18n';
import type { Locale } from './i18n';
import type { SelectionControls } from '../shared/preferences';
import type { OpenCommentAction } from './CommentActions';

let layout: ReturnType<typeof installReaderLayout>;
beforeEach(() => {
  layout = installReaderLayout();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.getSelection()?.removeAllRanges(); });
function mount({ count = 9, locale = 'en' as Locale, visibility = 'on-demand' as SelectionControls, includeHidden = true } = {}) {
  const data = generateDiscussion({ count, shape: 'shallow', roots: Math.max(3, Math.ceil(count / 20)), seenRatio: 0, newIndexes: [1] });
  let comments = data.comments.map(comment => ({ ...comment, actions: { translate: true, permalink: true, author: true } }));
  const session = new DiscussionViewSession(comments, { evaluate: async (rows, query) => evaluateDiscussionQuery(rows, query), dispose: vi.fn() });
  const execute = vi.fn(async (request: BulkSeenRequest) => !!request.itemId), toggle = vi.fn(), action = vi.fn<OpenCommentAction>(async () => ({ ok: true as const, value: null }));
  let active = true;
  const content = () => <main className="reader-panel" tabIndex={0}><DiscussionPanel item={data.item} comments={comments} session={session}
    locale={locale} saving={false} refreshDisabled={false} coverageLimited={false} onRefresh={vi.fn()} onToggle={toggle} onAction={action}
    onBulk={execute} onUndo={vi.fn()} onBulkModal={vi.fn()} active={active} selectionControls={visibility} includeCollapsedInPrefix={includeHidden} /></main>;
  const rendered = render(content());
  const article = (index: number) => required(document.getElementById(`comment-generated-${index}`));
  const circle = (index: number) => required(article(index).querySelector<HTMLButtonElement>('.selection-circle'));
  const menu = (index: number) => fireEvent.contextMenu(article(index), { clientX: 120, clientY: 150 });
  return { ...rendered, session, execute, toggle, action, article, circle, menu, comments: () => comments,
    setActive(value: boolean) { active = value; rendered.rerender(content()); },
    setLocale(value: Locale) { locale = value; rendered.rerender(content()); },
    acknowledge() { comments = comments.map(comment => ({ ...comment, seen: true })); session.seenChanged(); rendered.rerender(content()); } };
}

it.each(['en', 'pl'] as const)('%s circles are explicit, round and distinct from seen, body Shift stays native, selection mode clears/exits', locale => {
  const reader = mount({ locale }), t = translator(locale);
  expect(document.querySelector('.selection-circle')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('selectComments') }));
  fireEvent.click(reader.circle(0)); fireEvent.click(reader.circle(6), { ctrlKey: true });
  expect(reader.session.state.bulkSelected).toEqual(new Set(['generated-0', 'generated-6']));
  expect(reader.circle(0).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(required(reader.article(1).querySelector('.comment-text')), { shiftKey: true, ctrlKey: true });
  expect(reader.session.state.bulkSelected.size).toBe(2); expect(reader.toggle).not.toHaveBeenCalled();
  fireEvent.click(reader.circle(3), { shiftKey: true }); expect(reader.session.state.bulkSelected.size).toBe(5);
  fireEvent.click(screen.getByRole('button', { name: t('clearSelection') })); expect(reader.session.state.bulkSelected.size).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: t('exitSelection') })); expect(document.querySelector('.selection-circle')).toBeNull();
});

it('always mode exposes circles and keyboard Space toggles only bulk selection; nested group collapse retains hidden selection count', async () => {
  const reader = mount({ visibility: 'always' }), user = userEvent.setup();
  reader.circle(1).focus(); await user.keyboard(' '); expect(reader.session.state.bulkSelected.has('generated-1')).toBe(true);
  fireEvent.click(reader.circle(0)); fireEvent.click(screen.getByRole('button', { name: 'Collapse selected threads' }));
  expect(screen.getByText('2 selected (1 hidden)')).toBeTruthy();
  expect(reader.toggle).not.toHaveBeenCalled(); expect(reader.session.state.selected).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Expand selected threads' })); expect(screen.getByText('2 selected (0 hidden)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Exit selection mode' })); expect(document.querySelector('.selection-circle')).not.toBeNull();
});

it('ordinary context menu is mutation-free, group actions apply only when clicked target belongs to the selected set, scrolling/tab/view dismisses', async () => {
  const reader = mount({ visibility: 'always' }); fireEvent.click(reader.circle(0)); fireEvent.click(reader.circle(1));
  reader.menu(3); expect(screen.queryByRole('menuitem', { name: 'Mark selected read' })).toBeNull();
  expect(reader.session.state.bulkSelected.size).toBe(2); expect(reader.toggle).not.toHaveBeenCalled(); expect(reader.execute).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }); expect(document.activeElement).toBe(reader.article(3));
  reader.menu(1); expect(screen.getByRole('menuitem', { name: 'Mark selected read' })).toBeTruthy();
  fireEvent.scroll(required(reader.container.querySelector('main'))); expect(screen.queryByRole('menu')).toBeNull();
  reader.menu(0); reader.setActive(false); expect(screen.queryByRole('menu')).toBeNull();
  reader.setActive(true); reader.menu(0); act(() => reader.session.setSort('newest')); expect(screen.queryByRole('menu')).toBeNull();
  reader.menu(0); fireEvent.pointerDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  reader.menu(0);
  // Production workspace hides an existing panel without rerendering it.
  const panel = required(reader.container.querySelector<HTMLElement>('main')); panel.hidden = true;
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull()); panel.hidden = false;
  reader.menu(0); reader.article(0).remove();
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

it('Context Menu / Shift+F10, arrows, Home/End, Enter and Escape manage focus and preserve native selected-text copying', async () => {
  const reader = mount(), user = userEvent.setup(), copy = vi.fn(async () => undefined);
  await act(async () => { await Promise.resolve(); });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  act(() => reader.article(0).focus());
  const text = required(reader.article(0).querySelector('.comment-text')).firstChild;
  const range = document.createRange(); range.setStart(required(text), 0); range.setEnd(required(text), 7);
  document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(range); const selected = document.getSelection()?.toString();
  expect(selected).toBe('0: Samp');
  fireEvent.keyDown(reader.article(0), { key: 'F10', shiftKey: true });
  expect(document.getSelection()?.toString()).toBe(selected);
  const menu = screen.getByRole('menu'), buttons = within(menu).getAllByRole('menuitem');
  expect(document.activeElement).toBe(buttons[0]); expect(buttons[0].textContent).toBe('Copy selection');
  fireEvent.keyDown(menu, { key: 'ArrowDown' }); expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(menu, { key: 'ArrowUp' }); expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(menu, { key: 'End' }); expect(document.activeElement).toBe(buttons.at(-1));
  fireEvent.keyDown(menu, { key: 'Home' }); expect(document.activeElement).toBe(buttons[0]);
  await user.keyboard('{Enter}'); await waitFor(() => expect(copy).toHaveBeenCalledWith(selected));
  expect(reader.execute).not.toHaveBeenCalled();
  fireEvent.keyDown(reader.article(0), { key: 'ContextMenu' }); fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(document.activeElement).toBe(reader.article(0));
});

it.each([true, false])('prefix confirms captured exact IDs with include-hidden=%s; preview focuses Cancel and view changes cannot enlarge IDs', async includeHidden => {
  const reader = mount({ includeHidden });
  act(() => reader.session.setCollapsed({ kind: 'comments', ids: ['generated-0', 'generated-3'], collapsed: true }));
  reader.menu(3); fireEvent.click(screen.getByRole('menuitem', { name: 'Mark everything up to here as read' }));
  const dialog = screen.getByRole('dialog'), ids = includeHidden ? ['generated-0', 'generated-1', 'generated-2', 'generated-3'] : ['generated-0', 'generated-3'];
  expect(dialog.textContent).toContain(`${ids.length} comments`); expect(dialog.textContent).toContain(`Includes ${includeHidden ? 2 : 0} comments hidden`);
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
  act(() => reader.session.setCollapsed({ kind: 'all', collapsed: false })); reader.setActive(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(reader.execute).toHaveBeenCalledExactlyOnceWith({ itemId: 'generated', seen: true, target: { kind: 'explicit', reason: 'view-prefix', ids } }));
});

it('selected assignments freeze exact IDs, Escape cancels, and seen acknowledgments retain frozen roles/NEW/query/collapse/sort/bulk selection', async () => {
  const reader = mount({ visibility: 'always' });
  act(() => reader.session.edit({ ...defaultQuery, seen: 'unseen' })); await act(() => reader.session.apply(reader.comments()));
  fireEvent.click(reader.circle(1)); fireEvent.click(reader.circle(4));
  const frozen = reader.session.state.result;
  fireEvent.click(screen.getByRole('button', { name: 'Mark selected read' }));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })); expect(reader.execute).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Mark selected unread' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(reader.execute).toHaveBeenCalledWith({ itemId: 'generated', seen: false, target: { kind: 'explicit', reason: 'selected', ids: ['generated-1', 'generated-4'] } }));
  reader.acknowledge(); expect(reader.session.state.result).toBe(frozen); expect(reader.session.state.seenStale).toBe(true);
  expect(reader.session.state.bulkSelected).toEqual(new Set(['generated-1', 'generated-4']));
  const ruler = required(reader.container.querySelector<HTMLElement>('.discussion-ruler'));
  expect(ruler.dataset.unseenCount).toBe('0'); expect(ruler.dataset.newCount).toBe('1'); expect(ruler.dataset.matchCount).toBe('9');
});

it('menu text/copy links/translation use exact identity-only intents and explicit full Unicode text', async () => {
  const reader = mount(), copy = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  for (const [label, action] of [['Translate in browser', 'translate'], ['Open original comment in browser', 'permalink'], ['Copy comment link', 'copy-permalink']]) {
    reader.menu(0); fireEvent.click(screen.getByRole('menuitem', { name: label }));
    await waitFor(() => expect(reader.action).toHaveBeenCalledWith({ itemId: 'generated', commentId: 'generated-0', action }));
  }
  reader.menu(0); fireEvent.click(screen.getByRole('menuitem', { name: 'Copy comment text' }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(reader.comments()[0].text)); expect(reader.toggle).not.toHaveBeenCalled();
  reader.setLocale('pl'); expect(screen.getByText(translator('pl')('copied'))).toBeTruthy();
});

it('long menu translations offer localized full-text copy fallback without truncation', async () => {
  const reader = mount(), copy = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  reader.action.mockResolvedValueOnce({ ok: false, error: { code: 'TRANSLATION_TOO_LONG' } });
  reader.menu(0); fireEvent.click(screen.getByRole('menuitem', { name: 'Translate in browser' }));
  await screen.findByText(translator('en')('translationTooLong'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy comment text' }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(reader.comments()[0].text));
});

it.each([10000, 50000])('%i visual range/prefix includes unmounted IDs without expanding the virtual DOM or flooding IPC', async count => {
  const reader = mount({ count, visibility: 'always' });
  fireEvent.click(reader.circle(0)); act(() => reader.session.select(`generated-${count - 1}`));
  await waitFor(() => expect(document.getElementById(`comment-generated-${count - 1}`)).not.toBeNull());
  fireEvent.click(reader.circle(count - 1), { shiftKey: true }); expect(reader.session.state.bulkSelected.size).toBe(count);
  reader.menu(count - 1); fireEvent.click(screen.getByRole('menuitem', { name: 'Mark everything up to here as read' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(reader.execute).toHaveBeenCalledTimes(1));
  expect(reader.execute.mock.calls[0][0].target).toMatchObject({ kind: 'explicit', ids: Array.from({ length: count }, (_, index) => `generated-${index}`) });
  expect(reader.container.querySelectorAll('.virtual-comment').length).toBeLessThan(30);
  expect(reader.container.querySelectorAll('.discussion-ruler *').length).toBeLessThan(10);
});

it('floating selection uses the same live selection, hidden counts, collapse commands and frozen confirmation as the ordinary toolbar', async () => {
  const reader = mount({ visibility: 'always' }), panel = required(reader.container.querySelector<HTMLElement>('main'));
  fireEvent.click(reader.circle(0)); fireEvent.click(reader.circle(1));
  const float = () => within(required(reader.container.querySelector<HTMLElement>('.floating-selection-toolbar')));
  expect(reader.container.querySelector('.floating-selection-toolbar')).toBeNull();
  panel.scrollTop = 1800; fireEvent.scroll(panel); act(() => layout.toolbarVisible(false));
  expect(float().getByRole('status').textContent).toBe('2 selected (0 hidden)');
  const top = panel.scrollTop, query = reader.session.state.result;
  fireEvent.click(float().getByRole('button', { name: 'Mark selected read' }));
  const dialog = screen.getByRole('dialog');
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
  // Changing membership cannot enlarge the captured confirmation.
  act(() => reader.session.toggleBulk('generated-4', false));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(reader.execute).toHaveBeenCalledExactlyOnceWith({ itemId: 'generated', seen: true, target: { kind: 'explicit', reason: 'selected', ids: ['generated-0', 'generated-1'] } }));
  expect(float().getByRole('status').textContent).toBe('3 selected (0 hidden)');
  expect(panel.scrollTop).toBe(top);
  fireEvent.click(float().getByLabelText('More selection actions'));
  fireEvent.click(float().getByRole('button', { name: 'Collapse selected threads' }));
  expect(float().getByRole('status').textContent).toBe('3 selected (1 hidden)');
  expect(reader.session.state.collapse.overrides).toEqual(['generated-0']);
  fireEvent.click(float().getByRole('button', { name: 'Expand selected threads' }));
  expect(float().getByRole('status').textContent).toBe('3 selected (0 hidden)');
  expect(reader.session.state.result).toBe(query); expect(reader.toggle).not.toHaveBeenCalled();
  // Collapse keeps the existing identity/offset anchor policy; changed row
  // heights can legitimately adjust pixels, but never jump to the toolbar.
  expect(panel.scrollTop).toBeGreaterThan(400);
  act(() => layout.toolbarVisible(true)); expect(reader.container.querySelector('.floating-selection-toolbar')).toBeNull();
  act(() => layout.toolbarVisible(false)); fireEvent.click(float().getByRole('button', { name: 'Clear selection' }));
  expect(reader.session.state.bulkSelected.size).toBe(0); expect(reader.container.querySelector('.floating-selection-toolbar')).toBeNull();
  expect(screen.getByRole('button', { name: 'Back to top' })).toBeTruthy();
});

it('floating single-target failure is visible at the reading position and shares pending state', async () => {
  const reader = mount({ visibility: 'always' }); fireEvent.click(reader.circle(0));
  act(() => layout.toolbarVisible(false));
  const float = within(required(reader.container.querySelector<HTMLElement>('.floating-selection-toolbar')));
  let finish: (value: boolean) => void = () => undefined;
  reader.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(float.getByRole('button', { name: 'Mark selected read' }));
  expect((float.getByRole('button', { name: 'Mark selected unread' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(false));
  expect(float.getByRole('alert').textContent).toBe(translator('en')('bulkFailed'));
  expect((float.getByRole('button', { name: 'Mark selected unread' }) as HTMLButtonElement).disabled).toBe(false);
  expect(reader.session.state.bulkSelected).toEqual(new Set(['generated-0']));
});

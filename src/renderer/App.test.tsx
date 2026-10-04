// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { initialComments, items } from '../fixtures/discussions';
import { toggleSeen } from '../domain/discussion';
import type { AcquisitionResult, ReaderApi, ReaderState, Result } from '../shared/reader-api';
import { closeWorkspaceTab, discussionTab, openWorkspaceTab, moveWorkspaceTab } from '../domain/workspace';
import { evaluateDiscussionQuery } from '../domain/discussion-query';
import { createQueryExecutor } from './query-executor';
import type { QueryExecutor } from './query-worker-client';
import { StrictMode } from 'react';
import { formatShortcut, reorderHelp, seenHelp, shortcutHint } from './shortcuts';
import { keyboardShortcutsTarget } from './KeyboardShortcuts';

// jsdom has no dedicated Web Worker; worker lifecycle/deadline has its own tests.
vi.mock('./query-executor', () => ({ createQueryExecutor: vi.fn() }));

let api: ReaderApi;
let state: ReaderState;
beforeEach(() => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: async (comments, query) => evaluateDiscussionQuery(comments, query), dispose: vi.fn() } as QueryExecutor as ReturnType<typeof createQueryExecutor>));
  state = { items, comments: initialComments, preferences: { locale: 'en', appearance: 'system' },
    workspace: { tabs: items.map(item => discussionTab(item.id)), activeTabId: discussionTab(items[0].id).id, revision: 0 } };
  const open: ReaderApi['openStoredItem'] = async ({ itemId }) => {
    state = { ...state, workspace: openWorkspaceTab(state.workspace, discussionTab(itemId)) };
    return { ok: true as const, value: state.workspace };
  };
  api = {
    openStoredItem: vi.fn(open),
    activateTab: vi.fn(async ({ tabId }) => {
      state = { ...state, workspace: openWorkspaceTab(state.workspace, state.workspace.tabs.find(tab => tab.id === tabId) ?? discussionTab(tabId.replace(/^discussion:/, ''))) };
      return { ok: true as const, value: state.workspace };
    }),
    openLibrary: vi.fn(async () => { state = { ...state, workspace: openWorkspaceTab(state.workspace, { id: 'library', kind: 'library' }) }; return { ok: true as const, value: state.workspace }; }),
    openSettings: vi.fn(async () => { state = { ...state, workspace: openWorkspaceTab(state.workspace, { id: 'settings', kind: 'settings' }) }; return { ok: true as const, value: state.workspace }; }),
    moveTab: vi.fn(async ({ tabId, toIndex }) => { state = { ...state, workspace: moveWorkspaceTab(state.workspace, tabId, toIndex) }; return { ok: true as const, value: state.workspace }; }),
    removeLibraryItem: vi.fn(async ({ itemId }) => {
      state = { ...state, items: state.items.filter(item => item.id !== itemId),
        comments: Object.fromEntries(Object.entries(state.comments).filter(([id]) => id !== itemId)),
        workspace: closeWorkspaceTab(state.workspace, discussionTab(itemId).id) };
      return { ok: true as const, value: state };
    }),
    closeTab: vi.fn<ReaderApi['closeTab']>(async ({ tabId }) => {
      state = { ...state, workspace: closeWorkspaceTab(state.workspace, tabId) };
      return { ok: true as const, value: state.workspace };
    }),
    acquire: vi.fn<ReaderApi['acquire']>(async () => ({ ok: false, error: { code: 'ACQUISITION_FAILED' } })),
    refresh: vi.fn<ReaderApi['refresh']>(async () => ({ ok: false, error: { code: 'ACQUISITION_FAILED' } })),
    bootstrap: vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: true as const, value: state })),
    toggleSeen: vi.fn<ReaderApi['toggleSeen']>(async request => {
      const comments = toggleSeen(state.comments[request.itemId], request.commentId, request.subtree);
      state = { ...state, comments: { ...state.comments, [request.itemId]: comments } };
      return { ok: true as const, value: comments };
    }),
    updatePreferences: vi.fn<ReaderApi['updatePreferences']>(async change => {
      state = { ...state, preferences: { ...state.preferences, ...change } };
      return { ok: true as const, value: state.preferences };
    }),
  };
});
async function showReader() { render(<App api={api} />); await screen.findByRole('tabpanel'); }

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  // A value avoids spying on jsdom's branded Navigator prototype getter.
  Object.defineProperty(window.navigator, 'languages', { configurable: true, value: ['en'] });
});
afterEach(() => { cleanup(); delete window.__readerWork; vi.restoreAllMocks(); });
const checkboxes = () => within(screen.getByRole('tabpanel')).getAllByRole<HTMLInputElement>('checkbox').filter(input => input.closest('.seen-control'));
const checked = () => checkboxes().map(input => input.checked);

function threeDiscussions() {
  const third = { ...items[0], id: 'third-discussion', sourceId: 'third' };
  const rows = initialComments[items[0].id].map(row => ({ ...row, id: `third-${row.id}`, itemId: third.id,
    parentId: row.parentId ? `third-${row.parentId}` : null }));
  state = { ...state, items: [...items, third], comments: { ...initialComments, [third.id]: rows },
    workspace: { ...state.workspace, tabs: [...state.workspace.tabs, discussionTab(third.id)] } };
}
const work = () => window.__readerWork ?? {};
function expectUnrelatedIdle() {
  for (const id of ['post-demo', 'third-discussion']) for (const kind of ['panel', 'forest', 'tree']) expect(work()[`${kind}:${id}`] ?? 0).toBe(0);
}

it('Library/Settings/discussion activation and pending workspace saves never rebuild or render mounted discussions', async () => {
  threeDiscussions(); window.__readerWork = {};
  await showReader();
  expect(work()['forest:third-discussion']).toBeGreaterThan(0);
  const panel = document.getElementById('panel-video-demo');
  if (!panel) throw new Error('Missing panel');
  panel.scrollTop = 345;
  const originalRows = Array.from(panel.querySelectorAll('.comment-branch'));
  window.__readerWork = {};
  for (const name of ['Library', 'Settings']) {
    fireEvent.click(screen.getByRole('button', { name }));
    await waitFor(() => expect(screen.getByRole('tabpanel').id).toBe(`panel-${name.toLowerCase()}`));
    expect(work()).toEqual({});
  }
  for (const id of ['video-demo', 'post-demo', 'third-discussion', 'video-demo']) {
    fireEvent.click(document.getElementById(`tab-${discussionTab(id).id}`) as HTMLElement);
    await waitFor(() => expect(screen.getByRole('tabpanel').id).toBe(`panel-${id}`));
    expect(work()).toEqual({});
  }
  let resolve!: (result: Result<ReaderState['workspace']>) => void;
  vi.mocked(api.activateTab).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(document.getElementById('tab-discussion:post-demo') as HTMLElement);
  expect(document.getElementById('tab-discussion:video-demo')?.hasAttribute('disabled')).toBe(true);
  expect(work()).toEqual({});
  await act(async () => resolve({ ok: true, value: openWorkspaceTab(state.workspace, discussionTab('post-demo')) }));
  expect(work()).toEqual({});
  expect(panel.scrollTop).toBe(345);
  expect(Array.from(panel.querySelectorAll('.comment-branch'))).toEqual(originalRows);
});

it('draft, query evaluation, navigation and seen saves in A keep B/C idle; drafts reuse A forest', async () => {
  threeDiscussions(); window.__readerWork = {};
  await showReader(); window.__readerWork = {};
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search this discussion' }), { target: { value: 'camera' } });
  expect(work()['panel:video-demo']).toBeGreaterThan(0);
  expect(work()['forest:video-demo'] ?? 0).toBe(0);
  expect(work()['tree:video-demo'] ?? 0).toBe(0);
  expectUnrelatedIdle();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(createQueryExecutor).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Evaluating…')).toBeNull());
  expectUnrelatedIdle();
  // Return to unrestricted membership for a deterministic seen target.
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search this discussion' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(checkboxes().length).toBe(initialComments['video-demo'].length));
  window.__readerWork = {};
  let resolve!: (result: Result<ReaderState['comments'][string]>) => void;
  vi.mocked(api.toggleSeen).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(checkboxes()[0]);
  expectUnrelatedIdle();
  expect(work()['forest:video-demo'] ?? 0).toBe(0);
  await act(async () => resolve({ ok: true, value: toggleSeen(initialComments['video-demo'], initialComments['video-demo'][0].id, false) }));
  expect(work()['forest:video-demo']).toBeGreaterThan(0);
  expectUnrelatedIdle();
});

it('reading, scrolling, tab navigation and language changes do not mark comments seen', async () => {
  const user = userEvent.setup();
  await showReader();
  const original = checked();
  fireEvent.scroll(screen.getByRole('tabpanel'), { target: { scrollTop: 500 } });
  await user.click(screen.getByText(initialComments['video-demo'][0].text));
  await user.click(screen.getByRole('tab', { name: /Community Post/ }));
  expect(checked()).toEqual(initialComments['post-demo'].map(comment => comment.seen));
  await user.keyboard('{ArrowLeft}');
  expect(checked()).toEqual(original);
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.selectOptions(screen.getByLabelText('Language'), 'pl');
  await user.click(screen.getByRole('tab', { name: /A quieter desk/ }));
  expect(document.documentElement.lang).toBe('pl');
  expect(screen.getByText(initialComments['video-demo'][0].text)).toBeTruthy();
  expect(checked()).toEqual(original);
  expect(screen.getAllByText('NIEPRZECZYTANY', { selector: '.unseen-badge' }).length).toBeGreaterThan(0);
});

it('ordinary click, Ctrl+click and Space apply manual state without removing NEW', async () => {
  const user = userEvent.setup();
  await showReader();
  const original = checked();
  await user.click(checkboxes()[2]);
  expect(checked()).toEqual(original.map((state, index) => index === 2 ? !state : state));
  const row = checkboxes()[2].closest('article');
  if (!row) throw new Error('Missing comment article');
  expect(within(row).getByText('NEW')).toBeTruthy();
  expect(within(row).queryByText('UNSEEN')).toBeNull();
  await user.keyboard('{Control>}');
  await user.click(checkboxes()[1]);
  await user.keyboard('{/Control}');
  expect(checked()).toEqual(original.map((state, index) => [1, 2, 3].includes(index) ? false : state));
  checkboxes()[1].focus();
  await user.keyboard(' ');
  expect(checkboxes()[1].checked).toBe(true);
  expect(checkboxes()[2].checked).toBe(false);
});

it('defaults to System and switches appearance without resetting seen state', async () => {
  const user = userEvent.setup();
  await showReader();
  expect(document.documentElement.dataset.appearance).toBe('system');
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  for (const appearance of ['dark', 'light', 'system']) {
    await user.selectOptions(screen.getByLabelText('Appearance'), appearance);
    expect(document.documentElement.dataset.appearance).toBe(appearance);
    expect(api.toggleSeen).not.toHaveBeenCalled();
  }
});

it('shows loading without fixture state, then shows an actionable bootstrap error', async () => {
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }));
  render(<App api={api} />);
  expect(screen.getByRole('status').textContent).toContain('Loading');
  expect(screen.queryByRole('checkbox')).toBeNull();
  await screen.findByRole('alert');
  await userEvent.click(screen.getByText('Try again'));
  await waitFor(() => expect(api.bootstrap).toHaveBeenCalledTimes(2));
});

it('a storage retry can recover and display the reader', async () => {
  const bootstrap = api.bootstrap;
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>()
    .mockResolvedValueOnce({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } })
    .mockImplementation(bootstrap);
  render(<App api={api} />);
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('tabpanel');
  expect(api.bootstrap).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('unsupported schema explains the failure without presenting Retry', async () => {
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } }));
  render(<App api={api} />);
  expect((await screen.findByRole('alert')).textContent).toContain('needs a newer version');
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(api.bootstrap).toHaveBeenCalledTimes(1);
});

it('keeps acknowledged checkbox state during a pending write and after a failed save', async () => {
  let finish: (result: Result<readonly import('../domain/discussion').Comment[]>) => void = () => { throw new Error('Not started'); };
  api.toggleSeen = vi.fn<ReaderApi['toggleSeen']>(() => new Promise(resolve => { finish = resolve; }));
  await showReader();
  const original = checked();
  await userEvent.click(checkboxes()[1]);
  expect(checked()).toEqual(original);
  expect(checkboxes().every(input => input.disabled)).toBe(true);
  finish({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  await screen.findByRole('alert');
  expect(checked()).toEqual(original);
  expect(checkboxes().every(input => !input.disabled)).toBe(true);
});

it('failed preferences keep saved language/appearance and rejected transport is visible', async () => {
  api.updatePreferences = vi.fn(async () => { throw new Error('Transport failed'); });
  await showReader();
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await userEvent.selectOptions(screen.getByLabelText('Language'), 'pl');
  await screen.findByRole('alert');
  expect(document.documentElement.lang).toBe('en');
  expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('en');
  await userEvent.selectOptions(screen.getByLabelText('Appearance'), 'dark');
  await screen.findByRole('alert');
  expect(document.documentElement.dataset.appearance).toBe('system');
});

function acquired(): AcquisitionResult {
  const item = { ...items[0], id: 'acquired-video', removable: true, sourceId: 'abcdefghijk', title: 'Acquired video' };
  const comment = { ...initialComments['video-demo'][0], id: 'acquired-comment', itemId: item.id, parentId: null, seen: false, text: 'Acquired comment' };
  return { state: { items: [...items, item], comments: { ...initialComments, [item.id]: [comment] }, preferences: { locale: 'en', appearance: 'system' },
    workspace: { tabs: [...items, item].map(item => discussionTab(item.id)), activeTabId: discussionTab(item.id).id, revision: 1 } },
    summary: { itemId: item.id, coverage: 'unknown', inserted: 1, updated: 0, warnings: 0 } };
}
it('URL Enter submission adds and activates acknowledged discussion, then Refresh updates while retaining active item', async () => {
  const value = acquired();
  api.acquire = vi.fn<ReaderApi['acquire']>(async () => ({ ok: true as const, value }));
  api.refresh = vi.fn<ReaderApi['refresh']>(async () => ({ ok: true as const, value: { ...value, state: { ...value.state,
    comments: { ...value.state.comments, 'acquired-video': [{ ...value.state.comments['acquired-video'][0], text: 'Refreshed comment' }] } } } }));
  await showReader();
  expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Add / Open' }));
  await userEvent.type(screen.getByLabelText('YouTube URL'), 'https://youtu.be/abcdefghijk{Enter}');
  expect(api.acquire).toHaveBeenCalledWith({ url: 'https://youtu.be/abcdefghijk' });
  await screen.findByText('Acquired comment');
  expect(screen.getByRole('tabpanel').id).toBe('panel-acquired-video');
  expect(screen.queryByText(/Synthetic discussions/)).toBeNull();
  expect(within(screen.getByRole('tabpanel')).queryByText(/Demo reference time/)).toBeNull();
  expect(screen.getByRole('status').title).toContain('Discussion saved');
  expect(screen.queryByLabelText('YouTube URL')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(api.refresh).toHaveBeenCalledWith({ itemId: 'acquired-video' });
  await screen.findByText('Refreshed comment');
  expect(screen.getByRole('tabpanel').id).toBe('panel-acquired-video');
});
it('acquisition shows busy but checkboxes remain usable; failure retains visible stored data and is localized', async () => {
  let finish: (result: Result<AcquisitionResult>) => void = () => { throw new Error('Not started'); };
  api.acquire = vi.fn<ReaderApi['acquire']>(() => new Promise(resolve => { finish = resolve; }));
  await showReader();
  const original = checked();
  await userEvent.click(screen.getByRole('button', { name: 'Add / Open' }));
  await userEvent.type(screen.getByLabelText('YouTube URL'), 'https://youtu.be/abcdefghijk');
  await userEvent.click(screen.getByRole('button', { name: 'Open URL' }));
  expect(screen.getByRole('status').textContent).toContain('Acquiring');
  expect((screen.getByRole('button', { name: 'Open URL' }) as HTMLButtonElement).disabled).toBe(true);
  expect(checkboxes().every(input => !input.disabled)).toBe(true);
  await userEvent.click(checkboxes()[0]);
  expect(checked()[0]).toBe(!original[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await userEvent.selectOptions(screen.getByLabelText('Language'), 'pl');
  await userEvent.click(screen.getByRole('tab', { name: /A quieter desk/ }));
  finish({ ok: false, error: { code: 'HELPER_UNAVAILABLE' } });
  expect((await screen.findByRole('alert')).textContent).toContain('niedostępny');
  expect(screen.getByRole('tabpanel').id).toBe('panel-video-demo');
  expect(checked()[0]).toBe(!original[0]);
  expect(screen.queryByRole('status')).toBeNull();
});
it('refresh failure preserves acquired comments and reports incompatible helper distinctly', async () => {
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: true as const, value: acquired().state }));
  api.refresh = vi.fn<ReaderApi['refresh']>(async () => ({ ok: false, error: { code: 'HELPER_INCOMPATIBLE' } }));
  await showReader();
  await userEvent.click(screen.getByRole('tab', { name: /Acquired video/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect((await screen.findByRole('alert')).textContent).toContain('version');
  expect(screen.getByText('Acquired comment')).toBeTruthy();
});
it('overlapping acknowledgments preserve newer seen edits and newly acquired membership', async () => {
  const value = acquired();
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: true as const, value: value.state }));
  let finish: (result: Result<AcquisitionResult>) => void = () => { throw new Error('Not started'); };
  api.refresh = vi.fn<ReaderApi['refresh']>(() => new Promise(resolve => { finish = resolve; }));
  api.toggleSeen = vi.fn<ReaderApi['toggleSeen']>(async () => ({ ok: true as const, value: [{ ...value.state.comments['acquired-video'][0], seen: true }] }));
  await showReader();
  await userEvent.click(screen.getByRole('tab', { name: /Acquired video/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await userEvent.click(checkboxes()[0]);
  const comments = value.state.comments['acquired-video'];
  finish({ ok: true as const, value: { ...value, state: { ...value.state, comments: { ...value.state.comments,
    'acquired-video': [...comments, { ...comments[0], id: 'new-comment', text: 'New discovery' }] } } } });
  await screen.findByText('New discovery');
  expect(checked()).toEqual([true, false]);
});

it('a seen acknowledgment arriving after refresh changes only seen and keeps new comments/remote fields', async () => {
  const value = acquired(), rows = value.state.comments['acquired-video'];
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: true as const, value: value.state }));
  let finishSeen: (result: Result<typeof rows>) => void = () => { throw new Error('Not started'); };
  let finishRefresh: (result: Result<AcquisitionResult>) => void = () => { throw new Error('Not started'); };
  api.toggleSeen = vi.fn<ReaderApi['toggleSeen']>(() => new Promise(resolve => { finishSeen = resolve; }));
  api.refresh = vi.fn<ReaderApi['refresh']>(() => new Promise(resolve => { finishRefresh = resolve; }));
  await showReader();
  await userEvent.click(screen.getByRole('tab', { name: /Acquired video/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await userEvent.click(checkboxes()[0]);
  finishRefresh({ ok: true as const, value: { ...value, state: { ...value.state, comments: { ...value.state.comments,
    'acquired-video': [{ ...rows[0], text: 'Updated remote comment' }, { ...rows[0], id: 'later-discovery', text: 'Later discovery' }] } } } });
  await screen.findByText('Later discovery');
  finishSeen({ ok: true as const, value: [{ ...rows[0], seen: true }] });
  await waitFor(() => expect(checked()).toEqual([true, false]));
  expect(screen.getByText('Updated remote comment')).toBeTruthy();
  expect(screen.getByText('Later discovery')).toBeTruthy();
});

it('keeps the URL row hidden until Add / Open and supports cancel, Escape and retry without losing input', async () => {
  await showReader();
  expect(screen.queryByLabelText('YouTube URL')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Add / Open' }));
  const input = screen.getByLabelText('YouTube URL');
  expect(document.activeElement).toBe(input);
  await userEvent.type(input, 'https://youtu.be/abcdefghijk');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('YouTube URL')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Add / Open' }));
  expect((screen.getByLabelText('YouTube URL') as HTMLInputElement).value).toBe('https://youtu.be/abcdefghijk');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByLabelText('YouTube URL')).toBeNull();
});

it('closes a background tab independently and Library reopens it; closing all shows a useful empty workspace', async () => {
  await showReader();
  const title = items[0].kind === 'video' ? items[0].title : '';
  await userEvent.click(screen.getByRole('button', { name: /^Close tab: Quiet Workshop/ }));
  expect(api.closeTab).toHaveBeenCalledWith({ tabId: discussionTab('post-demo').id });
  expect(api.activateTab).not.toHaveBeenCalled();
  expect(screen.getByRole('tabpanel').id).toBe('panel-video-demo');
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Open' }));
  expect(api.openStoredItem).toHaveBeenCalledWith({ itemId: 'post-demo' });
  expect(screen.getByRole('tabpanel').id).toBe('panel-post-demo');
  await userEvent.click(screen.getByRole('button', { name: 'Close tab: Library' }));
  await userEvent.click(screen.getByRole('button', { name: `Close tab: ${title}` }));
  await userEvent.click(screen.getByRole('button', { name: /^Close tab: Quiet Workshop/ }));
  expect(screen.queryByRole('tabpanel')).toBeNull();
  expect(screen.getByText('No open tabs')).toBeTruthy();
  expect(api.toggleSeen).not.toHaveBeenCalled();
});

it('starts with persisted tab selection and keeps complete stored description behind expand/collapse', async () => {
  const value = acquired().state;
  api.bootstrap = vi.fn(async () => ({ ok: true as const, value }));
  await showReader();
  expect(screen.getByRole('tabpanel').id).toBe('panel-acquired-video');
  const button = screen.getByRole('button', { name: 'Show description' });
  const description = document.getElementById(button.getAttribute('aria-controls') ?? '');
  expect(description?.classList.contains('preview')).toBe(true);
  expect(description?.textContent).toBe(value.items[2].kind === 'video' ? value.items[2].description : '');
  await userEvent.click(button);
  expect(screen.getByRole('button', { name: 'Hide description' }).getAttribute('aria-expanded')).toBe('true');
  expect(description?.classList.contains('expanded')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Hide description' }));
  expect(description?.classList.contains('preview')).toBe(true);
});

it('older acquisition workspace acknowledgment cannot reopen a tab closed after its snapshot', async () => {
  const value = acquired();
  api.bootstrap = vi.fn(async () => ({ ok: true as const, value: value.state }));
  let finish: (value: Result<AcquisitionResult>) => void = () => undefined;
  api.refresh = vi.fn<ReaderApi['refresh']>(() => new Promise(resolve => { finish = resolve; }));
  api.closeTab = vi.fn<ReaderApi['closeTab']>(async () => ({ ok: true as const, value: { tabs: ['video-demo', 'post-demo'].map(discussionTab), activeTabId: discussionTab('post-demo').id, revision: 2 } }));
  await showReader();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await userEvent.click(screen.getByRole('button', { name: 'Close tab: Acquired video' }));
  finish({ ok: true as const, value });
  await waitFor(() => expect(screen.queryByRole('tab', { name: /Acquired video/ })).toBeNull());
  expect(screen.getByRole('tabpanel').id).toBe('panel-post-demo');
});

it('a failed tab close retains the acknowledged view and presents localized save feedback', async () => {
  api.closeTab = vi.fn<ReaderApi['closeTab']>(async () => ({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }));
  await showReader();
  const original = checked();
  await userEvent.click(screen.getByRole('button', { name: /^Close tab: A quieter desk/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be confirmed');
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getByRole('tabpanel').id).toBe('panel-video-demo');
  expect(checked()).toEqual(original);
});

it('Library and Settings are ordinary singleton closable tabs; toolbar contains no preference controls', async () => {
  await showReader();
  expect(document.querySelector('.app-toolbar select')).toBeNull();
  for (const name of ['Library', 'Settings']) {
    await userEvent.click(screen.getByRole('button', { name }));
    await userEvent.click(screen.getByRole('button', { name }));
    expect(screen.getAllByRole('tab', { name: new RegExp(name) })).toHaveLength(1);
  }
  expect(screen.getByRole('tabpanel').id).toBe('panel-settings');
  await userEvent.click(screen.getByRole('button', { name: 'Close tab: Settings' }));
  expect(screen.getByRole('tabpanel').id).toBe('panel-library');
  await userEvent.click(screen.getByRole('button', { name: 'Close tab: Library' }));
  expect(screen.getByRole('tabpanel').id).toBe('panel-post-demo');
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  expect(screen.getAllByRole('tab').at(-1)?.textContent).toBe('Library');
});
it('Library filters metadata, shows open/closed counts and demo protection, and activates without duplication', async () => {
  await showReader();
  await userEvent.click(screen.getByRole('button', { name: /^Close tab: Quiet Workshop/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  const panel = screen.getByRole('tabpanel');
  expect(within(panel).getAllByText(/removal unavailable/)).toHaveLength(2);
  expect(within(panel).queryByRole('button', { name: 'Remove from Library' })).toBeNull();
  expect(within(panel).getAllByText('Open tab')).toHaveLength(1);
  await userEvent.type(screen.getByRole('searchbox'), 'reading lamp');
  expect(within(panel).getAllByRole('listitem')).toHaveLength(1);
  await userEvent.click(within(panel).getByRole('button', { name: 'Open' }));
  expect(screen.getByRole('tabpanel').id).toBe('panel-post-demo');
  expect(screen.getAllByRole('tab')).toHaveLength(3);
});
it('confirmation is required, Cancel preserves item, and successful Remove updates Library and workspace', async () => {
  state = acquired().state;
  await showReader();
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove from Library' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('seen state, and refresh history');
  expect(dialog.textContent).toContain('does not affect YouTube');
  expect(api.removeLibraryItem).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.removeLibraryItem).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Remove from Library' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.removeLibraryItem).toHaveBeenCalledWith({ itemId: 'acquired-video' });
  expect(screen.queryByRole('tab', { name: /Acquired video/ })).toBeNull();
  expect(screen.getByRole('tabpanel').id).toBe('panel-library');
  expect(within(screen.getByRole('tabpanel')).getAllByRole('listitem')).toHaveLength(2);
});
it('failed removal stays visible with storage feedback, and busy removal explains waiting', async () => {
  state = acquired().state;
  api.removeLibraryItem = vi.fn(async () => ({ ok: false as const, error: { code: 'STORAGE_UNAVAILABLE' as const } }));
  await showReader();
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove from Library' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
  expect((await screen.findByRole('alert')).textContent).toContain('remains in Library');
  expect(screen.getByRole('tab', { name: /Acquired video/ })).toBeTruthy();
  api.removeLibraryItem = vi.fn(async () => ({ ok: false as const, error: { code: 'ACQUISITION_BUSY' as const } }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Wait for it'));
});
it('an older acquisition content snapshot cannot resurrect an unrelated removed item', async () => {
  state = acquired().state;
  const old = acquired();
  let finish: (value: Result<AcquisitionResult>) => void = () => undefined;
  api.refresh = vi.fn<ReaderApi['refresh']>(() => new Promise(resolve => { finish = resolve; }));
  await showReader();
  // Simulate a delayed acknowledgment from an already completed helper snapshot.
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove from Library' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  finish({ ok: true, value: old });
  await waitFor(() => expect(document.querySelector('.acquisition-status')).toBeNull());
  expect(screen.queryByRole('tab', { name: /Acquired video/ })).toBeNull();
  expect(within(screen.getByRole('tabpanel')).getAllByRole('listitem')).toHaveLength(2);
});
it('older acquisition acknowledgment preserves newer app opens and mixed reorder', async () => {
  state = acquired().state;
  const old = acquired();
  let finish: (value: Result<AcquisitionResult>) => void = () => undefined;
  api.refresh = vi.fn<ReaderApi['refresh']>(() => new Promise(resolve => { finish = resolve; }));
  await showReader();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Settings: Settings' }), { key: 'ArrowLeft', altKey: true });
  await waitFor(() => expect(api.moveTab).toHaveBeenCalledWith({ tabId: 'settings', toIndex: 3 }));
  finish({ ok: true, value: old });
  await waitFor(() => expect(document.querySelector('.acquisition-status')).toBeNull());
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
    items[0].kind === 'video' ? items[0].title : '', expect.stringContaining('Quiet Workshop'), 'Acquired video', 'Settings', 'Library',
  ]);
  expect(screen.getByRole('tabpanel').id).toBe('panel-settings');
});

const currentView = () => within(screen.getByRole('tabpanel'));
const appliedRows = () => Array.from(screen.getByRole('tabpanel').querySelectorAll<HTMLElement>('[data-view-role=match]'), row => row.id);
const press = (key: string, modifiers: KeyboardEventInit = {}, target: Element | Document = document) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  fireEvent(target, event); return event;
};
const activeTab = () => screen.getAllByRole('tab').find(tab => tab.getAttribute('aria-selected') === 'true')?.id;
async function workspaceReady() { await waitFor(() => expect(screen.getByRole('button', { name: 'Library' }).hasAttribute('disabled')).toBe(false)); }
it('cycles forward and backward with wrap across discussions, Library and Settings even from editable controls', async () => {
  state = { ...state, workspace: { ...state.workspace, tabs: [...state.workspace.tabs, { id: 'library', kind: 'library' }, { id: 'settings', kind: 'settings' }] } };
  await showReader();
  const search = currentView().getByLabelText('Search this discussion');
  const ids = state.workspace.tabs.map(tab => `tab-${tab.id}`);
  expect(press('Tab', { ctrlKey: true }, search).defaultPrevented).toBe(true);
  await waitFor(() => expect(activeTab()).toBe(ids[1])); await workspaceReady();
  for (const id of [ids[2], ids[3], ids[0]]) {
    press('Tab', { ctrlKey: true }); await waitFor(() => expect(activeTab()).toBe(id)); await workspaceReady();
  }
  for (const id of [ids[3], ids[2], ids[1], ids[0]]) {
    press('Tab', { ctrlKey: true, shiftKey: true }); await waitFor(() => expect(activeTab()).toBe(id)); await workspaceReady();
  }
  expect(api.toggleSeen).not.toHaveBeenCalled();
});
it('closes active tabs using right then left then empty, without deleting stored discussions', async () => {
  state = { ...state, workspace: { ...state.workspace, tabs: [state.workspace.tabs[0], { id: 'library', kind: 'library' }, { id: 'settings', kind: 'settings' }, state.workspace.tabs[1]], activeTabId: 'library' } };
  await showReader();
  for (const id of ['tab-settings', 'tab-discussion:post-demo', 'tab-discussion:video-demo']) {
    expect(press('w', { ctrlKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(activeTab()).toBe(id)); await workspaceReady();
  }
  const search = currentView().getByLabelText('Search this discussion');
  press('w', { ctrlKey: true }, search);
  await screen.findByText('No open tabs'); await workspaceReady();
  expect(press('w', { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(press('Tab', { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(api.removeLibraryItem).not.toHaveBeenCalled();
  expect(state.items).toEqual(items); expect(state.comments).toEqual(initialComments);
});
it('focuses and selects discussion search and Library filter, leaving Settings and empty browser-find alone', async () => {
  await showReader();
  const search = currentView().getByLabelText<HTMLInputElement>('Search this discussion');
  fireEvent.change(search, { target: { value: 'desk' } });
  expect(press('f', { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(search); expect(search.selectionStart).toBe(0); expect(search.selectionEnd).toBe(4);
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  const filter = currentView().getByLabelText<HTMLInputElement>('Filter Library');
  fireEvent.change(filter, { target: { value: 'quiet' } });
  expect(press('f', { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(filter); expect(filter.selectionEnd).toBe(5);
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(press('f', { ctrlKey: true }).defaultPrevented).toBe(false);
});
it('does not handle browser-find in an empty workspace', async () => {
  state = { ...state, workspace: { tabs: [], activeTabId: null, revision: 0 } };
  render(<App api={api} />); await screen.findByText('No open tabs');
  expect(press('f', { ctrlKey: true }).defaultPrevented).toBe(false);
});
it('reveals, focuses and selects the URL control repeatedly without stealing subsequent typing or navigation', async () => {
  await showReader();
  expect(press('l', { ctrlKey: true }).defaultPrevented).toBe(true);
  const url = screen.getByLabelText<HTMLInputElement>('YouTube URL'); expect(document.activeElement).toBe(url);
  await userEvent.type(url, 'https://youtu.be/abcdefghijk');
  expect(press('l', { ctrlKey: true }, url).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(url); expect(url.selectionEnd).toBe(url.value.length);
  await userEvent.keyboard('x{ArrowLeft}y'); expect(url.value).toBe('yx');
  expect(press('Enter', { ctrlKey: true }, url).defaultPrevented).toBe(false);
  expect(press('F3', {}, url).defaultPrevented).toBe(false);
  expect(press('ArrowLeft', { altKey: true }, url).defaultPrevented).toBe(false);
  expect(api.moveTab).not.toHaveBeenCalled();
});
it('F1 waits for acknowledged singleton Settings activation and focuses help when closed, background or active', async () => {
  await showReader();
  let finish!: (result: Result<ReaderState['workspace']>) => void;
  const open = api.openSettings;
  api.openSettings = vi.fn<ReaderApi['openSettings']>(() => new Promise(resolve => { finish = resolve; }));
  expect(press('F1').defaultPrevented).toBe(true);
  expect(document.getElementById(keyboardShortcutsTarget)).toBeNull();
  expect(press('F1').defaultPrevented).toBe(false); // pending workspace acknowledgment owns this operation
  finish(await open());
  await waitFor(() => expect(document.activeElement?.id).toBe(keyboardShortcutsTarget));
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  api.openSettings = vi.fn(open);
  await userEvent.click(screen.getByRole('tab', { name: /Video:/ })); await workspaceReady();
  press('F1'); await waitFor(() => expect(document.activeElement?.id).toBe(keyboardShortcutsTarget)); await workspaceReady();
  screen.getByLabelText('Language').focus();
  press('F1', {}, screen.getByLabelText('Language'));
  await waitFor(() => expect(document.activeElement?.id).toBe(keyboardShortcutsTarget));
  expect(screen.getAllByRole('tab', { name: 'Settings: Settings' })).toHaveLength(1);
});
it('F1 from an empty workspace opens help; failed Settings activation leaves focus in place', async () => {
  state = { ...state, workspace: { tabs: [], activeTabId: null, revision: 0 } };
  render(<App api={api} />); await screen.findByText('No open tabs');
  const button = screen.getByRole('button', { name: 'Add / Open' }); button.focus();
  const open = api.openSettings;
  api.openSettings = vi.fn(async () => ({ ok: false as const, error: { code: 'STORAGE_UNAVAILABLE' as const } }));
  press('F1'); await screen.findByRole('alert'); expect(document.activeElement).toBe(button);
  api.openSettings = open; press('F1'); await waitFor(() => expect(document.activeElement?.id).toBe(keyboardShortcutsTarget));
});
it('ordinary editable keys remain local, query Ctrl+Enter/F3 still work and Alt+arrows require a focused tab', async () => {
  await showReader();
  const search = currentView().getByLabelText('Search this discussion');
  await userEvent.type(search, 'desk');
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'a']) expect(press(key, {}, search).defaultPrevented).toBe(false);
  expect(press('ArrowLeft', { altKey: true }, search).defaultPrevented).toBe(false);
  expect(api.activateTab).not.toHaveBeenCalled(); expect(api.moveTab).not.toHaveBeenCalled();
  expect(press('Enter', { ctrlKey: true }, search).defaultPrevented).toBe(true);
  await waitFor(() => expect(appliedRows().length).toBeGreaterThan(0));
  expect(press('F3', {}, search).defaultPrevented).toBe(true);
  expect(screen.getByRole('tabpanel').querySelector('[data-selected=true]')).toBeTruthy();
  const tab = screen.getByRole('tab', { name: /Video:/ }); tab.focus();
  press('ArrowRight', { altKey: true }, tab);
  await waitFor(() => expect(api.moveTab).toHaveBeenCalledWith({ tabId: 'discussion:video-demo', toIndex: 1 }));
  expect(api.toggleSeen).not.toHaveBeenCalled();
});
it.each(['textarea', 'select', 'contenteditable'])('leaves ordinary navigation and discussion commands in unrelated %s controls', async kind => {
  await showReader();
  const element = document.createElement(kind === 'contenteditable' ? 'div' : kind);
  if (kind === 'contenteditable') element.setAttribute('contenteditable', 'true');
  document.body.append(element);
  try {
    for (const key of ['ArrowLeft', 'Home', 'a', 'F3']) expect(press(key, {}, element).defaultPrevented).toBe(false);
    expect(press('Enter', { ctrlKey: true }, element).defaultPrevented).toBe(false);
    expect(api.activateTab).not.toHaveBeenCalled(); expect(api.toggleSeen).not.toHaveBeenCalled();
  } finally { element.remove(); }
});
it('removal confirmation and pending removal suspend shortcuts without losing dialog focus or mutating workspace', async () => {
  state = acquired().state; await showReader();
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove from Library' }));
  const dialog = screen.getByRole('dialog');
  const checkBlocked = () => {
    const focused = document.activeElement;
    for (const [key, modifiers] of [['Tab', { ctrlKey: true }], ['Tab', { ctrlKey: true, shiftKey: true }], ['w', { ctrlKey: true }], ['f', { ctrlKey: true }], ['l', { ctrlKey: true }], ['F1', {}], ['F3', {}], ['Enter', { ctrlKey: true }]] as const) {
      expect(press(key, modifiers, dialog).defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(focused);
    expect(api.closeTab).not.toHaveBeenCalled(); expect(api.activateTab).not.toHaveBeenCalled(); expect(api.openSettings).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('YouTube URL')).toBeNull();
  };
  checkBlocked();
  let finish!: (result: Result<ReaderState>) => void;
  api.removeLibraryItem = vi.fn<ReaderApi['removeLibraryItem']>(() => new Promise(resolve => { finish = resolve; }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' })); checkBlocked();
  fireEvent(dialog, new Event('cancel', { cancelable: true })); expect(screen.getByRole('dialog')).toBe(dialog);
  finish({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  await within(dialog).findByRole('alert');
  fireEvent(dialog, new Event('cancel', { cancelable: true })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('control titles and interaction help use registry formatting in English and Polish', async () => {
  await showReader();
  for (const locale of ['en', 'pl'] as const) {
    if (locale === 'pl') {
      await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
      await userEvent.selectOptions(screen.getByLabelText('Language'), 'pl');
      await userEvent.click(screen.getByRole('tab', { name: /Film:/ }));
    }
    const panel = screen.getByRole('tabpanel');
    expect(panel.querySelector('.query-controls button[type=submit]')?.getAttribute('title')).toBe(shortcutHint(locale, 'apply-view'));
    expect(panel.querySelector('.query-navigation button')?.getAttribute('title')).toBe(shortcutHint(locale, 'previous-match'));
    expect(panel.querySelector('.query-navigation button:nth-child(2)')?.getAttribute('title')).toBe(shortcutHint(locale, 'next-match'));
    expect(panel.querySelector('.query-search input')?.getAttribute('title')).toContain(formatShortcut('focus-search'));
    expect(panel.querySelector('.seen-control')?.getAttribute('title')).toBe(seenHelp(locale));
    expect(document.querySelector('[aria-controls=acquisition-form]')?.getAttribute('title')).toBe(shortcutHint(locale, 'open-url'));
    expect(document.querySelector('[role=tab][aria-selected=true]')?.getAttribute('title')).toContain(reorderHelp(locale));
    expect(document.querySelector('.tab[data-active=true] .tab-close')?.getAttribute('title')).toContain(formatShortcut('close-tab'));
    await userEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Library' : 'Biblioteka' }));
    expect(document.querySelector('.library-filter input')?.getAttribute('title')).toContain(formatShortcut('focus-search'));
    await userEvent.click(screen.getByRole('tab', { name: locale === 'en' ? /Video:/ : /Film:/ }));
  }
});
it('development StrictMode effect probes preserve query sessions and their first draft edit', async () => {
  render(<StrictMode><App api={api} /></StrictMode>); await screen.findByRole('tabpanel');
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'desk' } });
  expect((currentView().getByLabelText('Search this discussion') as HTMLInputElement).value).toBe('desk');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(appliedRows().length).toBeGreaterThan(0));
});
it('compact draft controls wait for Apply/Ctrl+Enter, context includes siblings and raw-only hits', async () => {
  await showReader();
  expect(appliedRows()).toEqual([]);
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'desk' } });
  expect(currentView().getByText('Draft criteria · Apply to update')).toBeTruthy();
  expect(appliedRows()).toEqual([]);
  fireEvent.keyDown(screen.getByRole('tabpanel'), { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(appliedRows().length).toBeGreaterThan(0));
  expect(screen.getByRole('tabpanel').querySelector('[data-view-role=context]')).toBeTruthy();
  expect(currentView().queryByText('Draft criteria · Apply to update')).toBeNull();
  expect(currentView().getByText(/Applied:.*matching comment/)).toBeTruthy();
  expect(api.toggleSeen).not.toHaveBeenCalled();
});
it('invalid regex/no-fields and worker timeout retain the previous applied view with localized feedback', async () => {
  await showReader();
  fireEvent.change(currentView().getByLabelText('Seen filter'), { target: { value: 'unseen' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  const previous = appliedRows();
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: '[' } });
  await userEvent.click(screen.getByRole('button', { name: 'Regular expression' }));
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid regular expression');
  expect(appliedRows()).toEqual(previous);
  fireEvent.click(currentView().getByText('Search fields', { selector: 'summary' }));
  fireEvent.click(currentView().getByLabelText('Comment contents'));
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('at least one search field'));
  expect(appliedRows()).toEqual(previous);
});
it('worker timeout feedback keeps previous successful results', async () => {
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: vi.fn().mockResolvedValue({ ok: false, error: 'QUERY_TOO_EXPENSIVE' }), dispose: vi.fn() } as unknown as ReturnType<typeof createQueryExecutor>));
  await showReader();
  const previous = screen.getByRole('tabpanel').querySelectorAll('.comment').length;
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: '(a+)+$' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect((await screen.findByRole('alert')).textContent).toContain('exceeded the time limit');
  expect(screen.getByRole('tabpanel').querySelectorAll('.comment')).toHaveLength(previous);
});
it('seen saves retain applied matches/counts and pending view until second Apply', async () => {
  await showReader();
  fireEvent.change(currentView().getByLabelText('Seen filter'), { target: { value: 'unseen' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  const previous = appliedRows(), count = currentView().getByText(/Applied:/).textContent;
  const target = document.getElementById(previous[0])?.querySelector<HTMLInputElement>('input');
  if (!target) throw new Error('Missing match');
  await userEvent.click(target);
  await waitFor(() => expect(target.checked).toBe(true));
  expect(appliedRows()).toEqual(previous); expect(currentView().getByText(/Applied:/).textContent).toBe(count);
  expect(currentView().getByText('Seen changes saved · Apply to update this view')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(appliedRows()).not.toContain(previous[0]));
  expect(currentView().queryByText('Seen changes saved · Apply to update this view')).toBeNull();
});
it('seen All edits do not report a stale view and independent drafts/applied results survive tab switch/reopen', async () => {
  await showReader();
  await userEvent.click(checkboxes()[0]);
  expect(currentView().queryByText('Seen changes saved · Apply to update this view')).toBeNull();
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'desk' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' })); const video = appliedRows();
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'video draft' } });
  await userEvent.click(screen.getByRole('tab', { name: /Community Post/ }));
  expect((currentView().getByLabelText('Search this discussion') as HTMLInputElement).value).toBe(''); expect(appliedRows()).toEqual([]);
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'post draft' } });
  await userEvent.click(screen.getByRole('tab', { name: /A quieter desk/ }));
  expect((currentView().getByLabelText('Search this discussion') as HTMLInputElement).value).toBe('video draft'); expect(appliedRows()).toEqual(video);
  await userEvent.click(screen.getByRole('button', { name: /Close tab: A quieter desk/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  const entry = currentView().getByText(items[0].kind === 'video' ? items[0].title : '').closest('li');
  if (!entry) throw new Error('Missing Library entry');
  await userEvent.click(within(entry).getByRole('button', { name: 'Open' }));
  expect((currentView().getByLabelText('Search this discussion') as HTMLInputElement).value).toBe('video draft'); expect(appliedRows()).toEqual(video);
});
it('match/F3/Shift+F3 and live unseen navigation select/reveal application IDs without saving', async () => {
  const reveal = vi.fn(); Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: reveal });
  await showReader();
  fireEvent.change(currentView().getByLabelText('Seen filter'), { target: { value: 'unseen' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' })); const matches = appliedRows();
  const selected = () => screen.getByRole('tabpanel').querySelector('[data-selected=true]')?.id;
  await userEvent.click(screen.getByRole('button', { name: 'Next match' })); expect(selected()).toBe(matches[0]);
  fireEvent.keyDown(document, { key: 'F3' }); expect(selected()).toBe(matches[1]);
  fireEvent.keyDown(document, { key: 'F3', shiftKey: true }); expect(selected()).toBe(matches[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Previous match' })); expect(selected()).toBe(matches.at(-1));
  await userEvent.click(screen.getByRole('button', { name: 'Next unseen' })); expect(selected()).toBe(matches[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Previous unseen' })); expect(selected()).toBe(matches.at(-1));
  expect(reveal).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' }); expect(api.toggleSeen).not.toHaveBeenCalled();
});
it('Refresh re-evaluates last applied criteria, retains draft and includes new committed matching comments', async () => {
  state = acquired().state;
  await showReader();
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'Acquired' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'draft does not match' } });
  const value = acquired();
  api.refresh = vi.fn(async () => ({ ok: true as const, value: { ...value, state: { ...value.state, comments: { ...value.state.comments,
    'acquired-video': [...value.state.comments['acquired-video'], { ...value.state.comments['acquired-video'][0], id: 'new-query', text: 'Acquired new matching comment' }] } } } }));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('Acquired new matching comment');
  await waitFor(() => expect(appliedRows()).toHaveLength(2));
  expect((currentView().getByLabelText('Search this discussion') as HTMLInputElement).value).toBe('draft does not match');
  expect(currentView().getByText('Draft criteria · Apply to update')).toBeTruthy();
});

it('raw-only search hits remain context; complete tree and live unseen navigation remain independent of matches', async () => {
  const value = acquired(), root = { ...value.state.comments['acquired-video'][0], text: 'camera', seen: true };
  state = { ...value.state, comments: { ...value.state.comments, 'acquired-video': [root,
    { ...root, id: 'nested-target', parentId: root.id, text: 'camera reply', seen: false },
    { ...root, id: 'sibling-context', parentId: root.id, text: 'unrelated sibling', seen: false }] } };
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  await showReader();
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'camera' } });
  fireEvent.change(currentView().getByLabelText('Seen filter'), { target: { value: 'unseen' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(appliedRows()).toEqual(['comment-nested-target']);
  expect(currentView().getByText('SEARCH HIT').closest('article')?.dataset.viewRole).toBe('context');
  expect(screen.getByRole('tabpanel').querySelectorAll('.comment')).toHaveLength(3);
  expect(currentView().getByText('Applied: 1 matching comment · 1 containing thread')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Next match' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next unseen' }));
  expect(screen.getByRole('tabpanel').querySelector('[data-selected=true]')?.id).toBe('comment-sibling-context');
  expect(api.toggleSeen).not.toHaveBeenCalled();
});
it('query failure after successful Refresh preserves the previous tree even if committed placement changes', async () => {
  const value = acquired(), root = value.state.comments['acquired-video'][0];
  state = { ...value.state, comments: { ...value.state.comments, 'acquired-video': [root, { ...root, id: 'child-query', parentId: root.id, text: 'needle' }] } };
  const evaluate = vi.fn(async (comments: Parameters<QueryExecutor['evaluate']>[0], query: Parameters<QueryExecutor['evaluate']>[1]) => evaluateDiscussionQuery(comments, query));
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate, dispose: vi.fn() }));
  await showReader();
  fireEvent.change(currentView().getByLabelText('Search this discussion'), { target: { value: 'needle' } });
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  const previous = appliedRows();
  evaluate.mockResolvedValueOnce({ ok: false, error: 'QUERY_FAILED' });
  api.refresh = vi.fn(async () => ({ ok: true as const, value: { ...value, state: { ...state,
    comments: { ...state.comments, 'acquired-video': [root, { ...root, id: 'child-query', parentId: null, text: 'needle changed' }] } } } }));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be evaluated');
  expect(appliedRows()).toEqual(previous);
  expect(screen.getByRole('tabpanel').querySelectorAll('.comment')).toHaveLength(2);
  expect(currentView().getByText('needle changed')).toBeTruthy();
  expect(document.getElementById('comment-child-query')?.closest('.comment-branch')?.getAttribute('data-depth')).toBe('1');
});

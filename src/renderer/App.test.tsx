// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { initialComments, items } from '../fixtures/discussions';
import { toggleSeen } from '../domain/discussion';
import type { AcquisitionResult, ReaderApi, ReaderState, Result } from '../shared/reader-api';
import { closeWorkspaceTab } from '../domain/workspace';

let api: ReaderApi;
beforeEach(() => {
  let state: ReaderState = { items, comments: initialComments, preferences: { locale: 'en', appearance: 'system' },
    workspace: { openItemIds: items.map(item => item.id), activeItemId: items[0].id, revision: 0 } };
  const open: ReaderApi['openStoredItem'] = async ({ itemId }) => {
    state = { ...state, workspace: { openItemIds: state.workspace.openItemIds.includes(itemId) ? state.workspace.openItemIds : [...state.workspace.openItemIds, itemId],
      activeItemId: itemId, revision: state.workspace.revision + 1 } };
    return { ok: true, value: state.workspace };
  };
  api = {
    openStoredItem: vi.fn(open), activateTab: vi.fn(open),
    closeTab: vi.fn<ReaderApi['closeTab']>(async ({ itemId }) => {
      state = { ...state, workspace: closeWorkspaceTab(state.workspace, itemId) };
      return { ok: true, value: state.workspace };
    }),
    acquire: vi.fn<ReaderApi['acquire']>(async () => ({ ok: false, error: { code: 'ACQUISITION_FAILED' } })),
    refresh: vi.fn<ReaderApi['refresh']>(async () => ({ ok: false, error: { code: 'ACQUISITION_FAILED' } })),
    bootstrap: vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: true, value: state })),
    toggleSeen: vi.fn<ReaderApi['toggleSeen']>(async request => {
      const comments = toggleSeen(state.comments[request.itemId], request.commentId, request.subtree);
      state = { ...state, comments: { ...state.comments, [request.itemId]: comments } };
      return { ok: true, value: comments };
    }),
    updatePreferences: vi.fn<ReaderApi['updatePreferences']>(async change => {
      state = { ...state, preferences: { ...state.preferences, ...change } };
      return { ok: true, value: state.preferences };
    }),
  };
});
async function showReader() { render(<App api={api} />); await screen.findByRole('tabpanel'); }

beforeEach(() => {
  // A value avoids spying on jsdom's branded Navigator prototype getter.
  Object.defineProperty(window.navigator, 'languages', { configurable: true, value: ['en'] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const checkboxes = () => screen.getAllByRole<HTMLInputElement>('checkbox');
const checked = () => checkboxes().map(input => input.checked);

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
  await user.selectOptions(screen.getByLabelText('Language'), 'pl');
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
  const original = checked();
  for (const appearance of ['dark', 'light', 'system']) {
    await user.selectOptions(screen.getByLabelText('Appearance'), appearance);
    expect(document.documentElement.dataset.appearance).toBe(appearance);
    expect(checked()).toEqual(original);
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
  await userEvent.selectOptions(screen.getByLabelText('Language'), 'pl');
  await screen.findByRole('alert');
  expect(document.documentElement.lang).toBe('en');
  expect((screen.getByLabelText('Language') as HTMLSelectElement).value).toBe('en');
  await userEvent.selectOptions(screen.getByLabelText('Appearance'), 'dark');
  await screen.findByRole('alert');
  expect(document.documentElement.dataset.appearance).toBe('system');
});

function acquired(): AcquisitionResult {
  const item = { ...items[0], id: 'acquired-video', sourceId: 'abcdefghijk', title: 'Acquired video' };
  const comment = { ...initialComments['video-demo'][0], id: 'acquired-comment', itemId: item.id, parentId: null, seen: false, text: 'Acquired comment' };
  return { state: { items: [...items, item], comments: { ...initialComments, [item.id]: [comment] }, preferences: { locale: 'en', appearance: 'system' },
    workspace: { openItemIds: [...items.map(item => item.id), item.id], activeItemId: item.id, revision: 1 } },
    summary: { itemId: item.id, coverage: 'unknown', inserted: 1, updated: 0, warnings: 0 } };
}
it('URL Enter submission adds and activates acknowledged discussion, then Refresh updates while retaining active item', async () => {
  const value = acquired();
  api.acquire = vi.fn<ReaderApi['acquire']>(async () => ({ ok: true, value }));
  api.refresh = vi.fn<ReaderApi['refresh']>(async () => ({ ok: true, value: { ...value, state: { ...value.state,
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
  await userEvent.selectOptions(screen.getByLabelText('Language'), 'pl');
  finish({ ok: false, error: { code: 'HELPER_UNAVAILABLE' } });
  expect((await screen.findByRole('alert')).textContent).toContain('niedostępny');
  expect(screen.getByRole('tabpanel').id).toBe('panel-video-demo');
  expect(checked()[0]).toBe(!original[0]);
  expect(screen.queryByRole('status')).toBeNull();
});
it('refresh failure preserves acquired comments and reports incompatible helper distinctly', async () => {
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: true, value: acquired().state }));
  api.refresh = vi.fn<ReaderApi['refresh']>(async () => ({ ok: false, error: { code: 'HELPER_INCOMPATIBLE' } }));
  await showReader();
  await userEvent.click(screen.getByRole('tab', { name: /Acquired video/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect((await screen.findByRole('alert')).textContent).toContain('version');
  expect(screen.getByText('Acquired comment')).toBeTruthy();
});
it('overlapping acknowledgments preserve newer seen edits and newly acquired membership', async () => {
  const value = acquired();
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: true, value: value.state }));
  let finish: (result: Result<AcquisitionResult>) => void = () => { throw new Error('Not started'); };
  api.refresh = vi.fn<ReaderApi['refresh']>(() => new Promise(resolve => { finish = resolve; }));
  api.toggleSeen = vi.fn<ReaderApi['toggleSeen']>(async () => ({ ok: true, value: [{ ...value.state.comments['acquired-video'][0], seen: true }] }));
  await showReader();
  await userEvent.click(screen.getByRole('tab', { name: /Acquired video/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await userEvent.click(checkboxes()[0]);
  const comments = value.state.comments['acquired-video'];
  finish({ ok: true, value: { ...value, state: { ...value.state, comments: { ...value.state.comments,
    'acquired-video': [...comments, { ...comments[0], id: 'new-comment', text: 'New discovery' }] } } } });
  await screen.findByText('New discovery');
  expect(checked()).toEqual([true, false]);
});

it('a seen acknowledgment arriving after refresh changes only seen and keeps new comments/remote fields', async () => {
  const value = acquired(), rows = value.state.comments['acquired-video'];
  api.bootstrap = vi.fn<ReaderApi['bootstrap']>(async () => ({ ok: true, value: value.state }));
  let finishSeen: (result: Result<typeof rows>) => void = () => { throw new Error('Not started'); };
  let finishRefresh: (result: Result<AcquisitionResult>) => void = () => { throw new Error('Not started'); };
  api.toggleSeen = vi.fn<ReaderApi['toggleSeen']>(() => new Promise(resolve => { finishSeen = resolve; }));
  api.refresh = vi.fn<ReaderApi['refresh']>(() => new Promise(resolve => { finishRefresh = resolve; }));
  await showReader();
  await userEvent.click(screen.getByRole('tab', { name: /Acquired video/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await userEvent.click(checkboxes()[0]);
  finishRefresh({ ok: true, value: { ...value, state: { ...value.state, comments: { ...value.state.comments,
    'acquired-video': [{ ...rows[0], text: 'Updated remote comment' }, { ...rows[0], id: 'later-discovery', text: 'Later discovery' }] } } } });
  await screen.findByText('Later discovery');
  finishSeen({ ok: true, value: [{ ...rows[0], seen: true }] });
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
  expect(api.closeTab).toHaveBeenCalledWith({ itemId: 'post-demo' });
  expect(api.activateTab).not.toHaveBeenCalled();
  expect(screen.getByRole('tabpanel').id).toBe('panel-video-demo');
  await userEvent.click(screen.getByRole('button', { name: 'Library' }));
  await userEvent.click(within(screen.getByRole('region', { name: 'Library' })).getByRole('button', { name: /Community Post/ }));
  expect(api.openStoredItem).toHaveBeenCalledWith({ itemId: 'post-demo' });
  expect(screen.getByRole('tabpanel').id).toBe('panel-post-demo');
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
  api.closeTab = vi.fn<ReaderApi['closeTab']>(async () => ({ ok: true, value: { openItemIds: ['video-demo', 'post-demo'], activeItemId: 'post-demo', revision: 2 } }));
  await showReader();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await userEvent.click(screen.getByRole('button', { name: 'Close tab: Acquired video' }));
  finish({ ok: true, value });
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

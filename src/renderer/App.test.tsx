// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { initialComments, items } from '../fixtures/discussions';
import { toggleSeen } from '../domain/discussion';
import type { ReaderApi, ReaderState, Result } from '../shared/reader-api';

let api: ReaderApi;
beforeEach(() => {
  let state: ReaderState = { items, comments: initialComments, preferences: { locale: 'en', appearance: 'system' } };
  api = {
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

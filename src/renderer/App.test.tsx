// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { initialComments } from '../fixtures/discussions';

beforeEach(() => {
  // A value avoids spying on jsdom's branded Navigator prototype getter.
  Object.defineProperty(window.navigator, 'languages', { configurable: true, value: ['en'] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const checkboxes = () => screen.getAllByRole<HTMLInputElement>('checkbox');
const checked = () => checkboxes().map(input => input.checked);

it('reading, scrolling, tab navigation and language changes do not mark comments seen', async () => {
  const user = userEvent.setup();
  render(<App />);
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
  render(<App />);
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
  render(<App />);
  expect(document.documentElement.dataset.appearance).toBe('system');
  const original = checked();
  for (const appearance of ['dark', 'light', 'system']) {
    await user.selectOptions(screen.getByLabelText('Appearance'), appearance);
    expect(document.documentElement.dataset.appearance).toBe(appearance);
    expect(checked()).toEqual(original);
  }
});

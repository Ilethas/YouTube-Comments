// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApplicationMenu } from './ApplicationMenu';
import type { ReaderApi } from '../shared/reader-api';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(locale: 'en' | 'pl' = 'en') {
  const api = { newWindow: vi.fn(async () => ({ ok: true, value: null })), closeWindow: vi.fn(async () => ({ ok: true, value: null })), quitApplication: vi.fn(async () => ({ ok: true, value: null })) };
  const ui = render(<ApplicationMenu api={api as unknown as ReaderApi} locale={locale} disabled={false} />);
  return { ...ui, api, trigger: screen.getByRole('button') };
}
it.each(['en', 'pl'] as const)('localized trigger and keyboard menu route one selected command and restore focus in %s', async locale => {
  const { api, trigger } = setup(locale), user = userEvent.setup();
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  trigger.focus(); await user.keyboard('{ArrowDown}');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const commands = screen.getAllByRole('menuitem'); expect(document.activeElement).toBe(commands[0]);
  expect(commands.map(e => e.textContent)).toEqual(locale === 'en'
    ? ['New WindowCtrl+N', 'Close WindowCtrl+Shift+W', 'Quit ApplicationCtrl+Shift+Q']
    : ['Nowe oknoCtrl+N', 'Zamknij oknoCtrl+Shift+W', 'Zakończ aplikacjęCtrl+Shift+Q']);
  await user.keyboard('{End}'); expect(document.activeElement).toBe(commands[2]);
  await user.keyboard('{Home}{ArrowDown} ');
  expect(api.closeWindow).toHaveBeenCalledOnce(); expect(api.newWindow).not.toHaveBeenCalled(); expect(api.quitApplication).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
  await user.keyboard('{ArrowUp}'); expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[2]);
  await user.keyboard('{Escape}'); expect(document.activeElement).toBe(trigger);
});
it('pointer toggle, outside dismissal, disabled lifecycle state and IME keys do not duplicate actions', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const { api, trigger, rerender } = setup(), user = userEvent.setup();
  await user.click(trigger); await user.click(trigger); expect(screen.queryByRole('menu')).toBeNull();
  await user.click(trigger); expect(fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter', isComposing: true })).toBe(false); expect(api.newWindow).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body); expect(screen.queryByRole('menu')).toBeNull();
  await user.click(trigger); fireEvent.click(screen.getAllByRole('menuitem')[0]); expect(api.newWindow).toHaveBeenCalledOnce();
  await user.click(trigger); rerender(<ApplicationMenu api={api as unknown as ReaderApi} locale="en" disabled />);
  expect(screen.queryByRole('menu')).toBeNull(); expect(trigger.hasAttribute('disabled')).toBe(true);
});
it('rejected commands expose a localized actionable error without a privileged fallback', async () => {
  const { api, trigger } = setup(); api.newWindow.mockRejectedValueOnce(Error('blocked'));
  fireEvent.click(trigger); fireEvent.click(screen.getAllByRole('menuitem')[0]);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Try again'));
});
it('an unavailable command set stays keyboard-dismissible without executing a fallback', async () => {
  render(<ApplicationMenu api={{} as ReaderApi} locale="en" disabled={false} />);
  const trigger = screen.getByRole('button'); fireEvent.click(trigger);
  const menu = screen.getByRole('menu'); expect(document.activeElement).toBe(menu);
  expect(screen.getAllByRole('menuitem').every(item => item.hasAttribute('disabled'))).toBe(true);
  fireEvent.keyDown(menu, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
});

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataBackups } from './DataBackups';
import type { ReaderApi } from '../shared/reader-api';
import { backupText } from '../shared/data-backup';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);
it.each([
  ['en', 'createBackup'], ['en', 'restoreBackup'], ['pl', 'createBackup'], ['pl', 'restoreBackup'],
] as const)('announces %s pending %s beside a decorative spinner and releases the modal on cancellation', async (locale, operation) => {
  const t = backupText(locale), onBusy = vi.fn();
  let finish!: () => void;
  const intent = vi.fn(() => new Promise(resolve => { finish = () => resolve({ ok: true, value: { status: 'cancelled' } }); }));
  const api = { [operation]: intent } as unknown as ReaderApi;
  render(<DataBackups api={api} locale={locale} prepare={async () => true} onBusy={onBusy} />);
  const trigger = screen.getByRole('button', { name: operation === 'createBackup' ? t.create : t.restore });
  trigger.focus();
  await userEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: t.title }), status = within(dialog).getByRole('status');
  expect(status.textContent).toBe(t.running);
  expect(status.querySelector('.acquisition-spinner')?.getAttribute('aria-hidden')).toBe('true');
  expect(within(dialog).queryByRole('progressbar')).toBeNull();
  for (const button of screen.getAllByRole('button')) expect(button.hasAttribute('disabled')).toBe(true);
  const cancel = new Event('cancel', { cancelable: true });
  dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(onBusy).toHaveBeenLastCalledWith(true);
  finish();
  await screen.findByText(t.cancelled);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.querySelector('.acquisition-spinner')).toBeNull();
  expect(trigger.hasAttribute('disabled')).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(onBusy).toHaveBeenLastCalledWith(false);
});
it.each(['en', 'pl'] as const)('shows %s explanations, flushes before intent, acknowledges destination and localizes failure', async locale => {
  const t = backupText(locale), prepare = vi.fn(async () => true), onBusy = vi.fn();
  const api = { createBackup: vi.fn(async () => ({ ok: true, value: { status: 'created', destination: 'D:\\backup.sqlite' } })),
    restoreBackup: vi.fn(async () => ({ ok: false, error: { code: 'NEWER_BACKUP' } })),
  } as unknown as ReaderApi;
  render(<DataBackups api={api} locale={locale} prepare={prepare} onBusy={onBusy} />);
  expect(screen.getByText(t.explanation)).toBeDefined(); expect(screen.getByText(t.privacy)).toBeDefined();
  await userEvent.click(screen.getByRole('button', { name: t.create }));
  await screen.findByText(`${t.created} D:\\backup.sqlite`); expect(prepare).toHaveBeenCalledOnce();
  expect(document.querySelector('dialog')).toBeNull();
  expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.createBackup).mock.invocationCallOrder[0]);
  await userEvent.click(screen.getByRole('button', { name: t.restore })); await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe(t.NEWER_BACKUP);
});
it('blocks snapshot when pending writes fail and keeps the operation modal through restart', async () => {
  const prepare = vi.fn(async () => false), api = { createBackup: vi.fn(async () => ({ ok: true, value: { status: 'restarting' } })) } as unknown as ReaderApi;
  render(<DataBackups api={api} locale="en" prepare={prepare} onBusy={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: backupText('en').create }));
  await screen.findByRole('alert'); expect(api.createBackup).not.toHaveBeenCalled();
  prepare.mockResolvedValueOnce(true);
  await userEvent.click(screen.getByRole('button', { name: backupText('en').create }));
  await waitFor(() => expect(screen.getByRole('dialog').hasAttribute('open')).toBe(true));
  expect(within(screen.getByRole('dialog')).getByRole('status').textContent).toBe(backupText('en').restarting);
  expect(screen.getByRole('button', { name: backupText('en').create }).hasAttribute('disabled')).toBe(true);
});

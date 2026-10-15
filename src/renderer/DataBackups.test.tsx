// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataBackups } from './DataBackups';
import type { ReaderApi } from '../shared/reader-api';
import { backupText } from '../shared/data-backup';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);
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
  expect(screen.getByRole('button', { name: backupText('en').create }).hasAttribute('disabled')).toBe(true);
});

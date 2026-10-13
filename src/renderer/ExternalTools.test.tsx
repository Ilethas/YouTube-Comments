// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExternalTools } from './ExternalTools';
import type { ReaderApi } from '../shared/reader-api';
import type { HelperKind, HelperStatus, HelperRequest } from '../shared/helper-settings';
import { testedHelperVersions } from '../shared/helper-settings';
import { StrictMode } from 'react';

afterEach(cleanup);
function status(kind: HelperKind, change: Partial<HelperStatus> = {}): HelperStatus {
  return { kind, mode: 'PATH', state: 'tested', path: `C:\\tools\\${kind}.exe`, version: testedHelperVersions[kind], testedVersion: testedHelperVersions[kind], ...change };
}
function apiWith(values: Partial<Record<HelperKind, Partial<HelperStatus>>> = {}) {
  return { getHelperStatus: vi.fn(async ({ kind }: HelperRequest) => ({ ok: true, value: status(kind, values[kind]) })),
    chooseHelper: vi.fn(async ({ kind }: HelperRequest) => ({ ok: true, value: status(kind, { mode: 'configured', path: `C:\\my tools\\${kind}.exe` }) })),
    clearHelper: vi.fn(async ({ kind }: HelperRequest) => ({ ok: true, value: status(kind) })),
  } as Pick<ReaderApi, 'getHelperStatus' | 'chooseHelper' | 'clearHelper'> as ReaderApi;
}

it('lazily checks both helpers once, including StrictMode, and ordinary renders/tab activation never re-probe', async () => {
  const api = apiWith();
  const view = render(<StrictMode><ExternalTools api={api} locale="en" active={false} /></StrictMode>);
  expect(api.getHelperStatus).not.toHaveBeenCalled();
  view.rerender(<StrictMode><ExternalTools api={api} locale="en" active /></StrictMode>);
  await screen.findAllByText('Tested version'); expect(api.getHelperStatus).toHaveBeenCalledTimes(2);
  for (const active of [false, true, true]) view.rerender(<StrictMode><ExternalTools api={api} locale="pl" active={active} /></StrictMode>);
  expect(api.getHelperStatus).toHaveBeenCalledTimes(2);
  expect(screen.getAllByText('Przetestowana wersja')).toHaveLength(2);
});

it('shows both helpers, full paths, required/detected versions, Browse and immediate automatic reset', async () => {
  const api = apiWith(); render(<ExternalTools api={api} locale="en" active />);
  const video = within(screen.getByRole('article', { name: 'yt-dlp' }));
  await video.findByText('Tested version');
  expect(screen.getByRole('article', { name: 'post-archiver' })).toBeDefined();
  expect(video.getByText('Detected automatically')).toBeDefined();
  expect(video.getByTitle('C:\\tools\\yt-dlp.exe').textContent).toBe('C:\\tools\\yt-dlp.exe');
  expect(video.getByText(/Tested version: 2026.08.19.*Detected version: 2026.08.19/)).toBeDefined();
  expect(video.getByRole('button', { name: 'Use automatic detection' }).hasAttribute('disabled')).toBe(true);
  await userEvent.click(video.getByRole('button', { name: 'Choose executable…' }));
  expect(api.chooseHelper).toHaveBeenCalledWith({ kind: 'yt-dlp' }); await video.findByText('Custom executable');
  expect(video.getByTitle('C:\\my tools\\yt-dlp.exe')).toBeDefined();
  await userEvent.click(video.getByRole('button', { name: 'Use automatic detection' }));
  expect(api.clearHelper).toHaveBeenCalledWith({ kind: 'yt-dlp' }); await video.findByText('Detected automatically');
  await userEvent.click(video.getByRole('button', { name: 'Recheck' }));
  expect(api.getHelperStatus).toHaveBeenCalledTimes(3);
});

it('cancellation keeps the current display without an alert; invalid/missing selection retains it', async () => {
  const api = apiWith({ 'yt-dlp': { mode: 'configured' } });
  vi.mocked(api.chooseHelper).mockResolvedValueOnce({ ok: true, value: null })
    .mockResolvedValueOnce({ ok: false, error: { code: 'HELPER_UNAVAILABLE' } })
    .mockResolvedValueOnce({ ok: false, error: { code: 'HELPER_UNAVAILABLE' } });
  render(<ExternalTools api={api} locale="en" active />);
  const video = within(screen.getByRole('article', { name: 'yt-dlp' })); await video.findByText('Tested version');
  const browse = video.getByRole('button', { name: 'Choose executable…' });
  await userEvent.click(browse); expect(video.queryByRole('alert')).toBeNull();
  await userEvent.click(browse); expect((await video.findByRole('alert')).textContent).toContain('unavailable or invalid');
  await userEvent.click(browse); expect((await video.findByRole('alert')).textContent).toContain('unavailable or invalid');
  expect(video.getByTitle('C:\\tools\\yt-dlp.exe')).toBeDefined(); expect(video.getByText('Tested version')).toBeDefined();
});

it('environment disables Browse/reset, including invalid overrides, while Recheck remains available', async () => {
  const api = apiWith({ 'yt-dlp': { mode: 'environment', state: 'invalid-path', path: '' }, 'post-archiver': { mode: 'environment', state: 'untested', version: '0.4.1' } });
  render(<ExternalTools api={api} locale="en" active />);
  await screen.findByText('Unavailable / invalid executable'); await screen.findByText('Untested version');
  expect(screen.getAllByText('Controlled by environment')).toHaveLength(2);
  for (const name of ['Choose executable…', 'Use automatic detection']) for (const button of screen.getAllByRole('button', { name })) expect(button.hasAttribute('disabled')).toBe(true);
  for (const button of screen.getAllByRole('button', { name: 'Recheck' })) expect(button.hasAttribute('disabled')).toBe(false);
});

it('Polish presents unavailable/custom/untested states and selection errors', async () => {
  const api = apiWith({ 'yt-dlp': { mode: 'unavailable', state: 'unavailable', path: undefined, version: undefined }, 'post-archiver': { mode: 'configured', state: 'untested', version: '0.4.1' } });
  vi.mocked(api.chooseHelper).mockResolvedValueOnce({ ok: false, error: { code: 'HELPER_UNAVAILABLE' } });
  render(<ExternalTools api={api} locale="pl" active />);
  await screen.findByText('Niedostępny / nieprawidłowy plik wykonywalny'); await screen.findByText('Nieprzetestowana wersja');
  expect(screen.getByText('Własny plik wykonywalny')).toBeDefined();
  await userEvent.click(within(screen.getByRole('article', { name: 'post-archiver' })).getByRole('button', { name: 'Wybierz plik wykonywalny…' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Poprzedni wybór został zachowany'));
});
it.each(['en', 'pl'] as const)('untested %s selection shows a textual warning and both versions while remaining accepted', async locale => {
  const api = apiWith();
  vi.mocked(api.chooseHelper).mockResolvedValueOnce({ ok: true, value: status('yt-dlp', { state: 'untested', version: '2026.10.07', mode: 'configured' }) });
  const { translator } = await import('./i18n'); const t = translator(locale);
  render(<ExternalTools api={api} locale={locale} active />);
  const video = within(screen.getByRole('article', { name: 'yt-dlp' })); await video.findByText(t('helperTested'));
  await userEvent.click(video.getByRole('button', { name: t('helperBrowse') }));
  expect((await video.findByRole('status')).textContent).toBe(t('helperUntested'));
  expect(video.getByText(t('helperUntestedHelp'), { exact: false })).toBeDefined();
  expect(video.getByText(/2026.08.19.*2026.10.07/)).toBeDefined(); expect(video.queryByRole('alert')).toBeNull();
});

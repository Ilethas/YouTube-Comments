// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DownloadJob, DownloadsApi, DownloadsSnapshot } from '../shared/downloads';
import { isDownloadsSnapshot, isSubmitDownloadRequest, isDownloadIdentity } from '../shared/downloads';
import { Downloads, DownloadStatus } from './Downloads';
import { DownloadsReplica, useDownloads } from './use-downloads';
import { translator } from './i18n';

const job: DownloadJob = { operationId: 'job-1', sourceKind: 'youtube-video', sourceId: 'VidDemo_001', kind: 'refresh', itemId: 'item-1',
  label: 'Fictional discussion', state: 'fetching', createdAt: 1000, startedAt: 1000, cancellable: true, comments: { fetched: 1755, estimatedTotal: 8721 } };
const snapshot = (revision: number, jobs: readonly DownloadJob[] = [job]): DownloadsSnapshot => ({ profileEpoch: 'epoch', revision, jobs });
function api(): DownloadsApi {
  return { current: vi.fn(async () => ({ ok: true as const, value: snapshot(0, []) })), onChanged: vi.fn(() => () => undefined),
    submit: vi.fn(async () => ({ ok: true as const, value: { job, reused: false } })), retry: vi.fn(async () => ({ ok: true as const, value: { job, reused: false } })), cancel: vi.fn(async () => ({ ok: true as const, value: null })) };
}
afterEach(cleanup);
it('rejects extra privileged fields, invalid counts, identities, and unbounded snapshots', () => {
  expect(isDownloadsSnapshot(snapshot(1))).toBe(true);
  expect(isSubmitDownloadRequest({ kind: 'acquire', url: 'https://youtu.be/VidDemo_001', executable: '/private' })).toBe(false);
  expect(isDownloadIdentity({ operationId: job.operationId, pid: 10 })).toBe(false);
  for (const extra of [{ stderr: 'private' }, { comments: { fetched: 5, estimatedTotal: 2 } }, { state: 'saving', cancellable: true }, { label: 'private\u0000' }, { startedAt: -1 }])
    expect(isDownloadsSnapshot(snapshot(1, [{ ...job, ...extra } as DownloadJob]))).toBe(false);
  expect(isDownloadsSnapshot(snapshot(1, Array.from({ length: 161 }, () => job)))).toBe(false);
  expect(isDownloadsSnapshot({ ...snapshot(1), privatePath: 'secret' })).toBe(false);
});
it('revision fencing rejects delayed hydration and retired events, including settlement versus retry', () => {
  const model = new DownloadsReplica();
  const newer = snapshot(4, [{ ...job, state: 'cancelled', cancellable: false }, { ...job, operationId: 'retry-2' }]);
  model.accept(newer); expect(model.accept(snapshot(1))).toBe(newer); expect(model.accept(snapshot(3))).toBe(newer);
  const next = { ...snapshot(0, []), profileEpoch: 'new-profile' }; model.accept(next); expect(model.accept(snapshot(100))).toBe(next);
});
it('subscribes before querying; StrictMode hydration cannot overwrite a more recent event', async () => {
  const service = api(), listeners = new Set<(value: DownloadsSnapshot) => void>();
  let resolve!: (value: Awaited<ReturnType<DownloadsApi['current']>>) => void;
  service.onChanged = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  service.current = () => new Promise(done => { resolve = done; });
  function List() { const jobs = useDownloads(service); return <span>{jobs.length ? jobs[0].operationId : 'empty'}</span>; }
  const view = render(<StrictMode><List /></StrictMode>); expect(listeners.size).toBe(1);
  act(() => listeners.forEach(listener => listener(snapshot(2))));
  await act(async () => resolve({ ok: true as const, value: snapshot(0, []) })); expect(screen.getByText(job.operationId)).toBeTruthy();
  view.unmount(); expect(listeners.size).toBe(0);
});
it.each(['en', 'pl'] as const)('shows only active count, localized controls, estimates, Escape and focus restoration in %s', async locale => {
  const t = translator(locale), service = api();
  const jobs = [...Array.from({ length: 3 }, (_, i) => ({ ...job, operationId: `active-${i}` })), ...Array.from({ length: 5 }, (_, i) => ({ ...job, operationId: `queued-${i}`, state: 'queued' as const }))];
  render(<Downloads jobs={jobs} api={service} locale={locale} open={vi.fn()} />);
  const toggle = screen.getByRole('button'); expect(toggle.textContent).toContain('3'); expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle); expect(screen.getByRole('dialog')).toBeTruthy(); expect(document.activeElement).toBe(screen.getByRole('button', { name: t('closeDownloads') }));
  expect(screen.getAllByText(/≈20%/)).toHaveLength(3);
  fireEvent.click(screen.getAllByRole('button', { name: `${t('removeFromQueue')} — ${job.label}` })[0]);
  await waitFor(() => expect(service.cancel).toHaveBeenCalledWith({ operationId: 'queued-0' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(toggle);
});
it('shows empty state without badge; recent jobs offer Retry/Open and no cancellation', async () => {
  const service = api(), open = vi.fn(); const view = render(<Downloads jobs={[]} api={service} locale="en" open={open} />);
  fireEvent.click(screen.getByRole('button')); expect(screen.getByText('No downloads in this session.')).toBeTruthy(); expect(document.querySelector('.downloads-badge')).toBeNull();
  view.rerender(<Downloads jobs={[{ ...job, state: 'failed', cancellable: false }, { ...job, operationId: 'completed', state: 'completed', cancellable: false }]} api={service} locale="en" open={open} />);
  fireEvent.click(screen.getByRole('button', { name: `Retry — ${job.label}` })); await waitFor(() => expect(service.retry).toHaveBeenCalledWith({ operationId: job.operationId }));
  fireEvent.click(screen.getByRole('button', { name: 'Open stored discussion' })); expect(open).toHaveBeenCalledWith('item-1'); expect(screen.queryByRole('dialog')).toBeNull();
});
it('local discussion status reflects queued and processing states without estimating completeness', () => {
  const view = render(<DownloadStatus job={{ ...job, state: 'queued' }} locale="en" />); expect(screen.getByText('Refresh queued')).toBeTruthy();
  view.rerender(<DownloadStatus job={{ ...job, state: 'processing' }} locale="en" />); expect(document.body.textContent).toContain('Processing'); expect(document.body.textContent).not.toContain('%');
});

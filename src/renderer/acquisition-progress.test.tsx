// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AcquisitionProgressState, useAcquisitionProgress } from './use-acquisition-progress';
import { AcquisitionStatus } from './AcquisitionStatus';
import type { AcquisitionNotification, AcquisitionProgress } from '../shared/acquisition';
import type { ReaderApi } from '../shared/reader-api';
const progress: AcquisitionProgress = { operationId: 'first', kind: 'refresh', sourceKind: 'youtube-video',
  itemId: 'item-id', stage: 'fetching', startedAt: 1000, cancellable: true };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it.each(['checking-helper', 'preparing', 'fetching', 'processing', 'saving'] as const)('uses a compact decorative spinner and textual status during %s', stage => {
  render(<AcquisitionStatus progress={{ ...progress, stage, cancellable: stage !== 'saving' }} locale="en" cancel={vi.fn()} />);
  expect(document.querySelector('.acquisition-spinner')?.getAttribute('aria-hidden')).toBe('true');
  expect(screen.getByRole('status').textContent).toBeTruthy(); expect(screen.queryByRole('progressbar')).toBeNull();
  expect(!!screen.queryByRole('button', { name: 'Cancel' })).toBe(stage !== 'saving');
});
it('settlement retires IDs and late old progress cannot replace a new run', () => {
  const state = new AcquisitionProgressState();
  expect(state.accept(progress)).toBe(progress);
  expect(state.accept({ operationId: 'first', settled: true })).toBeNull();
  expect(state.accept(progress)).toBeNull();
  const next = { ...progress, operationId: 'second' };
  state.accept(next);
  expect(state.accept(progress)).toBe(next);
  expect(state.accept({ operationId: 'first', settled: true })).toBe(next);
  expect(state.accept({ operationId: 'second', settled: true })).toBeNull();
});
it.each(['en', 'pl'] as const)('shows localized fetched counts, estimated totals and approximate percentages in %s', locale => {
  const view = render(<AcquisitionStatus progress={{ ...progress, comments: { fetched: 1755, estimatedTotal: 8721 } }} locale={locale} cancel={vi.fn()} />);
  const number = new Intl.NumberFormat(locale);
  expect(screen.getByRole('status').textContent).toContain(`${number.format(1755)} / ~${number.format(8721)} (≈20%)`);
  view.rerender(<AcquisitionStatus progress={{ ...progress, comments: { fetched: 9000 } }} locale={locale} cancel={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain(number.format(9000));
  expect(screen.getByRole('status').textContent).not.toContain('%');
  view.rerender(<AcquisitionStatus progress={{ ...progress, comments: { fetched: 9000, estimatedTotal: 9000 } }} locale={locale} cancel={vi.fn()} />);
  expect(screen.getByRole('status').textContent).toContain('≈99%');
  expect(screen.getByRole('status').textContent).not.toContain('100%');
  view.rerender(<AcquisitionStatus progress={progress} locale={locale} cancel={vi.fn()} />);
  expect(screen.getByRole('status').textContent).not.toContain('%');
  expect(document.querySelector('.acquisition-spinner')).toBeTruthy();
  expect(screen.getByRole('button')).toBeTruthy();
});
it('StrictMode and rerender maintain one subscription; snapshot cannot overtake newer events', async () => {
  const listeners = new Set<(value: AcquisitionNotification) => void>();
  let snapshot!: (value: Awaited<ReturnType<ReaderApi['getAcquisitionProgress']>>) => void;
  const api = { onAcquisitionProgress: (listener: (value: AcquisitionNotification) => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  }, getAcquisitionProgress: () => new Promise(resolve => { snapshot = resolve; }) } as ReaderApi;
  function Status() { const value = useAcquisitionProgress(api); return <div>{value?.operationId ?? 'idle'}</div>; }
  const view = render(<StrictMode><Status /></StrictMode>);
  expect(listeners.size).toBe(1);
  act(() => listeners.forEach(listener => listener(progress)));
  expect(screen.getByText('first')).toBeTruthy();
  await act(async () => snapshot({ ok: true, value: { ...progress, operationId: 'stale-snapshot' } }));
  expect(screen.getByText('first')).toBeTruthy();
  view.rerender(<StrictMode><Status /></StrictMode>); expect(listeners.size).toBe(1);
  view.unmount(); expect(listeners.size).toBe(0);
});
it('elapsed uses a local monotonic timer; Cancel disappears after saving or updating view', async () => {
  vi.useFakeTimers(); vi.setSystemTime(9000);
  let mono = 0; vi.spyOn(performance, 'now').mockImplementation(() => mono);
  const cancel = vi.fn(async () => undefined);
  const view = render(<AcquisitionStatus progress={progress} locale="en" cancel={cancel} />);
  expect(screen.getByLabelText('Elapsed time').textContent).toBe('00:08');
  expect(document.querySelector('.acquisition-spinner')).toBeTruthy();
  expect(screen.queryByRole('progressbar')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => { mono = 2000; vi.setSystemTime(1000000); await vi.advanceTimersByTimeAsync(250); });
  expect(screen.getByLabelText('Elapsed time').textContent).toBe('00:10');
  view.rerender(<AcquisitionStatus progress={{ ...progress, stage: 'saving', cancellable: false }} locale="pl" cancel={cancel} />);
  expect(screen.getByText('Zapisywanie')).toBeTruthy(); expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<AcquisitionStatus progress={progress} updating locale="en" cancel={cancel} />);
  expect(screen.getByText('Updating view…')).toBeTruthy(); expect(screen.queryByRole('button')).toBeNull();
});

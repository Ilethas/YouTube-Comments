// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { required } from './testing/required';
import { Notification, useNotification } from './Notification';
import { notificationDurations } from '../shared/preferences';
import type { NotificationDismissal, NotificationDuration } from '../shared/preferences';

let controller: ReturnType<typeof useNotification<string>>;
function Harness({ mode = 'automatic', seconds = 5 }: { mode?: NotificationDismissal; seconds?: NotificationDuration }) {
  controller = useNotification<string>();
  return <><button>Reader control</button><Notification notification={controller.notification} message={controller.notification?.message ?? ''}
    mode={mode} seconds={seconds} closeLabel="Dismiss notification" dismiss={controller.dismiss} /></>;
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each(notificationDurations)('dismisses success after exactly %i seconds, even in StrictMode', seconds => {
  render(<StrictMode><Harness seconds={seconds} /></StrictMode>);
  act(() => { controller.show('Moved', 'success'); });
  advance(seconds * 1000 - 1); expect(screen.getByRole('status').textContent).toBe('Moved');
  advance(1); expect(screen.getByRole('status').textContent).toBe(''); expect(screen.queryByRole('button', { name: 'Dismiss notification' })).toBeNull();
});
it('retains manual success, errors and pending operations; dismissal never moves focus', () => {
  const { rerender } = render(<Harness mode="manual" />);
  act(() => { controller.show('Manual', 'success'); }); advance(100000); expect(screen.getByRole('status').textContent).toBe('Manual');
  rerender(<Harness />);
  for (const kind of ['pending', 'error'] as const) {
    act(() => { controller.show(kind, kind); }); advance(100000); expect(screen.getByRole('status').textContent).toBe(kind);
    const origin = screen.getByRole('button', { name: 'Reader control' }); origin.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.getByRole('status').textContent).toBe(''); expect(document.activeElement).toBe(origin);
  }
});
it('pauses the remaining duration for hover and focus, including overlapping pauses', () => {
  render(<Harness />); act(() => { controller.show('Moved', 'success'); }); advance(2000);
  const overlay = required(screen.getByRole('status').parentElement);
  fireEvent.mouseEnter(overlay); advance(20000);
  act(() => screen.getByRole('button', { name: 'Dismiss notification' }).focus());
  fireEvent.mouseLeave(overlay); advance(20000); expect(screen.getByRole('status').textContent).toBe('Moved');
  act(() => screen.getByRole('button', { name: 'Reader control' }).focus());
  advance(2999); expect(screen.getByRole('status').textContent).toBe('Moved'); advance(1); expect(screen.getByRole('status').textContent).toBe('');
});
it('protects replacements from stale timers, dismissals and operation completions with one bounded slot', () => {
  render(<Harness />);
  let old!: number;
  act(() => { old = controller.show('Old', 'success'); }); advance(4999);
  act(() => { controller.show('New', 'success'); });
  act(() => { controller.dismiss(old); controller.settle(old, 'Stale failure', 'error'); });
  advance(1); expect(screen.getByRole('status').textContent).toBe('New'); expect(screen.getAllByRole('status')).toHaveLength(1);
  advance(4999); expect(screen.getByRole('status').textContent).toBe('');
});
it('settles dismissed pending operations into fresh success or persistent failure', () => {
  render(<Harness />);
  for (const kind of ['success', 'error'] as const) {
    let pending!: number;
    act(() => { pending = controller.show('Pending', 'pending'); }); advance(60000);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    act(() => controller.settle(pending, kind, kind)); expect(screen.getByRole('status').textContent).toBe(kind);
    advance(5000); expect(screen.getByRole('status').textContent).toBe(kind === 'error' ? 'error' : '');
  }
});
it('applies mode/duration changes to the current notification without re-announcing it', () => {
  const { rerender } = render(<Harness />); act(() => { controller.show('Moved', 'success'); });
  const region = screen.getByRole('status');
  const changed = vi.fn(), observer = new MutationObserver(changed); observer.observe(region, { childList: true, characterData: true, subtree: true });
  advance(4000); rerender(<Harness mode="manual" seconds={3} />); advance(60000);
  expect(region.textContent).toBe('Moved'); rerender(<Harness seconds={3} />); advance(2999); expect(region.textContent).toBe('Moved');
  expect(changed).not.toHaveBeenCalled(); observer.disconnect(); advance(1); expect(region.textContent).toBe('');
});
it('has one stable polite atomic live region and a separately named keyboard close control', async () => {
  vi.useRealTimers(); const user = userEvent.setup(); render(<Harness mode="manual" />);
  const region = screen.getByRole('status'); expect(region.getAttribute('aria-live')).toBe('polite'); expect(region.getAttribute('aria-atomic')).toBe('true');
  act(() => { controller.show('Moved', 'success'); });
  const close = screen.getByRole('button', { name: 'Dismiss notification' }); expect(region.contains(close)).toBe(false);
  await user.tab(); await user.tab(); expect(document.activeElement).toBe(close); await user.keyboard('{Enter}');
  expect(screen.getByRole('status')).toBe(region); expect(region.textContent).toBe('');
  expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Reader control' }));
});

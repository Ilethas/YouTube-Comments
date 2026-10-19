// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProfileProgress } from './use-profile-progress';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
it('quick operations never present progress; long operations do after 180ms', () => {
  const ui = renderHook(({ busy, id }) => useProfileProgress(busy, id, false), { initialProps: { busy: true, id: 'a' } });
  advance(179); expect(ui.result.current).toBe(false);
  ui.rerender({ busy: false, id: 'a' }); advance(200); expect(ui.result.current).toBe(false);
  ui.rerender({ busy: true, id: 'b' }); advance(179); expect(ui.result.current).toBe(false);
  advance(1); expect(ui.result.current).toBe(true);
  ui.rerender({ busy: false, id: 'b' }); expect(ui.result.current).toBe(false);
});
it('rapid operation identities fence earlier timers even if busy never rendered false', () => {
  const ui = renderHook(({ id }) => useProfileProgress(true, id, false), { initialProps: { id: 'a' } });
  advance(170); ui.rerender({ id: 'b' }); advance(10); expect(ui.result.current).toBe(false);
  advance(170); expect(ui.result.current).toBe(true);
  ui.rerender({ id: 'c' }); expect(ui.result.current).toBe(false);
  ui.unmount(); expect(vi.getTimerCount()).toBe(0);
});
it('failed reconciliation is immediately visible and successful release hides it', () => {
  const ui = renderHook(({ busy, failed }) => useProfileProgress(busy, 'a', failed), { initialProps: { busy: true, failed: false } });
  ui.rerender({ busy: true, failed: true }); expect(ui.result.current).toBe(true);
  ui.rerender({ busy: false, failed: false }); expect(ui.result.current).toBe(false);
  advance(200); expect(ui.result.current).toBe(false);
});

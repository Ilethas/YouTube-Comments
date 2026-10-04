// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceTabs } from './WorkspaceTabs';
import { discussionTab } from '../domain/workspace';
import type { WorkspaceState } from '../domain/workspace';

const workspace: WorkspaceState = { tabs: [discussionTab('a'), { id: 'library', kind: 'library' }, { id: 'settings', kind: 'settings' }, discussionTab('b')], activeTabId: 'library', revision: 2 };
const move = vi.fn(), activate = vi.fn(), close = vi.fn();
function show() { render(<WorkspaceTabs workspace={workspace} locale="en" disabled={false}
  label={tab => tab.kind === 'discussion' ? tab.itemId : tab.kind} icon={tab => tab.kind === 'discussion' ? 'video' : tab.kind}
  move={move} activate={activate} close={close} />); }
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true;
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('localized icon labels and separate close controls coexist with keyboard reordering and navigation', () => {
  show();
  const library = screen.getByRole('tab', { name: 'Library: library' });
  fireEvent.keyDown(library, { key: 'ArrowLeft', altKey: true }); expect(move).toHaveBeenLastCalledWith('library', 0);
  expect(activate).not.toHaveBeenCalled();
  fireEvent.keyDown(library, { key: 'ArrowRight', altKey: true }); expect(move).toHaveBeenLastCalledWith('library', 2);
  fireEvent.keyDown(library, { key: 'End' }); expect(activate).toHaveBeenLastCalledWith('discussion:b', true);
  fireEvent.keyDown(library, { key: 'Home' }); expect(activate).toHaveBeenLastCalledWith('discussion:a', true);
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: library' })); expect(close).toHaveBeenCalledWith('library');
  expect(screen.getByRole('tab', { name: 'Video: a' }).querySelector('svg[aria-hidden=true]')).toBeTruthy();
});
it.each(['discussion:a', 'library', 'settings', 'discussion:b'])('pointer drag previews %s and persists only final order once', id => {
  show();
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.tab'));
  rows.forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => ({ left: index * 100, width: 100 } as DOMRect)));
  const tab = document.getElementById(`tab-${id}`);
  if (!tab) throw new Error('Missing tab');
  const from = workspace.tabs.findIndex(tab => tab.id === id), target = from === 3 ? 0 : 3;
  fireEvent.pointerDown(tab, { button: 0, clientX: from * 100 + 20 });
  fireEvent.pointerMove(tab, { clientX: target ? 800 : -10 });
  expect(move).not.toHaveBeenCalled();
  expect(document.querySelector('[data-dragging=true]')).toBeTruthy();
  fireEvent.pointerUp(tab);
  expect(move).toHaveBeenCalledTimes(1); expect(move).toHaveBeenCalledWith(id, target);
  expect(activate).not.toHaveBeenCalled();
});
it('pointer cancel and motion under the threshold do not write order', () => {
  show(); const tab = screen.getByRole('tab', { name: 'Library: library' });
  fireEvent.pointerDown(tab, { button: 0, clientX: 20 }); fireEvent.pointerMove(tab, { clientX: 23 }); fireEvent.pointerUp(tab);
  expect(move).not.toHaveBeenCalled();
  fireEvent.pointerDown(tab, { button: 0, clientX: 20 }); fireEvent.pointerMove(tab, { clientX: 100 }); fireEvent.pointerCancel(tab);
  expect(move).not.toHaveBeenCalled();
});

it('the stable strip captures, survives child movement/lost capture, and commits once outside the original tab', () => {
  show();
  const tab = screen.getByRole('tab', { name: 'Library: library' }), strip = screen.getByRole('tablist');
  document.querySelectorAll<HTMLElement>('.tab').forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: index * 100, width: 100 } as DOMRect));
  fireEvent.pointerDown(tab, { button: 0, clientX: 120 });
  expect(strip.setPointerCapture).toHaveBeenCalledTimes(1);
  expect(vi.mocked(strip.setPointerCapture).mock.instances[0]).toBe(strip);
  fireEvent.pointerMove(strip, { clientX: 800, clientY: 600 });
  expect(Array.from(document.querySelectorAll<HTMLElement>('.tab'), row => row.dataset.tabId).at(-1)).toBe('library');
  fireEvent.lostPointerCapture(tab);
  expect(document.querySelector('[data-dragging=true]')).toBeTruthy();
  fireEvent.pointerMove(strip, { clientX: -300, clientY: 600 });
  expect(document.querySelector<HTMLElement>('.tab')?.dataset.tabId).toBe('library');
  fireEvent.pointerMove(strip, { clientX: 800, clientY: 30 });
  fireEvent.pointerUp(strip, { button: 0 });
  fireEvent.pointerUp(strip, { button: 0 });
  fireEvent.lostPointerCapture(strip);
  fireEvent.click(tab, { detail: 1 });
  expect(move).toHaveBeenCalledExactlyOnceWith('library', 3);
  expect(activate).not.toHaveBeenCalled();
  expect(strip.releasePointerCapture).toHaveBeenCalledTimes(1);
});

it.each(['escape', 'pointercancel', 'capture-loss', 'blur', 'pagehide'])('%s cancels capture without persisting or activating', reason => {
  show(); const tab = screen.getByRole('tab', { name: 'Library: library' }), strip = screen.getByRole('tablist');
  fireEvent.pointerDown(tab, { button: 0, clientX: 20 });
  fireEvent.pointerMove(strip, { clientX: 200, clientY: 300 });
  if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' });
  else if (reason === 'pointercancel') fireEvent.pointerCancel(strip);
  else if (reason === 'capture-loss') fireEvent.lostPointerCapture(strip);
  else fireEvent(window, new Event(reason));
  fireEvent.pointerUp(strip, { button: 0 }); fireEvent.click(tab, { detail: 1 });
  expect(move).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  expect(document.querySelector('[data-dragging=true]')).toBeNull();
});

it('a captured ordinary press activates exactly once and does not reorder', () => {
  show(); const tab = screen.getByRole('tab', { name: 'Library: library' }), strip = screen.getByRole('tablist');
  fireEvent.pointerDown(tab, { button: 0, clientX: 20 });
  fireEvent.pointerUp(strip, { button: 0 }); fireEvent.click(tab, { detail: 1 });
  expect(activate).toHaveBeenCalledExactlyOnceWith('library'); expect(move).not.toHaveBeenCalled();
});

function wheelStrip(scrollWidth = 1000, clientWidth = 400, scrollLeft = 100) {
  show(); const strip = screen.getByRole('tablist');
  Object.defineProperties(strip, { scrollWidth: { configurable: true, value: scrollWidth }, clientWidth: { configurable: true, value: clientWidth } });
  strip.scrollLeft = scrollLeft;
  return strip;
}
it.each([{ deltaY: 70 }, { deltaX: 70 }, { deltaX: 70, deltaY: 12 }])('overflowing wheel scrolls immediately using the dominant axis: %j', delta => {
  const strip = wheelStrip();
  expect(fireEvent.wheel(strip, { ...delta, cancelable: true })).toBe(false);
  expect(strip.scrollLeft).toBe(170);
  expect(move).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  expect(screen.getByRole('tab', { name: 'Library: library' }).getAttribute('aria-selected')).toBe('true');
  expect(Array.from(document.querySelectorAll<HTMLElement>('.tab'), row => row.dataset.tabId)).toEqual(workspace.tabs.map(tab => tab.id));
});
it('no overflow leaves wheel unconsumed', () => {
  const strip = wheelStrip(400, 400, 0);
  expect(fireEvent.wheel(strip, { deltaY: 100, cancelable: true })).toBe(true);
  expect(strip.scrollLeft).toBe(0);
});
it('edges pass through outward wheel motion, clamp partial motion, and allow inward scrolling', () => {
  const strip = wheelStrip(1000, 400, 0);
  expect(fireEvent.wheel(strip, { deltaY: -80, cancelable: true })).toBe(true);
  expect(fireEvent.wheel(strip, { deltaY: 1000, cancelable: true })).toBe(false);
  expect(strip.scrollLeft).toBe(600);
  expect(fireEvent.wheel(strip, { deltaX: 80, cancelable: true })).toBe(true);
  expect(fireEvent.wheel(strip, { deltaY: -30, cancelable: true })).toBe(false);
  expect(strip.scrollLeft).toBe(570);
});
it('line/page wheel units are normalized and Ctrl-wheel is left to the browser', () => {
  const strip = wheelStrip();
  fireEvent.wheel(strip, { deltaY: 2, deltaMode: 1, cancelable: true }); expect(strip.scrollLeft).toBe(132);
  fireEvent.wheel(strip, { deltaY: 1, deltaMode: 2, cancelable: true }); expect(strip.scrollLeft).toBe(532);
  expect(fireEvent.wheel(strip, { deltaY: 30, ctrlKey: true, cancelable: true })).toBe(true);
  expect(strip.scrollLeft).toBe(532);
});

it('other pointers and secondary releases cannot finish the owning primary drag', () => {
  show(); const tab = screen.getByRole('tab', { name: 'Library: library' }), strip = screen.getByRole('tablist');
  fireEvent.pointerDown(tab, { button: 0, clientX: 20, pointerId: 4 });
  fireEvent.pointerMove(strip, { clientX: 200, pointerId: 4 });
  fireEvent.pointerUp(strip, { button: 0, pointerId: 7 });
  fireEvent.pointerCancel(strip, { pointerId: 7 });
  fireEvent.pointerUp(strip, { button: 2, pointerId: 4 });
  expect(document.querySelector('[data-dragging=true]')).toBeTruthy();
  expect(move).not.toHaveBeenCalled();
  fireEvent.pointerUp(strip, { button: 0, pointerId: 4 });
  expect(move).toHaveBeenCalledTimes(1);
});
it('wheel during a captured drag scrolls without committing; release still persists once', () => {
  const strip = wheelStrip(); const tab = screen.getByRole('tab', { name: 'Library: library' });
  fireEvent.pointerDown(tab, { button: 0, clientX: 20 });
  fireEvent.pointerMove(strip, { clientX: 200, clientY: 300 });
  fireEvent.wheel(strip, { deltaY: 80, cancelable: true });
  expect(strip.scrollLeft).toBe(180);
  expect(move).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  fireEvent.pointerUp(strip, { button: 0 }); expect(move).toHaveBeenCalledTimes(1);
});
it('Escape suppression lasts until delayed release; keyboard clicks and a fresh press still activate', async () => {
  show(); const tab = screen.getByRole('tab', { name: 'Library: library' }), strip = screen.getByRole('tablist');
  fireEvent.pointerDown(tab, { button: 0, clientX: 20 });
  fireEvent.pointerMove(strip, { clientX: 200 });
  fireEvent.keyDown(document, { key: 'Escape' });
  await new Promise(resolve => setTimeout(resolve, 10));
  fireEvent.pointerUp(strip, { button: 0 }); fireEvent.click(tab, { detail: 1 });
  expect(activate).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled();
  fireEvent.click(tab, { detail: 0 }); expect(activate).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(tab, { button: 0, clientX: 20 }); fireEvent.pointerUp(strip, { button: 0 });
  fireEvent.click(tab, { detail: 1 }); expect(activate).toHaveBeenCalledTimes(2);
  const closeButton = screen.getByRole('button', { name: 'Close tab: library' });
  fireEvent.pointerDown(closeButton, { button: 0 }); fireEvent.click(closeButton, { detail: 1 });
  expect(close).toHaveBeenCalledExactlyOnceWith('library');
});

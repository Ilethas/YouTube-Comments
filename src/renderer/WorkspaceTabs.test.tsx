const discussionTab = (itemId: string) => instanceTab(`test-view-${itemId}`, itemId);
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TAB_DRAG_MIME } from '../shared/tab-transfer';
import type { TabTransferApi, TransferEvent } from '../shared/tab-transfer';
import { required } from './testing/required';
import { WorkspaceTabs } from './WorkspaceTabs';
import { discussionTab as instanceTab } from '../domain/workspace';
import type { WorkspaceState } from '../domain/workspace';

const workspace: WorkspaceState = { tabs: [discussionTab('a'), { id: 'library', kind: 'library' }, { id: 'settings', kind: 'settings' }, discussionTab('b')], activeTabId: 'library', revision: 2 };
const move = vi.fn(), activate = vi.fn(), close = vi.fn();
const token = '00000000-0000-4000-8000-000000000001';
const listeners = new Set<(event: TransferEvent) => void>();
const emit = (event: TransferEvent) => listeners.forEach(listener => listener(event));
const dragApi = {
  prepareDrag: vi.fn(async () => ({ ok: true, value: { token, gestureId: token } })),
  startDrag: vi.fn(async () => { emit({ kind: 'drag-started', token }); return { ok: true, value: null }; }),
  cancel: vi.fn(async () => ({ ok: true, value: null })),
  endDrag: vi.fn(async () => ({ ok: true, value: null })),
  hoverDrag: vi.fn(async () => ({ ok: true, value: null })),
  offerDrag: vi.fn(async () => ({ ok: true, value: null })),
  onEvent: (listener: (event: TransferEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
} as unknown as TabTransferApi;
function show() { render(<WorkspaceTabs workspace={workspace} locale="en" disabled={false} dragApi={dragApi}
  label={tab => tab.kind === 'discussion' ? tab.itemId : tab.kind} icon={tab => tab.kind === 'discussion' ? 'video' : tab.kind}
  move={move} activate={activate} close={close} />); }
beforeEach(() => {
  vi.clearAllMocks(); listeners.clear();
  vi.stubGlobal('DragEvent', class extends MouseEvent {
    readonly dataTransfer: DataTransfer | null;
    constructor(type: string, init: DragEventInit = {}) { super(type, init); this.dataTransfer = init.dataTransfer ?? null; }
  });
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
  fireEvent.keyDown(library, { key: 'End' }); expect(activate).toHaveBeenLastCalledWith('test-view-b', true);
  fireEvent.keyDown(library, { key: 'Home' }); expect(activate).toHaveBeenLastCalledWith('test-view-a', true);
  fireEvent.click(screen.getByRole('button', { name: 'Close tab: library' })); expect(close).toHaveBeenCalledWith('library');
  expect(screen.getByRole('tab', { name: 'Video: a' }).querySelector('svg[aria-hidden=true]')).toBeTruthy();
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

it.each(['en', 'pl'] as const)('discussion-only duplication is discoverable by pointer and keyboard in %s', locale => {
  const duplicate = vi.fn();
  render(<WorkspaceTabs workspace={workspace} locale={locale} disabled={false} duplicate={duplicate}
    label={tab => tab.kind === 'discussion' ? tab.itemId : tab.kind} icon={tab => tab.kind === 'discussion' ? 'video' : tab.kind} move={move} activate={activate} close={close} />);
  for (const kind of ['library', 'settings']) {
    const tab = document.getElementById('tab-' + kind); if (!tab) throw new Error('Missing singleton');
    fireEvent.contextMenu(tab); fireEvent.keyDown(tab, { key: 'F10', shiftKey: true }); expect(screen.queryByRole('menu')).toBeNull();
  }
  const source = document.getElementById('tab-test-view-a'); if (!source) throw new Error('Missing source');
  fireEvent.keyDown(source, { key: 'F10', shiftKey: true });
  const command = screen.getByRole('menuitem', { name: locale === 'en' ? 'Duplicate Tab' : 'Duplikuj kart\u0119' });
  expect(document.activeElement).toBe(command); fireEvent.keyDown(command, { key: 'Enter' });
  expect(duplicate).toHaveBeenLastCalledWith('test-view-a');
  fireEvent.contextMenu(source); fireEvent.click(screen.getByRole('menuitem')); expect(duplicate).toHaveBeenCalledTimes(2);
  expect(activate).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled();
});

function dataStore(types = [TAB_DRAG_MIME], value = token) {
  let stored = value;
  return { types, effectAllowed: 'none', dropEffect: 'none', clearData: vi.fn(), setData: vi.fn((_type: string, data: string) => { stored = data; }), getData: vi.fn(() => stored) };
}
async function start(id = 'library') {
  const tab = required(document.getElementById(`tab-${id}`));
  await act(async () => { fireEvent.pointerDown(tab, { button: 0, clientX: 20 }); });
  const dataTransfer = dataStore(); fireEvent.dragStart(tab, { dataTransfer });
  return { tab, strip: screen.getByRole('tablist'), dataTransfer };
}
it.each(['test-view-a', 'library', 'settings', 'test-view-b'])('native drag previews %s and persists one final reorder without activation or capture', async id => {
  show();
  document.querySelectorAll<HTMLElement>('.tab').forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: index * 100, width: 100 } as DOMRect));
  const { tab, strip, dataTransfer } = await start(id), target = id === 'test-view-b' ? 0 : 3, clientX = target ? 800 : -10;
  fireEvent.dragOver(strip, { clientX, dataTransfer });
  expect(move).not.toHaveBeenCalled(); expect(document.querySelector('[data-dragging=true]')).toBeTruthy();
  expect(Array.from(document.querySelectorAll<HTMLElement>('.tab'), row => row.dataset.tabId)).toEqual(workspace.tabs.map(t => t.id));
  await act(async () => { fireEvent.drop(strip, { clientX, dataTransfer }); fireEvent.dragEnd(tab, { dataTransfer }); fireEvent.dragEnd(tab, { dataTransfer }); });
  expect(move).toHaveBeenCalledExactlyOnceWith(id, target); expect(activate).not.toHaveBeenCalled();
  expect(strip.setPointerCapture).not.toHaveBeenCalled(); expect(dragApi.endDrag).toHaveBeenCalledExactlyOnceWith({ token, outcome: 'local' });
  expect(dataTransfer.setData).toHaveBeenCalledExactlyOnceWith(TAB_DRAG_MIME, token);
});
it('too-fast dragstart cancels synchronously and late preparation cannot revive it; ordinary clicks work', async () => {
  show(); const tab = required(document.getElementById('tab-library')), dataTransfer = dataStore();
  fireEvent.pointerDown(tab, { button: 0 });
  expect(fireEvent.dragStart(tab, { dataTransfer })).toBe(false);
  await act(async () => undefined);
  expect(dataTransfer.setData).not.toHaveBeenCalled(); expect(dragApi.cancel).toHaveBeenCalledWith({ token });
  fireEvent.pointerUp(tab); fireEvent.click(tab, { detail: 1 }); expect(activate).toHaveBeenCalledExactlyOnceWith('library');
});
it('no-op local drop does not call the SQL reorder lane', async () => {
  show(); document.querySelectorAll<HTMLElement>('.tab').forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: index * 100, width: 100 } as DOMRect));
  const { strip, dataTransfer } = await start(); fireEvent.dragOver(strip, { clientX: 190, dataTransfer }); fireEvent.drop(strip, { clientX: 190, dataTransfer });
  expect(move).not.toHaveBeenCalled(); expect(dragApi.offerDrag).not.toHaveBeenCalled();
});
it.each(['Escape', 'pagehide', 'visibility'])('%s explicitly cancels and duplicate end cannot detach; keyboard clicks still work', async reason => {
  show(); const { tab, dataTransfer } = await start();
  if (reason === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
  else if (reason === 'pagehide') fireEvent(window, new Event('pagehide'));
  else { const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); fireEvent(document, new Event('visibilitychange')); spy.mockRestore(); }
  fireEvent.dragEnd(tab, { dataTransfer }); fireEvent.click(tab, { detail: 1 });
  expect(dragApi.endDrag).not.toHaveBeenCalled(); expect(move).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  fireEvent.click(tab, { detail: 0 }); expect(activate).toHaveBeenCalledOnce();
});
it('native pointercancel and source blur do not cancel an ongoing cross-window drag', async () => {
  show(); const { tab, strip, dataTransfer } = await start();
  fireEvent.pointerCancel(strip); fireEvent.blur(window); fireEvent.dragEnd(tab, { dataTransfer }); fireEvent.dragEnd(tab, { dataTransfer });
  expect(dragApi.cancel).not.toHaveBeenCalled(); expect(dragApi.endDrag).toHaveBeenCalledExactlyOnceWith({ token, outcome: 'unclaimed' });
});
it.each([{ types: ['text/plain'] }, { types: ['Files'] }, { types: ['text/uri-list'] }, { types: [TAB_DRAG_MIME] }])('external or forged $types data cannot move a local tab', ({ types }) => {
  show(); const strip = screen.getByRole('tablist'), dataTransfer = dataStore(types, 'forged');
  expect(fireEvent.dragOver(strip, { dataTransfer })).toBe(true); fireEvent.drop(strip, { dataTransfer });
  expect(move).not.toHaveBeenCalled(); expect(dragApi.offerDrag).not.toHaveBeenCalled();
});
it('recipient hover reads no payload, drop binds the exact neighbor and revision', () => {
  show(); document.querySelectorAll<HTMLElement>('.tab').forEach((row, index) => vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: index * 100, width: 100 } as DOMRect));
  act(() => emit({ kind: 'drag-started', token })); const strip = screen.getByRole('tablist'), dataTransfer = dataStore();
  fireEvent.dragOver(strip, { clientX: 220, dataTransfer }); expect(dataTransfer.getData).not.toHaveBeenCalled();
  expect(document.querySelector('[data-insert-before=true]')?.getAttribute('data-tab-id')).toBe('settings');
  fireEvent.drop(strip, { clientX: 220, dataTransfer }); expect(dragApi.offerDrag).toHaveBeenCalledExactlyOnceWith({ token, expectedRevision: 2, beforeTabId: 'settings' });
});
it('nested hover leave does not clear current app evidence and old gesture clear cannot reset a newer one', () => {
  show(); const strip = screen.getByRole('tablist'), dataTransfer = dataStore(); act(() => emit({ kind: 'drag-started', token }));
  fireEvent.dragEnter(strip, { dataTransfer }); fireEvent.dragEnter(required(strip.firstElementChild), { dataTransfer }); fireEvent.dragLeave(required(strip.firstElementChild), { dataTransfer });
  expect(dragApi.hoverDrag).toHaveBeenCalledTimes(1); fireEvent.dragLeave(strip, { dataTransfer });
  expect(dragApi.hoverDrag).toHaveBeenLastCalledWith({ gestureId: token, sequence: 2, inside: false });
  const next = '00000000-0000-4000-8000-000000000002'; act(() => { emit({ kind: 'drag-started', token: next }); emit({ kind: 'drag-cleared', token }); });
  fireEvent.dragEnter(strip, { dataTransfer }); expect(dragApi.hoverDrag).toHaveBeenLastCalledWith({ gestureId: next, sequence: 1, inside: true });
});
it.each([1, 2])('button %s and nonprimary initiation cannot prepare a drag', button => {
  show(); const tab = required(document.getElementById('tab-library')); fireEvent.pointerDown(tab, { button }); fireEvent.dragStart(tab, { dataTransfer: dataStore() });
  fireEvent.pointerDown(tab, { button: 0, isPrimary: false }); expect(dragApi.prepareDrag).not.toHaveBeenCalled();
});

it('a rejected start reply from an earlier generation cannot cancel a rapid newer drag', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(dragApi.startDrag).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  show(); await start(); await start('settings');
  await act(async () => { reject(Error('old start failed')); });
  expect(document.querySelector('[data-dragging=true]')?.getAttribute('data-tab-id')).toBe('settings');
});
it('disabled and hidden recipient strips cannot accept a drop', () => {
  const props = { workspace, locale: 'en' as const, label: () => 'Title', icon: () => 'video' as const, move, activate, close, dragApi };
  const ui = render(<WorkspaceTabs {...props} disabled />), dataTransfer = dataStore();
  act(() => emit({ kind: 'drag-started', token })); fireEvent.dragOver(screen.getByRole('tablist'), { dataTransfer }); fireEvent.drop(screen.getByRole('tablist'), { dataTransfer });
  expect(dragApi.offerDrag).not.toHaveBeenCalled();
  ui.rerender(<WorkspaceTabs {...props} disabled={false} />);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); fireEvent.drop(screen.getByRole('tablist'), { dataTransfer }); expect(dragApi.offerDrag).not.toHaveBeenCalled();
});

it('a delayed dragend with an old data store cannot terminate a newer drag of the same tab', async () => {
  const nextToken = '00000000-0000-4000-8000-000000000002';
  vi.mocked(dragApi.prepareDrag).mockResolvedValueOnce({ ok: true, value: { token, gestureId: token } }).mockResolvedValueOnce({ ok: true, value: { token: nextToken, gestureId: nextToken } });
  show(); const old = await start(); const next = await start();
  fireEvent.dragEnd(old.tab, { dataTransfer: old.dataTransfer }); expect(dragApi.endDrag).not.toHaveBeenCalled();
  fireEvent.dragEnd(next.tab, { dataTransfer: next.dataTransfer }); expect(dragApi.endDrag).toHaveBeenCalledExactlyOnceWith({ token: nextToken, outcome: 'unclaimed' });
});

it('an expired or revoked main token cannot commit even a same-window reorder', async () => {
  vi.mocked(dragApi.endDrag).mockResolvedValueOnce({ ok: false, error: { code: 'FORBIDDEN' } });
  show(); const { strip, dataTransfer } = await start();
  await act(async () => { fireEvent.drop(strip, { clientX: 900, dataTransfer }); });
  expect(move).not.toHaveBeenCalled(); expect(screen.getByRole('status').textContent).toContain('cancelled');
});
it('a delayed local end acknowledgment cannot reorder after a second gesture has started', async () => {
  let finish!: (result: Awaited<ReturnType<TabTransferApi['endDrag']>>) => void;
  vi.mocked(dragApi.endDrag).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  show(); const { strip, dataTransfer } = await start(); fireEvent.drop(strip, { clientX: 900, dataTransfer });
  await start('settings'); await act(async () => { finish({ ok: true, value: null }); });
  expect(move).not.toHaveBeenCalled(); expect(document.querySelector('[data-dragging=true]')?.getAttribute('data-tab-id')).toBe('settings');
});

it('leaving the strip for the reader stops insertion preview and auto-scroll without cancelling the native gesture', async () => {
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
  show(); const { strip, dataTransfer } = await start();
  fireEvent.dragOver(strip, { clientX: 900, dataTransfer }); expect(strip.getAttribute('data-insert-end')).toBe('true');
  fireEvent.dragLeave(strip, { relatedTarget: document.body, dataTransfer });
  expect(strip.getAttribute('data-insert-end')).toBe('false'); expect(cancelFrame).toHaveBeenCalled();
  expect(document.querySelector('[data-dragging=true]')).toBeTruthy(); expect(move).not.toHaveBeenCalled();
});

it.each(['en', 'pl'] as const)('empty windows expose a drop area and clear its highlight on leave, drop and exact gesture end in %s', locale => {
  render(<WorkspaceTabs workspace={{ tabs: [], activeTabId: null, revision: 9 }} locale={locale} disabled={false} dragApi={dragApi}
    label={() => ''} icon={() => 'video'} move={move} activate={activate} close={close} />);
  const strip = screen.getByRole('tablist'), dataTransfer = dataStore();
  expect(strip.querySelector('.tab-drop-empty')?.textContent).toContain(locale === 'en' ? 'Drop a tab here' : 'Upuść kartę tutaj');
  fireEvent.dragOver(strip, { dataTransfer }); expect(strip.dataset.dropActive).toBe('false');
  act(() => emit({ kind: 'drag-started', token })); fireEvent.dragOver(strip, { dataTransfer });
  expect(strip.dataset.dropActive).toBe('true');
  fireEvent.dragLeave(strip, { relatedTarget: document.body, dataTransfer }); expect(strip.dataset.dropActive).toBe('false');
  fireEvent.dragOver(strip, { dataTransfer }); fireEvent.drop(strip, { dataTransfer });
  expect(dragApi.offerDrag).toHaveBeenCalledExactlyOnceWith({ token, expectedRevision: 9, beforeTabId: null });
  expect(strip.dataset.dropActive).toBe('false'); expect(move).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  fireEvent.dragOver(strip, { dataTransfer }); act(() => emit({ kind: 'drag-cleared', token }));
  expect(strip.dataset.dropActive).toBe('false');
});

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
  vi.clearAllMocks(); vi.stubGlobal('PointerEvent', MouseEvent);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
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

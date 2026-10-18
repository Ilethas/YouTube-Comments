// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentContextMenu } from './CommentContextMenu';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('one active item follows genuine pointer movement and keyboard focus, skips disabled items, and executes exactly the active command', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const runs = Array.from({ length: 4 }, () => vi.fn()), dismiss = vi.fn();
  const origin = document.createElement('article'); document.body.append(origin);
  const target = { id: 'test', x: 0, y: 0, origin, selectionText: '' };
  const items = runs.map((run, index) => ({ run, label: `Item ${index}`, icon: 'copy' as const, disabled: index === 1 }));
  const view = render(<CommentContextMenu target={target} items={items} locale="en" dismiss={dismiss} />);
  const buttons = screen.getAllByRole('menuitem'), menu = screen.getByRole('menu');
  function active(index: number) {
    expect(menu.querySelectorAll('[data-active=true]')).toHaveLength(1);
    expect(buttons[index].dataset.active).toBe('true'); expect(document.activeElement).toBe(buttons[index]);
  }
  active(0);
  fireEvent.keyDown(menu, { key: 'ArrowDown' }); active(2);
  fireEvent.keyDown(menu, { key: 'ArrowUp' }); active(0);
  fireEvent.keyDown(menu, { key: 'End' }); active(3);
  fireEvent.keyDown(menu, { key: 'ArrowDown' }); active(0);
  fireEvent.keyDown(menu, { key: 'Home' }); active(0);
  fireEvent.pointerMove(buttons[2], { clientX: 20, clientY: 30 }); active(2);
  fireEvent.keyDown(menu, { key: 'ArrowDown' }); active(3);
  view.rerender(<CommentContextMenu target={target} items={[...items]} locale="en" dismiss={dismiss} />);
  // Layout/focus changes and a repeat event at the same coordinates cannot take
  // activity back from the keyboard even though the pointer still hovers Item 2.
  fireEvent.pointerEnter(buttons[2]); fireEvent.pointerMove(buttons[2], { clientX: 20, clientY: 30 }); active(3);
  fireEvent.pointerMove(buttons[1], { clientX: 22, clientY: 12 }); active(3);
  fireEvent.click(buttons[1]); expect(runs.every(run => run.mock.calls.length === 0)).toBe(true);
  fireEvent.pointerMove(buttons[2], { clientX: 21, clientY: 30 }); active(2);
  await userEvent.keyboard('{End}{Enter}');
  expect(runs[3]).toHaveBeenCalledTimes(1); expect(runs[2]).not.toHaveBeenCalled();
  await userEvent.keyboard('{Home} '); expect(runs[0]).toHaveBeenCalledTimes(1);
  fireEvent.click(buttons[2]); expect(runs[2]).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalledTimes(3);
  view.unmount(); origin.remove();
});

it.each(['reader-panel', 'tabs'])('a menu anchored in %s ignores sibling-reader scrolling and dismisses only when its own origin moves', ownerClass => {
  const owner = document.createElement('div'), sibling = document.createElement('main'), origin = document.createElement('button');
  owner.className = ownerClass; sibling.className = 'reader-panel'; sibling.hidden = true; owner.append(origin); document.body.append(owner, sibling);
  const dismiss = vi.fn();
  const view = render(<CommentContextMenu target={{ id: 'view-owned', x: 10, y: 20, origin, selectionText: '' }} items={[{ label: 'Action', icon: 'copy', run: vi.fn() }]} locale="en" dismiss={dismiss} />);
  fireEvent.scroll(sibling); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.scroll(owner); expect(dismiss).toHaveBeenCalledOnce();
  view.unmount(); owner.remove(); sibling.remove();
});

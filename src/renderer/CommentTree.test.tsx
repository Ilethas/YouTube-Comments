// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommentArticle } from './CommentTree';
import { ReaderRails } from './VirtualCommentList';
import { projectReaderRows } from './discussion-presentation';
import { unrestrictedView } from '../domain/discussion-query';
import { toggleSeen } from '../domain/discussion';
import { initialComments } from '../fixtures/discussions';
import { required } from './testing/required';
afterEach(() => { cleanup(); document.getSelection()?.removeAllRanges(); });
function article(disabled = false) {
  const comment = initialComments['video-demo'][0], onToggle = vi.fn();
  const view = render(<CommentArticle comment={comment} role="normal" rawHit={false} hasChildren selected={false} locale="en" disabled={disabled} onToggle={onToggle} />);
  return { ...view, comment, onToggle, row: screen.getByRole('article'), text: required(view.container.querySelector('.comment-text')) };
}
it.each([false, true])('Shift primary row click sends the application ID once, subtree=%s', ctrlKey => {
  const { comment, onToggle, text } = article();
  fireEvent.click(text, { shiftKey: true, ctrlKey, button: 0 });
  expect(onToggle).toHaveBeenCalledExactlyOnceWith(comment.id, ctrlKey);
});
it.each([{}, { button: 2, shiftKey: true }, { button: 1, shiftKey: true }, { shiftKey: true, altKey: true }, { shiftKey: true, metaKey: true }, { ctrlKey: true }])('ignores row click modifiers %j and leaves context menus alone', modifiers => {
  const { onToggle, text } = article(); fireEvent.click(text, modifiers); fireEvent.contextMenu(text, { shiftKey: true }); expect(onToggle).not.toHaveBeenCalled();
});
it('disabled rows do not send gestures', () => {
  const { onToggle, text } = article(true); fireEvent.click(text, { shiftKey: true, ctrlKey: true }); expect(onToggle).not.toHaveBeenCalled();
});
it.each(['button', 'a', 'input', 'select', 'textarea', 'div[contenteditable]', 'div[role=button]', 'div[data-interactive]', 'div[tabindex]'])('excludes %s and nested control descendants', selector => {
  const { row, onToggle } = article();
  const tag = selector.split('[')[0], control = document.createElement(tag);
  if (tag === 'a') control.setAttribute('href', '#source');
  if (selector.includes('[')) {
    const [key, value] = selector.split('[')[1].replace(']', '').split('='); control.setAttribute(key, value ?? 'true');
  }
  row.append(control); const nested = document.createElement('span'); control.append(nested);
  fireEvent.click(nested, { shiftKey: true, ctrlKey: true }); expect(onToggle).not.toHaveBeenCalled();
});
it('Shift/Ctrl+Shift checkbox and label clicks remain one command; Ctrl checkbox stays subtree', () => {
  const { row, onToggle, comment } = article();
  const checkbox = screen.getByRole('checkbox'), labelText = required(row.querySelector('.seen-control span'));
  for (const target of [checkbox, labelText]) {
    for (const modifiers of [{}, { ctrlKey: true }, { shiftKey: true }, { ctrlKey: true, shiftKey: true }]) {
      onToggle.mockClear(); fireEvent.click(target, modifiers);
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onToggle).toHaveBeenCalledWith(comment.id, !!modifiers.ctrlKey);
      if (target === labelText) expect(document.activeElement).toBe(checkbox);
    }
  }
});
it('non-collapsed text selection in or intersecting the comment preserves selection and sends no command', () => {
  const { text, row, onToggle } = article();
  const range = document.createRange(); range.selectNodeContents(text); document.getSelection()?.addRange(range);
  const selected = document.getSelection()?.toString();
  fireEvent.click(text, { shiftKey: true }); expect(onToggle).not.toHaveBeenCalled(); expect(document.getSelection()?.toString()).toBe(selected);
  fireEvent.pointerDown(row); document.getSelection()?.removeAllRanges();
  fireEvent.click(text, { shiftKey: true, ctrlKey: true }); expect(onToggle).not.toHaveBeenCalled();
  const unrelated = document.createElement('p'); unrelated.textContent = 'Elsewhere'; document.body.append(unrelated);
  range.selectNodeContents(unrelated); document.getSelection()?.addRange(range);
  fireEvent.pointerDown(row); fireEvent.click(text, { shiftKey: true }); expect(onToggle).toHaveBeenCalledTimes(1); unrelated.remove();
});
it('seen checkbox keeps a native focusable input and keyboard Space activation', async () => {
  const { comment, onToggle } = article(); const checkbox = screen.getByRole('checkbox');
  expect(checkbox.closest('label')?.className).toBe('seen-control');
  checkbox.focus(); expect(document.activeElement).toBe(checkbox);
  await userEvent.keyboard(' '); expect(onToggle).toHaveBeenCalledExactlyOnceWith(comment.id, false);
});
it('retains deep data ancestry with neutral rails and independent manual seen semantics', () => {
  const comments = Array.from({ length: 60 }, (_, depth) => ({ ...initialComments['video-demo'][0], id: `deep-${depth}`, parentId: depth ? `deep-${depth - 1}` : null, seen: depth % 2 === 0 }));
  const result = unrestrictedView(comments), onToggle = vi.fn();
  const display = (data: readonly typeof comments[number][]) => projectReaderRows(data, result).rows.map(row => <div key={row.id} data-depth={row.depth}>
    <ReaderRails row={row} /><CommentArticle comment={row.comment} role={row.role} rawHit={row.rawHit} hasChildren={row.hasChildren}
      selected={false} locale="pl" disabled={false} onToggle={onToggle} />
  </div>);
  const { container, rerender } = render(<>{display(comments)}</>);
  expect(container.querySelectorAll('.comment')).toHaveLength(60);
  expect(container.querySelectorAll('.flat-elbow')).toHaveLength(59);
  expect(container.querySelector('[data-depth="59"] article')?.id).toBe('comment-deep-59');
  fireEvent.click(container.querySelectorAll('input')[1], { ctrlKey: true }); expect(onToggle).toHaveBeenCalledWith('deep-1', true);
  rerender(<>{display(toggleSeen(comments, 'deep-1', true))}</>);
  expect(container.querySelectorAll('.flat-elbow')).toHaveLength(59);
  expect(container.querySelectorAll('.is-unseen')).toHaveLength(0);
});

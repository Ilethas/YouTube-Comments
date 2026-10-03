// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CommentTree } from './CommentTree';
import { buildCommentTree, toggleSeen } from '../domain/discussion';
import { initialComments } from '../fixtures/discussions';
afterEach(cleanup);
it('retains arbitrary deep projected ancestry with neutral rails/elbows and separate unseen rows', () => {
  const rows = Array.from({ length: 60 }, (_, depth) => ({ ...initialComments['video-demo'][0], id: `deep-${depth}`, parentId: depth ? `deep-${depth - 1}` : null, seen: depth % 2 === 0 }));
  const forest = buildCommentTree(rows), onToggle = vi.fn();
  const { container, rerender } = render(<CommentTree nodes={forest} locale="pl" disabled={false} onToggle={onToggle} />);
  expect(container.querySelectorAll('.comment')).toHaveLength(60);
  expect(container.querySelectorAll('.reply-rail')).toHaveLength(59);
  expect(container.querySelectorAll('.reply-elbow')).toHaveLength(59);
  expect(container.querySelector('.comment-branch[data-depth="59"]')?.getAttribute('data-comment-id')).toBe('deep-59');
  fireEvent.click(container.querySelectorAll('input')[1], { ctrlKey: true }); expect(onToggle).toHaveBeenCalledWith('deep-1', true);
  const changed = toggleSeen(rows, 'deep-1', true);
  rerender(<CommentTree nodes={buildCommentTree(changed)} locale="pl" disabled={false} onToggle={onToggle} />);
  expect(container.querySelectorAll('.reply-rail')).toHaveLength(59);
  expect(container.querySelectorAll('.reply-elbow')).toHaveLength(59);
  expect(container.querySelectorAll('.is-unseen')).toHaveLength(0);
});

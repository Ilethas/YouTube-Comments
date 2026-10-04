// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CommentArticle } from './CommentTree';
import { ReaderRails } from './VirtualCommentList';
import { projectReaderRows } from './discussion-presentation';
import { unrestrictedView } from '../domain/discussion-query';
import { toggleSeen } from '../domain/discussion';
import { initialComments } from '../fixtures/discussions';
afterEach(cleanup);
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

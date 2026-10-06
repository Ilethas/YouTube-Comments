// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DiscussionRuler } from './DiscussionRuler';
import { aggregateRulerMarkers } from './discussion-ruler';
afterEach(cleanup);

it('pointer lane, hover counts and keyboard activation resolve the same data targets without per-comment nodes', () => {
  const markers = [{ commentId: 'first', presentationIndex: 0, categories: ['unseen', 'match', 'new'] as const },
    { commentId: 'last', presentationIndex: 1, categories: ['unseen', 'new'] as const }];
  const buckets = aggregateRulerMarkers(markers, [{ start: 0, size: 10 }, { start: 990, size: 10 }], 1000, 600);
  const navigate = vi.fn(), view = render(<DiscussionRuler buckets={buckets} height={600} top={0} left={0} locale="en" navigate={navigate} />);
  const ruler = view.getByRole('button');
  vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, height: 600, width: 18 } as DOMRect);
  expect(view.container.querySelectorAll('path')).toHaveLength(3);
  fireEvent.click(ruler, { clientX: 14, clientY: 597 });
  expect(navigate).toHaveBeenLastCalledWith('last');
  fireEvent.focus(ruler);
  fireEvent.keyDown(ruler, { key: 'Home' }); fireEvent.keyDown(ruler, { key: 'ArrowRight' });
  fireEvent.keyDown(ruler, { key: 'Enter' }); expect(navigate).toHaveBeenLastCalledWith('first');
  expect(view.getByRole('tooltip').textContent).toBe('1 unseen\n1 matches\n1 new');
  fireEvent.keyDown(ruler, { key: 'End' }); fireEvent.keyDown(ruler, { key: 'ArrowRight' });
  fireEvent.keyDown(ruler, { key: ' ' }); expect(navigate).toHaveBeenLastCalledWith('last');
  expect(view.getByRole('tooltip').textContent).toBe('1 unseen\n0 matches\n1 new');
  view.rerender(<DiscussionRuler buckets={buckets} height={600} top={0} left={0} locale="pl" navigate={navigate} />);
  expect(view.getByRole('tooltip').textContent).toContain('Nowe: 1');
});

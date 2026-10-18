import { required } from './testing/required';
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoThumbnail } from './VideoThumbnail';
import { DiscussionPanel } from './DiscussionPanel';
import type { ContentItem } from '../domain/discussion';
import { DiscussionViewSession } from './discussion-view-session';
import { generateDiscussion } from '../development/large-discussions';
import { evaluateDiscussionQuery } from '../domain/discussion-query';
import { installReaderLayout } from './testing/reader-layout';
import type { ReaderApi } from '../shared/reader-api';

const url = 'reader-thumbnail://cache/12345678-1234-1234-1234-123456789abc';
const item: ContentItem = { id: 'item', kind: 'video', title: 'Video', sourceId: 'abcdefghijk', sourceKind: 'youtube-video', baselineDiscoveryId: 'baseline' };
let api: Pick<ReaderApi, 'getThumbnail' | 'checkThumbnail' | 'openThumbnail'>;
beforeEach(() => {
  api = { getThumbnail: vi.fn(async () => ({ ok: true as const, value: url })), checkThumbnail: vi.fn(async () => ({ ok: true as const, value: url })), openThumbnail: vi.fn(async () => ({ ok: true as const, value: null })) };
  Object.defineProperty(window, 'reader', { configurable: true, value: api });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function load(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('.video-thumbnail-row img')).not.toBeNull());
  fireEvent.load(required(container.querySelector('.video-thumbnail-row img')));
}
it('compact toggle supports click, native keyboard, EN/PL actions and explicit image-viewer menu only', async () => {
  const user = userEvent.setup(), view = render(<VideoThumbnail item={item} locale="en" active />);
  await load(view.container);
  const button = screen.getByRole('button', { name: 'Expand thumbnail' });
  expect(button.classList.contains('expanded')).toBe(false);
  fireEvent.click(button); expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(button.getAttribute('aria-label')).toBe('Shrink thumbnail');
  button.focus(); await user.keyboard(' '); expect(button.getAttribute('aria-expanded')).toBe('false');
  await user.keyboard('{Enter}'); expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(api.openThumbnail).not.toHaveBeenCalled();
  fireEvent.contextMenu(button, { clientX: 10, clientY: 20 });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Open in image viewer' }));
  expect(api.openThumbnail).toHaveBeenCalledWith({ itemId: item.id });
  view.rerender(<VideoThumbnail item={item} locale="pl" active />);
  expect(button.getAttribute('aria-label')).toBe('Pomniejsz miniaturę');
  fireEvent.click(button); expect(button.getAttribute('aria-label')).toBe('Powiększ miniaturę');
  fireEvent.contextMenu(button); expect(screen.getByRole('menuitem', { name: 'Otwórz w przeglądarce obrazów' })).toBeDefined();
  expect(api.getThumbnail).toHaveBeenCalledTimes(1); expect(api.checkThumbnail).toHaveBeenCalledTimes(1);
});
it('no image or decoding failure reserves no space and does not expose a broken control', async () => {
  vi.mocked(api.getThumbnail).mockResolvedValue({ ok: true, value: null }); vi.mocked(api.checkThumbnail).mockResolvedValue({ ok: true, value: null });
  const view = render(<VideoThumbnail item={item} locale="en" active />);
  await waitFor(() => expect(api.checkThumbnail).toHaveBeenCalled()); expect(view.container.childElementCount).toBe(0);
  vi.mocked(api.getThumbnail).mockResolvedValue({ ok: true, value: url });
  view.rerender(<VideoThumbnail item={{ ...item, latestAcceptedDiscoveryId: 'refresh' }} locale="en" active />);
  await load(view.container); fireEvent.error(required(view.container.querySelector('img')));
  expect(screen.queryByRole('button', { name: 'Expand thumbnail' })).toBeNull();
  expect(required(view.container.querySelector<HTMLElement>('.video-thumbnail-row')).hidden).toBe(true);
});
it('discards late results after tab deactivation/unmount and never requests demo or post images', async () => {
  let finish!: (value: Awaited<ReturnType<ReaderApi['getThumbnail']>>) => void;
  vi.mocked(api.getThumbnail).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<VideoThumbnail item={item} locale="en" active />);
  view.rerender(<VideoThumbnail item={item} locale="en" active={false} />);
  await act(async () => finish({ ok: true, value: url })); expect(view.container.querySelector('img')).toBeNull(); expect(api.checkThumbnail).not.toHaveBeenCalled();
  view.unmount();
  render(<VideoThumbnail item={{ ...item, isDemo: true }} locale="en" active />);
  render(<VideoThumbnail item={{ ...item, kind: 'post', text: 'Post' }} locale="en" active />);
  expect(api.getThumbnail).toHaveBeenCalledTimes(1);
});
it.each([10000, 50000])('one header image for %i comments preserves projections, virtualization and scroll offsets', async count => {
  const layout = installReaderLayout();
  const data = generateDiscussion({ count, shape: 'flat' }), comments = data.comments.map(comment => ({ ...comment, itemId: item.id }));
  const engine = { evaluate: vi.fn(async (rows: Parameters<typeof evaluateDiscussionQuery>[0], query: Parameters<typeof evaluateDiscussionQuery>[1]) => evaluateDiscussionQuery(rows, query)), dispose: vi.fn() };
  const session = new DiscussionViewSession(comments, engine), toggle = vi.fn();
  const view = render(<main className="reader-panel"><DiscussionPanel item={item} comments={comments} session={session} locale="en" saving={false} refreshDisabled={false} coverageLimited={false} onRefresh={vi.fn()} onToggle={toggle} /></main>);
  await load(view.container);
  const header = required(view.container.querySelector('.item-header'));
  expect(required(header.querySelector('.item-actions')).nextElementSibling?.className).toBe('item-title');
  expect(required(header.querySelector('.item-title')).nextElementSibling?.className).toBe('video-thumbnail-row');
  const panel = required(view.container.querySelector('main'));
  act(() => { panel.scrollTop = 100000; fireEvent.scroll(panel); });
  act(() => layout.notify());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  const before = session.state, scroll = panel.scrollTop;
  fireEvent.click(screen.getByRole('button', { name: 'Expand thumbnail' }));
  act(() => layout.setMargin(680));
  await waitFor(() => expect(panel.scrollTop).toBeCloseTo(scroll + 400, 6));
  expect(session.state).toBe(before); expect(toggle).not.toHaveBeenCalled(); expect(engine.evaluate).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll('.virtual-comment').length).toBeLessThan(35);
  expect(api.getThumbnail).toHaveBeenCalledTimes(1); expect(api.checkThumbnail).toHaveBeenCalledTimes(1);
  session.dispose();
});

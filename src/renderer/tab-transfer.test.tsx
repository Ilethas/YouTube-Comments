// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { DiscussionViewSession } from './discussion-view-session';
import { useDiscussionViews } from './use-discussion-views';
import { MoveTabDialog } from './MoveTabDialog';
import { WorkspaceTabs } from './WorkspaceTabs';
import { createQueryExecutor } from './query-executor';
import { initialComments, items } from '../fixtures/discussions';
import { defaultQuery, evaluateDiscussionQuery } from '../domain/discussion-query';
import type { QueryExecutor } from './query-worker-client';
import type { TabTransferApi } from '../shared/tab-transfer';
import { isLiveViewHandoff } from '../shared/tab-transfer';
import { installReaderLayout } from './testing/reader-layout';
import { DiscussionPanel } from './DiscussionPanel';
import { generateDiscussion } from '../development/large-discussions';

vi.mock('./query-executor', () => ({ createQueryExecutor: vi.fn() }));
const rows = initialComments['video-demo'], stamp = { profileEpoch: '00000000-0000-0000-0000-000000000000', commitRevision: 1 };
const engine = (): QueryExecutor => ({ evaluate: vi.fn(async (rows, query) => evaluateDiscussionQuery(rows, query)), dispose: vi.fn() });
beforeEach(() => {
  installReaderLayout(); vi.mocked(createQueryExecutor).mockImplementation(() => engine() as ReturnType<typeof createQueryExecutor>);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function source(save: (intent: import('../domain/discussion-view').DiscussionViewIntent) => Promise<import('../shared/reader-api').Result<null>> = vi.fn(async () => ({ ok: true as const, value: null }))) {
  const session = new DiscussionViewSession(rows, engine(), undefined, undefined, { save });
  session.edit({ ...defaultQuery, seen: 'unseen' }); await session.apply(rows);
  session.edit({ ...session.state.draft, text: 'unsubmitted draft' }); session.setSort('oldest');
  session.toggleBulk('v1', false); session.select('v2');
  session.attachReader(() => ({ id: 'v1', offset: -29.25 })); session.seenChanged();
  return { session, save };
}
it('live handoff retains frozen membership/order, stale flag, temporary range selection, draft, navigation and exact logical offset without worker evaluation', async () => {
  const { session, save } = await source(), frozen = session.state.result;
  const handoff = await session.prepareTransfer('view', 'video-demo', stamp, null);
  expect(isLiveViewHandoff(handoff)).toBe(true); expect(save).toHaveBeenCalled();
  const targetEngine = engine(), target = new DiscussionViewSession(rows.map(c => ({ ...c, seen: true })), targetEngine, undefined, undefined, { saved: handoff.intent });
  target.adoptTransfer(handoff, rows); await target.restore(rows);
  expect(targetEngine.evaluate).not.toHaveBeenCalled(); expect(target.state.result).toEqual(frozen);
  expect(target.state.draft.text).toBe('unsubmitted draft'); expect(target.state.seenStale).toBe(true);
  expect(target.state.bulkSelected).toEqual(new Set(['v1'])); expect(target.state.selected).toBe('v2');
  expect(target.state.scrollRequest).toMatchObject({ id: 'v1', offset: -29.25 });
  target.toggleBulk('v3', true); expect(target.state.bulkSelected.has('v2')).toBe(true);
  expect(target.presentation(rows).orderedIds).toEqual(handoff.orderedIds);
  session.dispose(); target.dispose();
});

it('an empty Most liked view retains its mode and discussion availability across windows and shared Refresh', async () => {
  const comments = rows.map(row => ({ ...row, seen: true, likeCount: row.parentId === null ? 0 : undefined }));
  const session = new DiscussionViewSession(comments, engine());
  session.setSort('most-liked'); session.edit({ ...defaultQuery, seen: 'unseen' }); await session.apply(comments);
  const handoff = await session.prepareTransfer('view', 'video-demo', stamp, null);
  expect(handoff.orderedIds).toEqual([]); expect(handoff.mostLikedAvailable).toBe(true);
  const target = new DiscussionViewSession(comments, engine());
  target.adoptTransfer(handoff, comments);
  expect(target.presentation(comments).mostLikedAvailable).toBe(true);
  expect(target.state.sort).toBe('most-liked');
  const unknown = comments.map(row => ({ ...row, likeCount: undefined }));
  await target.refresh(unknown);
  expect(target.presentation(unknown).mostLikedAvailable).toBe(false);
  expect(target.persistentIntent().sort).toBe('most-liked');
  await target.refresh(comments);
  expect(target.presentation(comments).mostLikedAvailable).toBe(true);
  expect(target.state.result.visibleCommentIds).toEqual([]);
  session.dispose(); target.dispose();
});
it('freezes source mutations without removing its React panel; cancellation resumes its working session', async () => {
  const { session } = await source(), item = items.find(i => i.id === 'video-demo'); if (!item) throw Error('fixture');
  const props = { viewId: 'view', item, comments: rows, session, locale: 'en' as const, saving: false, refreshDisabled: false, coverageLimited: false, onRefresh: vi.fn(), onToggle: vi.fn() };
  const ui = render(<DiscussionPanel {...props} />);
  await act(async () => { await session.prepareTransfer('view', 'video-demo', stamp, null); });
  const draft = session.state.draft;
  act(() => { session.edit(defaultQuery); session.toggleBulk('v2', false); session.setCollapsed({ kind: 'all', collapsed: true }); });
  expect(session.state.draft).toBe(draft); expect(ui.container.querySelector('input[type=search]')).toBeTruthy(); expect(session.state.collapse.defaultCollapsed).toBe(false);
  act(() => { session.resumeTransfer(); session.edit({ ...draft, text: 'retry works' }); });
  expect(within(ui.container).getByLabelText<HTMLInputElement>('Search this discussion').value).toBe('retry works'); session.dispose();
});
it('failed final persistence rejects handoff and preserves source result/draft/temporary selection for retry', async () => {
  const save = vi.fn(async () => ({ ok: false as const, error: { code: 'STORAGE_UNAVAILABLE' as const } })), { session } = await source(save);
  const before = session.state;
  await expect(session.prepareTransfer('view', 'video-demo', stamp, null)).rejects.toThrow();
  expect(session.state.result).toBe(before.result); expect(session.state.bulkSelected).toEqual(before.bulkSelected);
  session.resumeTransfer(); session.edit(defaultQuery); expect(session.state.draft).toBe(defaultQuery); session.dispose();
});
it('cancelling a transfer never releases a simultaneous M3 pause or writes outside its sealed checkpoint', async () => {
  const { session, save } = await source();
  await session.prepareTransfer('view', 'video-demo', stamp, null);
  session.freeze(); session.resumeTransfer();
  const calls = vi.mocked(save).mock.calls.length;
  session.edit({ ...defaultQuery, text: 'accepted checkpoint' }); await session.flush();
  expect(vi.mocked(save).mock.calls).toHaveLength(calls);
  const checkpoints = await session.drainCheckpoints('view');
  expect(checkpoints[0].command.request).toMatchObject({ draft: { text: 'accepted checkpoint' } });
  checkpoints.forEach(c => c.accept({ ok: true, value: null }));
  session.resume(); session.edit(defaultQuery); await session.flush();
  expect(vi.mocked(save).mock.calls).toHaveLength(calls + 1); session.dispose();
});
it('a cancelled asynchronous checkpoint cannot freeze a later usable source session', async () => {
  let acknowledge!: () => void;
  const save = vi.fn(async () => { await new Promise<void>(resolve => { acknowledge = resolve; }); return { ok: true as const, value: null }; });
  const session = new DiscussionViewSession(rows, engine(), undefined, undefined, { save });
  session.edit(defaultQuery);
  const signal = new AbortController(), checkpoint = session.prepareTransfer('view', 'video-demo', stamp, null, signal.signal);
  await waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  signal.abort(); session.resumeTransfer(); acknowledge();
  await expect(checkpoint).rejects.toThrow('cancelled');
  session.edit({ ...defaultQuery, text: 'still usable' }); expect(session.state.draft.text).toBe('still usable'); session.dispose();
});
it('shared Refresh during a frozen transfer replays once after cancellation and keeps its draft', async () => {
  const { session } = await source(); await session.prepareTransfer('view', 'video-demo', stamp, null);
  const result = session.state.result, next = rows.map(c => ({ ...c, seen: true }));
  await session.refresh(next); expect(session.state.result).toBe(result);
  session.resumeTransfer();
  await waitFor(() => expect(session.state.pending).toBe(false));
  expect(session.state.result.activeMatchIds).toEqual([]); expect(session.state.draft.text).toBe('unsubmitted draft'); session.dispose();
});
it('a 50k discussion handoff is bounded identity data and never copies comment text', async () => {
  const generated = generateDiscussion({ count: 50000 }), session = new DiscussionViewSession(generated.comments, engine());
  const handoff = await session.prepareTransfer('large-view', generated.item.id, stamp, null), serialized = JSON.stringify(handoff);
  expect(isLiveViewHandoff(handoff)).toBe(true); expect(handoff.orderedIds).toHaveLength(50000);
  expect(serialized.length).toBeLessThan(32 * 1024 * 1024); expect(serialized).not.toContain(generated.comments[0].text);
  session.dispose();
}, 15000);
it('registry disposes an outgoing generation and adopts returning ownership instead of resurrecting the old A session; checkpoints carry current authority', async () => {
  const { session } = await source(), handoff = await session.prepareTransfer('view', 'video-demo', stamp, null), save = vi.fn(async () => ({ ok: true as const, value: null }));
  const old = { itemId: 'video-demo', intentRevision: 0, collapseRevision: 0 };
  const hook = renderHook(() => useDiscussionViews({ saved: {}, instances: { view: old }, save }));
  const first = hook.result.current.get('view', rows, 'video-demo');
  act(() => hook.result.current.hydrate({ viewInstances: {}, discussionViews: {}, discussionCollapse: {} }));
  const instance = { ...old, intentRevision: 2, collapseRevision: 2, ownerGeneration: 'new-authority' };
  act(() => hook.result.current.hydrate({ viewInstances: { view: instance }, discussionViews: { view: handoff.intent }, discussionCollapse: {}, liveHandoffs: { view: handoff } }));
  const returned = hook.result.current.get('view', rows, 'video-demo'); expect(returned).not.toBe(first); expect(returned.state.result).toEqual(handoff.result);
  act(() => { returned.edit(defaultQuery); hook.result.current.freeze('view'); });
  const checkpoints = await hook.result.current.checkpoints();
  expect(checkpoints[0].command.request).toMatchObject({ ownerGeneration: 'new-authority', expectedRevision: 2 });
  session.dispose();
});
it.each(['discussion', 'library', 'settings'] as const)('Shift+F10 exposes both move commands for %s without requiring a mouse', kind => {
  const transfer = vi.fn(), tab = kind === 'discussion' ? { id: 'view', kind, itemId: 'video-demo' } : { id: kind, kind };
  render(<WorkspaceTabs workspace={{ tabs: [tab], activeTabId: tab.id, revision: 1 }} locale="en" disabled={false} label={() => 'Title'} icon={() => kind === 'discussion' ? 'video' : kind}
    activate={vi.fn()} close={vi.fn()} move={vi.fn()} duplicate={vi.fn()} transfer={transfer} />);
  fireEvent.keyDown(screen.getByRole('tab'), { key: 'F10', shiftKey: true });
  expect(screen.getByRole('menuitem', { name: 'Move to Window…' })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' }); fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' });
  expect(transfer).toHaveBeenCalledWith(tab.id, true);
});
it('dirty Settings requires explicit preserve/discard; no destinations still offers a new window and Cancel starts focused', async () => {
  const move = vi.fn(), cancel = vi.fn(), api = { destinations: vi.fn(async () => ({ ok: true, value: [] })) } as unknown as TabTransferApi;
  render(<MoveTabDialog tabTitle="Settings" tabKind="settings" api={api} locale="en" dirty newWindow={false} move={move} cancel={cancel} />);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.queryByRole('radio', { name: /Move to New Window/ })).toBeNull(); expect(move).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft and continue' }));
  await waitFor(() => expect(screen.getByText('No other window is available.')).toBeTruthy());
  fireEvent.click(screen.getByRole('radio', { name: /Move to New Window/ })); expect(move).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Move' })); expect(move).toHaveBeenCalledWith('new');
});

it('dragged dirty Settings keeps its exact offered destination after explicit discard', async () => {
  const move = vi.fn(), destination = { windowId: 'recipient', expectedRevision: 12, beforeTabId: 'neighbor' };
  const api = { destinations: vi.fn(async () => ({ ok: true, value: [] })) } as unknown as TabTransferApi;
  render(<MoveTabDialog tabTitle="Settings" tabKind="settings" api={api} locale="en" dirty newWindow={false} fixedDestination={destination} move={move} cancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft and continue' }));
  expect(screen.queryByRole('radio', { name: /Move to New Window/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Move' })); expect(move).toHaveBeenCalledExactlyOnceWith(destination);
});

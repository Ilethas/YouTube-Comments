// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { required } from './testing/required';
import { App } from './App';
import { ReaderRepository } from '../main/persistence/reader-repository';
import { ReaderService } from '../main/reader-service';
import { createReaderBridge } from '../preload/reader-bridge';
import { readerChannels } from '../shared/reader-api';
import type { ReaderApi, ReaderOperation } from '../shared/reader-api';
import { createQueryExecutor } from './query-executor';
import { evaluateDiscussionQuery, defaultQuery } from '../domain/discussion-query';
import { installReaderLayout } from './testing/reader-layout';
vi.mock('./query-executor', () => ({ createQueryExecutor: vi.fn() }));
let holdDuplicateReply: Promise<void> | undefined, duplicateReplyHeld: (() => void) | undefined;
let root: string, repo: ReaderRepository, service: ReaderService, api: ReaderApi;
const panel = (id?: string) => id ? required(document.getElementById('panel-' + id)) : screen.getByRole('tabpanel');
const field = (id?: string) => within(panel(id)).getByLabelText<HTMLInputElement>('Search this discussion');
const sourceId = () => required(repo.workspace().tabs.find(t => t.kind === 'discussion' && t.itemId === 'video-demo')).id;
async function activate(id: string) { fireEvent.click(required(document.getElementById('tab-' + id))); await waitFor(() => expect(panel(id).hidden).toBe(false)); }
async function duplicate(id = sourceId(), keyboard = false) {
  const original = repo.workspace().tabs.length;
  const tab = required(document.getElementById('tab-' + id));
  if (keyboard) fireEvent.keyDown(tab, { key: 'F10', shiftKey: true }); else fireEvent.contextMenu(tab);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Tab' }));
  await waitFor(() => expect(repo.workspace().tabs.length).toBe(original + 1));
  const clone = required(repo.workspace().activeTabId);
  await waitFor(() => expect(field(clone)).toBeTruthy());
  return clone;
}
beforeEach(async () => {
  holdDuplicateReply = undefined; duplicateReplyHeld = undefined;
  installReaderLayout();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  vi.mocked(createQueryExecutor).mockImplementation(() => ({ evaluate: vi.fn(async (rows, query) => evaluateDiscussionQuery(rows, query)), dispose: vi.fn() } as ReturnType<typeof createQueryExecutor>));
  root = mkdtempSync(path.join(tmpdir(), 'reader-m5-react-')); repo = ReaderRepository.open(path.join(root, 'reader.sqlite')); repo.initializeDemo();
  service = new ReaderService(() => repo, ['en'], vi.fn());
  const operations = new Map<string, ReaderOperation>(Object.entries(readerChannels).map(([key, channel]) => [channel, key as ReaderOperation]));
  api = createReaderBridge(async (channel, ...args) => {
    if (channel === 'reader:window-ready') return { ok: true, value: null };
    const result = await service.dispatch(required(operations.get(channel)), args);
    if (channel === readerChannels.duplicateTab && holdDuplicateReply) { duplicateReplyHeld?.(); await holdDuplicateReply; }
    return result;
  }, undefined, listener => service.onSharedCommit(listener));
  window.reader = api;
  render(<App api={api} />); await screen.findByRole('tabpanel');
});
afterEach(async () => { cleanup(); await new Promise(resolve => setTimeout(resolve, 0)); await service.shutdown(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
it('flushes current debounced draft/collapse, hydrates a fresh worker before rendering, and namespaces all DOM/ARIA targets', async () => {
  const source = sourceId();
  fireEvent.change(field(), { target: { value: 'current draft' } });
  fireEvent.change(within(panel()).getByLabelText('Sort'), { target: { value: 'newest' } });
  fireEvent.click(within(panel()).getByRole('button', { name: 'Collapse all' }));
  const clone = await duplicate(source, true);
  expect(field(clone).value).toBe('current draft'); expect(field(source).value).toBe('current draft');
  expect(repo.viewSnapshot(repo.initialWindowId(), clone).intent?.sort).toBe('newest');
  expect(repo.viewSnapshot(repo.initialWindowId(), clone).collapse?.defaultCollapsed).toBe(true);
  expect(document.activeElement?.id).toBe('tab-' + clone);
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id); expect(new Set(ids).size).toBe(ids.length);
  for (const node of document.querySelectorAll('.reader-panel [aria-controls], .reader-panel [aria-labelledby], .reader-panel [aria-describedby], [role=tab]')) {
    for (const attr of ['aria-controls', 'aria-labelledby', 'aria-describedby']) for (const target of (node.getAttribute(attr) ?? '').split(' ').filter(Boolean)) expect(document.getElementById(target)).toBeTruthy();
  }
  expect(createQueryExecutor).toHaveBeenCalledTimes(2);
  fireEvent.change(field(clone), { target: { value: 'clone only' } });
  fireEvent.change(within(panel(clone)).getByLabelText('Sort'), { target: { value: 'oldest' } });
  fireEvent.click(within(panel(clone)).getByRole('button', { name: 'Expand all' }));
  await activate(source); expect(field().value).toBe('current draft');
  expect(within(panel()).getByLabelText<HTMLSelectElement>('Sort').value).toBe('newest');
  expect(repo.viewSnapshot(repo.initialWindowId(), source).collapse?.defaultCollapsed).toBe(true);
});
it('fresh clone evaluation sees current shared seen while source membership remains frozen; Apply and temporary selection are independent', async () => {
  const source = sourceId();
  fireEvent.change(within(panel()).getByLabelText('Seen filter'), { target: { value: 'unseen' } });
  fireEvent.submit(required(panel().querySelector('form')));
  await waitFor(() => expect(panel().querySelector('.applied-counts')).toBeTruthy());
  const matches = () => [...panel(source).querySelectorAll<HTMLElement>('[data-view-role=match]')].map(row => row.dataset.domainCommentId);
  const frozen = matches(), target = required(frozen[0]);
  await act(async () => { await api.toggleSeen({ itemId: 'video-demo', commentId: target, subtree: false, seen: true }); });
  expect(matches()).toEqual(frozen);
  fireEvent.click(within(panel()).getByRole('button', { name: 'Select comments' }));
  fireEvent.click(required(panel().querySelector('.selection-circle')));
  const clone = await duplicate();
  expect(panel(clone).querySelector('[data-bulk-selected=true]')).toBeNull();
  expect(panel(source).querySelector('[data-bulk-selected=true]')).toBeTruthy();
  expect([...panel(clone).querySelectorAll<HTMLElement>('[data-view-role=match]')].some(row => row.dataset.domainCommentId === target)).toBe(false);
  fireEvent.change(field(clone), { target: { value: 'no such text' } }); fireEvent.submit(required(panel(clone).querySelector('form')));
  await waitFor(() => expect(panel(clone).querySelectorAll('.comment').length).toBe(0));
  expect(matches()).toEqual(frozen); expect(field(source).value).toBe('');
});
it('F3 and Shift+F3 focus only the active duplicate; independent anchors, selection, descriptions and menus survive switching', async () => {
  const source = sourceId(), clone = await duplicate();
  fireEvent.change(field(clone), { target: { value: 'desk' } }); fireEvent.submit(required(panel(clone).querySelector('form')));
  await waitFor(() => expect(panel(clone).querySelector('[data-view-role=match]')).toBeTruthy());
  fireEvent.keyDown(document, { key: 'F3' });
  await waitFor(() => expect(document.activeElement?.closest('.reader-panel')).toBe(panel(clone)));
  const selected = panel(clone).querySelector('[data-selected=true]')?.getAttribute('data-domain-comment-id');
  panel(clone).scrollTop = 480; fireEvent.scroll(panel(clone));
  await activate(source); panel(source).scrollTop = 310; fireEvent.scroll(panel(source));
  fireEvent.keyDown(document, { key: 'F3', shiftKey: true });
  await waitFor(() => expect(document.activeElement?.closest('.reader-panel')).toBe(panel(source)));
  panel(source).scrollTop = 310; fireEvent.scroll(panel(source));
  expect(panel(clone).querySelector('[data-selected=true]')?.getAttribute('data-domain-comment-id')).toBe(selected);
  fireEvent.contextMenu(required(panel(source).querySelector('article')));
  expect(await screen.findByRole('menu', { name: 'Comment actions' })).toBeTruthy();
  await activate(clone); await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(panel(source).scrollTop).toBe(310); expect(panel(clone).scrollTop).toBe(480);
  expect(field(clone).value).toBe('desk'); expect(field(source).value).toBe('');
});
it('shared seen and exact-ID Undo update both mounted views; deletion removes both and disposes both workers', async () => {
  const source = sourceId(), clone = await duplicate();
  await act(async () => { await api.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } }); });
  for (const id of [source, clone]) expect([...panel(id).querySelectorAll<HTMLInputElement>('.seen-control input')].every(input => input.checked)).toBe(true);
  const recovery = required(repo.bootstrap(['en']).seenUndo['video-demo']);
  await act(async () => { await api.undoSeen({ itemId: 'video-demo', expectedOperationId: recovery.id }); });
  for (const id of [source, clone]) expect([...panel(id).querySelectorAll<HTMLInputElement>('.seen-control input')].some(input => !input.checked)).toBe(true);
  const executors = vi.mocked(createQueryExecutor).mock.results.map(result => result.value as ReturnType<typeof createQueryExecutor>);
  await act(async () => { await api.removeLibraryItem({ itemId: 'video-demo' }); });
  expect(document.getElementById('panel-' + source)).toBeNull(); expect(document.getElementById('panel-' + clone)).toBeNull();
  executors.forEach(executor => expect(executor.dispose).toHaveBeenCalledOnce());
});
it('a failed source checkpoint creates no duplicate and preserves the source controls for retry', async () => {
  const before = repo.workspace(), save = vi.spyOn(repo, 'saveDiscussionView').mockImplementation(() => { throw new Error('injected save'); });
  fireEvent.change(field(), { target: { value: 'must not clone stale database' } });
  fireEvent.contextMenu(required(document.getElementById('tab-' + sourceId()))); fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate Tab' }));
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(repo.workspace()).toEqual(before); expect(field().value).toBe('must not clone stale database');
  save.mockRestore();
});
it('new-view hydration uses a narrow read and older source worker completion cannot replace a newer Apply', async () => {
  const snapshots = vi.spyOn(repo, 'bootstrap'), narrow = vi.spyOn(repo, 'viewSnapshot');
  const clone = await duplicate(); expect(narrow).toHaveBeenCalled(); expect(snapshots).not.toHaveBeenCalled();
  const executor = vi.mocked(createQueryExecutor).mock.results[1].value as ReturnType<typeof createQueryExecutor>;
  let finish!: (result: ReturnType<typeof evaluateDiscussionQuery>) => void;
  vi.mocked(executor.evaluate).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.change(field(clone), { target: { value: 'camera' } }); fireEvent.submit(required(panel(clone).querySelector('form')));
  fireEvent.change(field(clone), { target: { value: 'unmatchable' } }); fireEvent.submit(required(panel(clone).querySelector('form')));
  await waitFor(() => expect(panel(clone).querySelectorAll('.comment')).toHaveLength(0));
  await act(async () => { finish(evaluateDiscussionQuery([], { ...defaultQuery, publicationBounds: undefined })); });
  expect(panel(clone).querySelectorAll('.comment')).toHaveLength(0); expect(field(sourceId()).value).toBe('');
});

it('a delayed successful duplicate reply cannot resurrect an item removed through the shared replica', async () => {
  let release!: () => void, committed!: () => void;
  holdDuplicateReply = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { committed = resolve; }); duplicateReplyHeld = committed;
  fireEvent.contextMenu(required(document.getElementById('tab-' + sourceId())));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate Tab' }));
  await act(async () => { await held; });
  await act(async () => { await api.removeLibraryItem({ itemId: 'video-demo' }); });
  expect(document.querySelector('[data-item-id=video-demo]')).toBeNull();
  await act(async () => { release(); });
  expect(document.querySelector('[data-item-id=video-demo]')).toBeNull();
  expect(repo.workspace().tabs.some(tab => tab.kind === 'discussion' && tab.itemId === 'video-demo')).toBe(false);
});

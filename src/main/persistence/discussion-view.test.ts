import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository, InvalidDiscussionViewError } from './reader-repository';
import { migrateDatabase, migrations } from './migrations';
import { defaultQuery } from '../../domain/discussion-query';
import { discussionSorts } from '../../domain/discussion-view';
import type { SaveDiscussionViewRequest } from '../../domain/discussion-view';
import { discussionTab } from '../../domain/workspace';
import { normalizeYtDlp } from '../extractors/yt-dlp';
import { ReaderService } from '../reader-service';

let directory: string, file: string, repo: ReaderRepository;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-view-test-'));
  file = path.join(directory, 'reader.sqlite'); repo = ReaderRepository.open(file); repo.initializeDemo();
});
afterEach(() => {
  repo.close(); vi.restoreAllMocks();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-view-test-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function restart() { repo.close(); repo = ReaderRepository.open(file); return repo.bootstrap(['en']); }
function raw<T>(action: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON');
  try { return action(db); } finally { db.close(); }
}
const intent = (itemId = 'video-demo'): SaveDiscussionViewRequest => ({ itemId,
  draft: { ...defaultQuery, text: 'microphone', fields: ['author', 'replied-to-author'], mode: 'regex', caseSensitive: true, publication: { kind: 'custom', from: '2026-10-01', to: '2026-10-14' }, discovery: 'new' },
  applied: { ...defaultQuery, text: 'camera', seen: 'unseen', publication: { kind: 'last-24-hours' } }, sort: 'newest',
  anchor: { commentId: itemId === 'video-demo' ? 'v3' : 'p2', offset: 27.5 }, selected: itemId === 'video-demo' ? 'v4' : 'p3' });

it('schema 7 → 8 preserves populated content, seen revisions, history, workspace, Undo, preferences and helpers; absent rows mean defaults', () => {
  repo.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  repo.updatePreferences({ locale: 'pl' }, ['en']); repo.updatePreferences({ appearance: 'dark' }, ['en']);
  repo.changeWorkspace('openLibrary'); repo.changeWorkspace('moveTab', 'library', 0);
  repo.setHelperSelection('yt-dlp', 'C:\\helpers\\yt-dlp.exe');
  const before = repo.bootstrap(['en']), history = repo.history();
  const revisions = raw(db => db.prepare('SELECT * FROM comment_state').all());
  repo.close();
  const db = new DatabaseSync(file);
  try {
    db.exec('ALTER TABLE preferences DROP COLUMN translation_target; DROP TABLE discussion_view_state; PRAGMA user_version=7');
    expect(() => migrateDatabase(db, [...migrations.slice(0, 7), { version: 8, apply: target => {
      migrations[7].apply(target); throw new Error('injected migration failure');
    } }])).toThrow('injected migration failure');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(7);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='discussion_view_state'").get()).toBeUndefined();
    migrateDatabase(db); migrateDatabase(db);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
    expect(db.prepare('SELECT * FROM discussion_view_state').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM comment_state').all()).toEqual(revisions);
  } finally { db.close(); repo = ReaderRepository.open(file); }
  expect(repo.bootstrap(['en'])).toEqual(before); expect(repo.history()).toEqual(history);
  expect(repo.getHelperSelection('yt-dlp')).toBe('C:\\helpers\\yt-dlp.exe');
});

it.each(discussionSorts)('%s persists distinct draft/applied, semantic dates, anchor/offset/selection across close, real connection restarts and Library reopen', sort => {
  const request = { ...intent(), sort }; repo.saveDiscussionView(request);
  repo.changeWorkspace('closeTab', discussionTab(request.itemId).id);
  const saved = restart().discussionViews[request.itemId];
  const { itemId, ...expected } = request; expect(saved).toEqual(expected);
  repo.changeWorkspace('openStoredItem', itemId);
  expect(restart().discussionViews[itemId]).toEqual(expected);
  raw(db => {
    const row = db.prepare('SELECT * FROM discussion_view_state').get();
    expect(Object.keys(row ?? {})).toEqual(['item_id', 'draft_query_json', 'applied_query_json', 'sort', 'anchor_comment_id', 'anchor_offset', 'selected_comment_id']);
    expect(String(row?.applied_query_json)).not.toContain('publicationBounds');
  });
});

it('discussion state remains independent, reacquisition retains identity, and removal cascades just the corresponding view', () => {
  repo.saveDiscussionView(intent()); repo.saveDiscussionView({ ...intent('post-demo'), sort: 'oldest' });
  const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
  const extraction = normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context);
  const id = repo.ingest(extraction, undefined, true).itemId;
  if (!id) throw new Error('Expected accepted fixture');
  const comment = repo.bootstrap(['en']).comments[id][0].id;
  repo.saveDiscussionView({ ...intent(), itemId: id, anchor: { commentId: comment, offset: 0 }, selected: comment });
  expect(repo.ingest(extraction).itemId).toBe(id);
  expect(Object.keys(restart().discussionViews)).toHaveLength(3);
  const after = repo.removeLibraryItem(id, ['en']);
  expect(Object.keys(after.discussionViews).sort()).toEqual(['post-demo', 'video-demo']);
  expect(restart().discussionViews).toEqual(after.discussionViews);
  raw(db => expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]));
});

it('invalid/corrupt convenience data falls back per discussion with one bounded diagnostic and keeps content/seen/history usable', () => {
  repo.saveDiscussionView(intent()); repo.saveDiscussionView(intent('post-demo'));
  const before = repo.bootstrap(['en']), history = repo.history();
  raw(db => db.prepare('UPDATE discussion_view_state SET applied_query_json=? WHERE item_id=?').run('{broken', 'video-demo'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const restored = restart(); repo.bootstrap(['en']);
  expect(restored.discussionViews['video-demo']).toBeUndefined();
  expect(restored.discussionViews['post-demo']).toEqual(before.discussionViews['post-demo']);
  expect(restored.comments).toEqual(before.comments); expect(repo.history()).toEqual(history);
  expect(warn.mock.calls).toEqual([['INVALID_DISCUSSION_VIEW_STATE']]);
  raw(db => db.prepare('UPDATE discussion_view_state SET draft_query_json=? WHERE item_id=?').run(JSON.stringify({ ...defaultQuery, sql: 'evil' }), 'post-demo'));
  expect(repo.bootstrap(['en']).discussionViews).toEqual({});
});

it('narrow IPC rejects unexpected/derived shapes, enums, oversized text, nonfinite offsets and foreign identities before writes', () => {
  const diagnose = vi.fn(), service = new ReaderService(() => repo, ['en'], diagnose);
  const request = intent();
  for (const invalid of [null, {}, { ...request, results: [] }, { ...request, sort: 'other' }, { ...request, draft: { ...request.draft, text: 'x'.repeat(16385) } },
    { ...request, applied: { ...request.applied, publicationBounds: { from: 1 } } }, { ...request, draft: { ...defaultQuery, fields: ['content', 'content'] } },
    { ...request, applied: { ...defaultQuery, publication: { kind: 'today', now: 1 } } },
    ...[NaN, Infinity, -Infinity, 100001].map(offset => ({ ...request, anchor: { commentId: 'v1', offset } }))]) {
    expect(service.dispatch('saveDiscussionView', [invalid])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  }
  expect(service.dispatch('saveDiscussionView', [request, request]).ok).toBe(false);
  for (const invalid of [{ ...request, selected: 'p1' }, { ...request, anchor: { commentId: 'p1', offset: 0 } }]) {
    expect(service.dispatch('saveDiscussionView', [invalid])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(() => repo.saveDiscussionView(invalid)).toThrow(InvalidDiscussionViewError);
  }
  expect(repo.bootstrap(['en']).discussionViews).toEqual({});
  expect(service.dispatch('saveDiscussionView', [request])).toEqual({ ok: true, value: null });
  expect(service.dispatch('saveDiscussionView', [{ ...request, itemId: 'missing' }])).toEqual({ ok: false, error: { code: 'NOT_FOUND' } });
});

it('failed full view upsert retains the previously acknowledged intent', () => {
  repo.saveDiscussionView(intent()); const before = repo.bootstrap(['en']);
  raw(db => db.exec("CREATE TRIGGER fail_view BEFORE UPDATE ON discussion_view_state BEGIN SELECT RAISE(ABORT,'view failure'); END"));
  expect(() => repo.saveDiscussionView({ ...intent(), sort: 'oldest' })).toThrow('view failure');
  expect(restart()).toEqual(before);
});

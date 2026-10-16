import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './reader-repository';
import { defaultQuery } from '../../domain/discussion-query';
import { ReaderService } from '../reader-service';
import { normalizeYtDlp } from '../extractors/yt-dlp';
import { discussionTab } from '../../domain/workspace';
import type { ExtractLive } from '../live-extraction';

let directory: string, file: string, repository: ReaderRepository;
const fixture = JSON.parse(readFileSync(path.join(__dirname, '../extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
const extraction = normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context);
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-removal-test-')); file = path.join(directory, 'reader.sqlite');
  repository = ReaderRepository.open(file); repository.initializeDemo();
});
afterEach(() => {
  repository.close();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-removal-test-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function insert() { return repository.ingest(extraction, undefined, true).itemId as string; }
function raw<T>(action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file); db.exec('PRAGMA foreign_keys=ON');
  try { return action(db); } finally { db.close(); }
}
it.each(['real', 'video-demo', 'post-demo'])('removes %s and every owned record, preserving unrelated state and Undo', target => {
  const real = insert(), id = target === 'real' ? real : target;
  for (const item of repository.bootstrap(['en']).items) {
    repository.bulkSeen({ itemId: item.id, seen: true, target: { kind: 'all' } });
    repository.setDiscussionCollapse({ itemId: item.id, kind: 'all', collapsed: true });
    repository.saveDiscussionView({ itemId: item.id, draft: defaultQuery, applied: defaultQuery, sort: 'original', anchor: { commentId: null, offset: 10 }, selected: null });
  }
  repository.setHelperSelection('yt-dlp', 'C:\\test-only\\yt-dlp.exe');
  const preserved = repository.bootstrap(['en']);
  const filter = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== id));
  const after = repository.removeLibraryItem(id, ['en']);
  expect(after.items).toEqual(preserved.items.filter(item => item.id !== id));
  expect(after.comments).toEqual(filter(preserved.comments));
  expect(after.seenUndo).toEqual(filter(preserved.seenUndo));
  expect(after.discussionViews).toEqual(filter(preserved.discussionViews));
  expect(after.discussionCollapse).toEqual(filter(preserved.discussionCollapse));
  expect(repository.getHelperSelection('yt-dlp')).toBe('C:\\test-only\\yt-dlp.exe');
  raw(db => expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]));
  repository.close(); repository = ReaderRepository.open(file);
  expect(repository.bootstrap(['en'])).toEqual(after);
});
it.each(['closed', 'background', 'active-right', 'active-left'] as const)('removes %s real item and every owned record, preserving unrelated data and app tabs', position => {
  const id = insert();
  repository.toggleSeen({ itemId: id, commentId: repository.bootstrap(['en']).comments[id][0].id, subtree: true });
  repository.updatePreferences({ locale: 'pl' }, ['en']); repository.updatePreferences({ appearance: 'dark' }, ['en']);
  repository.changeWorkspace('openLibrary'); repository.changeWorkspace('openSettings');
  if (position === 'closed') repository.changeWorkspace('closeTab', discussionTab(id).id);
  else if (position === 'active-right') repository.changeWorkspace('activateTab', discussionTab(id).id);
  else if (position === 'active-left') { repository.changeWorkspace('moveTab', discussionTab(id).id, 4); repository.changeWorkspace('activateTab', discussionTab(id).id); }
  const before = repository.bootstrap(['en']), history = repository.history().filter(attempt => attempt.itemId !== id);
  const commentIds = before.comments[id].map(comment => comment.id);
  const after = repository.removeLibraryItem(id, ['en']);
  expect(after.items).toEqual(before.items.filter(item => item.id !== id));
  expect(after.comments).toEqual(Object.fromEntries(Object.entries(before.comments).filter(([itemId]) => itemId !== id)));
  expect(after.preferences).toEqual(before.preferences);
  expect(repository.history()).toEqual(history);
  expect(after.workspace.tabs.map(tab => tab.id)).toEqual(before.workspace.tabs.filter(tab => tab.id !== discussionTab(id).id).map(tab => tab.id));
  expect(after.workspace.activeTabId).toBe(position === 'active-right' ? 'library' : 'settings');
  raw(db => {
    for (const table of ['content_items', 'comments', 'extraction_attempts', 'workspace_tabs']) {
      const field = table === 'content_items' ? 'id' : 'item_id';
      expect(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${field}=?`).get(id)?.n).toBe(0);
    }
    for (const commentId of commentIds) expect(db.prepare('SELECT * FROM comment_state WHERE comment_id=?').get(commentId)).toBeUndefined();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  repository.close(); repository = ReaderRepository.open(file); repository.initializeDemo();
  expect(repository.bootstrap(['en'])).toEqual(after);
});
it('removing the last active discussion leaves an empty workspace', () => {
  const id = insert();
  for (const tab of repository.workspace().tabs) if (tab.id !== discussionTab(id).id) repository.changeWorkspace('closeTab', tab.id);
  expect(repository.removeLibraryItem(id, ['en']).workspace).toMatchObject({ tabs: [], activeTabId: null });
});
it.each(['real', 'video-demo'])('a late %s delete failure rolls back workspace, local state, comments, evidence and history', target => {
  const real = insert(), id = target === 'real' ? real : target;
  repository.bulkSeen({ itemId: id, seen: true, target: { kind: 'all' } });
  repository.setDiscussionCollapse({ itemId: id, kind: 'all', collapsed: true });
  repository.saveDiscussionView({ itemId: id, draft: defaultQuery, applied: defaultQuery, sort: 'original', anchor: { commentId: null, offset: 0 }, selected: null });
  const before = repository.bootstrap(['en']), history = repository.history();
  raw(db => db.exec("CREATE TRIGGER fail_remove BEFORE DELETE ON extraction_attempts BEGIN SELECT RAISE(ABORT,'late removal failure'); END"));
  expect(() => repository.removeLibraryItem(id, ['en'])).toThrow('late removal failure');
  expect(repository.bootstrap(['en'])).toEqual(before); expect(repository.history()).toEqual(history);
  raw(db => expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]));
});
it('synthetic baseline provenance supplies demo identity independently from removal, even after later observations', () => {
  const before = repository.bootstrap(['en']);
  expect(before.items.every(item => item.isDemo && item.removable)).toBe(true);
  const id = insert();
  expect(repository.getStoredItem(id)).toMatchObject({ isDemo: false, removable: true });
  // Author, title, source ID or a later backend must not reclassify a real baseline.
  raw(db => db.prepare("UPDATE content_items SET title='Quiet Workshop', author_display_name='Quiet Workshop' WHERE id=?").run(id));
  repository.ingest({ ...extraction, provenance: { ...extraction.provenance, backend: 'synthetic-demo' } });
  expect(repository.getStoredItem(id)?.isDemo).toBe(false);
  const service = new ReaderService(() => repository, ['en'], () => undefined);
  expect(service.dispatch('removeLibraryItem', [{ itemId: 'post-demo' }]).ok).toBe(true);
  expect(service.dispatch('removeLibraryItem', [{ itemId: 'missing' }])).toMatchObject({ error: { code: 'NOT_FOUND' } });
  expect(repository.getStoredItem('video-demo')).toMatchObject({ isDemo: true, removable: true });
});
it('complete backups retain demo identity and removability alongside real discussions', async () => {
  insert(); const before = repository.bootstrap(['en']);
  const backup = path.join(directory, 'backup.sqlite'); await repository.createBackup(backup);
  const restored = ReaderRepository.open(backup);
  try {
    expect(restored.bootstrap(['en'])).toEqual(before);
    const after = restored.removeLibraryItem('video-demo', ['en']);
    expect(after.items).toEqual(before.items.filter(item => item.id !== 'video-demo'));
    expect(after.comments['post-demo']).toEqual(before.comments['post-demo']);
    expect(repository.bootstrap(['en'])).toEqual(before);
  } finally { restored.close(); }
});
it('removal includes failed history recorded for its source before first successful acquisition', () => {
  const target = { sourceKind: 'youtube-video' as const, sourceId: 'VidDemo_001' };
  const failed = repository.ingest({ provenance: extraction.provenance, issues: [], coverage: { kind: 'failed', reason: 'before-baseline' } }, target);
  expect(failed.itemId).toBeUndefined();
  const id = insert();
  repository.removeLibraryItem(id, ['en']);
  expect(repository.history().some(attempt => attempt.id === failed.id)).toBe(false);
  raw(db => expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]));
});
it('unrelated removal stays available while a different source is being acquired and cannot reappear in its result', async () => {
  const id = insert();
  const other = repository.ingest(normalizeYtDlp(JSON.stringify({ ...fixture.raw, id: 'OtherDemo01' }), fixture.context), undefined, true).itemId as string;
  let finish: (value: Awaited<ReturnType<ExtractLive>>) => void = () => undefined;
  const service = new ReaderService(() => repository, ['en'], () => undefined, () => new Promise(resolve => { finish = resolve; }));
  const pending = service.dispatch('refresh', [{ itemId: id }]);
  expect(service.dispatch('removeLibraryItem', [{ itemId: other }]).ok).toBe(true);
  finish({ extraction });
  const result = await pending;
  if (!result.ok) throw new Error('Expected refresh');
  expect(result.value.state.items.some(item => item.id === other)).toBe(false);
  expect(result.value.state.items.some(item => item.id === id)).toBe(true);
});
it.each(['acquire', 'refresh'] as const)('rejects removal of the same source during %s; local workspace actions stay available', async operation => {
  const id = insert();
  let finish: (value: Awaited<ReturnType<ExtractLive>>) => void = () => undefined;
  const service = new ReaderService(() => repository, ['en'], () => undefined, () => new Promise(resolve => { finish = resolve; }));
  const pending = operation === 'acquire' ? service.dispatch('acquire', [{ url: 'https://youtu.be/VidDemo_001' }]) : service.dispatch('refresh', [{ itemId: id }]);
  expect(service.dispatch('removeLibraryItem', [{ itemId: id }])).toMatchObject({ error: { code: 'ACQUISITION_BUSY' } });
  expect(service.dispatch('openLibrary', []).ok).toBe(true);
  expect(service.dispatch('openSettings', []).ok).toBe(true);
  expect(service.dispatch('moveTab', [{ tabId: 'settings', toIndex: 0 }]).ok).toBe(true);
  const before = repository.workspace();
  finish({ extraction }); expect((await pending).ok).toBe(true);
  expect(repository.workspace().tabs).toEqual(before.tabs);
  const removed = service.dispatch('removeLibraryItem', [{ itemId: id }]); expect(removed.ok).toBe(true);
  repository.close(); repository = ReaderRepository.open(file);
  expect(repository.bootstrap(['en']).items.some(item => item.id === id)).toBe(false);
});

// eslint-disable-next-line import/no-unresolved
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './reader-repository';

let directory: string, file: string, repository: ReaderRepository;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-bootstrap-cache-'));
  file = path.join(directory, 'reader.sqlite');
  repository = ReaderRepository.open(file); repository.initializeDemo();
});
afterEach(() => {
  repository.close();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-bootstrap-cache-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});

it('reuses same-commit shared rows across windows while keeping owned workspace/view seeds separate', () => {
  const a = repository.initialWindowId(), b = repository.createPersistentWindow();
  repository.changeWorkspace('openStoredItem', 'video-demo', undefined, b);
  const first = repository.bootstrap(['en'], a), peer = repository.bootstrap(['pl'], b);
  expect(peer.comments).toBe(first.comments);
  expect(peer.items).toBe(first.items);
  expect(peer.seenUndo).toBe(first.seenUndo);
  expect(peer.workspace.tabs).toHaveLength(1);
  expect(first.workspace.tabs).toHaveLength(2);
  expect(Object.keys(peer.viewInstances)).toHaveLength(1);
  expect(Object.keys(peer.viewInstances).some(id => id in first.viewInstances)).toBe(false);
  // Preferences depend on the caller's language even without a stored locale.
  expect(first.preferences.locale).toBe('en'); expect(peer.preferences.locale).toBe('pl');
  repository.changeWorkspace('openSettings', undefined, undefined, b);
  expect(repository.bootstrap(['en'], a).workspace).toEqual(first.workspace);
  expect(repository.bootstrap(['en'], b).workspace.tabs).toHaveLength(2);
});

it('invalidates before post-COMMIT observers and retains old immutable snapshots through seen/bulk/Undo', () => {
  const first = repository.bootstrap(['en']), original = first.comments['video-demo'];
  const comment = original[0];
  let observed = first;
  const unsubscribe = repository.onCommit(() => { observed = repository.bootstrap(['en']); });
  repository.toggleSeen({ itemId: 'video-demo', commentId: comment.id, subtree: false, seen: !comment.seen });
  expect(observed.comments['video-demo'].find(row => row.id === comment.id)?.seen).toBe(!comment.seen);
  expect(original[0].seen).toBe(comment.seen);
  expect(observed.comments).not.toBe(first.comments);
  const bulk = repository.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  if (!bulk.undo) throw new Error('Missing recovery');
  expect(observed.comments['video-demo'].every(row => row.seen)).toBe(true);
  expect(observed.seenUndo['video-demo']?.id).toBe(bulk.undo.id);
  repository.undoSeen('video-demo', bulk.undo.id);
  expect(observed.seenUndo['video-demo']).toBeNull();
  expect(repository.itemSnapshot('video-demo').comments).toEqual(observed.comments['video-demo']);
  unsubscribe();
});

it('does not serve pre-transaction cached content in a removal return or after rollback', () => {
  const before = repository.bootstrap(['en']);
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TRIGGER fail_seen BEFORE UPDATE ON comment_state BEGIN SELECT RAISE(ABORT,'injected'); END");
    expect(() => repository.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } })).toThrow('injected');
    expect(repository.bootstrap(['en'])).toEqual(before);
    db.exec('DROP TRIGGER fail_seen');
    const removed = repository.removeLibraryItem('post-demo', ['en']);
    expect(removed.items.some(item => item.id === 'post-demo')).toBe(false);
    expect(removed.comments['post-demo']).toBeUndefined();
    expect(repository.bootstrap(['en'])).toEqual(removed);
    expect(before.comments['post-demo'].length).toBeGreaterThan(0);
  } finally { db.close(); }
});

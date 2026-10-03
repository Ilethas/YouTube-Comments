import { afterEach, beforeEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialComments, items } from '../../fixtures/discussions';
import { ReaderRepository, openReaderDatabase } from './reader-repository';
import { migrateDatabase, schemaVersion, UnsupportedSchemaError } from './migrations';
import { resolveDatabasePath } from './profile';

let directory: string;
let databasePath: string;
const connections: { close(): void }[] = [];
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'youtube-comments-test-'));
  databasePath = resolveDatabasePath({ mode: 'test', databasePath: path.join(directory, 'reader.sqlite') });
});
afterEach(() => {
  connections.splice(0).forEach(connection => connection.close());
  // Only the directory created by this test is owned/cleaned.
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('youtube-comments-test-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function repo() { const value = ReaderRepository.open(databasePath); connections.push(value); return value; }
function raw() { const value = new DatabaseSync(databasePath); connections.push(value); return value; }
function reopen(repository: ReaderRepository) {
  connections.splice(connections.indexOf(repository), 1);
  repository.close();
  return repo();
}

it('migrates an empty explicit temporary file from 0 to current schema', () => {
  const db = raw();
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
  migrateDatabase(db);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(schemaVersion);
  expect(db.prepare('SELECT * FROM preferences').get()).toMatchObject({ locale: null, appearance: 'system' });
});

it('round-trips normalized synthetic metadata, absent fields, identities and ordering', () => {
  const first = repo(); first.initializeDemo();
  const state = reopen(first).bootstrap(['en']);
  expect(state.items).toMatchObject(items);
  expect(state.comments).toMatchObject(initialComments);
});

it('rejects a newer schema without changing the file or stored data', () => {
  const first = repo(); first.initializeDemo();
  connections.splice(connections.indexOf(first), 1); first.close();
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA user_version = 999'); db.close();
  const before = readFileSync(databasePath);
  expect(() => ReaderRepository.open(databasePath)).toThrow(UnsupportedSchemaError);
  expect(readFileSync(databasePath)).toEqual(before);
});

it('isolates production/development and requires absolute test/development configuration', () => {
  const production = resolveDatabasePath({ mode: 'production', appData: directory });
  const development = resolveDatabasePath({ mode: 'development', appData: directory });
  expect(production).not.toBe(development);
  expect(production).not.toBe(databasePath);
  expect(development).not.toBe(databasePath);
  expect(development).toBe(path.join(directory, 'youtube-comments-development', 'reader.sqlite'));
  for (const root of ['', 'relative']) {
    expect(() => resolveDatabasePath({ mode: 'development', appData: root })).toThrow();
    expect(() => resolveDatabasePath({ mode: 'test', databasePath: root })).toThrow();
  }
  expect(() => resolveDatabasePath({ mode: 'test' } as never)).toThrow();
  expect(() => resolveDatabasePath({ mode: 'development' } as never)).toThrow();
  expect(() => resolveDatabasePath({ mode: 'unknown' } as never)).toThrow();
});

it('demo initialization is idempotent and never resets seen state or preferences', () => {
  const first = repo(); first.initializeDemo();
  first.toggleSeen({ itemId: 'video-demo', commentId: 'v1', subtree: false });
  first.updatePreferences({ locale: 'pl' }, ['en']);
  first.updatePreferences({ appearance: 'dark' }, ['en']);
  const before = first.bootstrap(['en']);
  const next = reopen(first); next.initializeDemo(); next.initializeDemo();
  expect(next.bootstrap(['en'])).toEqual(before);
});

it('ordinary toggle survives reopen and changes only its selected comment', () => {
  const first = repo(); first.initializeDemo();
  first.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: false });
  const state = reopen(first).bootstrap(['en']);
  expect(state.comments['video-demo']).toMatchObject(initialComments['video-demo'].map(comment => comment.id === 'v2' ? { ...comment, seen: false } : comment));
  expect(state.comments['post-demo']).toMatchObject(initialComments['post-demo']);
});

it.each([['v2', false, ['v2', 'v3', 'v4']], ['v3', true, ['v3', 'v4']]] as const)(
  'subtree %s applies its resulting state atomically across reopen, leaving ancestors/siblings alone', (id, seen, ids) => {
    const first = repo(); first.initializeDemo();
    first.toggleSeen({ itemId: 'video-demo', commentId: id, subtree: true });
    const state = reopen(first).bootstrap(['en']);
    expect(state.comments['video-demo']).toMatchObject(initialComments['video-demo'].map(comment => ids.some(id => id === comment.id) ? { ...comment, seen } : comment));
    expect(state.comments['post-demo']).toMatchObject(initialComments['post-demo']);
  });

it('a failed SQLite write after earlier subtree updates rolls back the entire operation', () => {
  const first = repo(); first.initializeDemo();
  const before = first.bootstrap(['en']);
  raw().exec(`CREATE TRIGGER fail_late BEFORE UPDATE ON comment_state
    WHEN NEW.comment_id = 'v4' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`);
  expect(() => first.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: true })).toThrow('injected failure');
  expect(reopen(first).bootstrap(['en'])).toEqual(before);
});

it('explicit language survives reopen and overrides later OS languages', () => {
  const first = repo();
  expect(first.preferences(['de', 'pl-PL'])).toEqual({ locale: 'pl', appearance: 'system' });
  expect(first.preferences(['de'])).toEqual({ locale: 'en', appearance: 'system' });
  first.updatePreferences({ locale: 'pl' }, ['en']);
  expect(reopen(first).preferences(['en-US']).locale).toBe('pl');
});

it.each(['system', 'light', 'dark'] as const)('appearance %s survives reopen without changing language or comment state', appearance => {
  const first = repo(); first.initializeDemo(); first.updatePreferences({ locale: 'pl' }, ['en']);
  first.updatePreferences({ appearance }, ['en']);
  const next = reopen(first);
  expect(next.preferences(['en'])).toEqual({ locale: 'pl', appearance });
  expect(next.bootstrap(['en']).comments).toMatchObject(initialComments);
});

it('enables foreign keys per connection and enforces same-item parents and local state constraints', () => {
  const first = repo(); first.initializeDemo();
  const db = openReaderDatabase(databasePath); connections.push(db);
  expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('delete');
  expect(() => db.exec("INSERT INTO comment_state VALUES ('missing', 1)")).toThrow();
  expect(() => db.exec("UPDATE comments SET parent_id = 'p1' WHERE id = 'v2'")).toThrow();
  expect(() => db.exec("UPDATE comments SET parent_id = 'v2' WHERE id = 'v2'")).toThrow();
  expect(() => db.exec("UPDATE comment_state SET seen = 2 WHERE comment_id = 'v1'")).toThrow();
  expect(() => db.exec("UPDATE preferences SET appearance = 'automatic'")).toThrow();
  expect(() => db.exec("UPDATE preferences SET locale = 'de'")).toThrow();
});

it('migration failure preserves existing version-0 data and rolls back schema/version, allowing retry', () => {
  const db = raw();
  db.exec("CREATE TABLE valuable (text TEXT); INSERT INTO valuable VALUES ('keep me');");
  expect(() => migrateDatabase(db, [
    { version: 1, apply: database => database.exec('CREATE TABLE tentative (id INTEGER)') },
    { version: 2, apply: database => database.exec('INSERT INTO missing VALUES (1)') },
  ])).toThrow();
  expect(db.prepare('SELECT * FROM valuable').get()?.text).toBe('keep me');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'tentative'").get()).toBeUndefined();
  migrateDatabase(db);
  expect(db.prepare('SELECT * FROM valuable').get()?.text).toBe('keep me');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(schemaVersion);
});

it('a real initial-schema collision fails opening without recreating/resetting existing data', () => {
  const db = raw(); db.exec("CREATE TABLE content_items (text TEXT); INSERT INTO content_items VALUES ('valuable');");
  expect(() => ReaderRepository.open(databasePath)).toThrow();
  expect(db.prepare('SELECT * FROM content_items').get()?.text).toBe('valuable');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
});

it('a later ordered migration runs only pending versions and preserves the prior committed schema on failure', () => {
  const first = repo(); first.initializeDemo();
  first.toggleSeen({ itemId: 'video-demo', commentId: 'v2', subtree: false });
  const before = first.bootstrap(['en']);
  const db = raw();
  const earlier = [1, 2, 3, 4].map(version => ({ version, apply: () => { throw new Error('Already applied migration must not run'); } }));
  expect(() => migrateDatabase(db, [...earlier, { version: 5, apply: database => {
    database.exec('CREATE TABLE future_test_table (id INTEGER)');
    throw new Error('Upgrade failed');
  } }])).toThrow('Upgrade failed');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
  expect(first.bootstrap(['en'])).toEqual(before);
  migrateDatabase(db, [...earlier, { version: 5, apply: database => database.exec('CREATE TABLE future_test_table (id INTEGER)') }]);
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
  expect(first.bootstrap(['en'])).toEqual(before);
});

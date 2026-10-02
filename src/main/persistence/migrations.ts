import type { DatabaseSync } from 'node:sqlite';

export class UnsupportedSchemaError extends Error {}
export interface Migration { readonly version: number; readonly apply: (db: DatabaseSync) => void }

export const migrations: readonly Migration[] = [{ version: 1, apply: db => db.exec(`
  CREATE TABLE content_items (
    id TEXT PRIMARY KEY NOT NULL,
    position INTEGER NOT NULL UNIQUE CHECK(position >= 0),
    kind TEXT NOT NULL CHECK(kind IN ('video','post')),
    source_id TEXT NOT NULL,
    title TEXT, description TEXT, text TEXT,
    author_source_id TEXT, author_display_name TEXT, author_handle TEXT,
    published_at TEXT, baseline_discovery_id TEXT NOT NULL,
    CHECK((kind = 'video' AND title IS NOT NULL AND text IS NULL)
       OR (kind = 'post' AND text IS NOT NULL AND title IS NULL AND description IS NULL))
  ) STRICT;
  CREATE TABLE comments (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES content_items(id),
    parent_id TEXT,
    position INTEGER NOT NULL CHECK(position >= 0),
    source_comment_id TEXT NOT NULL,
    author_source_id TEXT, author_display_name TEXT, author_handle TEXT,
    text TEXT NOT NULL, published_at TEXT,
    first_discovered_at TEXT NOT NULL, last_observed_at TEXT NOT NULL,
    first_discovery_id TEXT NOT NULL,
    like_count INTEGER CHECK(like_count >= 0),
    is_creator INTEGER CHECK(is_creator IN (0,1)),
    is_pinned INTEGER CHECK(is_pinned IN (0,1)),
    UNIQUE(item_id, id), UNIQUE(item_id, position),
    CHECK(parent_id IS NULL OR parent_id <> id),
    FOREIGN KEY(item_id, parent_id) REFERENCES comments(item_id, id) DEFERRABLE INITIALLY DEFERRED
  ) STRICT;
  CREATE INDEX comments_parent ON comments(item_id, parent_id);
  CREATE TABLE comment_state (
    comment_id TEXT PRIMARY KEY NOT NULL REFERENCES comments(id),
    seen INTEGER NOT NULL CHECK(seen IN (0,1))
  ) STRICT;
  CREATE TABLE preferences (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    locale TEXT CHECK(locale IN ('en','pl')),
    appearance TEXT NOT NULL CHECK(appearance IN ('system','light','dark'))
  ) STRICT;
  INSERT INTO preferences VALUES (1, NULL, 'system');
`) }];
export const schemaVersion = migrations[migrations.length - 1].version;

/** Short synchronous main-owned transaction; any failure rolls back all writes. */
export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = action();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Version 0 means no application schema. Ordered migrations and user_version
 * advance together, never by deleting/recreating a failed database. The optional
 * migration list supports deterministic failure tests without production hooks. */
export function migrateDatabase(db: DatabaseSync, ordered: readonly Migration[] = migrations): void {
  if (ordered.some((migration, index) => migration.version !== index + 1)) throw new Error('Unordered migrations');
  const current = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  const supported = ordered.length;
  if (current > supported) throw new UnsupportedSchemaError('Unsupported database schema');
  if (current === supported) return;
  transaction(db, () => {
    for (const migration of ordered.slice(current)) {
      migration.apply(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
  });
}

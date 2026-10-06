import type { DatabaseSync } from 'node:sqlite';
import { establishSyntheticHistory } from './synthetic-history';

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
`) }, { version: 2, apply: db => {
  db.exec(`
    CREATE UNIQUE INDEX content_source_identity ON content_items(kind, source_id);
    CREATE UNIQUE INDEX comment_source_identity ON comments(item_id, source_comment_id);
    CREATE TABLE extraction_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT REFERENCES content_items(id) DEFERRABLE INITIALLY DEFERRED,
      source_kind TEXT CHECK(source_kind IN ('youtube-video','youtube-community-post')),
      source_id TEXT,
      at TEXT NOT NULL, backend TEXT NOT NULL, backend_version TEXT NOT NULL,
      coverage TEXT NOT NULL CHECK(coverage IN ('unknown','partial','complete','failed')),
      outcome TEXT NOT NULL CHECK(outcome IN ('accepted','failed')),
      collection TEXT NOT NULL CHECK(collection IN ('present','unavailable','failed')),
      details TEXT NOT NULL CHECK(json_valid(details)),
      CHECK((source_kind IS NULL) = (source_id IS NULL)),
      CHECK((outcome = 'failed') = (coverage = 'failed')),
      CHECK(outcome = 'failed' OR (item_id IS NOT NULL AND source_kind IS NOT NULL))
    ) STRICT;
    ALTER TABLE content_items ADD COLUMN remote_json TEXT CHECK(remote_json IS NULL OR json_valid(remote_json));
    ALTER TABLE content_items ADD COLUMN baseline_attempt_id TEXT REFERENCES extraction_attempts(id);
    ALTER TABLE comments ADD COLUMN remote_json TEXT CHECK(remote_json IS NULL OR json_valid(remote_json));
    ALTER TABLE comments ADD COLUMN first_attempt_id TEXT REFERENCES extraction_attempts(id);
    ALTER TABLE comments ADD COLUMN last_attempt_id TEXT REFERENCES extraction_attempts(id);
  `);
  establishSyntheticHistory(db);
  // The nullable columns allow staged schema-1 demo inserts in ONE transaction.
  // Once evidence is present, identity/history consistency is enforced by SQLite.
  for (const event of ['INSERT', 'UPDATE']) {
    db.exec(`CREATE TRIGGER item_evidence_${event.toLowerCase()} BEFORE ${event} ON content_items
      WHEN NEW.remote_json IS NOT NULL BEGIN
        SELECT CASE WHEN json_extract(NEW.remote_json, '$.sourceId') IS NOT NEW.source_id
          OR json_extract(NEW.remote_json, '$.sourceKind') IS NOT CASE NEW.kind WHEN 'video' THEN 'youtube-video' ELSE 'youtube-community-post' END
          OR NEW.baseline_discovery_id IS NOT NEW.baseline_attempt_id
          OR NOT EXISTS (SELECT 1 FROM extraction_attempts WHERE id = NEW.baseline_attempt_id AND item_id = NEW.id AND outcome = 'accepted')
          THEN RAISE(ABORT, 'Invalid item evidence/history') END;
      END;
      CREATE TRIGGER comment_evidence_${event.toLowerCase()} BEFORE ${event} ON comments
      WHEN NEW.remote_json IS NOT NULL BEGIN
        SELECT CASE WHEN json_extract(NEW.remote_json, '$.sourceId') IS NOT NEW.source_comment_id
          OR json_extract(NEW.remote_json, '$.relationship.kind') NOT IN ('top-level','direct-parent','thread-containment')
          OR json_extract(NEW.remote_json, '$.relationship.kind') IS NULL
          OR (json_extract(NEW.remote_json, '$.relationship.kind') = 'direct-parent' AND COALESCE(length(json_extract(NEW.remote_json, '$.relationship.parentSourceId')),0) = 0)
          OR (json_extract(NEW.remote_json, '$.relationship.kind') = 'thread-containment' AND COALESCE(length(json_extract(NEW.remote_json, '$.relationship.rootSourceId')),0) = 0)
          OR NEW.first_discovery_id IS NOT NEW.first_attempt_id
          OR NOT EXISTS (SELECT 1 FROM extraction_attempts WHERE id = NEW.first_attempt_id AND item_id = NEW.item_id AND outcome = 'accepted')
          OR NOT EXISTS (SELECT 1 FROM extraction_attempts WHERE id = NEW.last_attempt_id AND item_id = NEW.item_id AND outcome = 'accepted')
          THEN RAISE(ABORT, 'Invalid comment evidence/history') END;
      END;`);
  }
} }, { version: 3, apply: db => db.exec(`
  CREATE TABLE workspace_tabs (
    item_id TEXT PRIMARY KEY NOT NULL REFERENCES content_items(id),
    position INTEGER NOT NULL UNIQUE CHECK(position >= 0)
  ) STRICT;
  CREATE TABLE workspace (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    active_item_id TEXT REFERENCES workspace_tabs(item_id) DEFERRABLE INITIALLY DEFERRED,
    revision INTEGER NOT NULL CHECK(revision >= 0)
  ) STRICT;
  INSERT INTO workspace_tabs SELECT id, position FROM content_items ORDER BY position;
  INSERT INTO workspace VALUES (1, (SELECT item_id FROM workspace_tabs ORDER BY position LIMIT 1), 0);
`) }, { version: 4, apply: db => db.exec(`
  CREATE TABLE unified_tabs (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('discussion','library','settings')),
    item_id TEXT UNIQUE REFERENCES content_items(id),
    position INTEGER NOT NULL UNIQUE CHECK(position >= 0),
    CHECK((kind = 'discussion' AND item_id IS NOT NULL AND id = 'discussion:' || item_id)
      OR (kind IN ('library','settings') AND item_id IS NULL AND id = kind))
  ) STRICT;
  CREATE TABLE unified_workspace (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    active_tab_id TEXT REFERENCES unified_tabs(id) DEFERRABLE INITIALLY DEFERRED,
    revision INTEGER NOT NULL CHECK(revision >= 0)
  ) STRICT;
  INSERT INTO unified_tabs SELECT 'discussion:' || item_id, 'discussion', item_id, position FROM workspace_tabs;
  INSERT INTO unified_workspace SELECT id, CASE WHEN active_item_id IS NULL THEN NULL ELSE 'discussion:' || active_item_id END, revision FROM workspace;
  DROP TABLE workspace;
  DROP TABLE workspace_tabs;
  ALTER TABLE unified_tabs RENAME TO workspace_tabs;
  ALTER TABLE unified_workspace RENAME TO workspace;
`) }, { version: 5, apply: db => db.exec(`
  ALTER TABLE extraction_attempts ADD COLUMN attempt_order INTEGER NOT NULL DEFAULT 0 CHECK(attempt_order >= 0);
  UPDATE extraction_attempts SET attempt_order = rowid;
  CREATE UNIQUE INDEX extraction_attempt_order ON extraction_attempts(attempt_order) WHERE attempt_order > 0;
  CREATE INDEX latest_accepted_attempt ON extraction_attempts(item_id, outcome, attempt_order DESC);
  CREATE TRIGGER assign_attempt_order AFTER INSERT ON extraction_attempts BEGIN
    UPDATE extraction_attempts SET attempt_order = (SELECT COALESCE(MAX(attempt_order), 0) + 1 FROM extraction_attempts)
      WHERE id = NEW.id;
  END;
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

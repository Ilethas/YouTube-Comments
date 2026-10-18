import type { DatabaseSync } from 'node:sqlite';

/** Additive M6 contract. v13 had no live-set evidence: retain its prior single
 * startup choice once at migration, without opening historical dormant windows. */
export function migrateWindowSession(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE window_restore (
      window_id TEXT PRIMARY KEY NOT NULL REFERENCES app_windows(id),
      position INTEGER NOT NULL UNIQUE CHECK(position >= 0)
    ) STRICT;
    CREATE TABLE window_session (
      id INTEGER PRIMARY KEY CHECK(id=1),
      version INTEGER NOT NULL CHECK(version=1),
      revision INTEGER NOT NULL CHECK(revision >= 0 AND revision < 9007199254740991),
      last_focused_id TEXT NOT NULL REFERENCES window_restore(window_id) DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE TABLE window_geometry (
      window_id TEXT PRIMARY KEY NOT NULL REFERENCES app_windows(id),
      revision INTEGER NOT NULL CHECK(revision >= 0 AND revision < 9007199254740991),
      geometry_json TEXT CHECK(geometry_json IS NULL OR (json_valid(geometry_json) AND length(geometry_json) <= 2048))
    ) STRICT;
    INSERT INTO window_restore SELECT id,0 FROM app_windows ORDER BY rowid LIMIT 1;
    INSERT INTO window_session SELECT 1,1,0,window_id FROM window_restore;
    INSERT INTO window_geometry SELECT id,0,NULL FROM app_windows;
    CREATE TRIGGER create_window_geometry AFTER INSERT ON app_windows BEGIN
      INSERT INTO window_geometry VALUES (NEW.id,0,NULL);
    END;
  `);
  if (!db.prepare('SELECT 1 FROM window_session').get()) throw new Error('Missing window session');
}

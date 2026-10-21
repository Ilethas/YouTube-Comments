import { DatabaseSync } from 'node:sqlite';
import { migrations, migrateDatabase, schemaVersion } from './migrations';
import { isDiscussionViewIntent, isViewIdentity } from '../../domain/discussion-view';
import { normalizeTranslationCode } from '../../shared/preferences';
import { isReaderAppearance } from '../../shared/appearance';
import { isWindowGeometry } from '../../domain/window-geometry';

export type BackupValidationReason = 'INVALID_BACKUP' | 'NEWER_BACKUP' | 'OLDER_BACKUP';
export class BackupValidationError extends Error {
  constructor(readonly reason: BackupValidationReason) { super(reason); }
}

const schemas = new Map<number, string>();
function structure(db: DatabaseSync): string {
  return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    .map(row => ({ ...row, sql: String(row.sql).trim().replace(/\s+/g, ' ') })));
}
function knownStructure(version: number): string {
  let value = schemas.get(version);
  if (!value) {
    const reference = new DatabaseSync(':memory:');
    try { migrateDatabase(reference, migrations.slice(0, version)); value = structure(reference); schemas.set(version, value); }
    finally { reference.close(); }
  }
  return value;
}
function requireEmpty(db: DatabaseSync, sql: string): void {
  if (db.prepare(sql).get()) throw new BackupValidationError('INVALID_BACKUP');
}

/** Read-only validation uses only application-authored SQL. Unknown tables,
 * indexes, views and triggers are rejected before any staged migration runs.
 * All historical schemas are recognized; only the staged copy may subsequently migrate. */
export function validateBackup(file: string): number {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA query_only=ON;');
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > schemaVersion) throw new BackupValidationError('NEWER_BACKUP');
    if (version < 1) throw new BackupValidationError('INVALID_BACKUP');
    if (structure(db) !== knownStructure(version)) throw new BackupValidationError('INVALID_BACKUP');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new BackupValidationError('INVALID_BACKUP');
    requireEmpty(db, 'PRAGMA foreign_key_check');
    if (db.prepare('SELECT count(*) AS n FROM preferences WHERE id=1').get()?.n !== 1) throw new BackupValidationError('INVALID_BACKUP');
    if (version >= 12) {
      const preferences = db.prepare('SELECT * FROM preferences WHERE id=1').get();
      const code = preferences?.custom_translation_target;
      if (code !== null && normalizeTranslationCode(code) !== code || preferences?.translation_target === 'custom' && code === null) throw new BackupValidationError('INVALID_BACKUP');
    }
    if (version >= 15) {
      const row = db.prepare('SELECT config_json FROM reader_appearance WHERE id=1').get();
      const value: unknown = JSON.parse(String(row?.config_json));
      if (!isReaderAppearance(value) || db.prepare('SELECT appearance FROM preferences WHERE id=1').get()?.appearance === 'custom' && !value.customThemeId) throw new BackupValidationError('INVALID_BACKUP');
    }
    requireEmpty(db, 'SELECT 1 FROM comments c LEFT JOIN comment_state s ON c.id=s.comment_id WHERE s.comment_id IS NULL LIMIT 1');
    if (version >= 3 && version <= 12 && db.prepare('SELECT count(*) AS n FROM workspace WHERE id=1').get()?.n !== 1) throw new BackupValidationError('INVALID_BACKUP');
    if (version >= 2) {
      requireEmpty(db, `SELECT 1 FROM extraction_attempts a JOIN content_items i ON i.id=a.item_id
        WHERE a.outcome='accepted' AND (a.source_id IS NOT i.source_id OR a.source_kind IS NOT
          CASE i.kind WHEN 'video' THEN 'youtube-video' ELSE 'youtube-community-post' END) LIMIT 1`);
      requireEmpty(db, `SELECT 1 FROM content_items i LEFT JOIN extraction_attempts a ON a.id=i.baseline_attempt_id
        WHERE i.remote_json IS NULL OR i.baseline_discovery_id IS NOT i.baseline_attempt_id
        OR a.item_id IS NOT i.id OR a.outcome IS NOT 'accepted'
        OR json_extract(i.remote_json,'$.sourceId') IS NOT i.source_id
        OR json_extract(i.remote_json,'$.sourceKind') IS NOT CASE i.kind WHEN 'video' THEN 'youtube-video' ELSE 'youtube-community-post' END LIMIT 1`);
      requireEmpty(db, `SELECT 1 FROM comments c LEFT JOIN extraction_attempts f ON f.id=c.first_attempt_id
        LEFT JOIN extraction_attempts l ON l.id=c.last_attempt_id WHERE c.remote_json IS NULL
        OR c.first_discovery_id IS NOT c.first_attempt_id OR f.item_id IS NOT c.item_id OR l.item_id IS NOT c.item_id
        OR f.outcome IS NOT 'accepted' OR l.outcome IS NOT 'accepted'
        OR json_extract(c.remote_json,'$.sourceId') IS NOT c.source_comment_id
        OR coalesce(json_extract(c.remote_json,'$.relationship.kind'),'') NOT IN ('top-level','direct-parent','thread-containment') LIMIT 1`);
      for (const table of ['content_items', 'comments']) {
        for (const row of db.prepare(`SELECT remote_json FROM ${table}`).iterate()) {
          const remote = JSON.parse(String(row.remote_json));
          if (!remote.author || !remote.publication || !remote.text) throw new BackupValidationError('INVALID_BACKUP');
          if (table === 'comments' && ((remote.relationship.kind === 'direct-parent' && !remote.relationship.parentSourceId)
            || (remote.relationship.kind === 'thread-containment' && !remote.relationship.rootSourceId))) throw new BackupValidationError('INVALID_BACKUP');
        }
      }
    }
    if (version >= 5) requireEmpty(db, 'SELECT 1 FROM extraction_attempts WHERE attempt_order<=0 LIMIT 1');
    if (version >= 6) requireEmpty(db, `SELECT 1 FROM seen_operations o WHERE o.changed_count !=
      (SELECT count(*) FROM seen_operation_entries e WHERE e.operation_id=o.id) LIMIT 1`);
    if (version >= 6) requireEmpty(db, `SELECT 1 FROM seen_operation_entries e JOIN comment_state s ON s.comment_id=e.comment_id
      WHERE e.written_revision>s.revision LIMIT 1`);
    if (version >= 8) for (const row of db.prepare(version <= 12 ? 'SELECT * FROM discussion_view_state' : 'SELECT * FROM discussion_view_intent').iterate()) {
      if (!isViewIdentity(row.item_id) || !isDiscussionViewIntent({ draft: JSON.parse(String(row.draft_query_json)),
        applied: JSON.parse(String(row.applied_query_json)), sort: row.sort,
        anchor: { commentId: row.anchor_comment_id, offset: row.anchor_offset }, selected: row.selected_comment_id })) throw new BackupValidationError('INVALID_BACKUP');
    }
    if (version >= 13) {
      if (!db.prepare('SELECT 1 FROM app_windows').get()) throw new BackupValidationError('INVALID_BACKUP');
      requireEmpty(db, `SELECT 1 FROM tab_instances t LEFT JOIN discussion_views v ON v.view_id=t.id WHERE t.kind='discussion' AND v.view_id IS NULL LIMIT 1`);
      requireEmpty(db, `SELECT 1 FROM tab_instances t LEFT JOIN item_resume_view r ON r.window_id=t.owner_window_id AND r.item_id=t.item_id WHERE t.kind='discussion' AND r.view_id IS NULL LIMIT 1`);
    }
    if (version >= 14) {
      if (db.prepare('SELECT count(*) AS n FROM window_session WHERE id=1').get()?.n !== 1 || !db.prepare('SELECT 1 FROM window_restore').get()) throw new BackupValidationError('INVALID_BACKUP');
      requireEmpty(db, 'SELECT 1 FROM app_windows w LEFT JOIN window_geometry g ON g.window_id=w.id WHERE g.window_id IS NULL LIMIT 1');
      for (const row of db.prepare('SELECT geometry_json FROM window_geometry WHERE geometry_json IS NOT NULL').iterate()) {
        if (!isWindowGeometry(JSON.parse(String(row.geometry_json)))) throw new BackupValidationError('INVALID_BACKUP');
      }
    }
    return version;
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    throw new BackupValidationError('INVALID_BACKUP');
  } finally { db?.close(); }
}

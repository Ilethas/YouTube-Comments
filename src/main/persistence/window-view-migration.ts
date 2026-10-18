import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Runs inside the migration transaction. Legacy payloads are copied by SQL,
 * byte for byte; only application instance identities are newly generated. */
export function migrateWindowViews(db: DatabaseSync): void {
  if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Invalid legacy ownership');
  const workspace = db.prepare('SELECT * FROM workspace WHERE id=1').get();
  if (!workspace || db.prepare('SELECT count(*) AS n FROM workspace').get()?.n !== 1) throw new Error('Missing legacy workspace');
  const items = db.prepare('SELECT id FROM content_items ORDER BY position').all();
  const tabs = db.prepare('SELECT * FROM workspace_tabs ORDER BY position').all();
  const windowId = randomUUID();
  const views = new Map(items.map(item => [String(item.id), randomUUID()]));
  const mappedTabs = new Map(tabs.map(tab => [String(tab.id), tab.kind === 'discussion' ? views.get(String(tab.item_id)) : randomUUID()]));
  if ([...mappedTabs.values()].some(id => !id) || workspace.active_tab_id !== null && !mappedTabs.has(String(workspace.active_tab_id))) throw new Error('Unmappable legacy tab');
  const mappedId = (oldId: string) => { const id = mappedTabs.get(oldId); if (!id) throw new Error('Unmappable legacy tab'); return id; };
  db.exec(`
    CREATE TABLE app_windows (
      id TEXT PRIMARY KEY NOT NULL,
      active_tab_id TEXT,
      topology_revision INTEGER NOT NULL CHECK(topology_revision >= 0),
      FOREIGN KEY(id,active_tab_id) REFERENCES window_tabs(window_id,tab_id) DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE TABLE tab_instances (
      id TEXT PRIMARY KEY NOT NULL,
      owner_window_id TEXT NOT NULL REFERENCES app_windows(id),
      kind TEXT NOT NULL CHECK(kind IN ('discussion','library','settings')),
      item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
      CHECK((kind='discussion' AND item_id IS NOT NULL) OR (kind IN ('library','settings') AND item_id IS NULL)),
      UNIQUE(id,item_id,kind), UNIQUE(owner_window_id,id,kind), UNIQUE(owner_window_id,id,item_id)
    ) STRICT;
    CREATE UNIQUE INDEX window_singleton_instances ON tab_instances(owner_window_id,kind) WHERE kind IN ('library','settings');
    CREATE TABLE window_tabs (
      window_id TEXT NOT NULL REFERENCES app_windows(id),
      tab_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('discussion','library','settings')),
      position INTEGER NOT NULL CHECK(position >= 0),
      PRIMARY KEY(window_id,tab_id), UNIQUE(window_id,position),
      FOREIGN KEY(window_id,tab_id,kind) REFERENCES tab_instances(owner_window_id,id,kind) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE discussion_views (
      view_id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'discussion' CHECK(kind='discussion'),
      intent_revision INTEGER NOT NULL DEFAULT 0 CHECK(intent_revision >= 0),
      collapse_revision INTEGER NOT NULL DEFAULT 0 CHECK(collapse_revision >= 0),
      UNIQUE(view_id,item_id),
      FOREIGN KEY(view_id,item_id,kind) REFERENCES tab_instances(id,item_id,kind) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE item_resume_view (
      window_id TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
      view_id TEXT NOT NULL,
      PRIMARY KEY(window_id,item_id),
      FOREIGN KEY(window_id,view_id,item_id) REFERENCES tab_instances(owner_window_id,id,item_id) ON DELETE CASCADE,
      FOREIGN KEY(view_id,item_id) REFERENCES discussion_views(view_id,item_id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE discussion_view_intent (
      view_id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      draft_query_json TEXT NOT NULL CHECK(length(draft_query_json) <= 110000),
      applied_query_json TEXT NOT NULL CHECK(length(applied_query_json) <= 110000),
      sort TEXT NOT NULL CHECK(sort IN ('original','newest','oldest','most-liked','latest-activity')),
      anchor_comment_id TEXT,
      anchor_offset REAL NOT NULL CHECK(anchor_offset BETWEEN -100000 AND 100000),
      selected_comment_id TEXT,
      FOREIGN KEY(view_id,item_id) REFERENCES discussion_views(view_id,item_id) ON DELETE CASCADE,
      FOREIGN KEY(item_id,anchor_comment_id) REFERENCES comments(item_id,id),
      FOREIGN KEY(item_id,selected_comment_id) REFERENCES comments(item_id,id)
    ) STRICT;
    CREATE TABLE view_collapse (
      view_id TEXT PRIMARY KEY NOT NULL,
      item_id TEXT NOT NULL,
      default_collapsed INTEGER NOT NULL CHECK(default_collapsed IN (0,1)),
      UNIQUE(view_id,item_id),
      FOREIGN KEY(view_id,item_id) REFERENCES discussion_views(view_id,item_id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE view_collapse_overrides (
      view_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      PRIMARY KEY(view_id,comment_id),
      FOREIGN KEY(view_id,item_id) REFERENCES view_collapse(view_id,item_id) ON DELETE CASCADE,
      FOREIGN KEY(item_id,comment_id) REFERENCES comments(item_id,id) ON DELETE CASCADE
    ) STRICT;
    CREATE TRIGGER clear_deleted_active_tab BEFORE DELETE ON tab_instances BEGIN
      UPDATE app_windows SET active_tab_id=NULL,topology_revision=topology_revision+1 WHERE active_tab_id=OLD.id;
    END;
    CREATE TRIGGER create_discussion_view AFTER INSERT ON tab_instances WHEN NEW.kind='discussion' BEGIN
      INSERT INTO discussion_views(view_id,item_id) VALUES (NEW.id,NEW.item_id);
    END;
    CREATE TRIGGER immutable_tab_identity BEFORE UPDATE OF id,kind,item_id ON tab_instances
      WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.item_id IS NOT OLD.item_id BEGIN
      SELECT RAISE(ABORT,'Tab instance identity is immutable');
    END;
    CREATE TRIGGER retain_discussion_view BEFORE DELETE ON discussion_views
      WHEN EXISTS(SELECT 1 FROM tab_instances WHERE id=OLD.view_id) BEGIN
      SELECT RAISE(ABORT,'Discussion tab requires its view');
    END;
  `);
  db.prepare('INSERT INTO app_windows VALUES (?,?,?)').run(windowId,
    workspace.active_tab_id === null ? null : mappedId(String(workspace.active_tab_id)), workspace.revision);
  for (const [itemId, viewId] of views) {
    db.prepare("INSERT INTO tab_instances VALUES (?,?,'discussion',?)").run(viewId, windowId, itemId);
    db.prepare('INSERT INTO item_resume_view VALUES (?,?,?)').run(windowId, itemId, viewId);
    db.prepare('INSERT INTO discussion_view_intent SELECT ?,item_id,draft_query_json,applied_query_json,sort,anchor_comment_id,anchor_offset,selected_comment_id FROM discussion_view_state WHERE item_id=?').run(viewId, itemId);
    db.prepare('INSERT INTO view_collapse SELECT ?,item_id,default_collapsed FROM discussion_collapse WHERE item_id=?').run(viewId, itemId);
    db.prepare('INSERT INTO view_collapse_overrides SELECT ?,item_id,comment_id FROM comment_collapse_overrides WHERE item_id=?').run(viewId, itemId);
  }
  for (const tab of tabs) {
    const id = mappedId(String(tab.id));
    if (tab.kind !== 'discussion') db.prepare('INSERT INTO tab_instances VALUES (?,?,?,NULL)').run(id, windowId, tab.kind);
    db.prepare('INSERT INTO window_tabs VALUES (?,?,?,?)').run(windowId, id, tab.kind, tab.position);
  }
  for (const [oldTable, newTable] of [['workspace_tabs','window_tabs'], ['discussion_view_state','discussion_view_intent'],
    ['discussion_collapse','view_collapse'], ['comment_collapse_overrides','view_collapse_overrides']]) {
    if (db.prepare(`SELECT count(*) AS n FROM ${oldTable}`).get()?.n !== db.prepare(`SELECT count(*) AS n FROM ${newTable}`).get()?.n) throw new Error('Incomplete legacy mapping');
  }
  // Drop children first. None of the authoritative content/history tables rebuild.
  db.exec('DROP TABLE comment_collapse_overrides; DROP TABLE discussion_collapse; DROP TABLE discussion_view_state; DROP TABLE workspace; DROP TABLE workspace_tabs;');
  if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Invalid migrated ownership');
}

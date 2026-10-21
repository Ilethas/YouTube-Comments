import { DatabaseSync } from 'node:sqlite';
import { migrations, migrateDatabase } from '../migrations';

/** Historical fixture construction only. Reconstruct the single legacy workspace
 * and item-owned optional rows before tests exercise original migrations. */
export function downgradeWindowFixture(db: DatabaseSync): void {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='app_windows'").get()) return;
  if (db.prepare('SELECT count(*) AS n FROM app_windows').get()?.n !== 1) throw new Error('Single-window fixture required');
  const reference = new DatabaseSync(':memory:');
  if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='window_session'").get()) db.exec('DROP TRIGGER create_window_geometry; DROP TABLE window_session; DROP TABLE window_restore; DROP TABLE window_geometry;');
  try {
    migrateDatabase(reference, migrations.slice(0, 12));
    const sql = (name: string) => String(reference.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name)?.sql);
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='reader_appearance'").get()) {
      db.exec('CREATE TEMP TABLE fixture_appearance_preferences AS SELECT * FROM preferences; DROP TABLE preferences; DROP TABLE reader_appearance;');
      db.exec(sql('preferences'));
      db.exec('INSERT INTO preferences (id,locale,appearance,translation_target,selection_controls,include_collapsed_in_prefix,custom_translation_target) SELECT id,locale,appearance,translation_target,selection_controls,include_collapsed_in_prefix,custom_translation_target FROM fixture_appearance_preferences; DROP TABLE fixture_appearance_preferences;');
    }
    for (const name of ['workspace_tabs', 'workspace', 'discussion_view_state', 'discussion_collapse', 'comment_collapse_overrides']) db.exec(sql(name));
    db.exec(`INSERT INTO workspace_tabs SELECT CASE t.kind WHEN 'discussion' THEN 'discussion:'||t.item_id ELSE t.kind END,t.kind,t.item_id,p.position
      FROM window_tabs p JOIN tab_instances t ON t.id=p.tab_id;
      INSERT INTO workspace SELECT 1,CASE WHEN w.active_tab_id IS NULL THEN NULL WHEN t.kind='discussion' THEN 'discussion:'||t.item_id ELSE t.kind END,w.topology_revision
        FROM app_windows w LEFT JOIN tab_instances t ON t.id=w.active_tab_id;
      INSERT INTO discussion_view_state SELECT item_id,draft_query_json,applied_query_json,sort,anchor_comment_id,anchor_offset,selected_comment_id FROM discussion_view_intent;
      INSERT INTO discussion_collapse SELECT item_id,default_collapsed FROM view_collapse;
      INSERT INTO comment_collapse_overrides SELECT item_id,comment_id FROM view_collapse_overrides;
      DROP TABLE view_collapse_overrides; DROP TABLE view_collapse; DROP TABLE discussion_view_intent; DROP TABLE item_resume_view;
      DROP TABLE discussion_views; UPDATE app_windows SET active_tab_id=NULL; DROP TABLE window_tabs; DROP TABLE tab_instances; DROP TABLE app_windows;
      PRAGMA user_version=12;`);
  } finally { reference.close(); }
}

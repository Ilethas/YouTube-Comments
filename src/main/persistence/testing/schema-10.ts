import { DatabaseSync } from 'node:sqlite';
import { downgradeWindowFixture } from './schema-12';
import { migrations, migrateDatabase } from '../migrations';

/** Test fixture construction only: restore the exact historical schema before
 * existing tests strip earlier increments. Never used by profile startup. */
export function downgradeSelectionFixture(db: DatabaseSync): void {
  downgradeCustomTranslationFixture(db);
  if (!db.prepare('PRAGMA table_info(preferences)').all().some(row => row.name === 'selection_controls')) return;
  const reference = new DatabaseSync(':memory:');
  try {
    migrateDatabase(reference, migrations.slice(0, 10));
    const sql = (name: string) => String(reference.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name)?.sql);
    db.exec(`CREATE TEMP TABLE fixture_operations AS SELECT * FROM seen_operations;
      CREATE TEMP TABLE fixture_entries AS SELECT * FROM seen_operation_entries;
      DROP TABLE seen_operation_entries; DROP TABLE seen_operations;`);
    db.exec(sql('seen_operations')); db.exec('INSERT INTO seen_operations SELECT * FROM fixture_operations');
    db.exec(sql('seen_operation_entries')); db.exec(sql('seen_entries_comment'));
    db.exec(`INSERT INTO seen_operation_entries SELECT * FROM fixture_entries;
      DROP TABLE fixture_entries; DROP TABLE fixture_operations;
      ALTER TABLE preferences DROP COLUMN selection_controls;
      ALTER TABLE preferences DROP COLUMN include_collapsed_in_prefix;
      PRAGMA user_version=10;`);
  } finally { reference.close(); }
}

/** Reconstruct schema 11 exactly, retaining every historical preference field. */
export function downgradeCustomTranslationFixture(db: DatabaseSync): void {
  downgradeWindowFixture(db);
  if (!db.prepare('PRAGMA table_info(preferences)').all().some(row => row.name === 'custom_translation_target')) return;
  const reference = new DatabaseSync(':memory:');
  try {
    migrateDatabase(reference, migrations.slice(0, 11));
    const sql = String(reference.prepare("SELECT sql FROM sqlite_schema WHERE name='preferences'").get()?.sql);
    db.exec(`CREATE TEMP TABLE fixture_preferences AS SELECT id,locale,appearance,
      CASE WHEN translation_target='custom' THEN 'app' ELSE translation_target END AS translation_target,
      selection_controls,include_collapsed_in_prefix FROM preferences; DROP TABLE preferences;`);
    db.exec(sql);
    db.exec('INSERT INTO preferences SELECT * FROM fixture_preferences; DROP TABLE fixture_preferences; PRAGMA user_version=11;');
  } finally { reference.close(); }
}

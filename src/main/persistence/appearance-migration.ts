import type { DatabaseSync } from 'node:sqlite';
import { defaultReaderAppearance } from '../../shared/appearance';

/** Forward-only schema 15. Historical definitions remain exact. All existing
 * preference values, including retained custom translation codes, copy verbatim. */
export function migrateAppearance(db: DatabaseSync): void {
  db.exec(`CREATE TABLE preferences_next (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    locale TEXT CHECK(locale IN ('en','pl')),
    appearance TEXT NOT NULL CHECK(appearance IN ('system','light','dark','charcoal','custom')),
    translation_target TEXT NOT NULL DEFAULT 'app'
      CHECK(translation_target IN ('app','en','pl','de','fr','es','it','pt','ja','ko','zh-CN','custom')),
    selection_controls TEXT NOT NULL DEFAULT 'on-demand' CHECK(selection_controls IN ('on-demand','always')),
    include_collapsed_in_prefix INTEGER NOT NULL DEFAULT 1 CHECK(include_collapsed_in_prefix IN (0,1)),
    custom_translation_target TEXT CHECK(custom_translation_target IS NULL OR (
      length(custom_translation_target) BETWEEN 2 AND 35
      AND custom_translation_target NOT GLOB '*[^A-Za-z0-9-]*'
      AND lower(custom_translation_target) <> 'auto')),
    CHECK(translation_target <> 'custom' OR custom_translation_target IS NOT NULL)
  ) STRICT;
  INSERT INTO preferences_next SELECT * FROM preferences;
  DROP TABLE preferences;
  ALTER TABLE preferences_next RENAME TO preferences;
  CREATE TABLE reader_appearance (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    config_json TEXT NOT NULL CHECK(length(config_json) <= 262144 AND json_valid(config_json))
  ) STRICT;`);
  db.prepare('INSERT INTO reader_appearance VALUES (1, ?)').run(JSON.stringify(defaultReaderAppearance));
}

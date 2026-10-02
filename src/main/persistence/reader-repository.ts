import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildCommentTree, toggleSeen } from '../../domain/discussion';
import type { Author, Comment, ContentItem } from '../../domain/discussion';
import { initialComments, items } from '../../fixtures/discussions';
import { initialLocale } from '../../shared/preferences';
import type { Preferences } from '../../shared/preferences';
import type { PreferenceChange, ReaderState, ToggleSeenRequest } from '../../shared/reader-api';
import { migrateDatabase, transaction } from './migrations';

type Row = Record<string, string | number | bigint | Uint8Array | null>;
function optionalText(row: Row, key: string): string | undefined {
  return row[key] === null ? undefined : String(row[key]);
}
function author(row: Row): Author | undefined {
  const sourceId = optionalText(row, 'author_source_id');
  const displayName = optionalText(row, 'author_display_name');
  const handle = optionalText(row, 'author_handle');
  return sourceId !== undefined || displayName !== undefined || handle !== undefined ? { sourceId, displayName, handle } : undefined;
}
function authorValues(value?: Author) { return [value?.sourceId ?? null, value?.displayName ?? null, value?.handle ?? null]; }
function booleanValue(value?: boolean) { return value === undefined ? null : Number(value); }
export class MissingCommentError extends Error {}

/** Shared connection setup for main-owned repositories and isolated integration
 * tests. Foreign keys are enabled on every connection, never assumed globally. */
export function openReaderDatabase(databasePath: string): DatabaseSync {
  if (!path.isAbsolute(databasePath)) throw new Error('Absolute database path required');
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
    if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) throw new Error('Foreign keys unavailable');
    migrateDatabase(db);
    return db;
  } catch (error) { db.close(); throw error; }
}

/** Main-side SQLite authority. Remote fixture inserts and local state writes are
 * separate operations; no row type or driver handle is exposed through IPC. */
export class ReaderRepository {
  private constructor(private readonly db: DatabaseSync) {}

  /** Requires a resolved absolute path. Failure closes the connection and keeps
   * the existing file; no reset/recovery fallback is performed. */
  static open(databasePath: string): ReaderRepository {
    return new ReaderRepository(openReaderDatabase(databasePath));
  }

  close(): void { this.db.close(); }

  /** Only empty demo databases are initialized. Existing discussions/preferences
   * are never replaced or upserted. These are synthetic observations, not a
   * first real acquisition or evidence of source-ID uniqueness. */
  initializeDemo(): void {
    transaction(this.db, () => {
      if (Number(this.db.prepare('SELECT count(*) AS count FROM content_items').get()?.count) !== 0) return;
      const insertItem = this.db.prepare(`INSERT INTO content_items
        (id, position, kind, source_id, title, description, text, author_source_id,
         author_display_name, author_handle, published_at, baseline_discovery_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insertComment = this.db.prepare(`INSERT INTO comments
        (id,item_id,parent_id,position,source_comment_id,author_source_id,author_display_name,
         author_handle,text,published_at,first_discovered_at,last_observed_at,first_discovery_id,
         like_count,is_creator,is_pinned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insertState = this.db.prepare('INSERT INTO comment_state VALUES (?,?)');
      items.forEach((item, index) => {
        buildCommentTree(initialComments[item.id]);
        insertItem.run(item.id, index, item.kind, item.sourceId, item.kind === 'video' ? item.title : null,
          item.kind === 'video' ? item.description ?? null : null, item.kind === 'post' ? item.text : null,
          ...authorValues(item.author), item.publishedAt ?? null, item.baselineDiscoveryId);
        initialComments[item.id].forEach((comment, position) => {
          insertComment.run(comment.id, item.id, comment.parentId, position, comment.source.commentId,
            ...authorValues(comment.author), comment.text, comment.publishedAt ?? null,
            comment.discovery.firstDiscoveredAt, comment.discovery.lastObservedAt, comment.discovery.firstDiscoveryId,
            comment.likeCount ?? null, booleanValue(comment.isCreator), booleanValue(comment.isPinned));
          insertState.run(comment.id, Number(comment.seen));
        });
      });
    });
  }

  private readItems(): readonly ContentItem[] {
    return this.db.prepare('SELECT * FROM content_items ORDER BY position').all().map(row => {
      const base = { id: String(row.id), sourceId: String(row.source_id), author: author(row),
        publishedAt: optionalText(row, 'published_at'), baselineDiscoveryId: String(row.baseline_discovery_id) };
      return row.kind === 'video'
        ? { ...base, kind: 'video', title: String(row.title), description: optionalText(row, 'description') }
        : { ...base, kind: 'post', text: String(row.text) };
    });
  }

  private readComments(item: ContentItem): readonly Comment[] {
    return this.db.prepare(`SELECT c.*, s.seen FROM comments c
      LEFT JOIN comment_state s ON s.comment_id = c.id WHERE c.item_id = ? ORDER BY c.position`).all(item.id).map(row => {
      if (row.seen !== 0 && row.seen !== 1) throw new Error('Missing local comment state');
      return {
        id: String(row.id), itemId: item.id, parentId: row.parent_id === null ? null : String(row.parent_id),
        source: { kind: item.kind, itemId: item.sourceId, commentId: String(row.source_comment_id) },
        author: author(row), text: String(row.text), publishedAt: optionalText(row, 'published_at'),
        discovery: { firstDiscoveredAt: String(row.first_discovered_at), lastObservedAt: String(row.last_observed_at),
          firstDiscoveryId: String(row.first_discovery_id) },
        likeCount: row.like_count === null ? undefined : Number(row.like_count),
        isCreator: row.is_creator === null ? undefined : row.is_creator === 1,
        isPinned: row.is_pinned === null ? undefined : row.is_pinned === 1, seen: row.seen === 1,
      };
    });
  }

  preferences(languages: readonly string[]): Preferences {
    const row = this.db.prepare('SELECT locale, appearance FROM preferences WHERE id = 1').get();
    if (!row) throw new Error('Missing preferences');
    return { locale: row.locale === null ? initialLocale(languages) : row.locale as Preferences['locale'],
      appearance: row.appearance as Preferences['appearance'] };
  }

  bootstrap(languages: readonly string[]): ReaderState {
    const items = this.readItems();
    return { items, comments: Object.fromEntries(items.map(item => [item.id, this.readComments(item)])),
      preferences: this.preferences(languages) };
  }

  /** Read current stored target state and resolve every descendant through the
   * pure domain rule inside ONE transaction. Return only committed state. */
  toggleSeen(request: ToggleSeenRequest): readonly Comment[] {
    return transaction(this.db, () => {
      const item = this.readItems().find(item => item.id === request.itemId);
      if (!item) throw new MissingCommentError('Unknown discussion');
      const current = this.readComments(item);
      if (!current.some(comment => comment.id === request.commentId)) throw new MissingCommentError('Unknown comment');
      const changed = toggleSeen(current, request.commentId, request.subtree);
      const update = this.db.prepare('UPDATE comment_state SET seen = ? WHERE comment_id = ?');
      changed.forEach((comment, index) => {
        if (comment !== current[index]) {
          if (update.run(Number(comment.seen), comment.id).changes !== 1) throw new Error('Missing local state');
        }
      });
      return changed;
    });
  }

  updatePreferences(change: PreferenceChange, languages: readonly string[]): Preferences {
    return transaction(this.db, () => {
      if ('locale' in change) this.db.prepare('UPDATE preferences SET locale = ? WHERE id = 1').run(change.locale);
      else this.db.prepare('UPDATE preferences SET appearance = ? WHERE id = 1').run(change.appearance);
      return this.preferences(languages);
    });
  }
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCommentTree, toggleSeen } from '../../domain/discussion';
import type { Author, Comment, ContentItem } from '../../domain/discussion';
import { initialComments, items } from '../../fixtures/discussions';
import { initialLocale } from '../../shared/preferences';
import type { Preferences } from '../../shared/preferences';
import type { PreferenceChange, ReaderState, ToggleSeenRequest } from '../../shared/reader-api';
import { migrateDatabase, transaction } from './migrations';
import { establishSyntheticHistory } from './synthetic-history';
import type { AuthorObservation, ContentObservation, CommentObservation, NormalizedExtraction } from '../../domain/extraction-observation';
import { observedValue, planObservationMerge, projectRelationships } from '../../domain/observation-merge';
import type { AttemptTarget, MergeAttempt, StoredCommentObservation, StoredContentObservation, StoredObservationDiscussion } from '../../domain/observation-merge';
import { closeWorkspaceTab, discussionTab, openWorkspaceTab, moveWorkspaceTab } from '../../domain/workspace';
import type { WorkspaceState, WorkspaceTab } from '../../domain/workspace';
import { isHttpsImageUrl } from '../../domain/remote-image';

type Row = Record<string, string | number | bigint | Uint8Array | null>;
function optionalText(row: Row, key: string): string | undefined {
  return row[key] === null ? undefined : String(row[key]);
}
function author(row: Row, remote: AuthorObservation): Author | undefined {
  const sourceId = optionalText(row, 'author_source_id');
  const displayName = optionalText(row, 'author_display_name');
  const handle = optionalText(row, 'author_handle');
  const avatarUrl = observedValue(remote.avatarUrl);
  return sourceId !== undefined || displayName !== undefined || handle !== undefined || avatarUrl !== undefined
    ? { sourceId, displayName, handle, ...(isHttpsImageUrl(avatarUrl) ? { avatarUrl } : {}) } : undefined;
}
/** Older normalized JSON lacks this optional evidence; default in memory only.
 * No data rewrite or avatar-only migration is needed. */
function remoteEvidence<T extends StoredCommentObservation | StoredContentObservation>(json: string): T {
  const remote = JSON.parse(json) as T;
  return { ...remote, author: { ...remote.author, avatarUrl: remote.author.avatarUrl ?? { status: 'unknown', reason: 'unavailable' } } };
}
function authorValues(value?: Author) { return [value?.sourceId ?? null, value?.displayName ?? null, value?.handle ?? null]; }
function booleanValue(value?: boolean) { return value === undefined ? null : Number(value); }
export class MissingCommentError extends Error {}
export class NotRemovableError extends Error {}

/** Privileged dependency injection, never a renderer capability. */
export interface IngestionDependencies { readonly now: () => string; readonly newId: () => string }
const ingestionDefaults: IngestionDependencies = { now: () => new Date().toISOString(), newId: randomUUID };
function authorObservationValues(remote: ContentObservation | CommentObservation) {
  return [observedValue(remote.author.sourceId) ?? null, observedValue(remote.author.displayName) ?? null, observedValue(remote.author.handle) ?? null];
}
const diagnosticText = (value: string) => Array.from(value).filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').slice(0, 240);
function diagnosticAttempt(attempt: MergeAttempt): MergeAttempt {
  return { ...attempt,
    provenance: { backend: diagnosticText(attempt.provenance.backend), version: diagnosticText(attempt.provenance.version),
      evidence: attempt.provenance.evidence.slice(0, 32).map(diagnosticText),
      ...(attempt.provenance.fixture ? { fixture: { id: diagnosticText(attempt.provenance.fixture.id), preparation: attempt.provenance.fixture.preparation } } : {}) },
    coverage: attempt.coverage.kind === 'failed' ? { kind: 'failed', reason: diagnosticText(attempt.coverage.reason) }
      : attempt.coverage.kind === 'unknown' ? { kind: 'unknown' } : { kind: attempt.coverage.kind, evidence: attempt.coverage.evidence.slice(0, 32).map(diagnosticText) },
    issues: attempt.issues.map(issue => ({ code: issue.code, severity: issue.severity, location: diagnosticText(issue.location),
      ...(issue.sourceId === undefined ? {} : { sourceId: issue.sourceId }),
      ...(issue.relatedLocations === undefined ? {} : { relatedLocations: issue.relatedLocations.map(diagnosticText) }) })),
  };
}

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
  private constructor(private readonly db: DatabaseSync, private readonly ingestion: IngestionDependencies) {}

  /** Requires a resolved absolute path. Failure closes the connection and keeps
   * the existing file; no reset/recovery fallback is performed. */
  static open(databasePath: string, ingestion: IngestionDependencies = ingestionDefaults): ReaderRepository {
    return new ReaderRepository(openReaderDatabase(databasePath), ingestion);
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
      establishSyntheticHistory(this.db, this.ingestion.newId);
      this.writeWorkspace({ tabs: items.map(item => discussionTab(item.id)), activeTabId: items[0] ? discussionTab(items[0].id).id : null, revision: this.workspace().revision + 1 });
    });
  }

  private readItems(): readonly ContentItem[] {
    return this.db.prepare('SELECT * FROM content_items ORDER BY position').all().map(row => {
      if (row.remote_json === null) throw new Error('Missing durable item evidence');
      const remote = remoteEvidence<StoredContentObservation>(String(row.remote_json));
      const removable = this.db.prepare('SELECT backend FROM extraction_attempts WHERE id=?').get(row.baseline_attempt_id)?.backend !== 'synthetic-demo';
      // Attempts are append-only and inserted inside the accepted merge transaction.
      // Use durable insertion order, not clock time or lexicographic UUID ordering.
      const latestAccepted = this.db.prepare("SELECT id FROM extraction_attempts WHERE item_id=? AND outcome='accepted' ORDER BY attempt_order DESC LIMIT 1").get(row.id);
      const base = { id: String(row.id), removable, sourceId: String(row.source_id), author: author(row, remote.author), remote, sourceKind: remote.sourceKind,
        publishedAt: optionalText(row, 'published_at'), baselineDiscoveryId: String(row.baseline_discovery_id),
        latestAcceptedDiscoveryId: latestAccepted ? String(latestAccepted.id) : undefined };
      return row.kind === 'video'
        ? { ...base, kind: 'video', title: String(row.title), description: optionalText(row, 'description') }
        : { ...base, kind: 'post', text: String(row.text) };
    });
  }

  private readComments(item: ContentItem): readonly Comment[] {
    const rows = this.db.prepare(`SELECT c.*, s.seen FROM comments c
      LEFT JOIN comment_state s ON s.comment_id = c.id WHERE c.item_id = ? ORDER BY c.position`).all(item.id);
    const evidence = rows.map(row => {
      if (row.remote_json === null) throw new Error('Missing durable comment evidence');
      return { id: String(row.id), remote: remoteEvidence<StoredCommentObservation>(String(row.remote_json)) };
    });
    const projection = projectRelationships(evidence);
    return rows.map((row, index) => {
      if (row.seen !== 0 && row.seen !== 1) throw new Error('Missing local comment state');
      const relationship = projection.get(String(row.id));
      if (!relationship) throw new Error('Missing relationship projection');
      return {
        id: String(row.id), itemId: item.id, parentId: relationship.parentId,
        directParentId: relationship.directParentId, remote: evidence[index].remote,
        relationshipStatus: relationship.status,
        relationship: evidence[index].remote.relationship, publication: evidence[index].remote.publication,
        source: { kind: item.kind, itemId: item.sourceId, commentId: String(row.source_comment_id) },
        author: author(row, evidence[index].remote.author), text: String(row.text), publishedAt: optionalText(row, 'published_at'),
        discovery: { firstDiscoveredAt: String(row.first_discovered_at), lastObservedAt: String(row.last_observed_at),
          firstDiscoveryId: String(row.first_discovery_id), lastObservationId: String(row.last_attempt_id) },
        likeCount: row.like_count === null ? undefined : Number(row.like_count),
        isCreator: row.is_creator === null ? undefined : row.is_creator === 1,
        isPinned: row.is_pinned === null ? undefined : row.is_pinned === 1, seen: row.seen === 1,
      };
    });
  }

  private storedDiscussion(target: AttemptTarget): StoredObservationDiscussion | undefined {
    const row = this.db.prepare('SELECT * FROM content_items WHERE kind = ? AND source_id = ?')
      .get(target.sourceKind === 'youtube-video' ? 'video' : 'post', target.sourceId);
    if (!row) return undefined;
    if (row.remote_json === null) throw new Error('Missing durable item evidence');
    return { id: String(row.id), baselineId: String(row.baseline_attempt_id), remote: remoteEvidence<StoredContentObservation>(String(row.remote_json)),
      comments: this.db.prepare('SELECT * FROM comments WHERE item_id = ? ORDER BY position').all(row.id).map(comment => {
        if (comment.remote_json === null) throw new Error('Missing durable comment evidence');
        return { id: String(comment.id), remote: remoteEvidence<StoredCommentObservation>(String(comment.remote_json)),
          firstDiscoveredAt: String(comment.first_discovered_at), firstDiscoveryId: String(comment.first_attempt_id),
          lastObservedAt: String(comment.last_observed_at), lastObservationId: String(comment.last_attempt_id) };
      }) };
  }

  /** Receives normalized data only. Reads/plans/writes/history share one short transaction.
   * Extractor execution/parsing must precede this call. Existing local state is never written.
   * Failed normalization records history only, optionally associated with a caller-owned target. */
  ingest(extraction: NormalizedExtraction, target?: AttemptTarget, openTab = false): MergeAttempt {
    const attemptId = this.ingestion.newId(), at = this.ingestion.now();
    return transaction(this.db, () => {
      const actualTarget = extraction.item ? { sourceKind: extraction.item.sourceKind, sourceId: extraction.item.sourceId } : target;
      const current = actualTarget ? this.storedDiscussion(actualTarget) : undefined;
      const plan = planObservationMerge(current, extraction, { attemptId, at, newId: this.ingestion.newId, target });
      const attempt = diagnosticAttempt(plan.attempt);
      this.db.prepare(`INSERT INTO extraction_attempts
        (id,item_id,source_kind,source_id,at,backend,backend_version,coverage,outcome,collection,details)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(attempt.id, attempt.itemId ?? null, attempt.target?.sourceKind ?? null,
          attempt.target?.sourceId ?? null, attempt.at, attempt.provenance.backend, attempt.provenance.version,
          attempt.coverage.kind, attempt.outcome, attempt.collection,
          JSON.stringify({ provenance: attempt.provenance, coverage: attempt.coverage, counts: attempt.counts, issues: attempt.issues }));
      if (!plan.item) return attempt;
      const item = plan.item, remote = item.remote;
      const kind = remote.sourceKind === 'youtube-video' ? 'video' : 'post';
      const itemValues = [kind === 'video' ? observedValue(remote.title) ?? '' : null,
        kind === 'video' ? observedValue(remote.text) ?? null : null, kind === 'post' ? observedValue(remote.text) ?? '' : null,
        ...authorObservationValues(remote), observedValue(remote.publication.instant) ?? null, JSON.stringify(remote)];
      if (plan.insertItem) {
        const position = Number(this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM content_items').get()?.next);
        this.db.prepare(`INSERT INTO content_items (id,position,kind,source_id,title,description,text,author_source_id,
          author_display_name,author_handle,published_at,remote_json,baseline_discovery_id,baseline_attempt_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(item.id, position, kind, remote.sourceId, ...itemValues, item.baselineId, item.baselineId);
      } else {
        this.db.prepare(`UPDATE content_items SET title=?,description=?,text=?,author_source_id=?,author_display_name=?,
          author_handle=?,published_at=?,remote_json=? WHERE id=?`).run(...itemValues, item.id);
      }
      let position = Number(this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM comments WHERE item_id=?').get(item.id)?.next);
      const insertedIds = new Set(plan.inserts.map(comment => comment.id));
      for (const comment of [...plan.inserts, ...plan.updates]) {
        const remote = comment.remote;
        const values = [...authorObservationValues(remote), observedValue(remote.text) ?? '', observedValue(remote.publication.instant) ?? null,
          observedValue(remote.likeCount) ?? null, booleanValue(observedValue(remote.creator)), booleanValue(observedValue(remote.pinned)),
          JSON.stringify(remote), comment.lastObservedAt, comment.lastObservationId];
        if (insertedIds.has(comment.id)) {
          this.db.prepare(`INSERT INTO comments (id,item_id,parent_id,position,source_comment_id,author_source_id,author_display_name,
            author_handle,text,published_at,like_count,is_creator,is_pinned,remote_json,last_observed_at,last_attempt_id,
            first_discovered_at,first_discovery_id,first_attempt_id) VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(comment.id, item.id, position++, remote.sourceId, ...values, comment.firstDiscoveredAt, comment.firstDiscoveryId, comment.firstDiscoveryId);
          this.db.prepare('INSERT INTO comment_state VALUES (?,0)').run(comment.id);
        } else {
          this.db.prepare(`UPDATE comments SET author_source_id=?,author_display_name=?,author_handle=?,text=?,published_at=?,
            like_count=?,is_creator=?,is_pinned=?,remote_json=?,last_observed_at=?,last_attempt_id=? WHERE id=?`).run(...values, comment.id);
        }
      }
      if (openTab) this.openWorkspaceItem(item.id);
      return attempt;
    });
  }

  /** Main-only durable attempt history; no acquisition/preload command is exposed. */
  history(itemId?: string): readonly MergeAttempt[] {
    return this.db.prepare(`SELECT * FROM extraction_attempts ${itemId === undefined ? '' : 'WHERE item_id = ?'} ORDER BY at, attempt_order`)
      .all(...itemId === undefined ? [] : [itemId]).map(row => ({ ...JSON.parse(String(row.details)), id: String(row.id),
        itemId: optionalText(row, 'item_id'), target: row.source_kind === null ? undefined : { sourceKind: String(row.source_kind), sourceId: String(row.source_id) },
        at: String(row.at), outcome: row.outcome, collection: row.collection }));
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
      preferences: this.preferences(languages), workspace: this.workspace() };
  }

  workspace(): WorkspaceState {
    const row = this.db.prepare('SELECT active_tab_id, revision FROM workspace WHERE id = 1').get();
    if (!row) throw new Error('Missing workspace');
    const tabs = this.db.prepare('SELECT id, kind, item_id FROM workspace_tabs ORDER BY position').all().map(tab =>
      tab.kind === 'discussion' ? discussionTab(String(tab.item_id))
        : { id: String(tab.id), kind: String(tab.kind) } as WorkspaceTab);
    return { tabs, activeTabId: row.active_tab_id === null ? null : String(row.active_tab_id), revision: Number(row.revision) };
  }

  private writeWorkspace(state: WorkspaceState): WorkspaceState {
    this.db.exec('DELETE FROM workspace_tabs');
    const insert = this.db.prepare('INSERT INTO workspace_tabs (id,kind,item_id,position) VALUES (?,?,?,?)');
    state.tabs.forEach((tab, position) => insert.run(tab.id, tab.kind, tab.kind === 'discussion' ? tab.itemId : null, position));
    this.db.prepare('UPDATE workspace SET active_tab_id = ?, revision = ? WHERE id = 1').run(state.activeTabId, state.revision);
    return state;
  }

  private openWorkspaceItem(itemId: string): WorkspaceState {
    const state = this.workspace(), next = openWorkspaceTab(state, discussionTab(itemId));
    return next === state ? state : this.writeWorkspace(next);
  }

  /** Intent-only workspace writes never change Library data. */
  changeWorkspace(operation: 'openStoredItem' | 'activateTab' | 'closeTab' | 'openLibrary' | 'openSettings' | 'moveTab',
    identity?: string, toIndex?: number): WorkspaceState {
    return transaction(this.db, () => {
      const state = this.workspace();
      let next: WorkspaceState;
      if (operation === 'openStoredItem') {
        if (!this.db.prepare('SELECT id FROM content_items WHERE id = ?').get(identity ?? '')) throw new MissingCommentError('Unknown discussion');
        return this.openWorkspaceItem(identity as string);
      } else if (operation === 'openLibrary' || operation === 'openSettings') {
        const kind = operation === 'openLibrary' ? 'library' : 'settings';
        next = openWorkspaceTab(state, { id: kind, kind });
      } else {
        const tab = state.tabs.find(tab => tab.id === identity);
        if (!tab) throw new MissingCommentError('Unknown tab');
        next = operation === 'closeTab' ? closeWorkspaceTab(state, tab.id)
          : operation === 'moveTab' ? moveWorkspaceTab(state, tab.id, toIndex as number) : openWorkspaceTab(state, tab);
      }
      return next === state ? state : this.writeWorkspace(next);
    });
  }

  /** Delete all item-owned rows and its view atomically, with FK enforcement on.
   * The baseline/history cycle requires deferring FK checks until commit. */
  removeLibraryItem(itemId: string, languages: readonly string[]): ReaderState {
    return transaction(this.db, () => {
      const item = this.readItems().find(item => item.id === itemId);
      if (!item) throw new MissingCommentError('Unknown discussion');
      if (!item.removable) throw new NotRemovableError('Synthetic discussion');
      this.db.exec('PRAGMA defer_foreign_keys = ON');
      const state = this.workspace(), next = closeWorkspaceTab(state, discussionTab(itemId).id);
      // Revision advances even for a closed item: stale content acknowledgments
      // must be distinguishable after a destructive mutation.
      this.writeWorkspace({ ...next, revision: state.revision + 1 });
      this.db.prepare('DELETE FROM comment_state WHERE comment_id IN (SELECT id FROM comments WHERE item_id=?)').run(itemId);
      this.db.prepare('DELETE FROM comments WHERE item_id=?').run(itemId);
      this.db.prepare('DELETE FROM content_items WHERE id=?').run(itemId);
      this.db.prepare('DELETE FROM extraction_attempts WHERE item_id=? OR (source_kind=? AND source_id=?)').run(itemId, item.sourceKind ?? null, item.sourceId);
      return this.bootstrap(languages);
    });
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

import type { TransferRequest } from '../../shared/tab-transfer';
import type { SharedChange, SharedCommit, SharedStamp, SharedItemSnapshot, SharedViewSnapshot } from '../../shared/reader-sync';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCommentTree } from '../../domain/discussion';
import type { Author, Comment, ContentItem } from '../../domain/discussion';
import { initialComments, items } from '../../fixtures/discussions';
import { initialLocale, normalizeTranslationCode } from '../../shared/preferences';
import { isReaderAppearance, isThemeDefinition, assetId } from '../../shared/appearance';
import type { ReaderAppearance, ThemeDefinition } from '../../shared/appearance';
import type { Preferences } from '../../shared/preferences';
import type { PreferenceChange, ReaderState, ToggleSeenRequest, DuplicateTabRequest, DuplicateTabResult } from '../../shared/reader-api';
import { migrateDatabase, transaction } from './migrations';
import { establishSyntheticHistory } from './synthetic-history';
import type { AuthorObservation, ContentObservation, CommentObservation, NormalizedExtraction } from '../../domain/extraction-observation';
import { observedValue, planObservationMerge, projectRelationships } from '../../domain/observation-merge';
import type { AttemptTarget, MergeAttempt, StoredCommentObservation, StoredContentObservation, StoredObservationDiscussion } from '../../domain/observation-merge';
import { closeWorkspaceTab, discussionTab, openWorkspaceTab, moveWorkspaceTab } from '../../domain/workspace';
import type { WorkspaceState, WorkspaceTab } from '../../domain/workspace';
import { isHttpsImageUrl } from '../../domain/remote-image';
import type { BulkSeenRequest, SeenMutationResult, SeenUndoDescriptor, SeenUndoResult } from '../../domain/seen-operation';
import { resolveBulkPublication } from '../../domain/publication-filter';
import type { QueryEvaluationTime } from '../../domain/publication-filter';
import { publicationMatches, ownPublicationInstant } from '../../domain/publication-predicate';
import { isBulkSeenRequest, isPreferenceChange } from '../../shared/reader-api';
import type { HelperKind } from '../../shared/helper-settings';
import { isSetDiscussionCollapseRequest } from '../../domain/discussion-collapse';
import type { DiscussionCollapse, SetDiscussionCollapseRequest } from '../../domain/discussion-collapse';
import { isSaveDiscussionViewRequest } from '../../domain/discussion-view';
import type { DiscussionViewIntent, SaveDiscussionViewRequest } from '../../domain/discussion-view';
import { createVerifiedBackup } from './sqlite-backup';
import { commentActionAvailability } from '../comment-actions';
import type { ActionComment } from '../comment-actions';
import { sourceUrl } from '../source-url';
import type { BackupTimings } from './sqlite-backup';
import { WindowSessionStore } from './window-session';

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
export class StateConflictError extends Error {}
export class ViewOwnershipError extends Error {}
export class UndoConflictError extends Error {}
export class MissingCommentError extends Error {}
export class NotRemovableError extends Error {}
export class InvalidSeenTargetError extends Error {}
export class InvalidDiscussionViewError extends Error {}

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
  readonly profileEpoch = randomUUID();
  private readonly ownerGenerations = new Map<string, string>();
  ownerAuthority(viewId: string): { ownerGeneration?: string } {
    const ownerGeneration = this.ownerGenerations.get(viewId);
    return ownerGeneration ? { ownerGeneration } : {};
  }
  validateOwnerAuthority(viewId: string, generation?: string | null): void {
    if (this.ownerGenerations.get(viewId) !== (generation ?? undefined)) throw new ViewOwnershipError('Revoked view generation');
  }
  private commitRevision = 0;
  private bootstrapShared?: { readonly revision: number; readonly value: Pick<ReaderState, 'items' | 'comments' | 'seenUndo'> };
  private committing = false;
  private readonly observers = new Set<(commit: SharedCommit) => void>();
  private lastCommit?: SharedCommit;
  latestCommit(): SharedCommit | undefined { return this.lastCommit; }
  /** Main observed changed runtime helper evidence. No content/config row changes;
   * the successful empty outer transaction orders its narrow invalidation. */
  invalidateHelperStatus(): void { this.commit({ kind: 'helpers' }, () => undefined); }
  private pendingSeen?: SharedChange;
  stamp(): SharedStamp { return { profileEpoch: this.profileEpoch, commitRevision: this.commitRevision }; }
  onCommit(observer: (commit: SharedCommit) => void): () => void { this.observers.add(observer); return () => { this.observers.delete(observer); }; }
  /** No nested transaction: publish exactly once AFTER the existing outer commit.
   * Epoch fences restart/reopen, so no historical log or database migration is needed.
   * Exhaustion fails before writes; observer failure can never change SQL success. */
  private commit<T>(change: SharedChange | ((value: T) => SharedChange), action: () => T): T {
    if (this.commitRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Revision exhausted');
    // Never reuse pre-write rows inside a transaction, including its return DTO.
    // A failed transaction may discard the cache, but cannot publish stale rows.
    this.bootstrapShared = undefined;
    this.committing = true;
    this.pendingSeen = undefined;
    let value: T;
    try { value = transaction(this.db, action); }
    catch (error) { this.pendingSeen = undefined; throw error; }
    finally { this.committing = false; this.bootstrapShared = undefined; }
    this.commitRevision++;
    let detail: SharedChange = { kind: 'watermark' };
    try { detail = this.pendingSeen ?? (typeof change === 'function' ? change(value) : change); } catch { /* Recovery watermark. */ }
    this.pendingSeen = undefined;
    const event: SharedCommit = { ...this.stamp(), change: detail };
    this.lastCommit = event;
    for (const observer of this.observers) { try { observer(event); } catch { /* Committed truth survives recipients. */ } }
    return value;
  }
  itemSnapshot(itemId: string, windowId = this.initialWindowId()): SharedItemSnapshot {
    const item = this.getStoredItem(itemId) ?? null;
    return { ...this.stamp(), itemId, item, comments: item ? this.readComments(item) : [], undo: item ? this.seenUndo(itemId) : null, workspace: this.workspace(windowId), viewInstances: this.viewInstances(windowId) };
  }
  private readonly invalidViewDiagnostics = new Set<string>();
  private constructor(private readonly db: DatabaseSync, private readonly ingestion: IngestionDependencies) {}

  /** Requires a resolved absolute path. Failure closes the connection and keeps
   * the existing file; no reset/recovery fallback is performed. */
  static open(databasePath: string, ingestion: IngestionDependencies = ingestionDefaults): ReaderRepository {
    return new ReaderRepository(openReaderDatabase(databasePath), ingestion);
  }

  close(): void { this.bootstrapShared = undefined; this.db.close(); }

  /** All authoritative tables share this connection and SQLite's online snapshot.
   * The service holds a mutation barrier until verification/publication completes. */
  async createBackup(destination: string, measured?: (timings: BackupTimings) => void): Promise<void> {
    const timings = await createVerifiedBackup(this.db, destination); measured?.(timings);
  }

  /** Quiescent offline transition: explicitly drain WAL if a future mode uses it.
   * No sidecar is copied to the replacement; failure aborts before installation. */
  prepareOffline(): void {
    const checkpoint = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (checkpoint?.busy !== 0) throw new Error('SQLite checkpoint busy');
    if (String(this.db.prepare('PRAGMA journal_mode=DELETE').get()?.journal_mode).toLowerCase() !== 'delete') throw new Error('Cannot settle SQLite journal');
  }

  /** Machine-specific profile configuration, separate from discussion/preferences DTOs. */
  getHelperSelection(kind: HelperKind): string | undefined {
    const row = this.db.prepare('SELECT executable_path FROM helper_settings WHERE kind = ?').get(kind);
    return row ? String(row.executable_path) : undefined;
  }

  /** Only the main-owned picker service writes paths after validation and probing. */
  setHelperSelection(kind: HelperKind, executable?: string): void {
    this.commit({ kind: 'helpers' }, () => {
    if (executable === undefined) this.db.prepare('DELETE FROM helper_settings WHERE kind = ?').run(kind);
    else this.db.prepare('INSERT INTO helper_settings VALUES (?,?) ON CONFLICT(kind) DO UPDATE SET executable_path = excluded.executable_path').run(kind, executable);
    });
  }

  /** Explicit seed for genuinely fresh development profiles only; startup owns
   * that file-existence/recovery gate. Never call for an existing/restored empty
   * profile. Existing discussions/preferences are not replaced or upserted.
   * These are synthetic observations, not a
   * first real acquisition or evidence of source-ID uniqueness. */
  initializeDemo(): void {
    this.commit({ kind: 'watermark' }, () => {
      if (Number(this.db.prepare('SELECT count(*) AS count FROM content_items').get()?.count) !== 0) return;
      const insertItem = this.db.prepare(`INSERT INTO content_items
        (id, position, kind, source_id, title, description, text, author_source_id,
         author_display_name, author_handle, published_at, baseline_discovery_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insertComment = this.db.prepare(`INSERT INTO comments
        (id,item_id,parent_id,position,source_comment_id,author_source_id,author_display_name,
         author_handle,text,published_at,first_discovered_at,last_observed_at,first_discovery_id,
         like_count,is_creator,is_pinned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insertState = this.db.prepare('INSERT INTO comment_state (comment_id,seen) VALUES (?,?)');
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
      const windowId = this.initialWindowId();
      const tabs = items.map(item => this.resumeTab(windowId, item.id));
      this.writeWorkspace(windowId, { tabs, activeTabId: tabs[0]?.id ?? null, revision: this.workspace(windowId).revision + 1 });
    });
  }

  /** Read-only stored identity lookup; opening a browser never changes the workspace. */
  getStoredItem(itemId: string): ContentItem | undefined {
    return this.readItems(itemId)[0];
  }

  hasVideoReference(sourceId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM content_items WHERE kind='video' AND source_id=? LIMIT 1").get(sourceId);
  }

  /** Indexed ownership lookup for explicit actions; no forest/bootstrap per click. */
  getActionComment(item: ContentItem, commentId: string): ActionComment | undefined {
    const row = this.db.prepare('SELECT id, item_id, source_comment_id, author_source_id, author_display_name, author_handle, text FROM comments WHERE item_id=? AND id=?').get(item.id, commentId);
    if (!row) return undefined;
    return { id: String(row.id), itemId: item.id, source: { kind: item.kind, itemId: item.sourceId, commentId: String(row.source_comment_id) },
      author: { sourceId: optionalText(row, 'author_source_id'), handle: optionalText(row, 'author_handle') }, text: String(row.text) };
  }

  private readItems(itemId?: string): readonly ContentItem[] {
    const rows = itemId === undefined ? this.db.prepare('SELECT * FROM content_items ORDER BY position').all()
      : this.db.prepare('SELECT * FROM content_items WHERE id=?').all(itemId);
    return rows.map(row => {
      if (row.remote_json === null) throw new Error('Missing durable item evidence');
      const remote = remoteEvidence<StoredContentObservation>(String(row.remote_json));
      const isDemo = this.db.prepare('SELECT backend FROM extraction_attempts WHERE id=?').get(row.baseline_attempt_id)?.backend === 'synthetic-demo';
      // Attempts are append-only and inserted inside the accepted merge transaction.
      // Use durable insertion order, not clock time or lexicographic UUID ordering.
      const latestAccepted = this.db.prepare("SELECT id FROM extraction_attempts WHERE item_id=? AND outcome='accepted' ORDER BY attempt_order DESC LIMIT 1").get(row.id);
      const base = { id: String(row.id), isDemo, removable: true, sourceId: String(row.source_id), author: author(row, remote.author), remote, sourceKind: remote.sourceKind,
        publishedAt: optionalText(row, 'published_at'), baselineDiscoveryId: String(row.baseline_discovery_id),
        latestAcceptedDiscoveryId: latestAccepted ? String(latestAccepted.id) : undefined };
      return row.kind === 'video'
        ? { ...base, kind: 'video', title: String(row.title), description: optionalText(row, 'description') }
        : { ...base, kind: 'post', text: String(row.text) };
    });
  }

  private readComments(item: ContentItem): readonly Comment[] {
    const canonicalItem = sourceUrl(item) ?? '';
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
      const comment: Comment = {
        id: String(row.id), itemId: item.id, parentId: relationship.parentId,
        // Reader consumers use the projections below. Sending the complete
        // normalized evidence again multiplies contextBridge clone/freeze work
        // across every native window (M9.1). Merge/backup retain remote_json.
        directParentId: relationship.directParentId,
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
      return { ...comment, actions: commentActionAvailability(item, comment, canonicalItem) };
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
  ingest(extraction: NormalizedExtraction, target?: AttemptTarget, openTab = false, windowId = this.initialWindowId()): MergeAttempt {
    const attemptId = this.ingestion.newId(), at = this.ingestion.now();
    return this.commit((attempt: MergeAttempt) => attempt.outcome === 'accepted' && attempt.itemId ? { kind: 'item', itemId: attempt.itemId } : { kind: 'watermark' }, () => {
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
          this.db.prepare('INSERT INTO comment_state (comment_id,seen) VALUES (?,0)').run(comment.id);
        } else {
          this.db.prepare(`UPDATE comments SET author_source_id=?,author_display_name=?,author_handle=?,text=?,published_at=?,
            like_count=?,is_creator=?,is_pinned=?,remote_json=?,last_observed_at=?,last_attempt_id=? WHERE id=?`).run(...values, comment.id);
        }
      }
      this.resumeTab(windowId, item.id);
      if (openTab) this.openWorkspaceItem(windowId, item.id);
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
    const row = this.db.prepare('SELECT * FROM preferences WHERE id = 1').get();
    if (!row) throw new Error('Missing preferences');
    return { maximumConcurrentDownloads: row.maximum_concurrent_downloads as Preferences['maximumConcurrentDownloads'], notificationDismissal: row.notification_dismissal as Preferences['notificationDismissal'],
      notificationDurationSeconds: row.notification_duration_seconds as Preferences['notificationDurationSeconds'],
      readerAppearance: this.readerAppearance(), locale: row.locale === null ? initialLocale(languages) : row.locale as Preferences['locale'],
      appearance: row.appearance as Preferences['appearance'], translationTarget: row.translation_target as Preferences['translationTarget'],
      ...(row.custom_translation_target === null ? {} : { customTranslationTarget: String(row.custom_translation_target) }),
      selectionControls: row.selection_controls as Preferences['selectionControls'], includeCollapsedInPrefix: row.include_collapsed_in_prefix === 1 };
  }

  bootstrap(languages: readonly string[], windowId = this.initialWindowId()): ReaderState {
    // Equal windows at the same commit share immutable main-side materialization,
    // not renderer objects or authority. Repeating synchronous 60k reads can
    // otherwise starve the first windows' cold worker-file loads (M9.1).
    let shared = this.bootstrapShared?.revision === this.commitRevision ? this.bootstrapShared.value : undefined;
    if (!shared || this.committing) {
      const items = this.readItems();
      shared = { items, comments: Object.fromEntries(items.map(item => [item.id, this.readComments(item)])),
        seenUndo: Object.fromEntries(items.map(item => [item.id, this.seenUndo(item.id)])) };
      if (!this.committing) this.bootstrapShared = { revision: this.commitRevision, value: shared };
    }
    return { ...shared,
      preferences: this.preferences(languages), workspace: this.workspace(windowId), viewInstances: this.viewInstances(windowId), discussionViews: this.discussionViews(windowId), discussionCollapse: this.discussionCollapse(windowId) };
  }

  /** Main-only native session persistence, using the same transaction authority. */
  nativeSession(): WindowSessionStore { return new WindowSessionStore(this.db, action => this.commit({ kind: 'watermark' }, action)); }

  /** Internal default follows intended session focus, never a dormant oldest row. */
  initialWindowId(): string {
    return this.nativeSession().read().lastFocusedId;
  }

  /** Main-only intended-session construction for fixtures/internal callers.
   * Public native creation allocates dormant identity, then enrolls after registration. */
  createPersistentWindow(): string {
    return this.nativeSession().create();
  }

  viewInstances(windowId: string): ReaderState['viewInstances'] {
    return Object.fromEntries(this.db.prepare(`SELECT v.* FROM discussion_views v JOIN tab_instances t ON t.id=v.view_id WHERE t.owner_window_id=?`).all(windowId)
      .map(row => [String(row.view_id), { itemId: String(row.item_id), intentRevision: Number(row.intent_revision), collapseRevision: Number(row.collapse_revision), ...this.ownerAuthority(String(row.view_id)) }]));
  }

  /** Dormant instances retain their owner; close never revokes a queued final save.
   * Document incarnation is checked by M1 at dispatch, including M3 checkpoints. */
  ownedView(windowId: string, viewId: string): string {
    const row = this.db.prepare(`SELECT v.item_id FROM discussion_views v JOIN tab_instances t ON t.id=v.view_id WHERE v.view_id=? AND t.owner_window_id=?`).get(viewId, windowId);
    if (!row) throw new ViewOwnershipError('Unowned view');
    return String(row.item_id);
  }
  /** Identity-only validation for transient handoffs; never materialize text or
   * evidence merely to move a view of a large discussion. */
  ownedCommentIds(itemId: string): ReadonlySet<string> {
    return new Set(this.db.prepare('SELECT id FROM comments WHERE item_id=?').all(itemId).map(row => String(row.id)));
  }
  private advanceView(windowId: string, viewId: string, expected: number, column: 'intent_revision' | 'collapse_revision'): string {
    const itemId = this.ownedView(windowId, viewId);
    if (!this.db.prepare(`UPDATE discussion_views SET ${column}=${column}+1 WHERE view_id=? AND ${column}=?`).run(viewId, expected).changes) throw new StateConflictError('Stale view');
    return itemId;
  }
  private discussionCollapse(windowId: string, viewId: string | null = null): ReaderState['discussionCollapse'] {
    const states: Record<string, DiscussionCollapse> = {};
    for (const row of this.db.prepare(`SELECT c.* FROM view_collapse c JOIN tab_instances t ON t.id=c.view_id WHERE t.owner_window_id=? AND (? IS NULL OR c.view_id=?)`).all(windowId, viewId, viewId)) {
      if (row.default_collapsed !== 0 && row.default_collapsed !== 1) continue;
      const overrides = this.db.prepare('SELECT o.comment_id FROM view_collapse_overrides o JOIN comments c ON c.id=o.comment_id AND c.item_id=o.item_id WHERE o.view_id=? AND o.item_id=? ORDER BY o.comment_id').all(row.view_id, row.item_id);
      states[String(row.view_id)] = { defaultCollapsed: row.default_collapsed === 1, overrides: overrides.map(o => String(o.comment_id)) };
    }
    return states;
  }
  setDiscussionCollapse(request: SetDiscussionCollapseRequest, windowId = this.initialWindowId()): null {
    if (!isSetDiscussionCollapseRequest(request)) throw new InvalidDiscussionViewError();
    return this.commit({ kind: 'watermark' }, () => {
      this.validateOwnerAuthority(request.viewId, request.ownerGeneration);
      const itemId = this.advanceView(windowId, request.viewId, request.expectedRevision, 'collapse_revision');
      if (request.kind === 'comments') {
        const owns = this.db.prepare('SELECT 1 FROM comments WHERE item_id=? AND id=?');
        if (request.ids.some(id => !owns.get(itemId, id))) throw new InvalidDiscussionViewError();
      }
      this.db.prepare('INSERT OR IGNORE INTO view_collapse VALUES (?,?,0)').run(request.viewId, itemId);
      let existing = this.db.prepare('SELECT default_collapsed FROM view_collapse WHERE view_id=?').get(request.viewId);
      if (!existing) throw new Error('Missing collapse default');
      if (existing.default_collapsed !== 0 && existing.default_collapsed !== 1) {
        this.db.prepare('DELETE FROM view_collapse WHERE view_id=?').run(request.viewId);
        this.db.prepare('INSERT INTO view_collapse VALUES (?,?,0)').run(request.viewId, itemId); existing = { default_collapsed: 0 };
      }
      if (request.kind === 'all') {
        this.db.prepare('DELETE FROM view_collapse_overrides WHERE view_id=?').run(request.viewId);
        this.db.prepare('UPDATE view_collapse SET default_collapsed=? WHERE view_id=?').run(Number(request.collapsed), request.viewId);
      } else {
        for (const id of request.ids) {
          if (request.collapsed === (existing.default_collapsed === 1)) this.db.prepare('DELETE FROM view_collapse_overrides WHERE view_id=? AND comment_id=?').run(request.viewId, id);
          else this.db.prepare('INSERT OR IGNORE INTO view_collapse_overrides VALUES (?,?,?)').run(request.viewId, itemId, id);
        }
      }
      return null;
    });
  }
  private ownsViewIdentities(itemId: string, request: DiscussionViewIntent): boolean {
    const owns = this.db.prepare('SELECT 1 FROM comments WHERE item_id=? AND id=?');
    return [request.anchor.commentId, request.selected].every(id => id === null || !!owns.get(itemId, id));
  }
  private discussionViews(windowId: string, viewId: string | null = null): ReaderState['discussionViews'] {
    const views: [string, DiscussionViewIntent][] = [];
    for (const row of this.db.prepare(`SELECT v.* FROM discussion_view_intent v JOIN tab_instances t ON t.id=v.view_id WHERE t.owner_window_id=? AND (? IS NULL OR v.view_id=?)`).all(windowId, viewId, viewId)) {
      try {
        const request: unknown = { viewId: row.view_id, expectedRevision: 0, draft: JSON.parse(String(row.draft_query_json)), applied: JSON.parse(String(row.applied_query_json)),
          sort: row.sort, anchor: { commentId: row.anchor_comment_id, offset: row.anchor_offset }, selected: row.selected_comment_id };
        if (!isSaveDiscussionViewRequest(request) || !this.ownsViewIdentities(String(row.item_id), request)) throw new InvalidDiscussionViewError();
        const { viewId, draft, applied, sort, anchor, selected } = request;
        const view = { draft, applied, sort, anchor, selected };
        views.push([viewId, view]);
      } catch {
        const id = String(row.view_id);
        if (!this.invalidViewDiagnostics.has(id)) { this.invalidViewDiagnostics.add(id); console.warn('INVALID_DISCUSSION_VIEW_STATE'); }
      }
    }
    return Object.fromEntries(views);
  }
  saveDiscussionView(request: SaveDiscussionViewRequest, windowId = this.initialWindowId()): null {
    if (!isSaveDiscussionViewRequest(request)) throw new InvalidDiscussionViewError('Invalid view intent');
    return this.commit({ kind: 'watermark' }, () => {
      this.validateOwnerAuthority(request.viewId, request.ownerGeneration);
      const itemId = this.advanceView(windowId, request.viewId, request.expectedRevision, 'intent_revision');
      if (!this.ownsViewIdentities(itemId, request)) throw new InvalidDiscussionViewError('Unowned comment');
      this.db.prepare(`INSERT INTO discussion_view_intent VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(view_id) DO UPDATE SET draft_query_json=excluded.draft_query_json, applied_query_json=excluded.applied_query_json,
          sort=excluded.sort, anchor_comment_id=excluded.anchor_comment_id, anchor_offset=excluded.anchor_offset, selected_comment_id=excluded.selected_comment_id`)
        .run(request.viewId, itemId, JSON.stringify(request.draft), JSON.stringify(request.applied), request.sort, request.anchor.commentId, request.anchor.commentId === null ? 0 : request.anchor.offset, request.selected);
      this.invalidViewDiagnostics.delete(request.viewId); return null;
    });
  }
  /** Scoped hydration is authorized even for an owned dormant instance. */
  viewSnapshot(windowId: string, viewId: string): SharedViewSnapshot {
    const itemId = this.ownedView(windowId, viewId);
    const row = this.db.prepare('SELECT intent_revision,collapse_revision FROM discussion_views WHERE view_id=?').get(viewId);
    if (!row) throw new ViewOwnershipError();
    return { ...this.stamp(), viewId, instance: { itemId, intentRevision: Number(row.intent_revision), collapseRevision: Number(row.collapse_revision), ...this.ownerAuthority(viewId) },
      intent: this.discussionViews(windowId, viewId)[viewId], collapse: this.discussionCollapse(windowId, viewId)[viewId] };
  }
  /** Copy acknowledged semantic SQL rows and place a new identity in ONE commit.
   * Fresh zero CAS lanes belong exclusively to the newly allocated instance. */
  duplicateTab(request: DuplicateTabRequest, windowId = this.initialWindowId()): DuplicateTabResult {
    const viewId = this.commit({ kind: 'workspace' }, () => {
      const itemId = this.ownedView(windowId, request.sourceViewId), state = this.workspace(windowId);
      if (state.revision !== request.expectedRevision) throw new StateConflictError('Stale topology');
      const index = state.tabs.findIndex(t => t.id === request.sourceViewId && t.kind === 'discussion');
      if (index < 0) throw new ViewOwnershipError('Source must be open');
      const source = this.viewSnapshot(windowId, request.sourceViewId);
      if (source.instance.intentRevision !== request.intentRevision || source.instance.collapseRevision !== request.collapseRevision) throw new StateConflictError('Stale source');
      const id = randomUUID();
      this.db.prepare("INSERT INTO tab_instances VALUES (?,?,'discussion',?)").run(id, windowId, itemId);
      this.db.prepare('INSERT INTO discussion_view_intent SELECT ?,item_id,draft_query_json,applied_query_json,sort,anchor_comment_id,anchor_offset,selected_comment_id FROM discussion_view_intent WHERE view_id=?').run(id, request.sourceViewId);
      this.db.prepare('INSERT INTO view_collapse SELECT ?,item_id,default_collapsed FROM view_collapse WHERE view_id=?').run(id, request.sourceViewId);
      this.db.prepare('INSERT INTO view_collapse_overrides SELECT ?,item_id,comment_id FROM view_collapse_overrides WHERE view_id=?').run(id, request.sourceViewId);
      const tabs = [...state.tabs]; tabs.splice(index + 1, 0, discussionTab(id, itemId));
      this.writeWorkspace(windowId, { tabs, activeTabId: id, revision: state.revision + 1 });
      return id;
    });
    return { workspace: this.workspace(windowId), view: this.viewSnapshot(windowId, viewId) };
  }
  /** One short synchronous transaction. Placement/resume references are removed
   * before updating the composite owner key; private view children never rebuild.
   * Runtime authority rotates before post-COMMIT observers, and rolls back on error. */
  transferTab(sourceId: string, targetId: string, request: TransferRequest, guard: () => void): { tabId: string; mergedIntoTabId: string | null } {
    const previous = this.ownerGenerations.get(request.tabId);
    try { return this.commit({ kind: 'workspace' }, () => {
      guard();
      if (sourceId === targetId || request.destination === 'new') throw new ViewOwnershipError('Invalid destination');
      const source = this.workspace(sourceId), target = this.workspace(targetId), destination = request.destination;
      if (source.revision !== request.expectedRevision || target.revision !== destination.expectedRevision) throw new StateConflictError('Stale topology');
      const tab = source.tabs.find(t => t.id === request.tabId);
      if (!tab) throw new ViewOwnershipError('Source is not placed');
      const owner = this.db.prepare('SELECT owner_window_id FROM tab_instances WHERE id=?').get(tab.id);
      if (owner?.owner_window_id !== sourceId) throw new ViewOwnershipError('Source owner changed');
      const slot = destination.beforeTabId === null ? target.tabs.length : target.tabs.findIndex(t => t.id === destination.beforeTabId);
      if (slot < 0) throw new StateConflictError('Insertion neighbor changed');
      if (tab.kind === 'discussion') {
        this.validateOwnerAuthority(tab.id, request.ownerGeneration);
        const view = this.viewSnapshot(sourceId, tab.id);
        if (view.instance.intentRevision !== request.intentRevision || view.instance.collapseRevision !== request.collapseRevision) throw new StateConflictError('Unacknowledged final save');
        if (view.instance.intentRevision >= Number.MAX_SAFE_INTEGER - 1 || view.instance.collapseRevision >= Number.MAX_SAFE_INTEGER - 1) throw new StateConflictError('View revision exhausted');
      }
      const existing = tab.kind === 'discussion' ? undefined : this.db.prepare('SELECT id FROM tab_instances WHERE owner_window_id=? AND kind=?').get(targetId, tab.kind);
      const mergedIntoTabId = existing ? String(existing.id) : null, id = mergedIntoTabId ?? tab.id;
      const nextSource = closeWorkspaceTab(source, tab.id);
      // Active membership is deferred, but placement -> owner is immediate.
      this.db.prepare('DELETE FROM window_tabs WHERE window_id IN (?,?)').run(sourceId, targetId);
      this.db.prepare('DELETE FROM item_resume_view WHERE view_id=?').run(tab.id);
      if (existing) this.db.prepare('DELETE FROM tab_instances WHERE id=?').run(tab.id);
      else this.db.prepare('UPDATE tab_instances SET owner_window_id=? WHERE id=?').run(targetId, tab.id);
      if (tab.kind === 'discussion') {
        this.db.prepare('UPDATE discussion_views SET intent_revision=intent_revision+1,collapse_revision=collapse_revision+1 WHERE view_id=?').run(tab.id);
        this.ownerGenerations.set(tab.id, randomUUID());
        const fallback = this.db.prepare("SELECT id FROM tab_instances WHERE owner_window_id=? AND item_id=? ORDER BY id LIMIT 1").get(sourceId, tab.itemId);
        if (fallback) this.db.prepare('INSERT OR IGNORE INTO item_resume_view VALUES (?,?,?)').run(sourceId, tab.itemId, fallback.id);
      }
      const tabs = target.tabs.filter(t => t.id !== id);
      if (!existing || !target.tabs.some(t => t.id === id)) tabs.splice(slot, 0, { ...tab, id });
      else tabs.splice(0, tabs.length, ...target.tabs);
      this.writeWorkspace(sourceId, { ...nextSource, revision: source.revision + 1 });
      this.writeWorkspace(targetId, { tabs, activeTabId: id, revision: target.revision + 1 });
      const session = new WindowSessionStore(this.db, action => action()), restored = session.read();
      if (!restored.windowIds.includes(targetId)) session.quit([...restored.windowIds, targetId], targetId, restored.revision);
      guard();
      return { tabId: id, mergedIntoTabId };
    }); } catch (error) {
      if (previous) this.ownerGenerations.set(request.tabId, previous); else this.ownerGenerations.delete(request.tabId);
      throw error;
    }
  }
  workspace(windowId = this.initialWindowId()): WorkspaceState {
    const row = this.db.prepare('SELECT active_tab_id,topology_revision FROM app_windows WHERE id=?').get(windowId);
    if (!row) throw new ViewOwnershipError('Unknown window');
    const tabs = this.db.prepare(`SELECT t.id,t.kind,t.item_id FROM window_tabs p JOIN tab_instances t ON t.id=p.tab_id WHERE p.window_id=? ORDER BY p.position`).all(windowId)
      .map(tab => tab.kind === 'discussion' ? discussionTab(String(tab.id), String(tab.item_id)) : { id: String(tab.id), kind: tab.kind } as WorkspaceTab);
    return { tabs, activeTabId: row.active_tab_id === null ? null : String(row.active_tab_id), revision: Number(row.topology_revision) };
  }
  private writeWorkspace(windowId: string, state: WorkspaceState): WorkspaceState {
    if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new StateConflictError('Topology revision exhausted');
    this.db.prepare('DELETE FROM window_tabs WHERE window_id=?').run(windowId);
    const insert = this.db.prepare('INSERT INTO window_tabs VALUES (?,?,?,?)');
    state.tabs.forEach((tab, position) => insert.run(windowId, tab.id, tab.kind, position));
    this.db.prepare('UPDATE app_windows SET active_tab_id=?,topology_revision=? WHERE id=?').run(state.activeTabId, state.revision, windowId);
    const active = state.tabs.find(t => t.id === state.activeTabId);
    if (active?.kind === 'discussion') this.db.prepare('INSERT INTO item_resume_view VALUES (?,?,?) ON CONFLICT(window_id,item_id) DO UPDATE SET view_id=excluded.view_id').run(windowId, active.itemId, active.id);
    return state;
  }
  private resumeTab(windowId: string, itemId: string): WorkspaceTab {
    const row = this.db.prepare('SELECT view_id FROM item_resume_view WHERE window_id=? AND item_id=?').get(windowId, itemId);
    if (row) return discussionTab(String(row.view_id), itemId);
    if (!this.db.prepare('SELECT 1 FROM content_items WHERE id=?').get(itemId)) throw new MissingCommentError();
    const id = randomUUID();
    this.db.prepare("INSERT INTO tab_instances VALUES (?,?,'discussion',?)").run(id, windowId, itemId);
    this.db.prepare('INSERT INTO item_resume_view VALUES (?,?,?)').run(windowId, itemId, id);
    return discussionTab(id, itemId);
  }
  private openWorkspaceItem(windowId: string, itemId: string): WorkspaceState {
    const state = this.workspace(windowId);
    const recent = this.db.prepare('SELECT view_id FROM item_resume_view WHERE window_id=? AND item_id=?').get(windowId, itemId);
    const candidates = state.tabs.filter(tab => tab.kind === 'discussion' && tab.itemId === itemId);
    const existing = candidates.find(tab => tab.id === recent?.view_id) ?? candidates[0];
    const next = openWorkspaceTab(state, existing ?? this.resumeTab(windowId, itemId));
    return next === state ? state : this.writeWorkspace(windowId, next);
  }
  /** Trusted callers can omit CAS; every renderer structural command supplies it. */
  changeWorkspace(operation: 'openStoredItem' | 'activateTab' | 'closeTab' | 'openLibrary' | 'openSettings' | 'moveTab',
    identity?: string, toIndex?: number, windowId = this.initialWindowId(), expectedRevision = this.workspace(windowId).revision): WorkspaceState {
    return this.commit({ kind: 'workspace' }, () => {
      const state = this.workspace(windowId);
      if (state.revision !== expectedRevision) throw new StateConflictError('Stale topology');
      if (operation === 'openStoredItem') { if (!identity) throw new MissingCommentError(); return this.openWorkspaceItem(windowId, identity); }
      let next: WorkspaceState;
      if (operation === 'openLibrary' || operation === 'openSettings') {
        const kind = operation === 'openLibrary' ? 'library' : 'settings';
        let tab = this.db.prepare('SELECT id FROM tab_instances WHERE owner_window_id=? AND kind=?').get(windowId, kind);
        if (!tab) { const id = randomUUID(); this.db.prepare('INSERT INTO tab_instances VALUES (?,?,?,NULL)').run(id, windowId, kind); tab = { id }; }
        next = openWorkspaceTab(state, { id: String(tab.id), kind });
      } else {
        const tab = state.tabs.find(tab => tab.id === identity);
        if (!tab) throw new ViewOwnershipError('Unowned tab');
        next = operation === 'closeTab' ? closeWorkspaceTab(state, tab.id) : operation === 'moveTab' ? moveWorkspaceTab(state, tab.id, toIndex as number) : openWorkspaceTab(state, tab);
      }
      return next === state ? state : this.writeWorkspace(windowId, next);
    });
  }
  removeLibraryItem(itemId: string, languages: readonly string[], windowId = this.initialWindowId()): ReaderState {
    return this.commit({ kind: 'removed', itemId }, () => {
      const item = this.readItems().find(item => item.id === itemId);
      if (!item) throw new MissingCommentError();
      if (!item.removable) throw new NotRemovableError();
      this.db.exec('PRAGMA defer_foreign_keys=ON');
      for (const row of this.db.prepare('SELECT id FROM app_windows').all()) {
        const id = String(row.id), state = this.workspace(id);
        let next = state;
        for (const tab of state.tabs) if (tab.kind === 'discussion' && tab.itemId === itemId) next = closeWorkspaceTab(next, tab.id);
        this.writeWorkspace(id, { ...next, revision: state.revision + 1 });
      }
      // Remove view FK references before comments, retaining every other item's state.
      this.db.prepare('DELETE FROM tab_instances WHERE item_id=?').run(itemId);
      this.db.prepare('DELETE FROM comment_state WHERE comment_id IN (SELECT id FROM comments WHERE item_id=?)').run(itemId);
      this.db.prepare('DELETE FROM comments WHERE item_id=?').run(itemId);
      this.db.prepare('DELETE FROM content_items WHERE id=?').run(itemId);
      this.db.prepare('DELETE FROM extraction_attempts WHERE item_id=? OR (source_kind=? AND source_id=?)').run(itemId, item.sourceKind ?? null, item.sourceId);
      return this.bootstrap(languages, windowId);
    });
  }

  /** Read current stored target state and resolve every descendant through the
   * pure domain rule inside ONE transaction. Return only committed state. */
  toggleSeen(request: ToggleSeenRequest): SeenMutationResult {
    return this.commit({ kind: 'seen-invalidation', itemId: request.itemId }, () => {
      const item = this.readItems().find(item => item.id === request.itemId);
      if (!item) throw new MissingCommentError('Unknown discussion');
      const current = this.readComments(item);
      const clicked = current.find(comment => comment.id === request.commentId);
      if (!clicked) throw new MissingCommentError('Unknown comment');
      const ids = new Set([clicked.id]);
      if (request.subtree) {
        const tree = buildCommentTree(current);
        const visit = [...tree];
        while (visit.length) {
          const node = visit.pop();
          if (!node) break;
          if (node.comment.id === clicked.id || node.comment.parentId !== null && ids.has(node.comment.parentId)) ids.add(node.comment.id);
          visit.push(...node.children);
        }
      }
      return this.assignSeen(current, ids, request.seen, 'subtree', request.subtree);
    });
  }

  private seenUndo(itemId: string): SeenUndoDescriptor | null {
    const row = this.db.prepare('SELECT * FROM seen_operations WHERE item_id=?').get(itemId);
    return row ? { id: String(row.id), itemId, createdAt: String(row.created_at), kind: row.kind as SeenUndoDescriptor['kind'],
      targetSeen: row.target_seen === 1, targetCount: Number(row.target_count), changedCount: Number(row.changed_count) } : null;
  }

  /** Called inside the command transaction. Only actual transitions own revisions.
   * A subtree requires >1 changed row; a bulk command with >1 targets retains even
   * a single actual transition. No-op and ordinary edits retain the old recovery. */
  private assignSeen(current: readonly Comment[], ids: ReadonlySet<string>, seen: boolean,
    kind: SeenUndoDescriptor['kind'], recoverable = true): SeenMutationResult {
    const changes = current.filter(comment => ids.has(comment.id) && comment.seen !== seen);
    const record = recoverable && changes.length > 0 && (kind === 'subtree' ? changes.length > 1 : ids.size > 1);
    let operationId: string | undefined;
    if (record) {
      this.db.prepare('DELETE FROM seen_operations WHERE item_id=?').run(current[0].itemId);
      operationId = this.ingestion.newId();
      this.db.prepare('INSERT INTO seen_operations VALUES (?,?,?,?,?,?,?)').run(operationId, current[0].itemId,
        this.ingestion.now(), kind, Number(seen), ids.size, changes.length);
    }
    const update = this.db.prepare('UPDATE comment_state SET seen=?, revision=revision+1 WHERE comment_id=? RETURNING revision');
    const insert = this.db.prepare('INSERT INTO seen_operation_entries VALUES (?,?,?,?)');
    for (const comment of changes) {
      const row = update.get(Number(seen), comment.id);
      if (!row) throw new Error('Missing local state');
      if (operationId) insert.run(operationId, comment.itemId, comment.id, row.revision);
    }
    if (current[0] && changes.length <= 256) this.pendingSeen = { kind: 'seen', itemId: current[0].itemId, values: changes.map(c => ({ id: c.id, seen })), undo: this.seenUndo(current[0].itemId) };
    return { comments: current.map(comment => ids.has(comment.id) && comment.seen !== seen ? { ...comment, seen } : comment),
      targetCount: ids.size, changedCount: changes.length, undo: current[0] ? this.seenUndo(current[0].itemId) : null };
  }

  /** All target resolution, validation, writes and log replacement share one
   * transaction. Publication uses precisely the filtering resolver/predicate. */
  bulkSeen(request: BulkSeenRequest, evaluationTime: () => QueryEvaluationTime = () => ({ now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })): SeenMutationResult {
    if (!isBulkSeenRequest(request)) throw new InvalidSeenTargetError('Invalid seen intent');
    return this.commit({ kind: 'seen-invalidation', itemId: request.itemId }, () => {
      const item = this.readItems().find(item => item.id === request.itemId);
      if (!item) throw new MissingCommentError('Unknown discussion');
      const current = this.readComments(item), target = request.target;
      let ids: Set<string>;
      if (target.kind === 'matching' || target.kind === 'explicit') {
        ids = new Set(target.ids);
        const owned = new Set(current.map(comment => comment.id));
        if (target.ids.some(id => !owned.has(id))) throw new InvalidSeenTargetError('Unowned matching identity');
      } else if (target.kind === 'publication') {
        const resolved = resolveBulkPublication(target, evaluationTime());
        if (!resolved.ok || !resolved.bounds) throw new InvalidSeenTargetError('Invalid publication range');
        ids = new Set(current.filter(comment => publicationMatches(ownPublicationInstant(comment.publishedAt), resolved.bounds)).map(comment => comment.id));
      } else ids = new Set(current.map(comment => comment.id));
      const result = this.assignSeen(current, ids, request.seen, target.kind === 'explicit' ? target.reason : target.kind);
      return { ...result, undo: this.seenUndo(request.itemId) };
    });
  }

  /** One-shot partial recovery: later revision ownership wins even after a user
   * changes a state away and back. Consume only after all conditional writes. */
  undoSeen(itemId: string, expectedOperationId: string): SeenUndoResult {
    return this.commit({ kind: 'seen-invalidation', itemId }, () => {
      const item = this.readItems().find(item => item.id === itemId);
      if (!item) throw new MissingCommentError('Unknown discussion');
      const operation = this.seenUndo(itemId);
      if (!operation || operation.id !== expectedOperationId) throw new UndoConflictError('Recovery replaced');
      const entries = this.db.prepare('SELECT comment_id,written_revision FROM seen_operation_entries WHERE operation_id=? AND item_id=?').all(operation.id, itemId);
      const update = this.db.prepare('UPDATE comment_state SET seen=?,revision=revision+1 WHERE comment_id=? AND revision=? AND seen=?');
      let restored = 0;
      for (const entry of entries) restored += Number(update.run(Number(!operation.targetSeen), entry.comment_id, entry.written_revision, Number(operation.targetSeen)).changes);
      this.db.prepare('DELETE FROM seen_operations WHERE id=? AND item_id=?').run(operation.id, itemId);
      return { comments: this.readComments(item), targetCount: operation.changedCount, changedCount: restored, undo: null,
        restored, skipped: operation.changedCount - restored };
    });
  }

  updatePreferences(change: PreferenceChange, languages: readonly string[]): Preferences {
    if (!isPreferenceChange(change)) throw new InvalidPreferenceError();
    return this.commit({ kind: 'preferences' }, () => {
      if ('locale' in change) this.db.prepare('UPDATE preferences SET locale = ? WHERE id = 1').run(change.locale);
      else if ('appearance' in change) {
        if (change.appearance === 'custom' && !this.readerAppearance().customThemeId) throw new InvalidPreferenceError();
        this.db.prepare('UPDATE preferences SET appearance = ? WHERE id = 1').run(change.appearance);
      }
      else if ('selectTheme' in change) {
        const current = this.readerAppearance();
        if (change.selectTheme.expectedRevision !== current.revision) throw new StateConflictError();
        if (!current.themes.some(theme => theme.id === change.selectTheme.id)) throw new InvalidPreferenceError();
        this.writeReaderAppearance({ ...current, customThemeId: change.selectTheme.id });
        this.db.prepare("UPDATE preferences SET appearance='custom' WHERE id=1").run();
      }
      else if ('readerAppearance' in change) {
        const current = this.readerAppearance(), { expectedRevision, ...settings } = change.readerAppearance;
        if (expectedRevision !== current.revision) throw new StateConflictError();
        this.writeReaderAppearance({ ...current, ...settings });
        if (settings.customThemeId && settings.customThemeId !== current.customThemeId) this.db.prepare("UPDATE preferences SET appearance='custom' WHERE id=1").run();
        else if (!settings.customThemeId && this.preferences(languages).appearance === 'custom') this.db.prepare("UPDATE preferences SET appearance='system' WHERE id=1").run();
      }
      else if ('removeWallpaper' in change) {
        const current = this.readerAppearance();
        if (change.removeWallpaper.expectedRevision !== current.revision) throw new StateConflictError();
        this.writeReaderAppearance({ ...current, wallpaperId: null, wallpaperEnabled: false });
      }
      else if ('deleteTheme' in change) {
        const current = this.readerAppearance();
        if (change.deleteTheme.expectedRevision !== current.revision) throw new StateConflictError();
        if (!current.themes.some(theme => theme.id === change.deleteTheme.id)) throw new InvalidPreferenceError();
        const selected = current.customThemeId === change.deleteTheme.id;
        this.writeReaderAppearance({ ...current, themes: current.themes.filter(theme => theme.id !== change.deleteTheme.id), customThemeId: selected ? null : current.customThemeId });
        if (selected) this.db.prepare("UPDATE preferences SET appearance=CASE WHEN appearance='custom' THEN 'system' ELSE appearance END WHERE id=1").run();
      }
      else if ('translationTarget' in change) {
        const custom = normalizeTranslationCode(change.customTranslationTarget === undefined ? this.preferences(languages).customTranslationTarget : change.customTranslationTarget);
        if (change.translationTarget === 'custom' && !custom) throw new InvalidPreferenceError();
        this.db.prepare('UPDATE preferences SET translation_target = ?, custom_translation_target = ? WHERE id = 1').run(change.translationTarget, custom ?? null);
      }
      else if ('maximumConcurrentDownloads' in change) this.db.prepare('UPDATE preferences SET maximum_concurrent_downloads = ? WHERE id = 1').run(change.maximumConcurrentDownloads);
      else if ('notificationDismissal' in change) this.db.prepare('UPDATE preferences SET notification_dismissal = ? WHERE id = 1').run(change.notificationDismissal);
      else if ('notificationDurationSeconds' in change) this.db.prepare('UPDATE preferences SET notification_duration_seconds = ? WHERE id = 1').run(change.notificationDurationSeconds);
      else if ('selectionControls' in change) this.db.prepare('UPDATE preferences SET selection_controls = ? WHERE id = 1').run(change.selectionControls);
      else this.db.prepare('UPDATE preferences SET include_collapsed_in_prefix = ? WHERE id = 1').run(Number(change.includeCollapsedInPrefix));
      return this.preferences(languages);
    });
  }

  readerAppearance(): ReaderAppearance {
    const row = this.db.prepare('SELECT config_json FROM reader_appearance WHERE id=1').get();
    const value: unknown = JSON.parse(String(row?.config_json));
    if (!isReaderAppearance(value)) throw new InvalidPreferenceError();
    return value;
  }
  private writeReaderAppearance(value: ReaderAppearance): void {
    const next = { ...value, revision: value.revision + 1 };
    if (!isReaderAppearance(next)) throw new InvalidPreferenceError();
    this.db.prepare('UPDATE reader_appearance SET config_json=? WHERE id=1').run(JSON.stringify(next));
  }
  /** Main-only import commits use the same post-COMMIT preference stream. */
  importTheme(definition: ThemeDefinition, languages: readonly string[], expectedRevision: number, id: string = randomUUID()): Preferences {
    if (!isThemeDefinition(definition)) throw new InvalidPreferenceError();
    return this.commit({ kind: 'preferences' }, () => {
      const current = this.readerAppearance();
      if (current.revision !== expectedRevision) throw new StateConflictError();
      if (current.themes.length >= 16) throw new InvalidPreferenceError();
      this.writeReaderAppearance({ ...current, themes: [...current.themes, { id, definition }], customThemeId: id });
      this.db.prepare("UPDATE preferences SET appearance='custom' WHERE id=1").run();
      return this.preferences(languages);
    });
  }
  /** File refresh uses the ordinary shared preference commit and CAS lane. */
  replaceThemes(themes: ReaderAppearance['themes'], languages: readonly string[], expectedRevision: number): Preferences {
    const current = this.readerAppearance();
    if (current.revision !== expectedRevision) throw new StateConflictError();
    if (JSON.stringify(themes) === JSON.stringify(current.themes)) return this.preferences(languages);
    return this.commit({ kind: 'preferences' }, () => {
      const customThemeId = themes.some(theme => theme.id === current.customThemeId) ? current.customThemeId : null;
      this.writeReaderAppearance({ ...current, themes, customThemeId });
      if (!customThemeId) this.db.prepare("UPDATE preferences SET appearance=CASE WHEN appearance='custom' THEN 'system' ELSE appearance END WHERE id=1").run();
      return this.preferences(languages);
    });
  }
  importWallpaper(id: string, languages: readonly string[], expectedRevision: number): Preferences {
    if (!assetId(id)) throw new InvalidPreferenceError();
    return this.commit({ kind: 'preferences' }, () => {
      const current = this.readerAppearance();
      if (current.revision !== expectedRevision) throw new StateConflictError();
      this.writeReaderAppearance({ ...current, wallpaperId: id, wallpaperEnabled: true });
      return this.preferences(languages);
    });
  }
}
export class InvalidPreferenceError extends Error {}

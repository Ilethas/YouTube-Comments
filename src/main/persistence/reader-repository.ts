import type { SharedChange, SharedCommit, SharedStamp, SharedItemSnapshot } from '../../shared/reader-sync';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildCommentTree } from '../../domain/discussion';
import type { Author, Comment, ContentItem } from '../../domain/discussion';
import { initialComments, items } from '../../fixtures/discussions';
import { initialLocale, normalizeTranslationCode } from '../../shared/preferences';
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
  private commitRevision = 0;
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
    this.pendingSeen = undefined;
    let value: T;
    try { value = transaction(this.db, action); }
    catch (error) { this.pendingSeen = undefined; throw error; }
    this.commitRevision++;
    let detail: SharedChange = { kind: 'watermark' };
    try { detail = this.pendingSeen ?? (typeof change === 'function' ? change(value) : change); } catch { /* Recovery watermark. */ }
    this.pendingSeen = undefined;
    const event: SharedCommit = { ...this.stamp(), change: detail };
    this.lastCommit = event;
    for (const observer of this.observers) { try { observer(event); } catch { /* Committed truth survives recipients. */ } }
    return value;
  }
  itemSnapshot(itemId: string): SharedItemSnapshot {
    const item = this.getStoredItem(itemId) ?? null;
    return { ...this.stamp(), itemId, item, comments: item ? this.readComments(item) : [], undo: item ? this.seenUndo(itemId) : null, workspace: this.workspace() };
  }
  private readonly invalidViewDiagnostics = new Set<string>();
  private constructor(private readonly db: DatabaseSync, private readonly ingestion: IngestionDependencies) {}

  /** Requires a resolved absolute path. Failure closes the connection and keeps
   * the existing file; no reset/recovery fallback is performed. */
  static open(databasePath: string, ingestion: IngestionDependencies = ingestionDefaults): ReaderRepository {
    return new ReaderRepository(openReaderDatabase(databasePath), ingestion);
  }

  close(): void { this.db.close(); }

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
      this.writeWorkspace({ tabs: items.map(item => discussionTab(item.id)), activeTabId: items[0] ? discussionTab(items[0].id).id : null, revision: this.workspace().revision + 1 });
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
  ingest(extraction: NormalizedExtraction, target?: AttemptTarget, openTab = false): MergeAttempt {
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
    const row = this.db.prepare('SELECT * FROM preferences WHERE id = 1').get();
    if (!row) throw new Error('Missing preferences');
    return { locale: row.locale === null ? initialLocale(languages) : row.locale as Preferences['locale'],
      appearance: row.appearance as Preferences['appearance'], translationTarget: row.translation_target as Preferences['translationTarget'],
      ...(row.custom_translation_target === null ? {} : { customTranslationTarget: String(row.custom_translation_target) }),
      selectionControls: row.selection_controls as Preferences['selectionControls'], includeCollapsedInPrefix: row.include_collapsed_in_prefix === 1 };
  }

  bootstrap(languages: readonly string[]): ReaderState {
    const items = this.readItems();
    return { items, comments: Object.fromEntries(items.map(item => [item.id, this.readComments(item)])),
      seenUndo: Object.fromEntries(items.map(item => [item.id, this.seenUndo(item.id)])),
      preferences: this.preferences(languages), workspace: this.workspace(), discussionViews: this.discussionViews(), discussionCollapse: this.discussionCollapse() };
  }

  /** Invalid presentation state is isolated per discussion; content stays readable. */
  private discussionCollapse(): Readonly<Record<string, DiscussionCollapse>> {
    const states = new Map<string, DiscussionCollapse>();
    for (const row of this.db.prepare('SELECT d.* FROM discussion_collapse d JOIN content_items i ON i.id=d.item_id').all()) {
      if (typeof row.item_id === 'string' && (row.default_collapsed === 0 || row.default_collapsed === 1))
        states.set(row.item_id, { defaultCollapsed: row.default_collapsed === 1, overrides: [] });
    }
    const overrides = new Map<string, string[]>();
    for (const row of this.db.prepare(`SELECT o.* FROM comment_collapse_overrides o
      JOIN comments c ON c.item_id=o.item_id AND c.id=o.comment_id`).all()) {
      if (typeof row.item_id !== 'string' || typeof row.comment_id !== 'string' || !states.has(row.item_id)) continue;
      const ids = overrides.get(row.item_id) ?? []; ids.push(row.comment_id); overrides.set(row.item_id, ids);
    }
    for (const [id, state] of states) states.set(id, { ...state, overrides: overrides.get(id) ?? [] });
    return Object.fromEntries(states);
  }

  /** Constant-space All, sparse opposite-default exceptions, atomic same-item
   * ownership validation. No comment/seen/query/history records are changed. */
  setDiscussionCollapse(request: SetDiscussionCollapseRequest): null {
    if (!isSetDiscussionCollapseRequest(request)) throw new InvalidDiscussionViewError();
    return this.commit({ kind: 'watermark' }, () => {
      if (!this.db.prepare('SELECT 1 FROM content_items WHERE id=?').get(request.itemId)) throw new MissingCommentError();
      if (request.kind === 'comments') {
        const owns = this.db.prepare('SELECT 1 FROM comments WHERE item_id=? AND id=?');
        if (request.ids.some(id => !owns.get(request.itemId, id))) throw new InvalidDiscussionViewError();
      }
      const existing = this.db.prepare('SELECT default_collapsed FROM discussion_collapse WHERE item_id=?').get(request.itemId);
      const valid = existing?.default_collapsed === 0 || existing?.default_collapsed === 1;
      if (existing && !valid) this.db.prepare('DELETE FROM discussion_collapse WHERE item_id=?').run(request.itemId);
      this.db.prepare('INSERT OR IGNORE INTO discussion_collapse VALUES (?,0)').run(request.itemId);
      if (request.kind === 'all') {
        this.db.prepare('DELETE FROM comment_collapse_overrides WHERE item_id=?').run(request.itemId);
        this.db.prepare('UPDATE discussion_collapse SET default_collapsed=? WHERE item_id=?').run(Number(request.collapsed), request.itemId);
      } else {
        const defaultCollapsed = valid && existing.default_collapsed === 1;
        const statement = request.collapsed === defaultCollapsed
          ? this.db.prepare('DELETE FROM comment_collapse_overrides WHERE item_id=? AND comment_id=?')
          : this.db.prepare('INSERT OR IGNORE INTO comment_collapse_overrides VALUES (?,?)');
        for (const id of request.ids) statement.run(request.itemId, id);
      }
      return null;
    });
  }

  private ownsViewIdentities(request: SaveDiscussionViewRequest): boolean {
    const owns = this.db.prepare('SELECT 1 FROM comments WHERE item_id=? AND id=?');
    return [request.anchor.commentId, request.selected].every(id => id === null || !!owns.get(request.itemId, id));
  }

  /** Validate presentation rows independently: corruption cannot fail content bootstrap.
   * Diagnostics expose a fixed code once per affected item in this connection. */
  private discussionViews(): Readonly<Record<string, DiscussionViewIntent>> {
    const views: [string, DiscussionViewIntent][] = [];
    for (const row of this.db.prepare('SELECT * FROM discussion_view_state').all()) {
      try {
        if (typeof row.draft_query_json !== 'string' || row.draft_query_json.length > 110000
          || typeof row.applied_query_json !== 'string' || row.applied_query_json.length > 110000) throw new InvalidDiscussionViewError();
        const request: unknown = { itemId: row.item_id, draft: JSON.parse(row.draft_query_json), applied: JSON.parse(row.applied_query_json),
          sort: row.sort, anchor: { commentId: row.anchor_comment_id, offset: row.anchor_offset }, selected: row.selected_comment_id };
        if (!isSaveDiscussionViewRequest(request) || !this.ownsViewIdentities(request)) throw new InvalidDiscussionViewError();
        const { itemId, ...view } = request;
        views.push([itemId, view]);
      } catch {
        const id = String(row.item_id);
        if (!this.invalidViewDiagnostics.has(id)) {
          this.invalidViewDiagnostics.add(id);
          console.warn('INVALID_DISCUSSION_VIEW_STATE');
        }
      }
    }
    return Object.fromEntries(views);
  }

  /** One small atomic full-intent upsert. No result IDs or generic JSON writes.
   * Closing a tab never deletes this row; deleting its item cascades it. */
  saveDiscussionView(request: SaveDiscussionViewRequest): null {
    if (!isSaveDiscussionViewRequest(request)) throw new InvalidDiscussionViewError('Invalid view intent');
    return this.commit({ kind: 'watermark' }, () => {
      if (!this.db.prepare('SELECT 1 FROM content_items WHERE id=?').get(request.itemId)) throw new MissingCommentError('Unknown discussion');
      if (!this.ownsViewIdentities(request)) throw new InvalidDiscussionViewError('Unowned view identity');
      this.db.prepare(`INSERT INTO discussion_view_state VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(item_id) DO UPDATE SET draft_query_json=excluded.draft_query_json, applied_query_json=excluded.applied_query_json,
          sort=excluded.sort, anchor_comment_id=excluded.anchor_comment_id, anchor_offset=excluded.anchor_offset,
          selected_comment_id=excluded.selected_comment_id`).run(request.itemId, JSON.stringify(request.draft), JSON.stringify(request.applied),
        request.sort, request.anchor.commentId, request.anchor.commentId === null ? 0 : request.anchor.offset, request.selected);
      this.invalidViewDiagnostics.delete(request.itemId);
      return null;
    });
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
    return this.commit({ kind: 'workspace' }, () => {
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
    return this.commit({ kind: 'removed', itemId }, () => {
      const item = this.readItems().find(item => item.id === itemId);
      if (!item) throw new MissingCommentError('Unknown discussion');
      if (!item.removable) throw new NotRemovableError('Discussion removal unavailable');
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
      else if ('appearance' in change) this.db.prepare('UPDATE preferences SET appearance = ? WHERE id = 1').run(change.appearance);
      else if ('translationTarget' in change) {
        const custom = normalizeTranslationCode(change.customTranslationTarget === undefined ? this.preferences(languages).customTranslationTarget : change.customTranslationTarget);
        if (change.translationTarget === 'custom' && !custom) throw new InvalidPreferenceError();
        this.db.prepare('UPDATE preferences SET translation_target = ?, custom_translation_target = ? WHERE id = 1').run(change.translationTarget, custom ?? null);
      }
      else if ('selectionControls' in change) this.db.prepare('UPDATE preferences SET selection_controls = ? WHERE id = 1').run(change.selectionControls);
      else this.db.prepare('UPDATE preferences SET include_collapsed_in_prefix = ? WHERE id = 1').run(Number(change.includeCollapsedInPrefix));
      return this.preferences(languages);
    });
  }
}
export class InvalidPreferenceError extends Error {}

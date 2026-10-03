import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { AuthorObservation, CommentObservation, ContentObservation, ImageObservation, LinkObservation, ObservedField, PublicationObservation } from '../../domain/extraction-observation';

type Row = Record<string, string | number | bigint | Uint8Array | null>;
const value = <T>(input: T | null): ObservedField<T> => input === null ? { status: 'unknown', reason: 'unavailable' } : { status: 'observed', value: input };
function author(row: Row): AuthorObservation {
  return { sourceId: value(row.author_source_id as string | null), displayName: value(row.author_display_name as string | null), handle: value(row.author_handle as string | null), avatarUrl: value<string>(null) };
}
function publication(row: Row): PublicationObservation {
  return { instant: value(row.published_at as string | null), label: value<string>(null), precision: row.published_at === null ? 'unknown' : 'exact', estimated: value<boolean>(null) };
}

/** Schema-1 fixture evidence is explicitly synthetic. Preserve all old identities,
 * timestamps, seen/preferences and declared demo parent links; never infer real-source facts. */
export function establishSyntheticHistory(db: DatabaseSync, newId: () => string = randomUUID): void {
  const insertAttempt = db.prepare(`INSERT INTO extraction_attempts
    (id,item_id,source_kind,source_id,at,backend,backend_version,coverage,outcome,collection,details)
    VALUES (?,?,?,?,?,'synthetic-demo','schema-1','unknown','accepted','present',?)`);
  for (const item of db.prepare('SELECT * FROM content_items WHERE remote_json IS NULL').all()) {
    const comments = db.prepare('SELECT * FROM comments WHERE item_id = ? ORDER BY position').all(item.id);
    const sourceKind = item.kind === 'video' ? 'youtube-video' : 'youtube-community-post';
    const attempts = new Map<string, { at: string; first: number; observed: number }>();
    attempts.set(String(item.baseline_discovery_id), { at: String(comments[0]?.first_discovered_at ?? item.published_at ?? '2026-09-20T08:00:00Z'), first: 0, observed: 0 });
    for (const comment of comments) {
      const id = String(comment.first_discovery_id);
      const attempt = attempts.get(id) ?? { at: String(comment.first_discovered_at), first: 0, observed: 0 };
      attempt.first++; attempts.set(id, attempt);
    }
    // Preserve last-observed instants even if schema 1 had no attempt label for them.
    const lastIds = new Map<string, string>();
    for (const comment of comments) {
      const at = String(comment.last_observed_at);
      let id = [...attempts].find(([, attempt]) => attempt.at === at)?.[0];
      if (!id) {
        id = newId();
        if (!id || attempts.has(id)) throw new Error('Invalid generated synthetic attempt ID');
        attempts.set(id, { at, first: 0, observed: 0 });
      }
      const attempt = attempts.get(id);
      if (!attempt) throw new Error('Missing synthetic attempt');
      attempt.observed++; lastIds.set(String(comment.id), id);
    }
    for (const [id, attempt] of attempts) insertAttempt.run(id, item.id, sourceKind, item.source_id, attempt.at, JSON.stringify({
      provenance: { backend: 'synthetic-demo', version: 'schema-1', evidence: ['Migrated/seeded synthetic reader data; no extraction occurred.'], fixture: { id: String(item.id), preparation: 'synthetic' } },
      coverage: { kind: 'unknown' }, issues: [], counts: { candidates: Math.max(attempt.first, attempt.observed), inserted: attempt.first, updated: Math.max(0, attempt.observed - attempt.first), skipped: 0, conflictedIdentities: 0 },
    }));
    const remote: ContentObservation = {
      sourceKind, sourceId: String(item.source_id), canonicalUrl: value<string>(null), title: value(item.title as string | null),
      text: value((item.kind === 'video' ? item.description : item.text) as string | null), author: author(item), publication: publication(item),
      images: value<readonly ImageObservation[]>(null), links: value<readonly LinkObservation[]>(null), likeCount: value<number>(null), reportedCommentCount: value<number>(null),
    };
    db.prepare('UPDATE content_items SET remote_json = ?, baseline_attempt_id = ? WHERE id = ?').run(JSON.stringify(remote), item.baseline_discovery_id, item.id);
    for (const comment of comments) {
      const parent = comments.find(candidate => candidate.id === comment.parent_id);
      if (comment.parent_id !== null && !parent) throw new Error('Missing schema-1 parent; migration cannot invent source truth');
      const remote: CommentObservation = {
        sourceId: String(comment.source_comment_id), text: value(String(comment.text)), author: author(comment), publication: publication(comment),
        relationship: parent ? { kind: 'direct-parent', parentSourceId: String(parent.source_comment_id) } : { kind: 'top-level' },
        likeCount: value(comment.like_count as number | null), creator: value(comment.is_creator === null ? null : comment.is_creator === 1), pinned: value(comment.is_pinned === null ? null : comment.is_pinned === 1),
      };
      db.prepare('UPDATE comments SET remote_json = ?, first_attempt_id = ?, last_attempt_id = ? WHERE id = ?')
        .run(JSON.stringify(remote), comment.first_discovery_id, lastIds.get(String(comment.id)) ?? null, comment.id);
    }
  }
}

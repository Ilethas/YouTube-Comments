import type { AuthorObservation, CommentObservation, ContentObservation, ContentSourceKind, ExtractionProvenance, ImageObservation, LinkObservation, NormalizationIssue, NormalizedExtraction, ObservationCoverage, ObservedField, PublicationObservation } from './extraction-observation';

/** Preserve precision/estimatedness for each observed publication representation,
 * since a later relative label must not rewrite the evidence for a retained exact instant. */
export interface StoredPublication extends PublicationObservation {
  readonly instantEvidence?: { readonly precision: PublicationObservation['precision']; readonly estimated: ObservedField<boolean> };
  readonly labelEvidence?: { readonly precision: PublicationObservation['precision']; readonly estimated: ObservedField<boolean> };
}
export type StoredContentObservation = Omit<ContentObservation, 'publication'> & { readonly publication: StoredPublication };
export type StoredCommentObservation = Omit<CommentObservation, 'publication'> & { readonly publication: StoredPublication };
/** Durable remote evidence and local identity/discovery, deliberately excluding seen state. */
export interface StoredObservationComment {
  readonly id: string;
  readonly remote: StoredCommentObservation;
  readonly firstDiscoveredAt: string;
  readonly firstDiscoveryId: string;
  readonly lastObservedAt: string;
  readonly lastObservationId: string;
}
export interface StoredObservationDiscussion {
  readonly id: string;
  readonly baselineId: string;
  readonly remote: StoredContentObservation;
  readonly comments: readonly StoredObservationComment[];
}
export interface AttemptTarget { readonly sourceKind: ContentSourceKind; readonly sourceId: string }
/** No raw dumps/messages: diagnostics use normalized structural issues and bounded provenance. */
export interface MergeAttempt {
  readonly id: string;
  readonly itemId?: string;
  readonly target?: AttemptTarget;
  readonly at: string;
  readonly provenance: ExtractionProvenance;
  readonly coverage: ObservationCoverage;
  readonly outcome: 'accepted' | 'failed';
  readonly collection: 'present' | 'unavailable' | 'failed';
  readonly counts: { readonly candidates: number; readonly inserted: number; readonly updated: number; readonly skipped: number; readonly conflictedIdentities: number };
  readonly issues: readonly NormalizationIssue[];
}
export interface MergeContext {
  readonly attemptId: string;
  readonly at: string;
  readonly newId: () => string;
  /** Required by a later orchestrator when failed normalization publishes no item. */
  readonly target?: AttemptTarget;
}
export interface ObservationMergePlan {
  readonly attempt: MergeAttempt;
  readonly item?: Omit<StoredObservationDiscussion, 'comments'>;
  readonly insertItem: boolean;
  readonly inserts: readonly StoredObservationComment[];
  readonly updates: readonly StoredObservationComment[];
}

function field<T>(old: ObservedField<T> | undefined, incoming: ObservedField<T>): ObservedField<T> {
  return incoming.status === 'observed' ? incoming : old ?? incoming;
}
function author(old: AuthorObservation | undefined, incoming: AuthorObservation): AuthorObservation {
  return { sourceId: field(old?.sourceId, incoming.sourceId), displayName: field(old?.displayName, incoming.displayName), handle: field(old?.handle, incoming.handle),
    avatarUrl: field(old?.avatarUrl, incoming.avatarUrl) };
}
/** Precision belongs to each observed instant/label, never its serialized number format.
 * Retained evidence survives unknown fields; a newly observed instant uses its supplied
 * precision, and a label never fabricates an instant or changes a retained instant's precision. */
export function mergePublication(old: StoredPublication | undefined, incoming: PublicationObservation): StoredPublication {
  const evidence = (type: 'instant' | 'label') => {
    const previous = type === 'instant' ? old?.instantEvidence : old?.labelEvidence;
    if (incoming[type].status === 'observed') return { precision: incoming.precision, estimated: field(previous?.estimated ?? old?.estimated, incoming.estimated) };
    return previous ?? (old?.[type].status === 'observed' ? { precision: old.precision, estimated: old.estimated } : undefined);
  };
  const instantEvidence = evidence('instant'), labelEvidence = evidence('label');
  return {
    instant: field(old?.instant, incoming.instant), label: field(old?.label, incoming.label),
    precision: instantEvidence?.precision ?? labelEvidence?.precision ?? 'unknown',
    estimated: instantEvidence?.estimated ?? labelEvidence?.estimated ?? field(old?.estimated, incoming.estimated),
    ...(instantEvidence ? { instantEvidence } : {}), ...(labelEvidence ? { labelEvidence } : {}),
  };
}
function mergeItem(old: StoredContentObservation | undefined, incoming: ContentObservation): StoredContentObservation {
  return { sourceKind: incoming.sourceKind, sourceId: incoming.sourceId, canonicalUrl: field(old?.canonicalUrl, incoming.canonicalUrl), title: field(old?.title, incoming.title),
    text: field(old?.text, incoming.text), author: author(old?.author, incoming.author), publication: mergePublication(old?.publication, incoming.publication),
    images: attachments(old?.images, incoming.images, (old, next) => ({ url: next.url, width: field(old?.width, next.width), height: field(old?.height, next.height) })),
    links: attachments(old?.links, incoming.links, (old, next) => ({ url: next.url, text: field(old?.text, next.text) })), likeCount: field(old?.likeCount, incoming.likeCount),
    reportedCommentCount: field(old?.reportedCommentCount, incoming.reportedCommentCount) };
}
function attachments<T extends ImageObservation | LinkObservation>(old: ObservedField<readonly T[]> | undefined, incoming: ObservedField<readonly T[]>, merge: (old: T | undefined, next: T) => T): ObservedField<readonly T[]> {
  if (incoming.status === 'unknown') return old ?? incoming;
  return { status: 'observed', value: incoming.value.map(next => {
    const matches = old?.status === 'observed' ? old.value.filter(entry => entry.url === next.url) : [];
    return merge(matches.length === 1 ? matches[0] : undefined, next);
  }) };
}
function mergeComment(old: StoredCommentObservation | undefined, incoming: CommentObservation): StoredCommentObservation {
  const relationship = incoming.relationship;
  return { sourceId: incoming.sourceId, relationship: relationship.kind === 'top-level' ? { kind: 'top-level' }
    : relationship.kind === 'direct-parent' ? { kind: 'direct-parent', parentSourceId: relationship.parentSourceId }
    : { kind: 'thread-containment', rootSourceId: relationship.rootSourceId },
    text: field(old?.text, incoming.text), author: author(old?.author, incoming.author),
    publication: mergePublication(old?.publication, incoming.publication), likeCount: field(old?.likeCount, incoming.likeCount),
    pinned: field(old?.pinned, incoming.pinned), creator: field(old?.creator, incoming.creator) };
}

/** Pure non-destructive plan. Every occurrence of an ambiguous identity is skipped,
 * even identical duplicates. Relationships remain source truth; reader projection handles
 * missing/cyclic targets separately. Absent stored comments do not appear in the writes. */
export function planObservationMerge(current: StoredObservationDiscussion | undefined, extraction: NormalizedExtraction, context: MergeContext): ObservationMergePlan {
  if (!context.attemptId || !context.at.endsWith('Z') || !Number.isFinite(Date.parse(context.at))) throw new Error('Invalid attempt identity/time');
  const base = { id: context.attemptId, at: context.at, provenance: extraction.provenance, coverage: extraction.coverage };
  const empty = { candidates: 0, inserted: 0, updated: 0, skipped: 0, conflictedIdentities: 0 };
  if (extraction.coverage.kind === 'failed' || !extraction.item) return {
    attempt: { ...base, itemId: current?.id, target: context.target, outcome: 'failed', collection: 'failed', counts: empty, issues: extraction.issues },
    insertItem: false, inserts: [], updates: [],
  };
  const incoming = extraction.item;
  if (current && (current.remote.sourceKind !== incoming.sourceKind || current.remote.sourceId !== incoming.sourceId)) throw new Error('Mismatched discussion');
  if (context.target && (context.target.sourceKind !== incoming.sourceKind || context.target.sourceId !== incoming.sourceId)) throw new Error('Mismatched attempt target');
  const newId = () => {
    const id = context.newId();
    if (!id || id.length > 256 || [...id].some(character => character.charCodeAt(0) < 32)) throw new Error('Invalid generated internal ID');
    return id;
  };
  const item = { id: current?.id ?? newId(), baselineId: current?.baselineId ?? context.attemptId, remote: mergeItem(current?.remote, incoming) };
  const candidates = extraction.collection?.status === 'present' ? extraction.collection.comments : [];
  const groups = new Map<string, CommentObservation[]>();
  for (const comment of candidates) {
    const group = groups.get(comment.sourceId);
    if (group) group.push(comment); else groups.set(comment.sourceId, [comment]);
  }
  const issues = [...extraction.issues];
  const inserts: StoredObservationComment[] = [], updates: StoredObservationComment[] = [];
  const stored = new Map(current?.comments.map(comment => [comment.remote.sourceId, comment]));
  let skipped = 0, conflictedIdentities = 0;
  for (const [sourceId, occurrences] of groups) {
    if (occurrences.length > 1 || issues.some(issue => issue.code === 'duplicate-identity' && issue.sourceId === sourceId)) {
      skipped += occurrences.length; conflictedIdentities++;
      if (!issues.some(issue => issue.code === 'duplicate-identity' && issue.sourceId === sourceId)) issues.push({ code: 'duplicate-identity', severity: 'error', location: '$.collection', sourceId });
      continue;
    }
    const previous = stored.get(sourceId);
    const next = { id: previous?.id ?? newId(), remote: mergeComment(previous?.remote, occurrences[0]),
      firstDiscoveredAt: previous?.firstDiscoveredAt ?? context.at, firstDiscoveryId: previous?.firstDiscoveryId ?? context.attemptId,
      lastObservedAt: context.at, lastObservationId: context.attemptId };
    (previous ? updates : inserts).push(next);
  }
  // Diagnose cycles in the accumulated library too, including a later-resolved edge.
  const combined = new Map(current?.comments.map(comment => [comment.id, comment]));
  for (const comment of [...inserts, ...updates]) combined.set(comment.id, comment);
  const projection = projectRelationships([...combined.values()].map(comment => ({ id: comment.id, remote: comment.remote })));
  for (const comment of combined.values()) {
    if (projection.get(comment.id)?.status === 'cyclic' && !issues.some(issue => issue.code === 'cyclic-relationship' && issue.sourceId === comment.remote.sourceId)) issues.push({ code: 'cyclic-relationship', severity: 'error', location: '$.storedRelationships', sourceId: comment.remote.sourceId });
  }
  return { item, insertItem: !current, inserts, updates,
    attempt: { ...base, itemId: item.id, target: { sourceKind: incoming.sourceKind, sourceId: incoming.sourceId }, outcome: 'accepted',
      collection: extraction.collection?.status ?? 'unavailable', issues,
      counts: { candidates: candidates.length, inserted: inserts.length, updated: updates.length, skipped, conflictedIdentities } } };
}

export interface RelationshipProjection {
  readonly parentId: string | null;
  readonly directParentId: string | null;
  readonly status: 'top-level' | 'resolved' | 'unresolved' | 'cyclic';
}
/** Resolve within one item. Every cycle member displays as a root; missing targets
 * display as roots too. Evidence is unchanged, and non-cycle descendants stay attached.
 * Future replied-to-author search must use directParentId, never parentId. */
export function projectRelationships(comments: readonly { readonly id: string; readonly remote: CommentObservation }[]): ReadonlyMap<string, RelationshipProjection> {
  const ids = new Map(comments.map(comment => [comment.remote.sourceId, comment.id]));
  const parents = new Map<string, string>();
  for (const comment of comments) {
    const relation = comment.remote.relationship;
    const sourceId = relation.kind === 'direct-parent' ? relation.parentSourceId : relation.kind === 'thread-containment' ? relation.rootSourceId : undefined;
    const parent = sourceId === undefined ? undefined : ids.get(sourceId);
    if (parent !== undefined) parents.set(comment.id, parent);
  }
  const cyclic = new Set<string>(), done = new Set<string>();
  for (const id of parents.keys()) {
    const path: string[] = [], indexes = new Map<string, number>();
    let next: string | undefined = id;
    while (next !== undefined && !done.has(next) && !indexes.has(next)) {
      indexes.set(next, path.length); path.push(next); next = parents.get(next);
    }
    if (next !== undefined && indexes.has(next)) for (const member of path.slice(indexes.get(next))) cyclic.add(member);
    for (const member of path) done.add(member);
  }
  return new Map(comments.map(comment => {
    const parentId = cyclic.has(comment.id) ? null : parents.get(comment.id) ?? null;
    return [comment.id, { parentId, directParentId: comment.remote.relationship.kind === 'direct-parent' ? parentId : null,
      status: cyclic.has(comment.id) ? 'cyclic' : comment.remote.relationship.kind === 'top-level' ? 'top-level' : parentId === null ? 'unresolved' : 'resolved' }];
  }));
}

export function observedValue<T>(value: ObservedField<T>): T | undefined { return value.status === 'observed' ? value.value : undefined; }

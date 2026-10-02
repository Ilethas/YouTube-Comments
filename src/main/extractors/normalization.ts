import type { CommentObservation, ContentSourceKind, ExtractionProvenance, NormalizationIssue, NormalizedExtraction, ObservedField } from '../../domain/extraction-observation';

/** Trusted side-channel evidence; raw helper JSON has no reliable coverage status. */
export interface CaptureContext {
  readonly provenance: ExtractionProvenance;
  readonly partialEvidence?: readonly string[];
  readonly failure?: string;
  readonly commentsDisabled?: boolean;
}

export const observed = <T>(value: T): ObservedField<T> => ({ status: 'observed', value });
export const unknown = <T>(reason: Extract<ObservedField<T>, { status: 'unknown' }>['reason'] = 'unavailable'): ObservedField<T> => ({ status: 'unknown', reason });
export const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const identity = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function failed(context: CaptureContext, issues: readonly NormalizationIssue[], reason: string): NormalizedExtraction {
  return { provenance: context.provenance, issues, coverage: { kind: 'failed', reason } };
}

export function decode(json: string, issues: NormalizationIssue[]): unknown {
  try { return JSON.parse(json); }
  catch { issues.push({ code: 'invalid-json', severity: 'error', location: '$' }); return undefined; }
}

export function field<T>(value: unknown, valid: (value: unknown) => value is T, location: string, issues: NormalizationIssue[]): ObservedField<T> {
  if (value === undefined || value === null) return unknown();
  if (valid(value)) return observed(value);
  issues.push({ code: 'invalid-field', severity: 'warning', location });
  return unknown('invalid');
}

export const stringValue = (value: unknown): value is string => typeof value === 'string';
export const countValue = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const booleanValue = (value: unknown): value is boolean => typeof value === 'boolean';

/** Explicit YouTube adapter rule. An unencodable identity remains opaque and observed;
 * only its derived URL becomes unavailable, rather than throwing on malformed Unicode. */
export function canonicalUrl(sourceKind: ContentSourceKind, sourceId: string, issues: NormalizationIssue[]): ObservedField<string> {
  try {
    const encoded = encodeURIComponent(sourceId);
    return observed(sourceKind === 'youtube-video' ? `https://www.youtube.com/watch?v=${encoded}` : `https://www.youtube.com/post/${encoded}`);
  } catch {
    issues.push({ code: 'invalid-field', severity: 'warning', location: '$.canonicalUrl', sourceId });
    return unknown('invalid');
  }
}

export function coverage(context: CaptureContext) {
  return context.partialEvidence?.length
    ? { kind: 'partial' as const, evidence: [...context.partialEvidence] }
    : { kind: 'unknown' as const };
}

/** No identity arbitration or tree repair. Missing references may already exist in local history. */
export function relationshipIssues(comments: readonly CommentObservation[], locations: readonly string[], issues: NormalizationIssue[]): void {
  const occurrences = new Map<string, number[]>();
  comments.forEach((comment, index) => {
    const indexes = occurrences.get(comment.sourceId);
    if (indexes) indexes.push(index);
    else occurrences.set(comment.sourceId, [index]);
  });
  for (const [sourceId, indexes] of occurrences) {
    if (indexes.length > 1) issues.push({ code: 'duplicate-identity', severity: 'error', sourceId, location: locations[indexes[0]], relatedLocations: indexes.slice(1).map(index => locations[index]) });
  }
  const parents = new Map<string, string>();
  comments.forEach((comment, index) => {
    const relationship = comment.relationship;
    if (relationship.kind === 'top-level') return;
    const parent = relationship.kind === 'direct-parent' ? relationship.parentSourceId : relationship.rootSourceId;
    if (!occurrences.has(parent)) issues.push({ code: 'missing-parent', severity: 'warning', location: locations[index], sourceId: comment.sourceId });
    if (occurrences.get(comment.sourceId)?.length === 1) parents.set(comment.sourceId, parent);
  });
  const done = new Set<string>();
  for (const sourceId of parents.keys()) {
    const path = new Set<string>();
    let current: string | undefined = sourceId;
    while (current !== undefined && !done.has(current) && !path.has(current)) {
      path.add(current); current = parents.get(current);
    }
    const index = current === undefined ? undefined : occurrences.get(current)?.[0];
    if (current !== undefined && path.has(current) && index !== undefined) issues.push({ code: 'cyclic-relationship', severity: 'error', location: locations[index], sourceId: current });
    for (const id of path) done.add(id);
  }
}

/** A handle is derived only from an explicit YouTube /@handle author URL. */
export function authorHandle(url: unknown): ObservedField<string> {
  if (typeof url !== 'string') return unknown();
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && ['www.youtube.com', 'youtube.com'].includes(parsed.hostname) && /^\/@[^/]+\/?$/.test(parsed.pathname)) return observed(decodeURIComponent(parsed.pathname.replace(/\/$/, '').slice(1)));
  } catch { /* Unavailable identity; never infer from the display name. */ }
  return unknown();
}

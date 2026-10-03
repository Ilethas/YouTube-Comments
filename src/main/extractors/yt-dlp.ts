import type { CommentObservation, ContentObservation, NormalizationIssue, NormalizedExtraction, PublicationObservation } from '../../domain/extraction-observation';
import { avatar, authorHandle, booleanValue, canonicalUrl, countValue, coverage, decode, failed, field, identity, object, observed, relationshipIssues, stringValue, unknown } from './normalization';
import type { CaptureContext } from './normalization';

function publication(raw: Record<string, unknown>, location: string, issues: NormalizationIssue[], comment: boolean): PublicationObservation {
  const seconds = field(raw.timestamp, (value): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value * 1000) <= 8640000000000000, `${location}.timestamp`, issues);
  const label = raw._time_text === '' ? unknown<string>('lossy-default') : field(raw._time_text, identity, `${location}.publicationLabel`, issues);
  const hasPublication = seconds.status === 'observed' || label.status === 'observed';
  return {
    instant: seconds.status === 'observed' ? observed(new Date(seconds.value * 1000).toISOString()) : seconds,
    label,
    // The investigated YouTube comment paths derive timestamps from relative labels.
    precision: comment && hasPublication ? 'coarse' : 'unknown',
    estimated: comment && hasPublication ? observed(true) : unknown(),
  };
}

/** Parses only the investigated single-video JSON contract. No process execution, mutation,
 * completeness/count inference, or application-tree repair occurs here. */
export function normalizeYtDlp(json: string, context: CaptureContext): NormalizedExtraction {
  const issues: NormalizationIssue[] = [];
  if (context.failure) return failed(context, issues, context.failure);
  if (context.provenance.backend !== 'yt-dlp' || context.provenance.version !== '2026.08.19') return failed(context, issues, 'unsupported-backend-version');
  const raw = decode(json, issues);
  if (!object(raw) || !identity(raw.id) || (raw._type !== undefined && raw._type !== 'video') || (raw.comments !== undefined && raw.comments !== null && !Array.isArray(raw.comments))) {
    issues.push({ code: 'invalid-structure', severity: 'error', location: '$' });
    return failed(context, issues, 'invalid-video-output');
  }
  const item: ContentObservation = {
    sourceKind: 'youtube-video', sourceId: raw.id,
    canonicalUrl: canonicalUrl('youtube-video', raw.id, issues),
    title: field(raw.title, stringValue, '$.title', issues),
    text: field(raw.description, stringValue, '$.text', issues),
    author: {
      sourceId: field(raw.channel_id, identity, '$.authorIdentity', issues),
      displayName: field(raw.channel, identity, '$.authorName', issues),
      handle: authorHandle(raw.channel_url),
      avatarUrl: unknown('unsupported'),
    },
    publication: publication(raw, '$', issues, false),
    images: unknown('unsupported'), links: unknown('unsupported'),
    likeCount: field(raw.like_count, countValue, '$.likes', issues),
    // After fetching this may be extracted count, not the original remote total.
    reportedCommentCount: raw.comment_count === undefined ? unknown() : unknown('unreliable'),
  };
  if (!Array.isArray(raw.comments)) return {
    provenance: context.provenance, issues, item, coverage: coverage(context),
    collection: { status: 'unavailable', reason: context.commentsDisabled ? 'disabled' : 'unknown' },
  };
  const comments: CommentObservation[] = [];
  const locations: string[] = [];
  for (const [index, input] of raw.comments.entries()) {
    const location = `$.comments[${index}]`;
    if (!object(input) || !identity(input.id) || typeof input.text !== 'string' || !identity(input.parent)) {
      issues.push({ code: 'invalid-structure', severity: 'error', location });
      return failed(context, issues, 'invalid-comment-output');
    }
    locations.push(location);
    comments.push({
      sourceId: input.id, text: observed(input.text),
      relationship: input.parent === 'root' ? { kind: 'top-level' } : { kind: 'direct-parent', parentSourceId: input.parent },
      author: {
        sourceId: field(input.author_id, identity, `${location}.authorIdentity`, issues),
        displayName: field(input.author, identity, `${location}.authorName`, issues),
        handle: authorHandle(input.author_url),
        avatarUrl: avatar(input.author_thumbnail, `${location}.avatarUrl`, issues),
      },
      publication: publication(input, location, issues, true),
      likeCount: field(input.like_count, countValue, `${location}.likes`, issues),
      pinned: field(input.is_pinned, booleanValue, `${location}.pinned`, issues),
      creator: field(input.author_is_uploader, booleanValue, `${location}.creator`, issues),
    });
  }
  relationshipIssues(comments, locations, issues);
  return { provenance: context.provenance, issues, item, coverage: coverage(context), collection: { status: 'present', comments } };
}

import type { AuthorObservation, CommentObservation, ContentObservation, ImageObservation, LinkObservation, NormalizationIssue, NormalizedExtraction, ObservedField, PublicationObservation } from '../../domain/extraction-observation';
import { authorHandle, booleanValue, canonicalUrl, countValue, coverage, decode, failed, field, identity, object, observed, relationshipIssues, stringValue, unknown } from './normalization';
import type { CaptureContext } from './normalization';

function text(value: unknown, location: string, issues: NormalizationIssue[]): ObservedField<string> {
  return value === '' ? unknown('lossy-default') : field(value, stringValue, location, issues);
}

function count(value: unknown, location: string, issues: NormalizationIssue[]): ObservedField<number> {
  if (value === undefined || value === null) return unknown();
  if (value === '0') return unknown('lossy-default');
  // No suffix/locale guessing for abbreviated counts such as 1.2K.
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && countValue(Number(value))) return observed(Number(value));
  issues.push({ code: 'invalid-field', severity: 'warning', location });
  return unknown('invalid');
}

function author(raw: Record<string, unknown>, location: string, issues: NormalizationIssue[]): AuthorObservation {
  return {
    sourceId: raw.author_id === '' ? unknown('lossy-default') : field(raw.author_id, identity, `${location}.authorIdentity`, issues),
    displayName: raw.author === '' ? unknown('lossy-default') : field(raw.author, identity, `${location}.authorName`, issues),
    handle: authorHandle(raw.author_url),
  };
}

function publication(raw: Record<string, unknown>, location: string, issues: NormalizationIssue[]): PublicationObservation {
  const label = text(raw.timestamp, `${location}.publicationLabel`, issues);
  const estimated = field(raw.timestamp_estimated, booleanValue, `${location}.publicationEstimated`, issues);
  // Archive timestamps are source labels; do not parse them using locale or current time.
  return {
    instant: unknown(), label,
    precision: estimated.status === 'observed' && estimated.value && label.status === 'observed' ? 'coarse' : 'unknown',
    estimated: estimated.status === 'unknown' ? estimated : estimated.value && label.status === 'observed' ? observed(true) : unknown('lossy-default'),
  };
}

function attachments<T>(value: unknown, location: string, issues: NormalizationIssue[], parse: (raw: Record<string, unknown>, location: string) => T | undefined): ObservedField<readonly T[]> {
  if (value === undefined || value === null) return unknown();
  if (!Array.isArray(value)) { issues.push({ code: 'invalid-field', severity: 'warning', location }); return unknown('invalid'); }
  if (!value.length) return unknown('lossy-default');
  const result: T[] = [];
  for (const [index, raw] of value.entries()) {
    const entryLocation = `${location}[${index}]`;
    const entry = object(raw) ? parse(raw, entryLocation) : undefined;
    if (!entry) { issues.push({ code: 'invalid-field', severity: 'warning', location: entryLocation }); return unknown('invalid'); }
    result.push(entry);
  }
  return observed(result);
}

/** Parses the 0.4.0 flattened archive envelope for exactly one public individual post.
 * Nested output proves thread containment only. No field in this verified format proves
 * a reply's direct parent; undocumented parent-like extensions are deliberately ignored. */
export function normalizeCommunityArchive(json: string, context: CaptureContext): NormalizedExtraction {
  const issues: NormalizationIssue[] = [];
  if (context.failure) return failed(context, issues, context.failure);
  if (context.provenance.backend !== 'post-archiver-improved' || context.provenance.version !== '0.4.0') return failed(context, issues, 'unsupported-backend-version');
  const raw = decode(json, issues);
  if (!object(raw) || !identity(raw.channel_id) || !Array.isArray(raw.posts) || raw.posts.length !== 1) {
    issues.push({ code: 'invalid-structure', severity: 'error', location: '$' });
    return failed(context, issues, 'invalid-individual-post-archive');
  }
  const post = raw.posts[0];
  if (!object(post) || !identity(post.post_id) || typeof post.content !== 'string' || !Array.isArray(post.comments)) {
    issues.push({ code: 'invalid-structure', severity: 'error', location: '$.posts[0]' });
    return failed(context, issues, 'invalid-post-output');
  }
  const item: ContentObservation = {
    sourceKind: 'youtube-community-post', sourceId: post.post_id,
    canonicalUrl: canonicalUrl('youtube-community-post', post.post_id, issues),
    title: unknown('unsupported'), text: text(post.content, '$.itemText', issues),
    author: author(post, '$.item', issues), publication: publication(post, '$.item', issues),
    likeCount: count(post.likes, '$.itemLikes', issues),
    reportedCommentCount: post.comments_count === undefined ? unknown() : unknown('unreliable'),
    images: attachments<ImageObservation>(post.images, '$.images', issues, (image, location) => identity(image.src) ? {
      url: image.src, width: field(image.width, countValue, `${location}.width`, issues), height: field(image.height, countValue, `${location}.height`, issues),
    } : undefined),
    links: attachments<LinkObservation>(post.links, '$.links', issues, (link, location) => identity(link.url) ? { url: link.url, text: text(link.text, `${location}.text`, issues) } : undefined),
  };
  const comments: CommentObservation[] = [];
  const locations: string[] = [];
  const pending: { input: unknown; root?: string; location: string }[] = post.comments.map((input, index) => ({ input, location: `$.posts[0].comments[${index}]` })).reverse();
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    const { input, root, location } = entry;
    if (!object(input) || !identity(input.id) || typeof input.text !== 'string' || !Array.isArray(input.replies)) {
      issues.push({ code: 'invalid-structure', severity: 'error', location });
      return failed(context, issues, 'invalid-comment-output');
    }
    locations.push(location);
    comments.push({
      sourceId: input.id, text: text(input.text, `${location}.text`, issues), author: author(input, location, issues),
      publication: publication(input, location, issues),
      relationship: root === undefined ? { kind: 'top-level' } : { kind: 'thread-containment', rootSourceId: root },
      likeCount: count(input.like_count, `${location}.likes`, issues),
      pinned: input.is_pinned === undefined ? unknown() : unknown('unreliable'),
      creator: unknown('unsupported'), // Favorite/member/verified badges are not creator identity.
    });
    for (let index = input.replies.length - 1; index >= 0; index--) pending.push({ input: input.replies[index], root: root ?? input.id, location: `${location}.replies[${index}]` });
  }
  relationshipIssues(comments, locations, issues);
  return { provenance: context.provenance, issues, coverage: coverage(context), item, collection: { status: 'present', comments } };
}

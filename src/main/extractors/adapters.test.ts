import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// eslint-disable-next-line import/no-unresolved
import { describe, expect, it } from 'vitest';
import type { CommentObservation, ContentObservation, NormalizedExtraction } from '../../domain/extraction-observation';
import { normalizeCommunityArchive } from './community';
import { normalizeYtDlp } from './yt-dlp';
import type { CaptureContext } from './normalization';

interface Fixture { context: CaptureContext; documentation: { origin: string; behavior: string; preserved: string; invocation: string }; raw: Record<string, unknown> }
const directory = join(__dirname, '__fixtures__');
function fixture(id: string): Fixture { return JSON.parse(readFileSync(join(directory, `${id}.json`), 'utf8')); }
function normalize(id: string): NormalizedExtraction {
  const input = fixture(id);
  return (input.context.provenance.backend === 'yt-dlp' ? normalizeYtDlp : normalizeCommunityArchive)(JSON.stringify(input.raw), input.context);
}
function comments(result: NormalizedExtraction): readonly CommentObservation[] {
  if (result.collection?.status !== 'present') throw new Error('Expected present collection');
  return result.collection.comments;
}
function item(result: NormalizedExtraction): ContentObservation {
  if (!result.item) throw new Error('Expected usable item');
  return result.item;
}

describe('yt-dlp observations', () => {
  it('maps HTTPS thumbnails and keeps missing/invalid avatars unknown', () => {
    const input = fixture('yt-nested-a');
    const normalized = comments(normalize('yt-nested-a'));
    expect(normalized.find(comment => comment.author.displayName.status === 'observed' && comment.author.displayName.value === 'Example A')?.author.avatarUrl)
      .toEqual({ status: 'observed', value: 'https://example.invalid/video-comment-author.png' });
    expect(normalized[0].author.avatarUrl).toEqual({ status: 'unknown', reason: 'unavailable' });
    for (const value of ['http://example.invalid/a', 'javascript:alert(1)', 'https://user:pass@example.invalid/a', 'not a URL', 12]) {
      const result = normalizeYtDlp(JSON.stringify({ ...input.raw, comments: [{ id: 'a', text: 'text', parent: 'root', author_thumbnail: value }] }), input.context);
      expect(comments(result)[0].author.avatarUrl).toEqual({ status: 'unknown', reason: 'invalid' });
      expect(result.issues).toContainEqual({ code: 'invalid-field', severity: 'warning', location: '$.comments[0].avatarUrl' });
    }
  });
  it('preserves opaque IDs and out-of-order direct depth, without inventing parent records', () => {
    const result = normalize('yt-nested-a');
    expect(item(result).sourceId).toBe('VidDemo_001');
    expect(item(result).sourceKind).toBe('youtube-video');
    expect(item(result).canonicalUrl).toEqual({ status: 'observed', value: 'https://www.youtube.com/watch?v=VidDemo_001' });
    expect(comments(result).map(comment => [comment.sourceId, comment.relationship])).toEqual([
      ['Ug.demo/deep:03', { kind: 'direct-parent', parentSourceId: 'Ug.demo+reply:02' }],
      ['Ug.demo+reply:02', { kind: 'direct-parent', parentSourceId: 'Ug.demo-root:01' }],
      ['Ug.demo-root:01', { kind: 'top-level' }],
    ]);
    expect(result.issues).toEqual([]);
    expect(comments(result)[2].text).toEqual({ status: 'observed', value: 'Invented root.\nZażółć gęślą jaźń.' });
  });

  it('keeps absent optional fields unknown while preserving explicit zero/false and pin/creator evidence', () => {
    const [deep, reply, root] = comments(normalize('yt-nested-a'));
    expect(deep.author.sourceId).toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(deep.likeCount.status).toBe('unknown');
    expect(deep.pinned.status).toBe('unknown');
    expect(deep.creator.status).toBe('unknown');
    expect(reply.likeCount).toEqual({ status: 'observed', value: 0 });
    expect(reply.pinned).toEqual({ status: 'observed', value: false });
    expect(reply.creator).toEqual({ status: 'observed', value: false });
    expect(reply.author.handle).toEqual({ status: 'observed', value: '@example-b' });
    expect(root.likeCount).toEqual({ status: 'observed', value: 12 });
    expect(root.pinned).toEqual({ status: 'observed', value: true });
    expect(root.creator).toEqual({ status: 'observed', value: true });
  });

  it('never upgrades integer comment timestamps to exact source precision', () => {
    const [deep, reply] = comments(normalize('yt-nested-a'));
    expect(reply.publication).toMatchObject({ precision: 'coarse', estimated: { status: 'observed', value: true }, label: { status: 'observed', value: '1 week ago' } });
    expect(reply.publication.instant).toEqual({ status: 'observed', value: '2025-09-27T19:06:40.000Z' });
    expect(deep.publication.instant.status).toBe('unknown');
    const input = fixture('yt-nested-a');
    const noLabel = { ...input.raw, comments: [{ id: 'opaque', text: 'text', parent: 'root', timestamp: 1759000000 }] };
    expect(comments(normalizeYtDlp(JSON.stringify(noLabel), input.context))[0].publication.precision).toBe('coarse');
  });

  it('separates unavailable, disabled and present empty collections without completeness inference', () => {
    expect(normalize('yt-unavailable').collection).toEqual({ status: 'unavailable', reason: 'unknown' });
    expect(normalize('yt-disabled').collection).toEqual({ status: 'unavailable', reason: 'disabled' });
    expect(normalize('yt-empty').collection).toEqual({ status: 'present', comments: [] });
    expect(normalize('yt-empty').coverage.kind).toBe('unknown');
    const input = fixture('yt-unavailable');
    const { comments: omitted, ...raw } = input.raw;
    expect(omitted).toBeNull();
    expect(normalizeYtDlp(JSON.stringify(raw), input.context).collection?.status).toBe('unavailable');
  });

  it('ordinary output stays unknown even with matching counts; side-channel limited evidence produces partial', () => {
    expect(normalize('yt-nested-a').coverage.kind).toBe('unknown');
    expect(item(normalize('yt-nested-a')).reportedCommentCount).toEqual({ status: 'unknown', reason: 'unreliable' });
    const limited = fixture('yt-limited');
    expect(normalize('yt-limited').coverage).toMatchObject({ kind: 'partial', evidence: limited.context.partialEvidence });
    expect(normalizeYtDlp(JSON.stringify(limited.raw), { provenance: limited.context.provenance }).coverage.kind).toBe('unknown');
  });

  it.each([{ id: '', text: 'x', parent: 'root' }, { id: 'x', parent: 'root' }, { id: 'x', text: 12, parent: 'root' }, { id: 'x', text: 'x' }, { id: 12, text: 'x', parent: 'root' }])('fails unusable required comment shape %# without publishing a batch', bad => {
    const input = fixture('yt-nested-a');
    const result = normalizeYtDlp(JSON.stringify({ ...input.raw, comments: [bad] }), input.context);
    expect(result.coverage.kind).toBe('failed');
    expect(result.item).toBeUndefined();
    expect(result.issues).toContainEqual({ code: 'invalid-structure', severity: 'error', location: '$.comments[0]' });
  });

  it('retains duplicate candidates and diagnoses missing/cyclic references without choosing or repairing', () => {
    const input = fixture('yt-nested-a');
    const result = normalizeYtDlp(JSON.stringify({ ...input.raw, comments: [
      { id: 'duplicate', text: 'one', parent: 'root' }, { id: 'duplicate', text: 'two', parent: 'missing' },
      { id: 'cycle-a', text: 'a', parent: 'cycle-b' }, { id: 'cycle-b', text: 'b', parent: 'cycle-a' },
    ] }), input.context);
    expect(comments(result)).toHaveLength(4);
    expect(result.issues.map(issue => issue.code)).toEqual(['duplicate-identity', 'missing-parent', 'cyclic-relationship']);
    expect(comments(result)[1].relationship).toEqual({ kind: 'direct-parent', parentSourceId: 'missing' });
  });

  it('rejects malformed optional fields as unknown, retaining usable required observations', () => {
    const input = fixture('yt-nested-a');
    const result = normalizeYtDlp(JSON.stringify({ ...input.raw, comments: [{ id: 'x', text: '', parent: 'root', timestamp: 1e100, like_count: -1, is_pinned: 'false' }] }), input.context);
    expect(result.coverage.kind).toBe('unknown');
    expect(comments(result)[0].text).toEqual({ status: 'observed', value: '' });
    expect(comments(result)[0].publication.instant).toEqual({ status: 'unknown', reason: 'invalid' });
    expect(comments(result)[0].likeCount).toEqual({ status: 'unknown', reason: 'invalid' });
    expect(result.issues).toHaveLength(3);
  });
});

describe('Community archive observations', () => {
  it('maps post/comment thumbnails while empty defaults are lossy, never authoritative clears', () => {
    const result = normalize('community-thread-a');
    expect(item(result).author.avatarUrl).toEqual({ status: 'observed', value: 'https://example.invalid/post-author.png' });
    expect(comments(result)[0].author.avatarUrl).toEqual({ status: 'observed', value: 'https://example.invalid/comment-author.png' });
    expect(comments(result)[1].author.avatarUrl).toEqual({ status: 'unknown', reason: 'lossy-default' });
  });

  it('retains the live-recaptured protocol-relative post thumbnail as unknown with a useful warning', () => {
    const result = normalize('community-limited');
    expect(item(result).author.avatarUrl).toEqual({ status: 'unknown', reason: 'invalid' });
    expect(result.issues).toContainEqual({ code: 'invalid-field', severity: 'warning', location: '$.item.avatarUrl' });
  });

  it('accepts verified integer English accessibility like labels and keeps zero/lossy and approximate formats conservative', () => {
    const input = fixture('community-thread-a');
    const samples = ['1 like', '4 likes', '0 likes', '1.2K likes', '4 polubienia', '4 likes extra', 4];
    const result = normalizeCommunityArchive(JSON.stringify({ channel_id: 'unknown', posts: [{ post_id: 'opaque', content: 'text',
      comments: samples.map((value, index) => ({ id: `c${index}`, text: 'text', replies: [], like_count: value })) }] }), input.context);
    expect(comments(result).map(comment => comment.likeCount)).toEqual([
      { status: 'observed', value: 1 }, { status: 'observed', value: 4 }, { status: 'unknown', reason: 'lossy-default' },
      ...Array.from({ length: 4 }, () => ({ status: 'unknown', reason: 'invalid' })),
    ]);
    expect(result.issues.map(issue => issue.location)).toEqual([3, 4, 5, 6].map(index => `$.posts[0].comments[${index}].likes`));
  });
  it('maps opaque post/comment IDs and thread containment without direct-parent claims', () => {
    const result = normalize('community-thread-a');
    expect(item(result).sourceId).toBe('UgkDemoPost_0123456789');
    expect(item(result).sourceKind).toBe('youtube-community-post');
    expect(item(result).text).toEqual({ status: 'observed', value: 'Invented Community update.\nCześć, świecie 🌍!' });
    expect(comments(result).map(comment => [comment.sourceId, comment.relationship])).toEqual([
      ['Ug.thread:01', { kind: 'top-level' }], ['Ug.reply:02', { kind: 'thread-containment', rootSourceId: 'Ug.thread:01' }],
      ['Ug.reply:03', { kind: 'thread-containment', rootSourceId: 'Ug.thread:01' }], ['Ug.thread:04', { kind: 'top-level' }],
    ]);
    expect(result.issues).toEqual([]);
  });

  it('does not upgrade deeper nesting or undocumented parent-like fields to direct parent', () => {
    const input = fixture('community-thread-a');
    const raw = structuredClone(input.raw) as { posts: { comments: { id: string; replies: Record<string, unknown>[] }[] }[] };
    const root = raw.posts[0].comments[0];
    root.replies[0].replies = [{ ...root.replies[1], parent_id: root.replies[0].id }];
    root.replies.splice(1);
    const replies = comments(normalizeCommunityArchive(JSON.stringify(raw), input.context)).filter(comment => comment.relationship.kind === 'thread-containment');
    expect(replies).toHaveLength(2);
    expect(replies.map(comment => comment.relationship)).toEqual([{ kind: 'thread-containment', rootSourceId: 'Ug.thread:01' }, { kind: 'thread-containment', rootSourceId: 'Ug.thread:01' }]);
  });

  it('preserves conservative unknowns for collapsed defaults, including text and attachments', () => {
    const result = normalize('community-lossy');
    for (const value of [item(result).text, item(result).author.sourceId, item(result).author.displayName, item(result).likeCount, item(result).images, item(result).links, item(result).publication.label, item(result).publication.estimated, comments(result)[0].text, comments(result)[0].likeCount]) {
      expect(value).toEqual({ status: 'unknown', reason: 'lossy-default' });
    }
    expect(item(result).publication.instant.status).toBe('unknown');
    expect(item(result).publication.precision).toBe('unknown');
    expect(comments(result)[0].author.handle.status).toBe('unknown');
  });

  it('retains reliable positive integer likes/author data, but makes counts/pinning/creator non-authoritative', () => {
    const result = normalize('community-thread-a');
    expect(comments(result)[0].likeCount).toEqual({ status: 'observed', value: 4 });
    expect(comments(result)[0].author.sourceId).toEqual({ status: 'observed', value: 'UC_DemoC' });
    expect(item(result).author.handle).toEqual({ status: 'observed', value: '@example-creator' });
    expect(item(result).reportedCommentCount).toEqual({ status: 'unknown', reason: 'unreliable' });
    expect(comments(result)[0].pinned).toEqual({ status: 'unknown', reason: 'unreliable' });
    expect(comments(result)[1].pinned).toEqual({ status: 'unknown', reason: 'unreliable' });
    expect(comments(result)[0].creator).toEqual({ status: 'unknown', reason: 'unsupported' });
  });

  it('keeps relative publication labels without invented instants or exact precision', () => {
    const result = normalize('community-thread-a');
    expect(item(result).publication).toEqual({ instant: { status: 'unknown', reason: 'unavailable' }, label: { status: 'observed', value: '2 days ago' }, precision: 'coarse', estimated: { status: 'observed', value: true } });
  });

  it('maps image/link data as observations only, excluding download paths and filesystem metadata', () => {
    const result = normalize('community-thread-a');
    expect(item(result).images).toEqual({ status: 'observed', value: [{ url: 'https://example.invalid/post-image.png', width: { status: 'observed', value: 640 }, height: { status: 'observed', value: 480 } }] });
    expect(item(result).links).toEqual({ status: 'observed', value: [{ url: 'https://example.invalid/resource', text: { status: 'observed', value: 'Invented resource' } }] });
  });

  it('retains both conflicting duplicate candidates and both containing roots as evidence', () => {
    const result = normalize('community-duplicate');
    const duplicates = comments(result).filter(comment => comment.sourceId === 'Ug.reply:02');
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map(comment => comment.relationship)).toEqual([{ kind: 'thread-containment', rootSourceId: 'Ug.thread:01' }, { kind: 'thread-containment', rootSourceId: 'Ug.thread:04' }]);
    expect(result.issues).toEqual([{ code: 'duplicate-identity', severity: 'error', sourceId: 'Ug.reply:02', location: '$.posts[0].comments[0].replies[0]', relatedLocations: ['$.posts[0].comments[1].replies[0]'] }]);
  });

  it('ordinary output remains unknown; only side-channel evidence establishes partial coverage', () => {
    expect(normalize('community-thread-a').coverage.kind).toBe('unknown');
    expect(normalize('community-limited').coverage.kind).toBe('partial');
    const limited = fixture('community-limited');
    expect(normalizeCommunityArchive(JSON.stringify(limited.raw), { provenance: limited.context.provenance }).coverage.kind).toBe('unknown');
  });

  it('keeps omitted metadata unavailable and refuses approximate counts or malformed optional attachments', () => {
    const input = fixture('community-thread-a');
    const result = normalizeCommunityArchive(JSON.stringify({ channel_id: 'post_opaque', posts: [{ post_id: 'opaque', content: 'text', likes: '1.2K', images: 'invalid', comments: [{ id: 'reply-id', text: 'text', timestamp_estimated: 'false', replies: [] }] }] }), input.context);
    expect(result.coverage.kind).toBe('unknown');
    expect(item(result).likeCount).toEqual({ status: 'unknown', reason: 'invalid' });
    expect(item(result).images).toEqual({ status: 'unknown', reason: 'invalid' });
    expect(item(result).links).toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(comments(result)[0].author.sourceId).toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(comments(result)[0].pinned).toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(comments(result)[0].publication.estimated).toEqual({ status: 'unknown', reason: 'invalid' });
    expect(result.issues).toHaveLength(3);
  });

  it.each([{}, { channel_id: 'x', posts: [] }, { channel_id: 'x', posts: [{ post_id: 'x', content: 1, comments: [] }] }, { channel_id: 'x', posts: [{ post_id: 'x', content: 'x', comments: [{ id: 'c', text: 'x' }] }] }])('rejects unusable archive/post/comment shape %#', raw => {
    expect(normalizeCommunityArchive(JSON.stringify(raw), fixture('community-thread-a').context).coverage.kind).toBe('failed');
  });
});

describe('shared observation boundary and fixture provenance', () => {
  it('preserves opaque item IDs while marking an unencodable derived URL unknown', () => {
    const yt = fixture('yt-nested-a'); const community = fixture('community-thread-a');
    const sourceId = '\ud800';
    const a = normalizeYtDlp(JSON.stringify({ ...yt.raw, id: sourceId }), yt.context);
    const b = normalizeCommunityArchive(JSON.stringify({ channel_id: 'post_example', posts: [{ post_id: sourceId, content: 'text', comments: [] }] }), community.context);
    for (const result of [a, b]) {
      expect(item(result).sourceId).toBe(sourceId);
      expect(item(result).canonicalUrl).toEqual({ status: 'unknown', reason: 'invalid' });
      expect(result.issues).toContainEqual({ code: 'invalid-field', severity: 'warning', location: '$.canonicalUrl', sourceId });
    }
  });

  it.each([['yt-nested-a', 'yt-membership-b'], ['community-thread-a', 'community-membership-b']])('normalizes paired %s/%s membership independently without deletion inference', (first, second) => {
    const a = normalize(first); const b = normalize(second);
    const aIds = comments(a).map(comment => comment.sourceId); const bIds = comments(b).map(comment => comment.sourceId);
    expect(aIds.some(id => bIds.includes(id))).toBe(true);
    expect(aIds.some(id => !bIds.includes(id))).toBe(true);
    expect(bIds.some(id => !aIds.includes(id))).toBe(true);
    expect(item(a).sourceId).toBe(item(b).sourceId);
    expect(Object.keys(b).sort()).toEqual(['collection', 'coverage', 'issues', 'item', 'provenance']);
    expect(normalize(first)).toEqual(a);
  });

  it('every saved fixture supplies honest version/preparation, behavior and preserved structure documentation', () => {
    const files = readdirSync(directory).filter(file => file.endsWith('.json'));
    expect(files).toHaveLength(11);
    for (const file of files) {
      const input = fixture(file.replace('.json', ''));
      expect(input.context.provenance.version).toBe(input.context.provenance.backend === 'yt-dlp' ? '2026.08.19' : '0.4.0');
      expect(input.context.provenance.fixture?.preparation).toBe(file.includes('duplicate') ? 'synthetic' : 'reconstructed-sanitized');
      for (const value of Object.values(input.documentation)) expect(value.length).toBeGreaterThan(20);
      const before = JSON.stringify(input);
      const adapter = input.context.provenance.backend === 'yt-dlp' ? normalizeYtDlp : normalizeCommunityArchive;
      expect(adapter(JSON.stringify(input.raw), input.context).provenance).toEqual(input.context.provenance);
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it('generic types and returned observations contain no local state or backend-specific schema keys', () => {
    const source = readFileSync(join(__dirname, '../../domain/extraction-observation.ts'), 'utf8');
    expect(source).not.toMatch(/\b(seen|unseen|post_id|comment_count|author_id|timestamp_estimated|is_pinned)\b/);
    const forbidden = new Set(['seen', 'unseen', 'deleted', 'post_id', 'author_id', 'like_count', 'is_pinned', 'timestamp_estimated', 'replies', 'parent']);
    function check(value: unknown): void {
      if (typeof value !== 'object' || value === null) return;
      for (const [key, nested] of Object.entries(value)) { expect(forbidden.has(key)).toBe(false); check(nested); }
    }
    for (const id of ['yt-nested-a', 'community-thread-a']) { const result = normalize(id); check(result.item); check(result.collection); }
  });

  it.each([normalizeYtDlp, normalizeCommunityArchive])('reports parse failure, explicit unusable runs and incompatible version without observations', adapter => {
    const context = fixture(adapter === normalizeYtDlp ? 'yt-nested-a' : 'community-thread-a').context;
    expect(adapter('{', context).issues[0].code).toBe('invalid-json');
    expect(adapter('{}', { ...context, failure: 'process-failed' }).coverage).toEqual({ kind: 'failed', reason: 'process-failed' });
    expect(adapter('{}', { provenance: { ...context.provenance, version: 'unsupported' } }).coverage).toEqual({ kind: 'failed', reason: 'unsupported-backend-version' });
  });
});

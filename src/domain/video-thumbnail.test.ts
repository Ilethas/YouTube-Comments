import { expect, it } from 'vitest';
import { isVideoThumbnailUrl, videoThumbnailSources } from './video-thumbnail';
import type { ContentItem } from './discussion';
import { normalizeYtDlp } from '../main/extractors/yt-dlp';

const id = 'abcdefghijk', url = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
export const thumbnailItem: ContentItem = { id: 'item', kind: 'video', title: 'Video', sourceId: id, sourceKind: 'youtube-video', baselineDiscoveryId: 'baseline' };
it('normalizes real single-video thumbnail shapes without inventing absent evidence', () => {
  const normalize = (extra: object) => normalizeYtDlp(JSON.stringify({ id, comments: [], ...extra }), { provenance: { backend: 'yt-dlp', version: '2026.08.19', evidence: [] } });
  const value = normalize({ thumbnail: url, thumbnails: [{ url, width: 1280, height: 720 }, { url: 'https://evil.invalid/a' }, { url: url.replace(id, 'zzzzzzzzzzz') }] });
  expect(value.item?.images).toEqual({ status: 'observed', value: [{ url, width: { status: 'observed', value: 1280 }, height: { status: 'observed', value: 720 } }] });
  expect(normalize({}).item?.images.status).toBe('unknown');
  expect(normalize({ thumbnails: [null, {}, { url: 'file:///a' }], thumbnail: 17 }).item?.images.status).toBe('unknown');
});
it('ranks metadata and safe canonical fallbacks without accepting foreign identities or origins', () => {
  expect(videoThumbnailSources(thumbnailItem)[0]).toBe(url);
  for (const bad of ['http://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg', url.replace('i.ytimg.com', '127.0.0.1'), url.replace('i.ytimg.com', 'i.ytimg.com.evil.invalid'), url.replace(id, '../private'), url.replace('https://', 'https://user@'), `${url}#x`, 'file:///private', `${url}\n`]) expect(isVideoThumbnailUrl(bad, id)).toBe(false);
  expect(isVideoThumbnailUrl(url, '../private')).toBe(false);
  expect(videoThumbnailSources({ ...thumbnailItem, isDemo: true })).toEqual([]);
  expect(videoThumbnailSources({ ...thumbnailItem, kind: 'post', text: 'Post' })).toEqual([]);
  expect(videoThumbnailSources({ ...thumbnailItem, sourceId: 'bad' })).toEqual([]);
});

it('prefers eligible high-resolution metadata while retaining finite lower-resolution fallbacks', () => {
  const high = `https://i.ytimg.com/vi_webp/${id}/maxresdefault.webp`;
  const normalized = normalizeYtDlp(JSON.stringify({ id, comments: [], thumbnails: [{ url: high, width: 1280, height: 720 }, { url: url.replace('maxresdefault', 'hqdefault'), width: 480, height: 360 }] }), { provenance: { backend: 'yt-dlp', version: '2026.08.19', evidence: [] } });
  const sources = videoThumbnailSources({ ...thumbnailItem, remote: normalized.item });
  expect(sources[0]).toBe(high); expect(sources).toContain(url.replace('maxresdefault', 'hqdefault')); expect(sources.length).toBeLessThanOrEqual(6);
});

import type { ContentItem } from './discussion';
import type { ImageObservation } from './extraction-observation';

export function isYouTubeVideoId(value: string): boolean { return /^[A-Za-z0-9_-]{11}$/.test(value); }

/** Only individual thumbnail variants on the fixed YouTube image origin are
 * eligible. Identity in the path must match the authoritative video ID. */
export function isVideoThumbnailUrl(value: unknown, videoId: string): value is string {
  if (!isYouTubeVideoId(videoId) || typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'i.ytimg.com' && !url.port && !url.username && !url.password && !url.hash
      && new RegExp(`^/(?:vi|vi_webp)/${videoId}/(?:maxresdefault|hq720|sddefault|hqdefault|mqdefault)(?:_live)?\\.(?:jpg|webp)$`).test(url.pathname);
  } catch { return false; }
}

/** Metadata supplies real variants first; canonical fallbacks support old stored
 * discussions without running an extractor. Tiny/storyboard variants are excluded. */
export function videoThumbnailSources(item: ContentItem): readonly string[] {
  if (item.kind !== 'video' || item.isDemo || item.sourceKind !== 'youtube-video' || !isYouTubeVideoId(item.sourceId)) return [];
  const images = item.remote?.images;
  const rank = (image: ImageObservation) => {
    const name = new URL(image.url).pathname.split('/').at(-1) ?? '';
    const quality = ['maxresdefault', 'hq720', 'sddefault', 'hqdefault', 'mqdefault'].findIndex(prefix => name.startsWith(prefix));
    return (5 - quality) * 100000000 + (image.width.status === 'observed' && image.height.status === 'observed' ? image.width.value * image.height.value : 0);
  };
  const metadata = images?.status === 'observed' ? images.value.filter(image => isVideoThumbnailUrl(image.url, item.sourceId)).sort((a, b) => rank(b) - rank(a)).map(image => image.url).slice(0, 2) : [];
  const fallback = ['maxresdefault', 'hq720', 'sddefault', 'hqdefault'].map(name => `https://i.ytimg.com/vi/${item.sourceId}/${name}.jpg`);
  // Rank canonical high resolutions ahead of known small metadata variants.
  return [...new Set([...metadata, ...fallback])].sort((a, b) => rank({ url: b, width: { status: 'unknown', reason: 'unavailable' }, height: { status: 'unknown', reason: 'unavailable' } }) - rank({ url: a, width: { status: 'unknown', reason: 'unavailable' }, height: { status: 'unknown', reason: 'unavailable' } })).slice(0, 6);
}

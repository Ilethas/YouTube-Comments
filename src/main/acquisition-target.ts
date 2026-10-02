import type { AttemptTarget } from '../domain/observation-merge';

export interface AcquisitionTarget extends AttemptTarget { readonly url: string }

/** Main-owned input policy: never fetch a URL to infer its source family. */
export function parseAcquisitionTarget(input: string): AcquisitionTarget | undefined {
  try {
    if (input.length > 2048 || [...input.trim()].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')) return undefined;
    const url = new URL(input.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || /^https:\/\/[^/]*@/i.test(input.trim())) return undefined;
    let videoId: string | null = null;
    if (['youtube.com', 'www.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) videoId = url.searchParams.get('v');
      const post = /^\/post\/(Ug[A-Za-z0-9_-]{8,254})\/?$/.exec(url.pathname);
      if (post) return { sourceKind: 'youtube-community-post', sourceId: post[1], url: `https://www.youtube.com/post/${post[1]}` };
    } else if (url.hostname === 'youtu.be') videoId = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null;
    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) return { sourceKind: 'youtube-video', sourceId: videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
  } catch { /* Invalid input remains an application validation error. */ }
  return undefined;
}

import type { ContentItem } from '../domain/discussion';
import { parseAcquisitionTarget } from './acquisition-target';

/** Reconstruct only supported canonical destinations from stored application identity.
 * Remote URL fields are never browser capabilities. Synthetic content has no action. */
export function sourceUrl(item: ContentItem): string | undefined {
  if (item.removable === false) return undefined;
  if (item.kind === 'video' ? !/^[A-Za-z0-9_-]{11}$/.test(item.sourceId) : !/^Ug[A-Za-z0-9_-]{8,254}$/.test(item.sourceId)) return undefined;
  const url = item.kind === 'video' && item.sourceKind === 'youtube-video'
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.sourceId)}`
    : item.kind === 'post' && item.sourceKind === 'youtube-community-post'
      ? `https://www.youtube.com/post/${encodeURIComponent(item.sourceId)}` : '';
  const target = parseAcquisitionTarget(url);
  return target && target.sourceKind === item.sourceKind && target.sourceId === item.sourceId ? target.url : undefined;
}

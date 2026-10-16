import type { Author, Comment, ContentItem } from '../domain/discussion';
import type { Preferences } from '../shared/preferences';
import { effectiveTranslationTarget } from '../shared/preferences';
import { sourceUrl } from './source-url';

/** Minimal stored projection needed for browser commands, without a reader forest. */
export type ActionComment = Pick<Comment, 'id' | 'itemId' | 'source' | 'author' | 'text'>;
/** Conservative handle subset: Unicode letters/numbers with internal separators.
 * No URL input, escapes, whitespace, bidi controls or path/query delimiters. */
export function authorUrl(author?: Author): string | undefined {
  if (author?.sourceId && /^UC[A-Za-z0-9_-]{22}$/.test(author.sourceId)) return `https://www.youtube.com/channel/${author.sourceId}`;
  const handle = author?.handle;
  if (handle && [...handle.slice(1)].length >= 3 && [...handle.slice(1)].length <= 30
    && /^@[\p{L}\p{N}][\p{L}\p{N}._\-·]*[\p{L}\p{N}]$/u.test(handle)) {
    return `https://www.youtube.com/@${encodeURIComponent(handle.slice(1))}`;
  }
  return undefined;
}
/** Only supported video comment identities form permalinks; Community stays plain. */
export function commentPermalink(item: ContentItem, comment: ActionComment, canonicalItem = sourceUrl(item)): string | undefined {
  if (item.kind !== 'video' || !canonicalItem || comment.itemId !== item.id
    || comment.source.kind !== 'video' || comment.source.itemId !== item.sourceId
    || !/^Ug[A-Za-z0-9_-]{8,254}(?:\.[A-Za-z0-9_-]{1,128})?$/.test(comment.source.commentId)) return undefined;
  return `https://www.youtube.com/watch?v=${item.sourceId}&lc=${encodeURIComponent(comment.source.commentId)}`;
}
/** Main-derived affordances are evidence only; activation always validates again. */
export function commentActionAvailability(item: ContentItem, comment: ActionComment, canonicalItem = sourceUrl(item)) {
  const real = !!canonicalItem && comment.itemId === item.id;
  return { author: real && !!authorUrl(comment.author), permalink: real && !!commentPermalink(item, comment, canonicalItem), translate: real };
}
export const translationUrlLimit = 8000;
// Google's web interface documents 5000 characters. UTF-16 length is conservative
// for supplementary characters, and avoids sending an over-limit plain ASCII text.
export const translationTextLimit = 5000;
/** Bound the complete ASCII URL; never truncate a comment or persist the URL.
 * URLSearchParams performs UTF-8 encoding (including replacement of lone surrogates). */
export function translationUrl(text: string, preferences: Preferences): string | undefined {
  if (text.length > translationTextLimit) return undefined;
  const url = new URL('https://translate.google.com/');
  url.search = new URLSearchParams({ sl: 'auto', tl: effectiveTranslationTarget(preferences), text, op: 'translate' }).toString();
  return url.href.length <= translationUrlLimit ? url.href : undefined;
}

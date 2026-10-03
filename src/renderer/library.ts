import type { ContentItem } from '../domain/discussion';

/** Literal case-insensitive metadata substring, independent of UI locale.
 * No comment text or localized application label participates. */
export function filterLibrary(items: readonly ContentItem[], query: string): readonly ContentItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter(item => [item.kind === 'video' ? item.title : item.text,
    item.author?.displayName, item.author?.handle].some(value => value?.toLowerCase().includes(needle)));
}

import type { Author } from '../domain/discussion';

/** Byline labels only; retain original metadata and spelling for author actions. */
export function authorPresentation(author: Author | undefined, unknownAuthor: string) {
  const name = author?.displayName?.trim() ? author.displayName
    : author?.handle?.trim() ? author.handle : unknownAuthor;
  const handle = author?.handle;
  // Ignore surrounding whitespace, casing and a single leading @ only.
  const comparisonKey = (value: string) => value.trim().replace(/^@/, '').toLowerCase();
  return { name, handle: handle?.trim() && comparisonKey(name) !== comparisonKey(handle) ? handle : undefined };
}

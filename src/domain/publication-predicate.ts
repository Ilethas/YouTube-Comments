/** Deterministic worker predicate. Calendar upper bounds are exclusive; rolling
 * bounds include the captured now. Undefined means no publication restriction. */
export interface PublicationBounds {
  readonly from?: number;
  readonly to?: number;
  readonly toInclusive: boolean;
}
/** Own best-available publication instant only. Precision/estimatedness never
 * change membership; absent/invalid instants cannot match an active predicate. */
export function publicationMatches(instant: number | undefined, bounds: PublicationBounds | undefined): boolean {
  if (!bounds) return true;
  return instant !== undefined && Number.isFinite(instant)
    && (bounds.from === undefined || instant >= bounds.from)
    && (bounds.to === undefined || (bounds.toInclusive ? instant <= bounds.to : instant < bounds.to));
}

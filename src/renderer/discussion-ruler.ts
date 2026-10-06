import type { DiscussionViewResult } from '../domain/discussion-query';
import type { ReaderRow } from './discussion-presentation';

export const rulerCategories = ['unseen', 'match', 'new'] as const;
export type RulerCategory = typeof rulerCategories[number];
/** Application identities in frozen virtual preorder, independent of DOM mounting. */
export interface RulerMarker {
  readonly commentId: string;
  readonly presentationIndex: number;
  readonly categories: readonly RulerCategory[];
}
export type RulerMarkerIndex = Readonly<Record<RulerCategory, readonly RulerMarker[]>>;
/** Zero-copy span in a shared category preorder. Geometry refresh does not
 * recreate target arrays/objects for every comment in a crowded band. */
export interface RulerTargetRange {
  readonly markers: readonly RulerMarker[];
  readonly from: number;
  readonly to: number;
  readonly length: number;
}
export interface RulerGeometry {
  readonly measurements: readonly RulerMeasurement[];
  readonly contentHeight: number;
  readonly rulerHeight: number;
}
/** One short pixel band; overlapping categories retain independent counts/targets. */
export interface RulerBucket {
  readonly index: number;
  readonly top: number;
  readonly height: number;
  readonly targets: Readonly<Record<RulerCategory, RulerTargetRange>>;
  readonly geometry: RulerGeometry;
}
export interface RulerMeasurement { readonly start: number; readonly size: number }

/** Unrestricted identity candidates are not matches. Raw-only hits never qualify.
 * Rows supply live acknowledged seen and the exact currently displayed membership. */
export function projectRulerMarkers(rows: readonly ReaderRow[], result: DiscussionViewResult, newIds: ReadonlySet<string>): readonly RulerMarker[] {
  const matches = new Set(result.restrictive ? result.activeMatchIds : []);
  return rows.flatMap((row, presentationIndex) => {
    const categories: RulerCategory[] = [];
    if (!row.comment.seen) categories.push('unseen');
    if (matches.has(row.id)) categories.push('match');
    if (newIds.has(row.id)) categories.push('new');
    return categories.length ? [{ commentId: row.id, presentationIndex, categories }] : [];
  });
}

/** Build once when category membership changes; geometry can reuse these arrays. */
export function indexRulerMarkers(markers: readonly RulerMarker[]): RulerMarkerIndex {
  const index: Record<RulerCategory, RulerMarker[]> = { unseen: [], match: [], new: [] };
  for (const marker of markers) for (const category of marker.categories) index[category].push(marker);
  return index;
}

/** Row-center coordinate including the existing header/query scroll margin. */
export function rulerMarkerCoordinate(marker: RulerMarker, geometry: RulerGeometry): number {
  const row = geometry.measurements[marker.presentationIndex];
  return row ? Math.max(0, Math.min(geometry.rulerHeight - .001, (row.start + row.size / 2) / geometry.contentHeight * geometry.rulerHeight)) : Infinity;
}

function lowerBound(markers: readonly RulerMarker[], geometry: RulerGeometry, coordinate: number, from = 0, to = markers.length): number {
  while (from < to) {
    const middle = Math.floor((from + to) / 2);
    if (rulerMarkerCoordinate(markers[middle], geometry) < coordinate) from = middle + 1;
    else to = middle;
  }
  return from;
}

/** Map row centers through full virtual scroll geometry (including header margin).
 * A long row consumes more distance than a short row. Empty/zero geometry is safe.
 * Only occupied bands are returned; their number is bounded by ruler pixels. */
export function aggregateRulerMarkers(markers: readonly RulerMarker[] | RulerMarkerIndex, measurements: readonly RulerMeasurement[], contentHeight: number,
  rulerHeight: number, bandHeight = 3): readonly RulerBucket[] {
  if (contentHeight <= 0 || rulerHeight <= 0 || bandHeight <= 0) return [];
  const count = Math.max(1, Math.ceil(rulerHeight / bandHeight));
  const categoryIndex = 'unseen' in markers ? markers : indexRulerMarkers(markers);
  const geometry = { measurements, contentHeight, rulerHeight };
  const ranges: Record<RulerCategory, RulerTargetRange[]> = { unseen: [], match: [], new: [] };
  // Row centers are monotone in virtual preorder. Search band boundaries rather
  // than traversing/materializing every cached VirtualItem after remeasurement.
  for (const category of rulerCategories) {
    const ordered = categoryIndex[category];
    let from = 0;
    for (let index = 0; index < count; index++) {
      const to = lowerBound(ordered, geometry, Math.min(rulerHeight, (index + 1) * bandHeight), from);
      ranges[category].push({ markers: ordered, from, to, length: to - from });
      from = to;
    }
  }
  return Array.from({ length: count }, (_, index) => ({ index, top: index * bandHeight,
    height: Math.min(bandHeight, rulerHeight - index * bandHeight), geometry,
    targets: { unseen: ranges.unseen[index], match: ranges.match[index], new: ranges.new[index] } }))
    .filter(bucket => rulerCategories.some(category => bucket.targets[category].length));
}

/** Nearest row center in the chosen band/lane. Equal distances choose preorder.
 * Keyboard activation uses the band center; no cycling or seen write occurs. */
export function rulerTarget(bucket: RulerBucket, category: RulerCategory, coordinate: number): string | undefined {
  const { markers, from, to } = bucket.targets[category];
  if (from === to) return;
  const position = lowerBound(markers, bucket.geometry, coordinate, from, to);
  // A clamped coordinate can be shared. Choose the first preorder member of the
  // preceding coordinate group as well as the first following coordinate group.
  const before = position > from ? markers[lowerBound(markers, bucket.geometry,
    rulerMarkerCoordinate(markers[position - 1], bucket.geometry), from, position)] : undefined;
  const after = position < to ? markers[position] : undefined;
  if (!before) return after?.commentId;
  if (!after) return before.commentId;
  const beforeDistance = Math.abs(rulerMarkerCoordinate(before, bucket.geometry) - coordinate);
  const afterDistance = Math.abs(rulerMarkerCoordinate(after, bucket.geometry) - coordinate);
  return beforeDistance <= afterDistance ? before.commentId : after.commentId;
}

/** Three compact SVG paths, never one DOM node per comment or per category hit. */
export function rulerLanePath(buckets: readonly RulerBucket[], category: RulerCategory): string {
  const lane = rulerCategories.indexOf(category) * 6;
  return buckets.filter(bucket => bucket.targets[category].length).map(bucket => `M${lane + 1},${bucket.top}h4v${bucket.height}h-4z`).join('');
}

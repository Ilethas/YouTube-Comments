import { Temporal } from '@js-temporal/polyfill';
import type { PublicationBounds } from './publication-predicate';

/** ISO Gregorian YYYY-MM-DD calendar date, never an instant. Drafts are validated
 * by the resolver (native date input values are not trusted as UTC timestamps). */
export type LocalDate = string;
/** Optional bulk-only local clock minute, strictly HH:mm; never an instant. */
export type LocalTime = string;
export interface BulkPublicationCriteria {
  readonly from?: LocalDate; readonly to?: LocalDate;
  readonly fromTime?: LocalTime; readonly toTime?: LocalTime;
}
export type PublicationCriteria = { readonly kind: 'all' }
  | { readonly kind: 'custom'; readonly from?: LocalDate; readonly to?: LocalDate }
  | { readonly kind: 'today' } | { readonly kind: 'last-24-hours' } | { readonly kind: 'last-7-days' };
export interface QueryEvaluationTime { readonly now: number; readonly timeZone: string }
export type PublicationResolution = { readonly ok: true; readonly bounds?: PublicationBounds }
  | { readonly ok: false; readonly error: 'INVALID_PUBLICATION_DATE' | 'INVALID_PUBLICATION_RANGE' };

function calendarDate(value: LocalDate): Temporal.PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new RangeError('Invalid local date');
  return Temporal.PlainDate.from(value, { overflow: 'reject' });
}
/** Bulk-only time resolution shares calendar conversion with query filtering.
 * Explicit clock times must identify exactly one instant. The upper endpoint is
 * one elapsed minute after that instant, including the entire entered minute
 * even when the following wall-clock minute crosses a zone transition. */
export function resolveBulkPublication(criteria: BulkPublicationCriteria, time: QueryEvaluationTime):
  PublicationResolution | { readonly ok: false; readonly error: 'INVALID_PUBLICATION_TIME' | 'INVALID_LOCAL_TIME' } {
  if (criteria.from === '' || criteria.to === '' || !criteria.from && !criteria.to || criteria.fromTime !== undefined && !criteria.from || criteria.toTime !== undefined && !criteria.to)
    return { ok: false, error: 'INVALID_PUBLICATION_DATE' };
  for (const clock of [criteria.fromTime, criteria.toTime]) {
    if (clock !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) return { ok: false, error: 'INVALID_PUBLICATION_TIME' };
  }
  const dates = resolvePublication({ kind: 'custom', from: criteria.from, to: criteria.to }, time);
  if (!dates.ok) return dates;
  const minute = (date: string, clock: string) => calendarDate(date).toPlainDateTime(Temporal.PlainTime.from(clock))
    .toZonedDateTime(time.timeZone, { disambiguation: 'reject' });
  try {
    const from = criteria.from && criteria.fromTime !== undefined ? minute(criteria.from, criteria.fromTime).epochMilliseconds : dates.bounds?.from;
    const to = criteria.to && criteria.toTime !== undefined ? minute(criteria.to, criteria.toTime).add({ minutes: 1 }).epochMilliseconds : dates.bounds?.to;
    if (from !== undefined && to !== undefined && from > to) return { ok: false, error: 'INVALID_PUBLICATION_RANGE' };
    return { ok: true, bounds: { from, to, toInclusive: false } };
  } catch { return { ok: false, error: 'INVALID_LOCAL_TIME' }; }
}
/** First instant of the local day under runtime IANA rules. Temporal handles
 * skipped/repeated midnight; next-day arithmetic is calendar arithmetic, not 24h. */
export function localDayStart(date: LocalDate, timeZone: string): number {
  return calendarDate(date).toZonedDateTime(timeZone).epochMilliseconds;
}
/** Resolve once per evaluation. Future date-based bulk commands MUST reuse this
 * resolver and publicationMatches rather than establishing another date model. */
export function resolvePublication(criteria: PublicationCriteria, time: QueryEvaluationTime): PublicationResolution {
  if (criteria.kind === 'all') return { ok: true };
  if (criteria.kind === 'last-24-hours' || criteria.kind === 'last-7-days') {
    if (!Number.isFinite(time.now)) throw new RangeError('Invalid evaluation clock');
    const duration = (criteria.kind === 'last-24-hours' ? 1 : 7) * 24 * 60 * 60 * 1000;
    return { ok: true, bounds: { from: time.now - duration, to: time.now, toInclusive: true } };
  }
  if (criteria.kind === 'today') {
    const date = Temporal.Instant.fromEpochMilliseconds(time.now).toZonedDateTimeISO(time.timeZone).toPlainDate();
    return { ok: true, bounds: { from: date.toZonedDateTime(time.timeZone).epochMilliseconds,
      to: date.add({ days: 1 }).toZonedDateTime(time.timeZone).epochMilliseconds, toInclusive: false } };
  }
  let from: Temporal.PlainDate | undefined, to: Temporal.PlainDate | undefined;
  try { from = criteria.from ? calendarDate(criteria.from) : undefined; to = criteria.to ? calendarDate(criteria.to) : undefined; }
  catch { return { ok: false, error: 'INVALID_PUBLICATION_DATE' }; }
  if (from && to && Temporal.PlainDate.compare(from, to) > 0) return { ok: false, error: 'INVALID_PUBLICATION_RANGE' };
  if (!from && !to) return { ok: true };
  return { ok: true, bounds: { from: from?.toZonedDateTime(time.timeZone).epochMilliseconds,
    to: to?.add({ days: 1 }).toZonedDateTime(time.timeZone).epochMilliseconds, toInclusive: false } };
}

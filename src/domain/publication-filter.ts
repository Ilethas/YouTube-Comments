import { Temporal } from '@js-temporal/polyfill';
import type { PublicationBounds } from './publication-predicate';

/** ISO Gregorian YYYY-MM-DD calendar date, never an instant. Drafts are validated
 * by the resolver (native date input values are not trusted as UTC timestamps). */
export type LocalDate = string;
/** Optional local clock minute, strictly HH:mm; never an instant. */
export type LocalTime = string;
export interface BulkPublicationCriteria {
  readonly from?: LocalDate; readonly to?: LocalDate;
  readonly fromTime?: LocalTime; readonly toTime?: LocalTime;
}
export type PublicationCriteria = { readonly kind: 'all' }
  | ({ readonly kind: 'custom' } & BulkPublicationCriteria)
  | { readonly kind: 'today' } | { readonly kind: 'last-24-hours' } | { readonly kind: 'last-7-days' };
export interface QueryEvaluationTime { readonly now: number; readonly timeZone: string }
export type PublicationResolution = { readonly ok: true; readonly bounds?: PublicationBounds }
  | { readonly ok: false; readonly error: 'INVALID_PUBLICATION_DATE' | 'INVALID_PUBLICATION_RANGE' | 'INVALID_PUBLICATION_TIME' | 'INVALID_LOCAL_TIME' };

function calendarDate(value: LocalDate): Temporal.PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new RangeError('Invalid local date');
  return Temporal.PlainDate.from(value, { overflow: 'reject' });
}
/** Bulk commands require at least one date; query custom criteria may be empty. */
export function resolveBulkPublication(criteria: BulkPublicationCriteria, time: QueryEvaluationTime): PublicationResolution {
  if (!criteria.from && !criteria.to) return { ok: false, error: 'INVALID_PUBLICATION_DATE' };
  return resolveCustomPublication(criteria, time);
}
/** Shared query/bulk calendar conversion.
 * Explicit clock times must identify exactly one instant. The upper endpoint is
 * one elapsed minute after that instant, including the entire entered minute
 * even when the following wall-clock minute crosses a zone transition. */
function resolveCustomPublication(criteria: BulkPublicationCriteria, time: QueryEvaluationTime): PublicationResolution {
  if (criteria.from === '' || criteria.to === '' || criteria.fromTime !== undefined && !criteria.from || criteria.toTime !== undefined && !criteria.to)
    return { ok: false, error: 'INVALID_PUBLICATION_DATE' };
  for (const clock of [criteria.fromTime, criteria.toTime]) {
    if (clock !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) return { ok: false, error: 'INVALID_PUBLICATION_TIME' };
  }
  let fromDate: Temporal.PlainDate | undefined, toDate: Temporal.PlainDate | undefined;
  try { fromDate = criteria.from ? calendarDate(criteria.from) : undefined; toDate = criteria.to ? calendarDate(criteria.to) : undefined; }
  catch { return { ok: false, error: 'INVALID_PUBLICATION_DATE' }; }
  if (fromDate && toDate && Temporal.PlainDate.compare(fromDate, toDate) > 0) return { ok: false, error: 'INVALID_PUBLICATION_RANGE' };
  if (!fromDate && !toDate) return { ok: true };
  const minute = (date: string, clock: string) => calendarDate(date).toPlainDateTime(Temporal.PlainTime.from(clock))
    .toZonedDateTime(time.timeZone, { disambiguation: 'reject' });
  try {
    const from = criteria.from && criteria.fromTime !== undefined ? minute(criteria.from, criteria.fromTime).epochMilliseconds : fromDate?.toZonedDateTime(time.timeZone).epochMilliseconds;
    const to = criteria.to && criteria.toTime !== undefined ? minute(criteria.to, criteria.toTime).add({ minutes: 1 }).epochMilliseconds : toDate?.add({ days: 1 }).toZonedDateTime(time.timeZone).epochMilliseconds;
    if (from !== undefined && to !== undefined && (from > to || from === to && !!(criteria.fromTime || criteria.toTime))) return { ok: false, error: 'INVALID_PUBLICATION_RANGE' };
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
  return resolveCustomPublication(criteria, time);
}

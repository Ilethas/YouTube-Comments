import { expect, it, vi } from 'vitest';
import { localDayStart, resolvePublication } from './publication-filter';
import type { PublicationCriteria } from './publication-filter';
import { publicationMatches } from './publication-predicate';

const time = { now: Date.parse('2026-10-07T12:34:56.789Z'), timeZone: 'Europe/Warsaw' };
function bounds(criteria: PublicationCriteria, zone = time.timeZone) {
  const outcome = resolvePublication(criteria, { ...time, timeZone: zone });
  if (!outcome.ok || !outcome.bounds) throw new Error('Expected bounds');
  return outcome.bounds;
}
it.each([
  ['Europe/Warsaw', '2026-03-29', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z', 23],
  ['Europe/Warsaw', '2026-10-25', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', 25],
  ['America/New_York', '2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z', 23],
  ['America/New_York', '2026-11-01', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 25],
  ['Asia/Kolkata', '2026-03-29', '2026-03-28T18:30:00Z', '2026-03-29T18:30:00Z', 24],
  ['America/Sao_Paulo', '2018-11-04', '2018-11-04T03:00:00Z', '2018-11-05T02:00:00Z', 23],
])('%s %s resolves actual local-day boundaries including DST/skipped midnight', (zone, date, start, end, hours) => {
  const range = bounds({ kind: 'custom', from: date, to: date }, zone);
  expect(localDayStart(date, zone)).toBe(Date.parse(start));
  expect(range).toEqual({ from: Date.parse(start), to: Date.parse(end), toInclusive: false });
  expect(((range.to ?? 0) - (range.from ?? 0)) / 3600000).toBe(hours);
  expect(publicationMatches(Date.parse(start) - 1, range)).toBe(false);
  expect(publicationMatches(Date.parse(start), range)).toBe(true);
  expect(publicationMatches(Date.parse(end) - 1, range)).toBe(true);
  expect(publicationMatches(Date.parse(end), range)).toBe(false);
});
it('From/To may independently be omitted; all and empty custom allow missing publication', () => {
  const from = bounds({ kind: 'custom', from: '2026-10-07' });
  const to = bounds({ kind: 'custom', to: '2026-10-07' });
  expect(from.to).toBeUndefined(); expect(to.from).toBeUndefined();
  expect(publicationMatches(Date.parse('2030-01-01T00:00:00Z'), from)).toBe(true);
  expect(publicationMatches(Date.parse('2001-01-01T00:00:00Z'), to)).toBe(true);
  expect(publicationMatches(undefined, from)).toBe(false);
  expect(publicationMatches(NaN, to)).toBe(false);
  expect(resolvePublication({ kind: 'all' }, time)).toEqual({ ok: true });
  expect(resolvePublication({ kind: 'custom' }, time)).toEqual({ ok: true });
  expect(publicationMatches(undefined, undefined)).toBe(true);
});
it.each(['2026-02-29', '2026-13-01', '2026-10-32', '0000-01-01', '2026-1-01', '2026-10-07T00:00:00Z', 'bad'])('rejects invalid local date %s', from => {
  expect(resolvePublication({ kind: 'custom', from }, time)).toEqual({ ok: false, error: 'INVALID_PUBLICATION_DATE' });
});
it('rejects reversed dates, accepts leap day and treats To as next calendar day across year end', () => {
  expect(resolvePublication({ kind: 'custom', from: '2026-10-08', to: '2026-10-07' }, time)).toEqual({ ok: false, error: 'INVALID_PUBLICATION_RANGE' });
  expect(bounds({ kind: 'custom', from: '2024-02-29', to: '2024-02-29' }, 'UTC').from).toBe(Date.parse('2024-02-29T00:00:00Z'));
  expect(bounds({ kind: 'custom', to: '2026-12-31' }, 'UTC').to).toBe(Date.parse('2027-01-01T00:00:00Z'));
});
it('Today uses the captured instant’s local date, includes future instants later that day', () => {
  const now = Date.parse('2026-03-28T23:30:00Z');
  const result = resolvePublication({ kind: 'today' }, { now, timeZone: 'Europe/Warsaw' });
  expect(result).toEqual({ ok: true, bounds: { from: Date.parse('2026-03-28T23:00:00Z'), to: Date.parse('2026-03-29T22:00:00Z'), toInclusive: false } });
  expect(result.ok && publicationMatches(now + 3600000, result.bounds)).toBe(true);
});
it.each([['last-24-hours', 24], ['last-7-days', 168]] as const)('%s is rolling elapsed hours with inclusive now, independent of DST/zone', (kind, hours) => {
  const range = bounds({ kind });
  expect(range).toEqual({ from: time.now - hours * 3600000, to: time.now, toInclusive: true });
  expect(bounds({ kind }, 'Asia/Kolkata')).toEqual(range);
  expect(publicationMatches(time.now - hours * 3600000 - 1, range)).toBe(false);
  expect(publicationMatches(time.now - hours * 3600000, range)).toBe(true);
  expect(publicationMatches(time.now, range)).toBe(true);
  expect(publicationMatches(time.now + 1, range)).toBe(false);
});
it('resolution and comparison never consult wall clock or UI locale', () => {
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Ambient clock'); });
  try {
    const range = bounds({ kind: 'today' });
    expect(range).toEqual({ from: Date.parse('2026-10-06T22:00:00Z'), to: Date.parse('2026-10-07T22:00:00Z'), toInclusive: false });
    for (const locale of ['en', 'pl']) {
      new Intl.DateTimeFormat(locale).format(time.now);
      expect(bounds({ kind: 'today' })).toEqual(range);
      expect(publicationMatches(time.now, range)).toBe(true);
    }
  } finally { clock.mockRestore(); }
});

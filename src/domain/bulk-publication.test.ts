import { expect, it } from 'vitest';
import { resolveBulkPublication, resolvePublication } from './publication-filter';
import { publicationMatches } from './publication-predicate';
import { isBulkSeenRequest } from '../shared/reader-api';

const time = { now: 0, timeZone: 'Europe/Warsaw' };
it.each(['Europe/Warsaw', 'America/New_York', 'Asia/Kolkata', 'America/Sao_Paulo'])('date-only bulk keeps query boundaries in %s, including DST and skipped midnight', timeZone => {
  for (const date of ['2026-03-29', '2026-10-25', '2018-11-04']) {
    for (const target of [{ from: date }, { to: date }, { from: date, to: date }])
      expect(resolveBulkPublication(target, { ...time, timeZone })).toEqual(resolvePublication({ kind: 'custom', ...target }, { ...time, timeZone }));
  }
});
it('inclusive From and exclusive minute-after-To include seconds throughout the entered minute', () => {
  const result = resolveBulkPublication({ from: '2026-10-09', fromTime: '14:30', to: '2026-10-09', toTime: '14:30' }, time);
  expect(result).toEqual({ ok: true, bounds: { from: Date.parse('2026-10-09T12:30:00Z'), to: Date.parse('2026-10-09T12:31:00Z'), toInclusive: false } });
  if (!result.ok) throw new Error('Expected bounds');
  for (const [instant, matches] of [['12:29:59', false], ['12:30:00', true], ['12:30:47', true], ['12:31:00', false]] as const)
    expect(publicationMatches(Date.parse(`2026-10-09T${instant}Z`), result.bounds)).toBe(matches);
  expect(publicationMatches(undefined, result.bounds)).toBe(false);
});
it('mixed optional times retain day boundaries, and stable non-DST conversion uses IANA rules', () => {
  expect(resolveBulkPublication({ from: '2026-10-09', to: '2026-10-09', toTime: '18:45' }, time)).toMatchObject({ bounds: { from: Date.parse('2026-10-08T22:00:00Z'), to: Date.parse('2026-10-09T16:46:00Z') } });
  expect(resolveBulkPublication({ from: '2026-10-09', fromTime: '14:30', to: '2026-10-09' }, time)).toMatchObject({ bounds: { from: Date.parse('2026-10-09T12:30:00Z'), to: Date.parse('2026-10-09T22:00:00Z') } });
  expect(resolveBulkPublication({ from: '2026-10-09', fromTime: '14:30', to: '2026-10-09', toTime: '18:45' }, { ...time, timeZone: 'Asia/Kolkata' })).toMatchObject({ bounds: { from: Date.parse('2026-10-09T09:00:00Z'), to: Date.parse('2026-10-09T13:16:00Z') } });
});
it.each([
  ['Europe/Warsaw', '2026-03-29', '02:30'], ['Europe/Warsaw', '2026-10-25', '02:30'],
  ['America/New_York', '2026-03-08', '02:30'], ['America/New_York', '2026-11-01', '01:30'],
])('rejects nonexistent/repeated explicit %s %s %s on either boundary', (timeZone, date, clock) => {
  for (const target of [{ from: date, fromTime: clock }, { to: date, toTime: clock }])
    expect(resolveBulkPublication(target, { ...time, timeZone })).toEqual({ ok: false, error: 'INVALID_LOCAL_TIME' });
});
it('a valid upper minute immediately before a spring gap includes that minute without guessing a nonexistent time', () => {
  expect(resolveBulkPublication({ to: '2026-03-29', toTime: '01:59' }, time)).toMatchObject({ bounds: { to: Date.parse('2026-03-29T01:00:00Z') } });
});
it.each([
  {}, { fromTime: '14:30' }, { toTime: '14:30' }, { from: '2026-02-30' }, { from: '2026-13-01' }, { from: '2026-1-01' },
  { from: '2026-10-09', fromTime: '24:00' }, { from: '2026-10-09', fromTime: '14:30:01' }, { to: '2026-10-09', toTime: '2:30' },
  { from: '2026-10-10', to: '2026-10-09' }, { from: '2026-10-09', fromTime: '14:32', to: '2026-10-09', toTime: '14:30' },
])('rejects invalid bulk boundary %j', criteria => expect(resolveBulkPublication(criteria, time).ok).toBe(false));
it('IPC time fields require a date, minute format, and forbid renderer zone/instant authority', () => {
  for (const target of [{ kind: 'publication', fromTime: '14:30' }, { kind: 'publication', from: '2026-10-09', fromTime: '14:30:00' },
    { kind: 'publication', from: '2026-10-09', timeZone: 'UTC' }, { kind: 'publication', from: '2026-10-09', fromInstant: 0 }])
    expect(isBulkSeenRequest({ itemId: 'stored', seen: true, target })).toBe(false);
  expect(isBulkSeenRequest({ itemId: 'stored', seen: true, target: { kind: 'publication', from: '2026-10-09', fromTime: '14:30' } })).toBe(true);
});

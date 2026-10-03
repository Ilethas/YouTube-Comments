import { expect, it } from 'vitest';
import { filterLibrary } from './library';
import { items } from '../fixtures/discussions';
it('filters only metadata literally and independently of UI language', () => {
  expect(filterLibrary(items, ' DESK ')).toEqual([items[0]]);
  expect(filterLibrary(items, 'reading lamp')).toEqual([items[1]]);
  expect(filterLibrary(items, '@QUIETWORKSHOP')).toEqual(items);
  expect(filterLibrary(items, 'quiet workshop')).toEqual(items);
  expect(filterLibrary(items, 'Dzięki')).toEqual([items[1]]);
  expect(filterLibrary(items, 'Video')).toEqual([]);
  expect(filterLibrary(items, '.*')).toEqual([]);
  expect(filterLibrary(items, '')).toEqual(items);
});

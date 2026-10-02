import { expect, it, vi } from 'vitest';
import { ReaderService } from './reader-service';
import { UnsupportedSchemaError } from './persistence/migrations';
import { MissingCommentError } from './persistence/reader-repository';
import type { ReaderRepository } from './persistence/reader-repository';

const failedOpen = () => { throw new Error('private path/diagnostic'); };
it.each([
  null, undefined, [], {}, { itemId: 'video-demo', commentId: 'v1', subtree: 'true' },
  { itemId: '', commentId: 'v1', subtree: false },
  { itemId: 'video-demo', commentId: 'v1', subtree: false, sql: 'DELETE FROM comments' },
  { itemId: 'video-demo', commentId: 'v1\0', subtree: false },
  { itemId: 'x'.repeat(257), commentId: 'v1', subtree: false },
])('rejects malformed seen payload %j before storage', payload => {
  const service = new ReaderService(failedOpen, ['en'], vi.fn());
  expect(service.dispatch('toggleSeen', [payload])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
});
it.each([null, {}, [], { locale: 'de' }, { appearance: 'automatic' }, { locale: 'pl', appearance: 'dark' }, { appearance: 'dark', path: 'C:/data' }])(
  'rejects malformed preference payload %j', payload => {
    const service = new ReaderService(failedOpen, ['en'], vi.fn());
    expect(service.dispatch('updatePreferences', [payload])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });
it('validates operation arity and never accepts arbitrary bootstrap payloads', () => {
  const service = new ReaderService(failedOpen, ['en'], vi.fn());
  expect(service.dispatch('bootstrap', [{}])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('toggleSeen', [])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('updatePreferences', [{ locale: 'pl' }, 'extra'])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
});
it('returns sanitized stable storage and unsupported-schema failures without paths', () => {
  const diagnose = vi.fn();
  expect(new ReaderService(failedOpen, ['en'], diagnose).dispatch('bootstrap', []))
    .toEqual({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  expect(new ReaderService(() => { throw new UnsupportedSchemaError('private'); }, ['en'], diagnose).dispatch('bootstrap', []))
    .toEqual({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } });
  expect(diagnose).toHaveBeenCalledTimes(3);
});

it('retries the original storage initialization after an initial open failure and retains the successful repository', () => {
  const state = { items: [], comments: {}, preferences: { locale: 'en', appearance: 'system' } };
  const repository = { bootstrap: vi.fn(() => state), close: vi.fn() } as unknown as ReaderRepository;
  const open = vi.fn<() => ReaderRepository>()
    .mockImplementationOnce(failedOpen).mockImplementationOnce(failedOpen).mockReturnValue(repository);
  const diagnose = vi.fn();
  const service = new ReaderService(open, ['en'], diagnose);
  expect(open).toHaveBeenCalledTimes(1);
  expect(service.dispatch('bootstrap', [])).toEqual({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  expect(service.dispatch('bootstrap', [])).toEqual({ ok: true, value: state });
  expect(service.dispatch('bootstrap', [])).toEqual({ ok: true, value: state });
  expect(open).toHaveBeenCalledTimes(3);
  expect(repository.bootstrap).toHaveBeenCalledWith(['en']);
  expect(diagnose).toHaveBeenCalledTimes(2);
  service.close();
  expect(repository.close).toHaveBeenCalledTimes(1);
});

it('reports repeated initialization failures safely and retries only valid bootstrap requests', () => {
  const open = vi.fn(failedOpen);
  const diagnose = vi.fn();
  const service = new ReaderService(open, ['en'], diagnose);
  expect(service.dispatch('bootstrap', [{}])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  expect(service.dispatch('updatePreferences', [{ locale: 'pl' }])).toEqual({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  expect(open).toHaveBeenCalledTimes(1);
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(service.dispatch('bootstrap', [])).toEqual({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  }
  expect(open).toHaveBeenCalledTimes(3);
  expect(diagnose).toHaveBeenCalledTimes(3);
  expect(() => service.close()).not.toThrow();
});

it('does not reopen an unsupported schema, including when a recoverable retry discovers it', () => {
  const unsupported = () => { throw new UnsupportedSchemaError('private schema diagnostic'); };
  for (const open of [vi.fn(unsupported), vi.fn<() => ReaderRepository>().mockImplementationOnce(failedOpen).mockImplementation(unsupported)]) {
    const service = new ReaderService(open, ['en'], vi.fn());
    expect(service.dispatch('bootstrap', [])).toEqual({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } });
    const attempts = open.mock.calls.length;
    expect(service.dispatch('bootstrap', [])).toEqual({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } });
    expect(open).toHaveBeenCalledTimes(attempts);
  }
});

it('successful startup opens storage once and subsequent bootstrap requests reuse it', () => {
  const state = { items: [], comments: {}, preferences: { locale: 'pl', appearance: 'dark' } };
  const repository = { bootstrap: vi.fn(() => state) } as unknown as ReaderRepository;
  const open = vi.fn(() => repository);
  const diagnose = vi.fn();
  const service = new ReaderService(open, ['pl'], diagnose);
  expect(open).toHaveBeenCalledTimes(1);
  expect(service.dispatch('bootstrap', [])).toEqual({ ok: true, value: state });
  expect(service.dispatch('bootstrap', [])).toEqual({ ok: true, value: state });
  expect(open).toHaveBeenCalledTimes(1);
  expect(repository.bootstrap).toHaveBeenCalledTimes(2);
  expect(diagnose).not.toHaveBeenCalled();
});
it('reports failed writes and missing targets as structured errors', () => {
  const repository = { toggleSeen: vi.fn(() => { throw new Error('private diagnostic'); }) } as unknown as ReaderRepository;
  const service = new ReaderService(() => repository, ['en'], vi.fn());
  const args = [{ itemId: 'video-demo', commentId: 'v2', subtree: true }];
  expect(service.dispatch('toggleSeen', args)).toEqual({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } });
  repository.toggleSeen = () => { throw new MissingCommentError('not found'); };
  expect(service.dispatch('toggleSeen', args)).toEqual({ ok: false, error: { code: 'NOT_FOUND' } });
});

import { required } from '../renderer/testing/required';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderService } from './reader-service';
import { ReaderRepository } from './persistence/reader-repository';
import { normalizeYtDlp } from './extractors/yt-dlp';
import { ThumbnailCache } from './thumbnail-cache';
import { thumbnailPng } from '../fixtures/thumbnail-image';
import { thumbnailImage } from './thumbnail-image';

let root: string, service: ReaderService, repository: ReaderRepository, cache: ThumbnailCache, itemId: string;
const openPath = vi.fn(async (file: string) => { void file; return ''; }), fetch = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'image/png' }, bytes: thumbnailPng() }));
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-thumbnail-service-'));
  repository = ReaderRepository.open(path.join(root, 'reader.sqlite'));
  const observation = normalizeYtDlp(JSON.stringify({ id: 'abcdefghijk', title: 'Existing video', comments: [{ id: 'c', parent: 'root', text: 'Saved comment' }] }), { provenance: { backend: 'yt-dlp', version: '2026.08.19', evidence: [] } });
  itemId = required(repository.ingest(observation, undefined, true).itemId);
  cache = new ThumbnailCache(path.join(root, 'thumbnails'), { fetch, decode: bytes => thumbnailImage(bytes, 'image/png') });
  service = new ReaderService(() => repository, ['en'], vi.fn(), async () => ({ extraction: observation }), {}, undefined, undefined, undefined, undefined, { cache, openPath });
  openPath.mockClear(); fetch.mockClear();
});
afterEach(async () => { await service.shutdown(); await fs.rm(root, { recursive: true, force: true }); });
it('identity-only image capabilities do not reacquire or mutate comments; shell opens only an explicit validated cached image', async () => {
  const before = service.dispatch('bootstrap', []);
  expect(await service.dispatch('getThumbnail', [{ itemId }])).toEqual({ ok: true, value: null });
  expect(fetch).not.toHaveBeenCalled(); expect(openPath).not.toHaveBeenCalled();
  const checked = await service.dispatch('checkThumbnail', [{ itemId }]);
  expect(checked).toMatchObject({ ok: true, value: expect.stringMatching(/^reader-thumbnail:\/\/cache\//) });
  if (!checked.ok || !checked.value) throw new Error('Expected thumbnail');
  expect(checked.value).not.toContain(root);
  expect((await service.thumbnailImage(checked.value))?.bytes).toEqual(thumbnailPng());
  expect(service.dispatch('bootstrap', [])).toEqual(before); expect(openPath).not.toHaveBeenCalled();
  expect(await service.dispatch('openThumbnail', [{ itemId }])).toEqual({ ok: true, value: null });
  const expected = required(await cache.read(required(await cache.cached(required(repository.getStoredItem(itemId))))));
  expect(openPath).toHaveBeenCalledExactlyOnceWith(expected.file);
  expect(path.extname(expected.file)).toBe('.png');
  await fs.rm(expected.file);
  expect(await service.dispatch('openThumbnail', [{ itemId }])).toMatchObject({ ok: false }); expect(openPath).toHaveBeenCalledTimes(1);
});
it.each(['getThumbnail', 'checkThumbnail', 'openThumbnail'] as const)('rejects arbitrary paths/URLs/arity for %s', async operation => {
  for (const args of [[], [{ itemId, path: 'C:/private.exe' }], [{ itemId, url: 'https://evil.invalid' }], [{ itemId }, {}], [{ itemId: '../private' , path: 'x' }]]) expect(await service.dispatch(operation, args)).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  expect(fetch).not.toHaveBeenCalled(); expect(openPath).not.toHaveBeenCalled();
  expect(await service.dispatch(operation, [{ itemId: 'missing' }])).toEqual({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(await service.thumbnailImage('file:///private')).toBeUndefined();
});
it('revokes stale capabilities on removal and best-effort cleanup follows the committed deletion', async () => {
  const checked = await service.dispatch('checkThumbnail', [{ itemId }]);
  if (!checked.ok || !checked.value) throw new Error('Expected thumbnail');
  expect(service.dispatch('removeLibraryItem', [{ itemId }]).ok).toBe(true);
  expect(await service.thumbnailImage(checked.value)).toBeUndefined();
  await vi.waitFor(async () => expect(await fs.readdir(cache.directory)).toEqual([]));
  expect(openPath).not.toHaveBeenCalled();
});
it('a reused internal item ID cannot grant a different restored video the old cache', async () => {
  const checked = await service.dispatch('checkThumbnail', [{ itemId }]);
  if (!checked.ok || !checked.value) throw new Error('Expected thumbnail');
  const original = required(repository.getStoredItem(itemId));
  vi.spyOn(repository, 'getStoredItem').mockReturnValue({ ...original, sourceId: 'zzzzzzzzzzz' });
  expect(await service.thumbnailImage(checked.value)).toBeUndefined();
  expect(await service.dispatch('getThumbnail', [{ itemId }])).toEqual({ ok: true, value: null });
});
it('bounded timeouts retry finitely and never cache partial bytes', async () => {
  const requests = vi.fn((_url: string, _id: string, _headers: Record<string, string>, signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })));
  const store = new ThumbnailCache(path.join(root, 'timeout'), { fetch: requests, timeoutMs: 2, decode: () => undefined });
  expect(await store.check(required(repository.getStoredItem(itemId)))).toBeNull();
  expect(requests.mock.calls.length).toBe(8);
  expect((await fs.readdir(store.directory)).every(name => name.endsWith('.json'))).toBe(true);
});
it('explicit discussion Refresh independently forces image revalidation and survives image HTTP failure', async () => {
  await service.dispatch('checkThumbnail', [{ itemId }]);
  const before = repository.bootstrap(['en']).comments[itemId];
  fetch.mockRejectedValue(new Error('offline image'));
  const refreshed = await service.dispatch('refresh', [{ itemId }]);
  expect(refreshed.ok).toBe(true);
  await cache.settle();
  expect(fetch.mock.calls.length).toBeGreaterThan(1);
  expect(repository.bootstrap(['en']).comments[itemId].map(comment => ({ id: comment.id, text: comment.text, seen: comment.seen }))).toEqual(before.map(comment => ({ id: comment.id, text: comment.text, seen: comment.seen })));
  expect(await cache.cached(required(repository.getStoredItem(itemId)))).not.toBeNull();
});

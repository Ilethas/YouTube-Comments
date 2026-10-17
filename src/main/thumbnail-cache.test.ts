import { required } from '../renderer/testing/required';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ThumbnailCache } from './thumbnail-cache';
import { thumbnailPng } from '../fixtures/thumbnail-image';
import { thumbnailImage } from './thumbnail-image';
import type { ThumbnailFetch, ThumbnailResponse } from './thumbnail-network';
import { thumbnailByteLimit } from './thumbnail-network';
import { resolveThumbnailDirectory } from './persistence/profile';
import type { ContentItem } from '../domain/discussion';

const item: ContentItem = { id: 'item', kind: 'video', title: 'Video', sourceId: 'abcdefghijk', sourceKind: 'youtube-video', baselineDiscoveryId: 'baseline' };
let root: string, now: number, fetch: ReturnType<typeof vi.fn<ThumbnailFetch>>;
const good = (bytes = thumbnailPng()): ThumbnailResponse => ({ status: 200, headers: { 'content-type': 'image/png', etag: '"one"', 'last-modified': 'Wed, 14 Oct 2026 00:00:00 GMT' }, bytes });
const decoder = (bytes: Buffer) => thumbnailImage(bytes, 'image/png');
const cache = (directory = path.join(root, 'thumbnails')) => new ThumbnailCache(directory, { fetch, now: () => now, decode: decoder });
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-thumbnail-test-')); now = 1800000000000; fetch = vi.fn<ThumbnailFetch>(async () => good()); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

it('first fetch, cache hit and process restart preserve actual bytes without redundant network', async () => {
  const first = cache(), value = await first.check(item);
  expect(value).not.toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  expect((await first.read(required(value)))?.bytes).toEqual(thumbnailPng());
  const restarted = cache(); expect(await restarted.cached(item)).toEqual(value); expect(await restarted.check(item)).toEqual(value);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await fs.readdir(first.directory)).sort()).toEqual([`${item.sourceId}-${required(value).digest}.png`, `${item.sourceId}.json`].sort());
});
it('isolates development/production paths under the existing explicit profile policy', async () => {
  const dev = cache(resolveThumbnailDirectory({ mode: 'development', appData: root }));
  const prod = cache(resolveThumbnailDirectory({ mode: 'production', appData: root }));
  await dev.check(item); expect(await prod.cached(item)).toBeNull();
  expect(dev.directory).toBe(path.join(root, 'youtube-comments-development', 'thumbnails'));
  expect(prod.directory).toBe(path.join(root, 'youtube-comments-production', 'thumbnails'));
});
it('conditionally revalidates after 24h, accepts 304, and replaces changed bytes at the same URL', async () => {
  const store = cache(), original = await store.check(item);
  now += 86400001;
  fetch.mockResolvedValueOnce({ status: 304, headers: {}, bytes: Buffer.alloc(0) });
  expect(await store.check(item)).toEqual(original);
  expect(fetch.mock.calls[1][2]).toMatchObject({ 'If-None-Match': '"one"', 'If-Modified-Since': expect.any(String) });
  await store.check(item); expect(fetch).toHaveBeenCalledTimes(2);
  now += 86400001; fetch.mockResolvedValue(good(thumbnailPng(1280, 720, 160)));
  const changed = await store.check(item); expect(required(changed).digest).not.toBe(required(original).digest);
  expect((await store.read(required(changed)))?.bytes).toEqual(thumbnailPng(1280, 720, 160));
  expect(await store.read(required(original))).toBeUndefined();
});
it('offline/partial download and failed forced refresh retain last good bytes with persisted backoff', async () => {
  const store = cache(), original = await store.check(item);
  fetch.mockRejectedValue(new Error('partial/offline')); now += 86400001;
  expect(await store.check(item, true)).toEqual(original);
  expect((await store.read(required(original)))?.bytes).toEqual(thumbnailPng());
  const calls = fetch.mock.calls.length;
  expect(await cache().check(item, true)).toEqual(original); expect(fetch).toHaveBeenCalledTimes(calls);
  expect((await fs.readdir(store.directory)).some(name => name.endsWith('.tmp'))).toBe(false);
});
it('coalesces same-video requests and bounds global network concurrency', async () => {
  let release!: () => void, running = 0, maximum = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  fetch.mockImplementation(async () => { running++; maximum = Math.max(maximum, running); await gate; running--; return good(); });
  const store = cache(), first = store.check(item), same = store.check(item);
  const other = store.check({ ...item, sourceId: 'zzzzzzzzzzz' }), third = store.check({ ...item, sourceId: 'yyyyyyyyyyy' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); release();
  const [a, b] = await Promise.all([first, same, other, third]); expect(a).toEqual(b); expect(fetch).toHaveBeenCalledTimes(3); expect(maximum).toBe(2);
});
it.each(['missing-type', 'wrong-type', 'bad-signature', 'oversize', 'decode-failure'])('rejects %s and negative-caches failures', async kind => {
  const response = good();
  if (kind === 'missing-type') response.headers = {};
  if (kind === 'wrong-type') response.headers['content-type'] = 'text/html';
  if (kind === 'bad-signature') response.bytes = Buffer.from('<html>not an image</html>');
  if (kind === 'oversize') response.bytes = Buffer.alloc(thumbnailByteLimit + 1);
  fetch.mockResolvedValue(response);
  const store = kind === 'decode-failure' ? new ThumbnailCache(path.join(root, 'thumbnails'), { fetch, now: () => now, decode: () => undefined }) : cache();
  expect(await store.check(item)).toBeNull(); const count = fetch.mock.calls.length;
  expect(await store.check(item, true)).toBeNull(); expect(fetch).toHaveBeenCalledTimes(count);
  expect((await fs.readdir(store.directory)).filter(name => !name.endsWith('.json'))).toEqual([]);
});
it('skips tiny missing-image placeholders and falls back to a valid high quality variant', async () => {
  fetch.mockImplementation(async url => url.includes('maxresdefault') ? good(thumbnailPng(120, 90)) : good(thumbnailPng(1280, 720)));
  expect(await cache().check(item)).not.toBeNull(); expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toContain('hq720');
});
it('does not fetch posts or demos; validates restore association using canonical video identity', async () => {
  const store = cache();
  expect(await store.check({ ...item, isDemo: true })).toBeNull();
  expect(await store.check({ ...item, kind: 'post', text: 'Post' })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  await store.check(item);
  expect(await store.cached({ ...item, sourceId: 'zzzzzzzzzzz' })).toBeNull();
  const manifest = path.join(store.directory, `${item.sourceId}.json`), data = JSON.parse(await fs.readFile(manifest, 'utf8'));
  data.entry.videoId = 'zzzzzzzzzzz'; await fs.writeFile(manifest, JSON.stringify(data));
  expect(await store.cached(item)).toBeNull();
});
it('removal waits for in-flight work, preserves other references, and removes unreferenced files', async () => {
  const store = cache(); await store.check(item);
  await store.remove(item.sourceId, () => true); expect(await store.cached(item)).not.toBeNull();
  await store.remove(item.sourceId, () => false); expect(await store.cached(item)).toBeNull(); expect(await fs.readdir(store.directory)).toEqual([]);
});
it('tampered or missing cached files cannot be delivered or opened', async () => {
  const store = cache(), value = required(await store.check(item)), image = required(await store.read(value));
  await fs.writeFile(image.file, Buffer.from('tampered')); expect(await store.read(value)).toBeUndefined();
  await fs.rm(image.file); expect(await store.read(value)).toBeUndefined();
});
it('failed checks back off even when the successful and failed clocks are identical', async () => {
  const store = cache(); await store.check(item);
  fetch.mockRejectedValue(new Error('offline'));
  await store.check(item, true);
  const calls = fetch.mock.calls.length;
  await cache().check(item, true); expect(fetch).toHaveBeenCalledTimes(calls);
});
it('accepts changed valid bytes when a source reduces resolution instead of retaining an obsolete image', async () => {
  const store = cache(), old = required(await store.check(item));
  fetch.mockResolvedValue(good(thumbnailPng(640, 360, 170)));
  const updated = required(await store.check(item, true));
  expect(updated.digest).not.toBe(old.digest);
  expect((await store.read(updated))?.bytes).toEqual(thumbnailPng(640, 360, 170));
});

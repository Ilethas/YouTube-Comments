import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContentItem } from '../domain/discussion';
import { sourceUrl } from './source-url';
import { ReaderService } from './reader-service';
import { ReaderRepository } from './persistence/reader-repository';
import { normalizeYtDlp } from './extractors/yt-dlp';
import { normalizeCommunityArchive } from './extractors/community';

let directory: string, repository: ReaderRepository;
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'reader-source-test-'));
  repository = ReaderRepository.open(path.join(directory, 'reader.sqlite'));
});
afterEach(() => {
  repository.close();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-source-test-')) throw new Error('Unsafe cleanup');
  rmSync(directory, { recursive: true, force: true });
});
function stored(post: boolean) {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'extractors/__fixtures__', post ? 'community-thread-a.json' : 'yt-nested-a.json'), 'utf8'));
  const extraction = (post ? normalizeCommunityArchive : normalizeYtDlp)(JSON.stringify(fixture.raw), fixture.context);
  if (!extraction.item) throw new Error('Fixture item missing');
  const attempt = repository.ingest(extraction, { sourceKind: extraction.item.sourceKind, sourceId: extraction.item.sourceId });
  if (!attempt.itemId) throw new Error('Ingestion failed');
  return attempt.itemId;
}
it.each([false, true])('stored source post=%s opens the canonical destination without changing any state', async post => {
  const itemId = stored(post), before = repository.bootstrap(['en']), history = repository.history();
  const open = vi.fn(async () => undefined), service = new ReaderService(() => repository, ['en'], vi.fn(), undefined, {}, open);
  expect(await service.dispatch('openSource', [{ itemId }])).toEqual({ ok: true, value: null });
  expect(open).toHaveBeenCalledExactlyOnceWith(post ? 'https://www.youtube.com/post/UgkDemoPost_0123456789' : 'https://www.youtube.com/watch?v=VidDemo_001');
  expect(repository.bootstrap(['en'])).toEqual(before); expect(repository.history()).toEqual(history);
  open.mockRejectedValueOnce(new Error('private browser diagnostic'));
  expect(await service.dispatch('openSource', [{ itemId }])).toEqual({ ok: false, error: { code: 'SOURCE_OPEN_FAILED' } });
  expect(repository.bootstrap(['en'])).toEqual(before); expect(repository.history()).toEqual(history);
});
it('rejects arbitrary renderer URL/path/scheme payloads and arity before opening', async () => {
  const itemId = stored(false), open = vi.fn(), service = new ReaderService(() => repository, ['en'], vi.fn(), undefined, {}, open);
  for (const url of ['https://evil.test', 'javascript:alert(1)', 'file:///private', 'custom:scheme', 'https://youtube.com.evil.test/watch?v=VidDemo_001']) {
    for (const payload of [{ url }, { itemId, url }, { itemId, path: url }])
      expect(await service.dispatch('openSource', [payload])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  }
  for (const args of [[], [{ itemId }, 'extra'], [null]]) expect(await service.dispatch('openSource', args)).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(open).not.toHaveBeenCalled();
});
it('missing and synthetic items fail safely; unsupported kinds and malformed stored IDs cannot form destinations', async () => {
  repository.initializeDemo();
  const open = vi.fn(), service = new ReaderService(() => repository, ['en'], vi.fn(), undefined, {}, open);
  expect(await service.dispatch('openSource', [{ itemId: 'missing' }])).toMatchObject({ error: { code: 'NOT_FOUND' } });
  expect(await service.dispatch('openSource', [{ itemId: 'video-demo' }])).toMatchObject({ error: { code: 'NOT_OPENABLE' } });
  const base = repository.getStoredItem(stored(false)); if (!base) throw new Error('Expected stored item');
  for (const change of [{ sourceKind: undefined }, { sourceKind: 'youtube-community-post' }, { kind: 'post' },
    { sourceId: '../evil' }, { sourceId: 'VidDemo_001&v=evil' }, { sourceId: 'https://evil.test' }, { sourceId: 'javascript:' }]) {
    expect(sourceUrl({ ...base, ...change } as ContentItem)).toBeUndefined();
  }
  expect(open).not.toHaveBeenCalled();
});

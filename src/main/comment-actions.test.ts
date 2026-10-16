import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderRepository } from './persistence/reader-repository';
import { ReaderService } from './reader-service';
import { normalizeYtDlp } from './extractors/yt-dlp';
import { normalizeCommunityArchive } from './extractors/community';
import { authorUrl, commentPermalink, translationUrl, translationUrlLimit, translationTextLimit } from './comment-actions';
import { isPreferenceChange } from '../shared/reader-api';
import { translationTargets } from '../shared/preferences';
import type { Preferences } from '../shared/preferences';

let root: string, repository: ReaderRepository;
const channel = 'UC' + 'a'.repeat(22), sourceComment = 'UgxComment_0123456789';
const text = '你好 한국어 Żółw 🦊 & ? # + = %\n第二行 "quotes"';
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'reader-actions-')); repository = ReaderRepository.open(path.join(root, 'reader.sqlite')); });
afterEach(() => {
  repository.close();
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-actions-')) throw new Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
});
function stored(post = false, content = text) {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'extractors/__fixtures__', post ? 'community-thread-a.json' : 'yt-nested-a.json'), 'utf8'));
  if (!post) fixture.raw.comments = [{ id: sourceComment, parent: 'root', text: content, author_id: channel, author: 'Creator', author_is_uploader: true, timestamp: 1758000000 }];
  const extraction = (post ? normalizeCommunityArchive : normalizeYtDlp)(JSON.stringify(fixture.raw), fixture.context);
  const result = repository.ingest(extraction);
  if (!result.itemId) throw new Error('Fixture failed');
  const state = repository.bootstrap(['en']), item = state.items.find(item => item.id === result.itemId);
  if (!item) throw new Error('Missing item');
  return { item, comment: state.comments[item.id][0] };
}
function service(open = vi.fn<(url: string) => Promise<void>>(async () => undefined), diagnose = vi.fn()) {
  return { open, diagnose, reader: new ReaderService(() => repository, ['en'], diagnose, undefined, {}, open) };
}
it('constructs canonical channel IDs before conservative handle fallback; remote URLs/names are never identities', () => {
  expect(authorUrl({ sourceId: channel, handle: '@other' })).toBe(`https://www.youtube.com/channel/${channel}`);
  expect(authorUrl({ sourceId: 'bad', handle: '@a.b-1' })).toBe('https://www.youtube.com/@a.b-1');
  expect(authorUrl({ handle: '@한국어' })).toBe('https://www.youtube.com/@%ED%95%9C%EA%B5%AD%EC%96%B4');
  for (const handle of ['@ab', '@a'.repeat(31), '@../bad', '@evil?x', '@evil#x', '@evil%2f', '@evil\\x', '@bad\u202e', 'name', '@bad.', '@ bad', '@evil@example']) expect(authorUrl({ handle })).toBeUndefined();
  for (const sourceId of ['UCbad', channel + '?x', 'https://youtube.com/channel/' + channel, '../' + channel]) expect(authorUrl({ sourceId, displayName: '@validname' })).toBeUndefined();
  expect(authorUrl()).toBeUndefined();
});
it('opens stored author and video comment with no state, history, seen, workspace or view mutation', async () => {
  const { item, comment } = stored(), before = repository.bootstrap(['en']), history = repository.history(), { reader, open } = service();
  expect(comment.actions).toEqual({ author: true, permalink: true, translate: true }); expect(comment.isCreator).toBe(true);
  for (const action of ['author', 'permalink'] as const) expect(await reader.dispatch('openCommentAction', [{ itemId: item.id, commentId: comment.id, action }])).toEqual({ ok: true, value: null });
  expect(open.mock.calls.map(call => call[0])).toEqual([`https://www.youtube.com/channel/${channel}`, `https://www.youtube.com/watch?v=${item.sourceId}&lc=${sourceComment}`]);
  expect(repository.bootstrap(['en'])).toEqual(before); expect(repository.history()).toEqual(history);
  expect(commentPermalink(item, { ...comment, source: { ...comment.source, commentId: 'local-ID' } })).toBeUndefined();
  expect(commentPermalink(item, { ...comment, source: { ...comment.source, itemId: 'wrong-video' } })).toBeUndefined();
  expect(commentPermalink(item, { ...comment, source: { ...comment.source, commentId: sourceComment + '.reply_123' } })).toContain('.reply_123');
});
it('Community has no verified comment permalink or creator evidence; synthetic items offer no external actions', async () => {
  const { item, comment } = stored(true), { reader, open } = service();
  expect(comment.actions?.permalink).toBe(false); expect(comment.isCreator).toBeUndefined();
  expect(await reader.dispatch('openCommentAction', [{ itemId: item.id, commentId: comment.id, action: 'permalink' }])).toMatchObject({ error: { code: 'NOT_OPENABLE' } });
  expect(open).not.toHaveBeenCalled();
});
it('rejects missing/mismatched identities, synthetic sources and extra renderer authority before opening', async () => {
  repository.initializeDemo(); const { item, comment } = stored(), { reader, open } = service();
  const request = { itemId: item.id, commentId: comment.id, action: 'translate' };
  for (const payload of [{ ...request, action: 'copy' }, { ...request, text: 'evil' }, { ...request, url: 'https://evil.test' }, { ...request, target: 'de' }, { ...request, itemId: '' }, null]) {
    expect(await reader.dispatch('openCommentAction', [payload])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  }
  for (const args of [[], [request, request]]) expect(await reader.dispatch('openCommentAction', args)).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  for (const payload of [{ ...request, itemId: 'missing' }, { ...request, commentId: 'missing' }, { ...request, itemId: 'post-demo' }]) expect(await reader.dispatch('openCommentAction', [payload])).toMatchObject({ error: { code: 'NOT_FOUND' } });
  for (const action of ['author', 'permalink', 'translate']) expect(await reader.dispatch('openCommentAction', [{ itemId: 'video-demo', commentId: 'v1', action }])).toMatchObject({ error: { code: 'NOT_OPENABLE' } });
  expect(open).not.toHaveBeenCalled();
});
it.each(translationTargets)('translation target %s encodes full Unicode/newline text with auto detection', translationTarget => {
  const preferences: Preferences = { locale: 'pl', appearance: 'dark', translationTarget };
  const url = new URL(translationUrl(text, preferences) ?? '');
  expect(url.origin + url.pathname).toBe('https://translate.google.com/');
  expect(Object.fromEntries(url.searchParams)).toEqual({ sl: 'auto', tl: translationTarget === 'app' ? 'pl' : translationTarget, text, op: 'translate' });
  expect(url.href).not.toContain('你好');
});
it('main resolves Follow app at click, overrides stay independent, and bootstrap never opens a browser', async () => {
  const { item, comment } = stored(), { reader, open } = service();
  reader.dispatch('bootstrap', []); expect(open).not.toHaveBeenCalled();
  const request = [{ itemId: item.id, commentId: comment.id, action: 'translate' }];
  for (const [locale, target, effective] of [['en', 'app', 'en'], ['pl', 'app', 'pl'], ['pl', 'en', 'en'], ['en', 'de', 'de'], ['pl', 'de', 'de']] as const) {
    reader.dispatch('updatePreferences', [{ locale }]); reader.dispatch('updatePreferences', [{ translationTarget: target }]);
    expect(await reader.dispatch('openCommentAction', request)).toEqual({ ok: true, value: null });
    const url = new URL(open.mock.calls.at(-1)?.[0] ?? ''); expect(url.searchParams.get('tl')).toBe(effective); expect(url.searchParams.get('text')).toBe(text);
  }
  expect(open).toHaveBeenCalledTimes(5);
  for (const translationTarget of ['', 'auto', 'zh', 'javascript:', 'de&text=evil', null, 1]) expect(isPreferenceChange({ translationTarget })).toBe(false);
});
it('bounds the entire encoded URL without truncation, and suppresses browser error text/URLs in diagnostics', async () => {
  const { item, comment } = stored(false, '中'.repeat(2000)), { reader, open, diagnose } = service();
  expect(await reader.dispatch('openCommentAction', [{ itemId: item.id, commentId: comment.id, action: 'translate' }])).toMatchObject({ error: { code: 'TRANSLATION_TOO_LONG' } });
  expect(open).not.toHaveBeenCalled();
  expect(translationUrl('x'.repeat(translationUrlLimit), { locale: 'en', appearance: 'system', translationTarget: 'app' })).toBeUndefined();
  const preferences: Preferences = { locale: 'en', appearance: 'system', translationTarget: 'app' };
  expect(translationUrl('x'.repeat(translationTextLimit), preferences)).toBeTruthy();
  expect(translationUrl('x'.repeat(translationTextLimit + 1), preferences)).toBeUndefined();
  open.mockRejectedValueOnce(new Error('https://translate.google.com/?text=private-comment'));
  expect(await reader.dispatch('openCommentAction', [{ itemId: item.id, commentId: comment.id, action: 'author' }])).toMatchObject({ error: { code: 'SOURCE_OPEN_FAILED' } });
  expect(diagnose).not.toHaveBeenCalled();
});

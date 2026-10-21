import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderService } from './reader-service';
import { ReaderRepository } from './persistence/reader-repository';
import { AppearanceAssets } from './appearance-assets';
import { builtinThemes } from '../shared/appearance';
import type { ReaderCallerContext } from './caller-context';

let root: string, repo: ReaderRepository;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'reader-appearance-service-')); repo = ReaderRepository.open(path.join(root, 'reader.sqlite')); });
afterEach(() => { vi.restoreAllMocks(); repo.close(); if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-appearance-service-')) throw Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true }); });
const caller = () => ({ isCurrent: () => true, windowId: repo.initialWindowId() }) as ReaderCallerContext;
function service(choose: () => Promise<string | undefined>) {
  return new ReaderService(() => repo, ['en'], () => undefined, undefined, {}, undefined, undefined, undefined, undefined, undefined,
    new AppearanceAssets(path.join(root, 'assets'), { choose, encode: () => undefined }));
}
it('authenticates narrow import intents and preserves active preferences on failure/cancel/write error', async () => {
  const file = path.join(root, 'theme.json'); writeFileSync(file, JSON.stringify(builtinThemes.charcoal));
  const choose = vi.fn(async () => file), s = service(choose);
  expect(await s.dispatch('importTheme', [], undefined)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(await s.dispatch('importTheme', [{ file }], caller())).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  const ok = await s.dispatch('importTheme', [], caller()); expect(ok.ok).toBe(true); expect(ok.sync?.commitRevision).toBeGreaterThan(0);
  const before = repo.preferences(['en']); writeFileSync(file, '{}');
  expect(await s.dispatch('importTheme', [], caller())).toMatchObject({ ok: false, error: { code: 'INVALID_THEME' } }); expect(repo.preferences(['en'])).toEqual(before);
  choose.mockResolvedValueOnce(undefined as never); expect(await s.dispatch('importTheme', [], caller())).toMatchObject({ ok: true, value: null });
  writeFileSync(file, JSON.stringify(builtinThemes.light)); vi.spyOn(repo, 'importTheme').mockImplementation(() => { throw Error('commit failed'); });
  expect(await s.dispatch('importTheme', [], caller())).toMatchObject({ ok: false, error: { code: 'APPEARANCE_IMPORT_FAILED' } }); expect(repo.preferences(['en'])).toEqual(before);
});
it('drops a picker reply after origin loss or a profile barrier and fences concurrent imports', async () => {
  const file = path.join(root, 'theme.json'); writeFileSync(file, JSON.stringify(builtinThemes.charcoal));
  let release!: (file: string) => void;
  const s = service(() => new Promise(resolve => { release = resolve; })), origin = caller();
  let current = true; const lease = { ...origin, isCurrent: () => current };
  const pending = s.dispatch('importTheme', [], lease);
  expect(await s.dispatch('importTheme', [], origin)).toMatchObject({ ok: false, error: { code: 'DATA_BUSY' } });
  current = false; release(file); expect(await pending).toMatchObject({ ok: true, value: null }); expect(repo.readerAppearance().themes).toEqual([]);
  const next = s.dispatch('importTheme', [], caller()); vi.spyOn(s, 'nativeWritesAllowed').mockReturnValue(false); release(file);
  expect(await next).toMatchObject({ ok: true, value: null }); expect(repo.readerAppearance().themes).toEqual([]);
});
it('rejects stale picker commits after a peer preference edit and returns missing wallpaper safely', async () => {
  const file = path.join(root, 'theme.json'); writeFileSync(file, JSON.stringify(builtinThemes.charcoal));
  let release!: (file: string) => void; const s = service(() => new Promise(resolve => { release = resolve; }));
  const pending = s.dispatch('importTheme', [], caller()); repo.importTheme(builtinThemes.light, ['en'], 0); release(file);
  expect(await pending).toMatchObject({ ok: false, error: { code: 'STATE_CONFLICT' } });
  repo.importWallpaper('a'.repeat(64), ['en'], repo.readerAppearance().revision);
  expect(await s.dispatch('getWallpaper', [], caller())).toMatchObject({ ok: true, value: null });
  expect(await s.wallpaperImage('reader-wallpaper://asset/../../reader.sqlite')).toBeUndefined();
});

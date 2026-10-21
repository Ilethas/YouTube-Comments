import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReaderService } from './reader-service';
import { ReaderRepository } from './persistence/reader-repository';
import { AppearanceAssets } from './appearance-assets';
import { builtinThemes, parseTheme, themeTemplates } from '../shared/appearance';
import type { AppearanceAssetsOptions } from './appearance-assets';
import type { ReaderCallerContext } from './caller-context';

let root: string, repo: ReaderRepository;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'reader-appearance-service-')); repo = ReaderRepository.open(path.join(root, 'reader.sqlite')); });
afterEach(() => { vi.restoreAllMocks(); repo.close(); if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-appearance-service-')) throw Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true }); });
const caller = () => ({ isCurrent: () => true, windowId: repo.initialWindowId() }) as ReaderCallerContext;
function service(choose: () => Promise<string | undefined>, options: Partial<AppearanceAssetsOptions> = {}) {
  return new ReaderService(() => repo, ['en'], () => undefined, undefined, {}, undefined, undefined, undefined, undefined, undefined,
    new AppearanceAssets(path.join(root, 'assets'), { choose, encode: () => undefined, ...options }));
}
it('exports every offline starter and round-trips imports without mutating state during export', async () => {
  const file = path.join(root, 'export.json'), saveTheme = vi.fn(async () => file);
  const s = service(async () => file, { saveTheme });
  for (const [source, definition] of Object.entries(themeTemplates)) {
    const before = repo.preferences(['en']), stamp = repo.stamp();
    expect(await s.dispatch('exportTheme', [{ source }], caller())).toEqual({ ok: true, value: null });
    expect(parseTheme(readFileSync(file, 'utf8'))).toEqual(definition);
    expect(repo.preferences(['en'])).toEqual(before); expect(repo.stamp()).toEqual(stamp);
    expect((await s.dispatch('importTheme', [], caller())).ok).toBe(true);
    expect(repo.readerAppearance().themes.at(-1)?.definition).toEqual(definition);
    await s.dispatch('exportTheme', [{ source: 'current' }], caller());
    expect(parseTheme(readFileSync(file, 'utf8'))).toEqual(definition);
  }
  repo.updatePreferences({ appearance: 'system' }, ['en']);
  const dark = service(async () => undefined, { saveTheme, systemDark: () => true });
  await dark.dispatch('exportTheme', [{ source: 'current' }], caller());
  expect(parseTheme(readFileSync(file, 'utf8'))).toEqual(builtinThemes.dark);
  const light = service(async () => undefined, { saveTheme, systemDark: () => false });
  await light.dispatch('exportTheme', [{ source: 'current' }], caller());
  expect(parseTheme(readFileSync(file, 'utf8'))).toEqual(builtinThemes.light);
});
it('authenticates exports, rejects arbitrary paths/data, and handles cancel and write failure', async () => {
  const saveTheme = vi.fn(async () => undefined as string | undefined), s = service(async () => undefined, { saveTheme });
  expect(await s.dispatch('exportTheme', [{ source: 'light' }])).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  for (const args of [[], [{ source: 'unknown' }], [{ source: 'light', path: 'private' }], [{ source: 'light' }, {}]]) {
    expect(await s.dispatch('exportTheme', args, caller())).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  }
  expect(saveTheme).not.toHaveBeenCalled();
  const before = repo.preferences(['en']);
  expect(await s.dispatch('exportTheme', [{ source: 'light' }], caller())).toEqual({ ok: true, value: null });
  saveTheme.mockResolvedValueOnce(path.join(root, 'missing', 'theme.json'));
  expect(await s.dispatch('exportTheme', [{ source: 'light' }], caller())).toMatchObject({ ok: false, error: { code: 'DATA_WRITE_FAILED' } });
  expect(repo.preferences(['en'])).toEqual(before);
  expect(readdirSync(root).some(name => name.startsWith('.theme-'))).toBe(false);
});
it('cancels export after document loss/barrier and bounds concurrent dialogs', async () => {
  let release!: (file: string) => void, current = true;
  const s = service(async () => undefined, { saveTheme: () => new Promise(resolve => { release = resolve; }) });
  const lease = { ...caller(), isCurrent: () => current }, file = path.join(root, 'existing.json');
  writeFileSync(file, 'original');
  const pending = s.dispatch('exportTheme', [{ source: 'light' }], lease);
  expect(await s.dispatch('exportTheme', [{ source: 'dark' }], caller())).toMatchObject({ ok: false, error: { code: 'DATA_BUSY' } });
  current = false; release(file); expect(await pending).toEqual({ ok: true, value: null });
  expect(readFileSync(file, 'utf8')).toBe('original');
  const next = s.dispatch('exportTheme', [{ source: 'light' }], caller());
  vi.spyOn(s, 'nativeWritesAllowed').mockReturnValue(false); release(file);
  expect(await next).toEqual({ ok: true, value: null });
  expect(readFileSync(file, 'utf8')).toBe('original');
});
it('exports the captured palette if a peer switches appearance while Save is open', async () => {
  let release!: (file: string) => void;
  repo.updatePreferences({ appearance: 'light' }, ['en']);
  const s = service(async () => undefined, { saveTheme: () => new Promise(resolve => { release = resolve; }) });
  const pending = s.dispatch('exportTheme', [{ source: 'current' }], caller());
  repo.updatePreferences({ appearance: 'charcoal' }, ['en']);
  const before = repo.preferences(['en']), file = path.join(root, 'captured.json');
  release(file); expect(await pending).toEqual({ ok: true, value: null });
  expect(parseTheme(readFileSync(file, 'utf8'))).toEqual(builtinThemes.light);
  expect(repo.preferences(['en'])).toEqual(before);
});
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

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppearanceAssets, readImport, wallpaperByteLimit } from './appearance-assets';
import { thumbnailPng } from '../fixtures/thumbnail-image';
import { builtinThemes } from '../shared/appearance';

let root: string;
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'reader-appearance-assets-')); });
afterEach(() => { if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-appearance-assets-')) throw Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true }); });
// Metadata-only output for injected decoder tests. Actual decode/encode is tested
// by smoke-appearance.cjs against nativeImage and the packaged production entry.
const jpeg = () => Buffer.from([255,216,255,192,0,17,8,0,32,0,32,3,1,17,0,2,17,0,3,17,0,255,217]);
function assets(encode = vi.fn(() => jpeg())) { return new AppearanceAssets(path.join(root, 'profile', 'appearance'), { choose: async () => undefined, encode }); }
it('imports a theme from a bounded file without retaining its original path', async () => {
  const file = path.join(root, 'theme.json'); writeFileSync(file, JSON.stringify(builtinThemes.charcoal));
  expect(await assets().theme(file)).toEqual(builtinThemes.charcoal);
  writeFileSync(file, Buffer.from([255,254,0])); await expect(assets().theme(file)).rejects.toThrow();
});
it('owns the approved wallpaper bytes after the original disappears; missing/tampered assets fall back', async () => {
  const file = path.join(root, 'picture.exe'); writeFileSync(file, thumbnailPng(32,32));
  const store = assets(), id = await store.wallpaper(file); unlinkSync(file);
  expect(await store.read(id)).toEqual(jpeg()); expect(await store.read('a'.repeat(64))).toBeUndefined(); expect(await store.read('../outside')).toBeUndefined();
  writeFileSync(path.join(store.directory, id + '.jpg'), 'changed'); expect(await store.read(id)).toBeUndefined();
});
it('checks size, format and decoded header limits before invoking any decoder', async () => {
  const encode = vi.fn(() => jpeg()), store = assets(encode), file = path.join(root, 'picture.png');
  for (const bytes of [Buffer.from('<svg/>'), Buffer.from('GIF89a'), Buffer.alloc(wallpaperByteLimit + 1), thumbnailPng(8193,1), thumbnailPng(4096,4096), Buffer.alloc(0)]) {
    writeFileSync(file, bytes); await expect(store.wallpaper(file)).rejects.toThrow();
  }
  expect(encode).not.toHaveBeenCalled();
  await expect(readImport(root, 100)).rejects.toThrow(); await expect(readImport('relative', 100)).rejects.toThrow();
});
it('rejects decoder failures and oversized outputs without importing them', async () => {
  const file = path.join(root, 'broken.png'); writeFileSync(file, thumbnailPng(16,16));
  const store = new AppearanceAssets(path.join(root, 'assets'), { choose: async () => undefined, encode: () => undefined });
  await expect(store.wallpaper(file)).rejects.toThrow();
  const blocked = path.join(root, 'file'); writeFileSync(blocked, 'file instead of directory');
  await expect(new AppearanceAssets(blocked, { choose: async () => undefined, encode: jpeg }).wallpaper(file)).rejects.toThrow();
});

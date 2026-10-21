import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { assetId, parseTheme, themeByteLimit } from '../shared/appearance';
import type { ThemeDefinition } from '../shared/appearance';
import { thumbnailImage } from './thumbnail-image';
import type { ReaderCallerContext } from './caller-context';
import type { Locale } from '../shared/preferences';

export const wallpaperByteLimit = 12 * 1024 * 1024;
export const wallpaperLimits = { minWidth: 1, minHeight: 1, pixels: 16000000 };
/** Bounded handles avoid unbounded readFile allocation and reject links/devices. */
export async function readImport(file: string, limit: number): Promise<Buffer> {
  if (!path.isAbsolute(file)) throw new Error('Invalid import');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit) throw new Error('Invalid import');
  const handle = await fs.open(file, 'r');
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size !== stat.size) throw new Error('Changed import');
    const bytes = Buffer.alloc(current.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset !== current.size) throw new Error('Changed import');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
export interface AppearanceAssetsOptions {
  readonly saveTheme?: (locale: Locale, caller: ReaderCallerContext) => Promise<string | undefined>;
  readonly systemDark?: () => boolean;
  readonly choose: (kind: 'theme' | 'wallpaper', locale: Locale, caller: ReaderCallerContext) => Promise<string | undefined>;
  /** Electron's actual decoder + resize/re-encode, supplied only by main. */
  readonly encode: (bytes: Buffer, width: number, height: number) => Buffer | undefined | Promise<Buffer | undefined>;
  /** Reads need actual decoding, without repeated JPEG re-encoding work. */
  readonly validate?: (bytes: Buffer, width: number, height: number) => boolean;
}
/** Only canonical, bounded, re-encoded local rasters enter this profile directory.
 * Originals and imported theme filenames are never sent across the bridge. */
export class AppearanceAssets {
  constructor(readonly directory: string, readonly options: AppearanceAssetsOptions) {
    if (!path.isAbsolute(directory)) throw new Error('Absolute appearance directory required');
  }
  async theme(file: string) { return parseTheme(new TextDecoder('utf-8', { fatal: true }).decode(await readImport(file, themeByteLimit))); }
  /** Native-dialog destination only; a sibling temporary prevents partial files.
   * Replacing a symlink replaces the link rather than writing to its target. */
  async exportTheme(file: string, theme: ThemeDefinition, allowed: () => boolean): Promise<void> {
    if (!path.isAbsolute(file)) throw new Error('Invalid export');
    const json = `${JSON.stringify(theme, null, 2)}\n`;
    parseTheme(json);
    const temporary = path.join(path.dirname(file), `.theme-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, json, { flag: 'wx', encoding: 'utf8' });
      if (allowed()) await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  async wallpaper(file: string): Promise<string> {
    const bytes = await readImport(file, wallpaperByteLimit);
    const header = ['image/png', 'image/jpeg', 'image/webp'].map(mime => thumbnailImage(bytes, mime, wallpaperLimits)).find(Boolean);
    if (!header) throw new Error('Invalid wallpaper');
    const encoded = await this.options.encode(bytes, header.width, header.height);
    const output = encoded && thumbnailImage(encoded, 'image/jpeg', wallpaperLimits);
    if (!encoded || encoded.length > wallpaperByteLimit || !output || output.width > 2560 || output.height > 1600) throw new Error('Invalid wallpaper');
    const id = createHash('sha256').update(encoded).digest('hex');
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.import-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, encoded, { flag: 'wx' });
      await fs.rename(temporary, path.join(this.directory, `${id}.jpg`));
    } finally { await fs.rm(temporary, { force: true }); }
    return id;
  }
  async read(id: string): Promise<Buffer | undefined> {
    if (!assetId(id)) return;
    try {
      const file = path.join(this.directory, `${id}.jpg`);
      if (await fs.realpath(file) !== path.join(await fs.realpath(this.directory), `${id}.jpg`)) return;
      const bytes = await readImport(file, wallpaperByteLimit);
      if (createHash('sha256').update(bytes).digest('hex') !== id) return;
      const header = thumbnailImage(bytes, 'image/jpeg', wallpaperLimits);
      if (!header || header.width > 2560 || header.height > 1600) return;
      const valid = this.options.validate?.(bytes, header.width, header.height) ?? Boolean(await this.options.encode(bytes, header.width, header.height));
      if (!valid) return;
      return bytes;
    } catch { return; }
  }
}

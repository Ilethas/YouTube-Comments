import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { ContentItem } from '../domain/discussion';
import { isVideoThumbnailUrl, isYouTubeVideoId, videoThumbnailSources } from '../domain/video-thumbnail';
import { fetchThumbnail, thumbnailByteLimit } from './thumbnail-network';
import type { ThumbnailFetch } from './thumbnail-network';
import { thumbnailImage } from './thumbnail-image';
import type { ThumbnailImage } from './thumbnail-image';

interface Entry extends ThumbnailImage { videoId: string; digest: string; url: string; etag?: string; modified?: string }
interface Manifest { videoId: string; checkedAt: number; attemptedAt: number; failed?: boolean; entry?: Entry }
export interface CachedThumbnail { readonly videoId: string; readonly digest: string }
export interface ThumbnailCacheOptions {
  readonly fetch?: ThumbnailFetch; readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly decode: (bytes: Buffer) => { width: number; height: number } | undefined;
}
const day = 24 * 60 * 60 * 1000, backoff = 15 * 60 * 1000;

/** Regenerable profile-local presentation bytes. Immutable content files are
 * committed before an atomic manifest replacement; failures retain the old entry.
 * Two network jobs globally, one job per video, with a finite waiting queue. */
export class ThumbnailCache {
  private pending = new Map<string, Promise<CachedThumbnail | null>>();
  private running = 0;
  private queue: (() => void)[] = [];
  private stopping = false;
  constructor(readonly directory: string, private readonly options: ThumbnailCacheOptions) {
    if (!path.isAbsolute(directory)) throw new Error('Absolute thumbnail directory required');
  }
  private filename(entry: Entry) { return `${entry.videoId}-${entry.digest}.${entry.extension}`; }
  private async regular(name: string, limit: number): Promise<Buffer> {
    const target = path.join(this.directory, name);
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || stat.size === 0) throw new Error('Invalid cache file');
    if (await fs.realpath(target) !== path.join(await fs.realpath(this.directory), name)) throw new Error('Invalid cache directory');
    const handle = await fs.open(target, 'r');
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.size > limit || current.size !== stat.size) throw new Error('Changed cache file');
      const bytes = Buffer.alloc(current.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      if (offset !== current.size) throw new Error('Changed cache file');
      return bytes.subarray(0, offset);
    } finally { await handle.close(); }
  }
  private async manifest(videoId: string): Promise<Manifest> {
    if (!isYouTubeVideoId(videoId)) throw new Error('Invalid thumbnail identity');
    try {
      const value = JSON.parse((await this.regular(`${videoId}.json`, 8192)).toString()) as Manifest;
      if (value.videoId !== videoId || !Number.isFinite(value.checkedAt) || !Number.isFinite(value.attemptedAt)) throw new Error('Invalid manifest');
      if (value.entry) {
        const entry = value.entry;
        if (entry.videoId !== videoId || !/^[a-f0-9]{64}$/.test(entry.digest) || !['jpg', 'png', 'webp'].includes(entry.extension) || !isVideoThumbnailUrl(entry.url, videoId)) throw new Error('Invalid entry');
      }
      return value;
    } catch { return { videoId, checkedAt: 0, attemptedAt: 0 }; }
  }
  private validate(bytes: Buffer, mime: string): ThumbnailImage | undefined {
    if (bytes.length > thumbnailByteLimit) return undefined;
    const image = thumbnailImage(bytes, mime);
    if (!image) return undefined;
    const decoded = this.options.decode(bytes);
    return decoded?.width === image.width && decoded.height === image.height ? image : undefined;
  }
  private async load(entry: Entry): Promise<Buffer | undefined> {
    try {
      const bytes = await this.regular(this.filename(entry), thumbnailByteLimit);
      const image = this.validate(bytes, entry.mime);
      return createHash('sha256').update(bytes).digest('hex') === entry.digest && image?.extension === entry.extension && image.width === entry.width && image.height === entry.height ? bytes : undefined;
    } catch { return undefined; }
  }
  async cached(item: ContentItem): Promise<CachedThumbnail | null> {
    if (!videoThumbnailSources(item).length) return null;
    const entry = (await this.manifest(item.sourceId)).entry;
    return entry && await this.load(entry) ? { videoId: entry.videoId, digest: entry.digest } : null;
  }
  async read(value: CachedThumbnail): Promise<{ bytes: Buffer; mime: string; file: string } | undefined> {
    const entry = (await this.manifest(value.videoId)).entry;
    if (!entry || entry.digest !== value.digest) return undefined;
    const bytes = await this.load(entry);
    return bytes ? { bytes, mime: entry.mime, file: path.join(this.directory, this.filename(entry)) } : undefined;
  }
  check(item: ContentItem, force = false): Promise<CachedThumbnail | null> {
    if (this.stopping || !videoThumbnailSources(item).length) return Promise.resolve(null);
    const previous = this.pending.get(item.sourceId);
    if (previous) return previous;
    if (this.pending.size >= 34) return this.cached(item);
    const pending = this.update(item, force).catch(() => this.cached(item)).finally(() => this.pending.delete(item.sourceId));
    this.pending.set(item.sourceId, pending);
    return pending;
  }
  private async atomic(name: string, bytes: Buffer | string): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.thumbnail-${randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, path.join(this.directory, name)); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  private async update(item: ContentItem, force: boolean): Promise<CachedThumbnail | null> {
    const manifest = await this.manifest(item.sourceId), now = (this.options.now ?? Date.now)();
    const cached = await this.cached(item);
    const failed = manifest.failed === true || manifest.attemptedAt > manifest.checkedAt;
    if (failed && now - manifest.attemptedAt < backoff || !force && cached && now - manifest.checkedAt < day) return cached;
    if (this.running >= 2) await new Promise<void>(resolve => this.queue.push(resolve));
    this.running++;
    try {
      const total = AbortSignal.timeout(30000);
      for (const url of videoThumbnailSources(item)) {
        if (total.aborted || this.stopping) break;
        for (let retry = 0; retry < 2; retry++) {
          try {
            const headers: Record<string, string> = { Accept: 'image/jpeg,image/webp,image/png' };
            const old = manifest.entry;
            if (cached && old?.url === url) {
              if (old.etag && old.etag.length <= 2048 && !/[\r\n]/.test(old.etag)) headers['If-None-Match'] = old.etag;
              if (old.modified && old.modified.length <= 2048 && !/[\r\n]/.test(old.modified)) headers['If-Modified-Since'] = old.modified;
            }
            const response = await (this.options.fetch ?? fetchThumbnail)(url, item.sourceId, headers, AbortSignal.any([total, AbortSignal.timeout(Math.max(1, Math.min(6000, this.options.timeoutMs ?? 6000)))]));
            if (response.status === 304 && cached && old?.url === url) {
              await this.atomic(`${item.sourceId}.json`, JSON.stringify({ ...manifest, failed: false, checkedAt: now, attemptedAt: now })); return cached;
            }
            if (response.status === 404 || response.status === 410) break;
            if (response.status !== 200) { if (response.status >= 500 && retry === 0) continue; break; }
            const mime = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
            const image = mime ? this.validate(response.bytes, mime) : undefined;
            if (!image) break;
            if (/\/(maxresdefault|hq720)/.test(url) && image.width < 640) break;
            const digest = createHash('sha256').update(response.bytes).digest('hex');
            const entry: Entry = { ...image, videoId: item.sourceId, url, digest, etag: response.headers.etag, modified: response.headers['last-modified'] };
            await this.atomic(this.filename(entry), response.bytes);
            await this.atomic(`${item.sourceId}.json`, JSON.stringify({ videoId: item.sourceId, entry, checkedAt: now, attemptedAt: now }));
            if (old && this.filename(old) !== this.filename(entry)) await fs.rm(path.join(this.directory, this.filename(old)), { force: true }).catch(() => undefined);
            return { videoId: item.sourceId, digest };
          } catch { if (total.aborted) break; }
        }
      }
      await this.atomic(`${item.sourceId}.json`, JSON.stringify({ ...manifest, failed: true, attemptedAt: now }));
      return cached;
    } finally { this.running--; this.queue.shift()?.(); }
  }
  async remove(videoId: string, referenced: () => boolean): Promise<void> {
    if (!isYouTubeVideoId(videoId)) return;
    await this.pending.get(videoId);
    if (referenced()) return;
    const files = await fs.readdir(this.directory).catch(() => []);
    await Promise.all(files.filter(name => name === `${videoId}.json` || new RegExp(`^${videoId}-[a-f0-9]{64}\\.(jpg|png|webp)$`).test(name)).map(name => fs.rm(path.join(this.directory, name), { force: true })));
  }
  async settle(): Promise<void> { await Promise.allSettled(this.pending.values()); }
  async shutdown(): Promise<void> { this.stopping = true; await this.settle(); }
}

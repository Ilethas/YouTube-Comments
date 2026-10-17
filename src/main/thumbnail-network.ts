import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { isVideoThumbnailUrl } from '../domain/video-thumbnail';

export const thumbnailByteLimit = 5 * 1024 * 1024;
export interface ThumbnailResponse { status: number; headers: Record<string, string | undefined>; bytes: Buffer }
export type ThumbnailFetch = (url: string, videoId: string, headers: Record<string, string>, signal: AbortSignal) => Promise<ThumbnailResponse>;

/** DNS is checked at connection time, including redirects. Only public IPv4
 * addresses are used; IPv6-only resolution fails closed for this optional cache. */
export function isPublicImageAddress(address: string): boolean {
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || b === 2))
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19 || b === 51)) && !(a === 203 && b === 0);
}

/** No ambient cookies, proxy, credentials, automatic redirects or unlimited body.
 * The deadline includes DNS, headers and body, rather than just socket inactivity. */
export const fetchThumbnail: ThumbnailFetch = async (url, videoId, headers, signal) => {
  for (let redirects = 0; redirects <= 2; redirects++) {
    if (!isVideoThumbnailUrl(url, videoId)) throw new Error('Unsafe thumbnail source');
    const response = await new Promise<ThumbnailResponse>((resolve, reject) => {
      const request = https.get(url, { headers, signal, agent: false,
        lookup: (_host, options, callback) => dns.lookup('i.ytimg.com', { family: 4 }, (error, address, family) => {
          if (error || !isPublicImageAddress(address)) callback(error ?? new Error('Unsafe image endpoint'), '', 4);
          else if (options.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        }),
      }, response => {
        const selected: Record<string, string | undefined> = {};
        for (const key of ['content-type', 'etag', 'last-modified', 'location']) {
          const value = response.headers[key];
          if (typeof value === 'string' && value.length <= 2048 && !/[\r\n]/.test(value)) selected[key] = value;
        }
        if (response.statusCode !== 200) { response.destroy(); resolve({ status: response.statusCode ?? 0, headers: selected, bytes: Buffer.alloc(0) }); return; }
        if (Number(response.headers['content-length']) > thumbnailByteLimit || response.headers['content-encoding']) {
          response.destroy(); reject(new Error('Oversized or encoded thumbnail')); return;
        }
        let length = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > thumbnailByteLimit) response.destroy(new Error('Oversized thumbnail'));
          else chunks.push(chunk);
        });
        response.once('end', () => response.complete ? resolve({ status: 200, headers: selected, bytes: Buffer.concat(chunks, length) }) : reject(new Error('Incomplete thumbnail')));
        response.once('error', reject); response.once('aborted', () => reject(new Error('Incomplete thumbnail')));
      });
      request.once('error', reject);
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === 2 || !response.headers.location) throw new Error('Thumbnail redirect limit');
    url = new URL(response.headers.location, url).href;
    // Validation occurs before the next connection; identity cannot change.
  }
  throw new Error('Thumbnail redirect limit');
};

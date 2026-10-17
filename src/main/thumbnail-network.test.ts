import { afterEach, expect, it, vi } from 'vitest';
import https from 'node:https';
import dns from 'node:dns';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fetchThumbnail, isPublicImageAddress, thumbnailByteLimit } from './thumbnail-network';

const url = 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg';
afterEach(() => vi.restoreAllMocks());
function network(status: number, headers: object = {}, chunks: Buffer[] = [], complete = true) {
  return vi.spyOn(https, 'get').mockImplementation(((_url: string, _options: unknown, callback: (response: unknown) => void) => {
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = Object.assign(new PassThrough(), { statusCode: status, headers, complete });
      callback(response);
      for (const chunk of chunks) if (!response.destroyed) response.write(chunk);
      if (!response.destroyed) response.end();
    });
    return request;
  }) as unknown as typeof https.get);
}
it('rejects arbitrary URLs, unsafe redirects and wrong identities before connecting', async () => {
  const get = network(302, { location: 'https://127.0.0.1/private' });
  await expect(fetchThumbnail(url, 'abcdefghijk', {}, AbortSignal.timeout(1000))).rejects.toThrow('Unsafe'); expect(get).toHaveBeenCalledTimes(1);
  get.mockClear();
  for (const target of ['file:///private', url.replace('i.ytimg.com', 'evil.invalid'), url.replace('abcdefghijk', 'zzzzzzzzzzz')]) await expect(fetchThumbnail(target, 'abcdefghijk', {}, AbortSignal.timeout(1000))).rejects.toThrow('Unsafe');
  expect(get).not.toHaveBeenCalled();
});
it('bounds approved same-video redirects', async () => {
  const get = network(302, { location: url });
  await expect(fetchThumbnail(url, 'abcdefghijk', {}, AbortSignal.timeout(1000))).rejects.toThrow('redirect limit'); expect(get).toHaveBeenCalledTimes(3);
});
it.each(['declared', 'streamed', 'partial'])('rejects %s oversized or interrupted responses', async mode => {
  network(200, mode === 'declared' ? { 'content-length': String(thumbnailByteLimit + 1) } : {}, mode === 'streamed' ? [Buffer.alloc(thumbnailByteLimit), Buffer.alloc(1)] : [Buffer.from('partial')], mode !== 'partial');
  await expect(fetchThumbnail(url, 'abcdefghijk', {}, AbortSignal.timeout(1000))).rejects.toThrow();
});
it('uses only public DNS answers at connection time, without resolving arbitrary hosts', async () => {
  const get = network(304);
  expect((await fetchThumbnail(url, 'abcdefghijk', {}, AbortSignal.timeout(1000))).status).toBe(304);
  const options = get.mock.calls[0][1] as https.RequestOptions;
  const lookup = options.lookup as (host: string, options: object, callback: (error: Error | null, address: string, family: number) => void) => void;
  const resolved = vi.fn();
  vi.spyOn(dns, 'lookup').mockImplementation(((_host: string, _options: object, callback: (error: Error | null, address: string, family: number) => void) => callback(null, '127.0.0.1', 4)) as unknown as typeof dns.lookup);
  lookup('i.ytimg.com', {}, resolved); expect(resolved.mock.calls[0][0]).toBeInstanceOf(Error);
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', '100.64.1.1', '0.0.0.0', '::1', '::ffff:127.0.0.1']) expect(isPublicImageAddress(address)).toBe(false);
  expect(isPublicImageAddress('142.250.1.1')).toBe(true);
});

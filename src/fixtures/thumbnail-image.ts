import { crc32, deflateSync } from 'node:zlib';

/** Deterministic valid PNGs for offline cache and Electron decoder checks. */
export function thumbnailPng(width = 1280, height = 720, color = 80): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const named = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(named));
    return Buffer.concat([length, named, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, color);
  for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

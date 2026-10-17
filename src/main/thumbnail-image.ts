export interface ThumbnailImage { mime: string; extension: 'jpg' | 'png' | 'webp'; width: number; height: number }

/** Read bounded JPEG/PNG/WebP headers before decoding, limiting decompression
 * cost. SVG, GIF and arbitrary executable/document formats are excluded. */
export function thumbnailImage(bytes: Buffer, mime: string): ThumbnailImage | undefined {
  let width = 0, height = 0, extension: ThumbnailImage['extension'];
  if (mime === 'image/png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    extension = 'png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (mime === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    extension = 'jpg';
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (offset + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([192,193,194].includes(marker) && size >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break; }
      offset += size;
    }
  } else if (mime === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) {
    extension = 'webp';
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X' && !(bytes[20] & 2)) { width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3); }
    else if (type === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383; }
    else if (type === 'VP8L' && bytes[20] === 47) { const bits = bytes.readUInt32LE(21); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
  } else return undefined;
  // Missing maxres variants often return a 120x90 placeholder with HTTP 200.
  return width >= 320 && height >= 180 && width <= 8192 && height <= 8192 && width * height <= 20000000 ? { mime, extension, width, height } : undefined;
}

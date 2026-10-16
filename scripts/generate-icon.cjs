// Original, replaceable geometric discussion glyph. No external branding assets.
// PNG-compressed 32-bit ICO frames, supersampled for small Windows shell sizes.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function pixel(x, y) {
  const inside = x >= 12 && x <= 88 && y >= 12 && y <= 76
    && Math.hypot(Math.max(24 - x, 0, x - 76), Math.max(24 - y, 0, y - 64)) <= 12;
  const tail = y >= 68 && y <= 91 && x >= 24 && x <= 48 - (y - 68);
  if (!inside && !tail) return [0, 0, 0, 0];
  if (x >= 29 && x <= 71 && ((y >= 31 && y <= 37) || (y >= 49 && y <= 55))) return [244, 247, 251, 255];
  return [65, 86, 115, 255];
}
function png(size) {
  const data = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      const color = pixel((x + (dx + 0.5) / 4) * 100 / size, (y + (dy + 0.5) / 4) * 100 / size);
      for (let i = 0; i < 3; i++) sum[i] += color[i] * color[3] / 255;
      sum[3] += color[3];
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let i = 0; i < 3; i++) data[offset + i] = sum[3] ? Math.round(sum[i] * 255 / sum[3]) : 0;
    data[offset + 3] = Math.round(sum[3] / 16);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [16, 24, 32, 48, 64, 128, 256], frames = sizes.map(png);
const header = Buffer.alloc(6 + 16 * sizes.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const pos = 6 + index * 16; header[pos] = header[pos + 1] = size % 256;
  header.writeUInt16LE(1, pos + 4); header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(frames[index].length, pos + 8); header.writeUInt32LE(offset, pos + 12); offset += frames[index].length;
});
const directory = path.resolve(__dirname, '../assets'); fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'application.ico'), Buffer.concat([header, ...frames]));
fs.writeFileSync(path.join(directory, 'application.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#415673" d="M24 12h52a12 12 0 0 1 12 12v40a12 12 0 0 1-12 12H40L24 91V76a12 12 0 0 1-12-12V24a12 12 0 0 1 12-12Z"/><path fill="#f4f7fb" d="M29 31h42v6H29zM29 49h42v6H29z"/></svg>\n');

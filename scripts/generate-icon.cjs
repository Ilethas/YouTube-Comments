// Original overlapping conversation bubbles. No external branding assets.
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
// One geometry list supplies both SVG and raster output, so the two cannot drift.
const shapes = [
  { fill: '#36b6ab', rect: [34, 36, 60, 46, 13] },
  { fill: '#36b6ab', polygon: [[72, 75], [88, 75], [88, 94]] },
  // A pale rim separates the silhouettes against both light and dark surfaces.
  { fill: '#f4f7fb', rect: [6, 6, 76, 61, 17] },
  { fill: '#f4f7fb', polygon: [[17, 53], [44, 62], [17, 84]] },
  { fill: '#243e57', rect: [10, 10, 68, 53, 13] },
  { fill: '#243e57', polygon: [[21, 51], [43, 59], [21, 76]] },
  { fill: '#f4f7fb', rect: [24, 26, 40, 7, 3.5] },
  { fill: '#f4f7fb', rect: [24, 41, 28, 7, 3.5] },
];
function contains(shape, x, y) {
  if (shape.rect) {
    const [left, top, width, height, radius] = shape.rect;
    return x >= left && x <= left + width && y >= top && y <= top + height
      && Math.hypot(Math.max(left + radius - x, 0, x - left - width + radius),
        Math.max(top + radius - y, 0, y - top - height + radius)) <= radius;
  }
  let inside = false;
  const points = shape.polygon;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pixel(x, y) {
  const shape = shapes.findLast(shape => contains(shape, x, y));
  return shape ? [...Buffer.from(shape.fill.slice(1), 'hex'), 255] : [0, 0, 0, 0];
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
const svg = shapes.map(shape => {
  if (shape.rect) {
    const [x, y, width, height, radius] = shape.rect;
    return `  <rect fill="${shape.fill}" x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/>`;
  }
  return `  <polygon fill="${shape.fill}" points="${shape.polygon.map(point => point.join(',')).join(' ')}"/>`;
}).join('\n');
fs.writeFileSync(path.join(directory, 'application.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n${svg}\n</svg>\n`);
if (process.argv.includes('--preview')) {
  const preview = path.resolve(__dirname, '../.packaging-diagnostics/icons');
  fs.mkdirSync(preview, { recursive: true });
  sizes.forEach((size, index) => fs.writeFileSync(path.join(preview, `${size}.png`), frames[index]));
}

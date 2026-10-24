// Local README links, decoded screenshot data, and Windows icon frames.
// Visual quality still requires opening the images; this only detects broken assets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
let links = 0;
for (const match of read('README.md').matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
  if (/^https?:\/\//.test(match[1])) continue;
  const [relative, anchor] = match[1].split('#');
  const file = path.resolve(root, decodeURIComponent(relative));
  assert.ok(file.startsWith(root + path.sep), `Link outside repository: ${relative}`);
  assert.ok(fs.statSync(file).isFile(), `Missing README link: ${relative}`);
  if (anchor) {
    const headings = [...fs.readFileSync(file, 'utf8').matchAll(/^#{1,6} (.+)$/gm)]
      .map(heading => heading[1].trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-'));
    assert.ok(headings.includes(anchor), `Missing README anchor: ${match[1]}`);
  }
  links++;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(bytes, width, height) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const data = []; let channels, ended = false, sawHeader = false;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(offset + length + 12 <= bytes.length, 'Truncated PNG chunk');
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + length)), bytes.readUInt32BE(offset + 8 + length));
    if (type === 'IHDR') {
      assert.equal(sawHeader, false); sawHeader = true;
      assert.equal(payload.readUInt32BE(0), width); assert.equal(payload.readUInt32BE(4), height);
      assert.equal(payload[8], 8); assert.ok([2, 6].includes(payload[9]));
      assert.equal(payload[12], 0); channels = payload[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(payload);
    else if (type === 'IEND') { ended = true; assert.equal(offset + length + 12, bytes.length); }
    offset += length + 12;
  }
  assert.ok(sawHeader && ended && data.length);
  const decoded = zlib.inflateSync(Buffer.concat(data));
  assert.equal(decoded.length, (width * channels + 1) * height);
  for (let row = 0; row < height; row++) assert.ok(decoded[row * (width * channels + 1)] <= 4);
  assert.ok(new Set(decoded).size > 16, 'Image has no useful pixel variation');
}
const screenshots = { 'reader-light.png': [1360, 1000], 'search-dark.png': [1360, 880],
  'collapse-selection-light.png': [1360, 920], 'library-light.png': [1360, 680],
  'multi-window-light.png': [1848, 1000], 'move-tab-pl-dark.png': [1360, 880], 'downloads-light.png': [1360, 1000] };
const capture = JSON.parse(read('docs/screenshots/capture.json'));
assert.deepEqual(capture.files.map(entry => entry.file).sort(), Object.keys(screenshots).sort());
assert.match(capture.builtMainSha256, /^[a-f0-9]{64}$/);
assert.ok(Object.keys(capture.rendererAssetsSha256).some(name => /^index-.*\.js$/.test(name)));
for (const hash of Object.values(capture.rendererAssetsSha256)) assert.match(hash, /^[a-f0-9]{64}$/);
assert.match(capture.multiWindow, /Not physical drag evidence/);
for (const [name, [width, height]] of Object.entries(screenshots)) {
  const bytes = fs.readFileSync(path.join(root, 'docs/screenshots', name));
  assert.ok(bytes.length > 10000 && bytes.length < 1000000, 'Unexpected screenshot size');
  png(bytes, width, height);
  const entry = capture.files.find(file => file.file === name);
  assert.deepEqual([entry.width, entry.height], [width, height]);
  // Later additions keep their own build provenance without attributing older
  // unchanged screenshots to the latest application binary.
  const provenance = entry.provenance ?? capture;
  assert.match(provenance.builtMainSha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.keys(provenance.rendererAssetsSha256).some(asset => /^index-.*\.js$/.test(asset)));
  for (const hash of Object.values(provenance.rendererAssetsSha256)) assert.match(hash, /^[a-f0-9]{64}$/);
  if (name === 'downloads-light.png') {
    const downloads = provenance.downloads;
    assert.deepEqual([downloads.maximumConcurrentDownloads, downloads.active, downloads.queued], [3, 3, 5]);
    assert.equal(downloads.jobs.filter(job => job.state === 'fetching' && job.comments).length, 3);
    assert.equal(downloads.jobs.filter(job => job.state === 'queued').length, 5);
    assert.match(downloads.fixture, /real Node fixture helper processes/);
  }
}
const ico = fs.readFileSync(path.join(root, 'assets/application.ico'));
assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1);
const sizes = [16, 24, 32, 48, 64, 128, 256]; assert.equal(ico.readUInt16LE(4), sizes.length);
let end = 6 + 16 * sizes.length;
sizes.forEach((size, index) => {
  const pos = 6 + index * 16, length = ico.readUInt32LE(pos + 8), offset = ico.readUInt32LE(pos + 12);
  assert.equal(ico[pos] || 256, size); assert.equal(ico[pos + 1] || 256, size);
  assert.equal(ico.readUInt16LE(pos + 4), 1); assert.equal(ico.readUInt16LE(pos + 6), 32);
  assert.equal(offset, end); png(ico.subarray(offset, offset + length), size, size); end += length;
});
assert.equal(end, ico.length);
console.log(`PASS: ${links} local README links/anchors, ${Object.keys(screenshots).length} decoded screenshots with provenance, 7 CRC-checked 32-bit ICO frames`);

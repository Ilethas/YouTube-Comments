// Offline checks for the reviewed notice inventory, not a legal-compliance test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const manifest = require('../third-party/manifest.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function verifyMetadata(pkg = json(path.join(root, 'package.json')), lock = json(path.join(root, 'package-lock.json'))) {
  assert.equal(pkg.license, 'UNLICENSED', 'Original application must remain UNLICENSED');
  assert.equal(pkg.private, true, 'Original application must remain private');
  const locked = lock.packages[''];
  assert.equal(locked.license, 'UNLICENSED', 'Lockfile root must remain UNLICENSED');
  for (const field of ['name', 'version', 'dependencies', 'devDependencies', 'engines'])
    assert.deepEqual(pkg[field], locked[field], `Package/lockfile mismatch: ${field}`);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
}

function verifyNotices(directory) {
  verifyMetadata();
  const noticeDirectory = path.join(directory, 'resources');
  const index = fs.readFileSync(path.join(noticeDirectory, 'THIRD_PARTY_NOTICES.md'));
  assert.deepEqual(index, fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md')), 'Notice index differs');
  const indexText = index.toString('utf8');
  const expectedFiles = ['manifest.json', ...manifest.packages.map(entry => entry.file), ...Object.keys(manifest.additionalFiles)].sort();
  assert.deepEqual(fs.readdirSync(path.join(noticeDirectory, 'third-party')).sort(), expectedFiles, 'Incomplete/unreviewed notice inventory');
  assert.deepEqual(fs.readFileSync(path.join(noticeDirectory, 'third-party/manifest.json')),
    fs.readFileSync(path.join(root, 'third-party/manifest.json')), 'Notice manifest differs');
  const files = Object.fromEntries([...manifest.packages.map(entry => [entry.file, entry.sha256]), ...Object.entries(manifest.additionalFiles)]);
  for (const [file, expectedHash] of Object.entries(files)) {
    assert.equal(hash(fs.readFileSync(path.join(root, 'third-party', file))), expectedHash, `Repository notice changed: ${file}`);
    assert.equal(hash(fs.readFileSync(path.join(noticeDirectory, 'third-party', file))), expectedHash, `Packaged notice missing/incomplete: ${file}`);
    assert.ok(indexText.includes(`third-party/${file}`), `Index missing packaged notice location: ${file}`);
  }
  const lock = json(path.join(root, 'package-lock.json'));
  for (const entry of manifest.packages) {
    const key = `node_modules/${entry.packagePath}`;
    assert.equal(lock.packages[key]?.version, entry.version, `Re-audit changed dependency: ${entry.name}`);
    assert.equal(lock.packages[key]?.license, entry.license, `Re-audit changed license: ${entry.name}`);
    assert.ok(indexText.includes(entry.version) && indexText.includes(entry.name), `Index missing component/version: ${entry.name}`);
    let original = fs.readFileSync(path.join(root, key, entry.upstreamFile));
    if (entry.section) original = original.subarray(0, original.indexOf('# Licenses of bundled dependencies'));
    assert.equal(hash(original), entry.sha256, `Upstream notice changed: ${entry.name}`);
  }
  assert.equal(lock.packages['node_modules/electron'].version, manifest.electron.version);
  for (const [file, expectedHash] of Object.entries(manifest.electron.files)) {
    assert.equal(hash(fs.readFileSync(path.join(directory, file))), expectedHash, `Electron notice missing/incomplete: ${file}`);
    assert.ok(indexText.includes(`../${file}`), `Index missing runtime notice location: ${file}`);
  }
  const archive = path.join(directory, 'resources/app.asar');
  const read = file => asar.extractFile(archive, path.normalize(file)).toString('utf8');
  const packaged = JSON.parse(read('package.json'));
  assert.equal(packaged.license, 'UNLICENSED', 'Packaged original application must remain UNLICENSED');
  assert.equal(packaged.private, true);
  for (const field of ['name', 'version', 'dependencies', 'devDependencies', 'engines'])
    assert.deepEqual(packaged[field], json(path.join(root, 'package.json'))[field], `Packaged metadata mismatch: ${field}`);
  const observed = new Set();
  for (const file of ['.vite/build/third-party-main.json', '.vite/build/third-party-preload.json',
    '.vite/renderer/main_window/third-party-renderer.json', '.vite/renderer/main_window/third-party-worker.json']) {
    const inputs = JSON.parse(read(file));
    for (const entry of inputs.packages) {
      assert.ok(entry.modules.length, 'Empty bundle input');
      observed.add(`${entry.name}@${entry.version}`);
    }
    for (const id of inputs.generated) assert.ok(['commonjsHelpers.js', 'vite/modulepreload-polyfill.js'].includes(id), `Review new generated helper: ${id}`);
  }
  assert.deepEqual([...observed].sort(), manifest.packages.filter(entry => entry.name !== 'vite')
    .map(entry => `${entry.name}@${entry.version}`).sort(), 'Bundled dependency inventory changed; review notices');
  return { license: 'UNLICENSED', bundledPackages: observed.size, noticeFiles: expectedFiles.length,
    index: 'resources/THIRD_PARTY_NOTICES.md', legalCompliance: 'requires human review' };
}

function verifySquirrelVendor() {
  assert.equal(json(path.join(root, 'node_modules/electron-winstaller/package.json')).version, manifest.squirrelVendor.version);
  for (const [file, expectedHash] of Object.entries(manifest.squirrelVendor.files))
    assert.equal(hash(fs.readFileSync(path.join(root, 'node_modules/electron-winstaller/vendor', file))), expectedHash, `Squirrel vendor changed; re-audit ${file}`);
}
module.exports = { verifyMetadata, verifyNotices, verifySquirrelVendor };
if (require.main === module) {
  try {
    if (process.argv.includes('--metadata-only')) { verifyMetadata(); console.log('PASS: private UNLICENSED package/lockfile metadata'); }
    else console.log(JSON.stringify(verifyNotices(path.resolve(process.argv[2] || path.join(root, 'out/youtube-comments-win32-x64'))), null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
}

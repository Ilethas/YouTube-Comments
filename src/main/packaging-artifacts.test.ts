import { afterAll, afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { verifyPackage, verifyZip } from '../../scripts/verify-artifacts.cjs';

// Exercise missing, empty, incomplete and changed output independently of Forge.
// The installed maker's own ZIP utility produces test archives on Windows.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-artifact-check-'));
afterEach(() => {
  for (const name of fs.readdirSync(directory)) {
    const target=path.resolve(directory,name);
    if (!target.startsWith(directory+path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(target,{recursive:true,force:true});
  }
});
afterAll(() => fs.rmdirSync(directory));
it('rejects absent and executable-only package output', async () => {
  await expect(verifyPackage(path.join(directory,'missing'))).rejects.toThrow();
  const executable=Buffer.alloc(1000001);
  executable.write('MZ'); executable.writeUInt32LE(0x80,0x3c); executable.writeUInt16LE(0x8664,0x84);
  fs.writeFileSync(path.join(directory,'youtube-comments.exe'),executable);
  await expect(verifyPackage(directory)).rejects.toThrow(/resources/);
});
it('rejects missing and empty ZIP output', async () => {
  await expect(verifyZip(path.join(directory,'missing.zip'),directory)).rejects.toThrow();
  fs.writeFileSync(path.join(directory,'empty.zip'),'');
  await expect(verifyZip(path.join(directory,'empty.zip'),directory)).rejects.toThrow();
});
it.skipIf(process.platform !== 'win32')('checks every ZIP entry against the complete application folder', async () => {
  const folder=path.join(directory,'app'); fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder,'youtube-comments.exe'),randomBytes(1100000));
  fs.mkdirSync(path.join(folder,'resources'));
  fs.writeFileSync(path.join(folder,'resources/app.asar'),'fixture archive');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crossZip = require(require.resolve('cross-zip', {paths:[path.dirname(require.resolve('@electron-forge/maker-zip/package.json'))]}));
  const zip=path.join(directory,'app.zip');
  await promisify(crossZip.zip)(folder,zip);
  await expect(verifyZip(zip,folder)).resolves.toHaveProperty('archive',zip);
  fs.writeFileSync(path.join(folder,'resources/app.asar'),'changed archive');
  await expect(verifyZip(zip,folder)).rejects.toThrow(/ZIP bytes differ/);
  fs.writeFileSync(path.join(folder,'resources/app.asar'),'fixture archive');
  fs.writeFileSync(path.join(folder,'missing-runtime.dll'),'not in ZIP');
  await expect(verifyZip(zip,folder)).rejects.toThrow(/missing application files/);
});

import { afterAll, afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { verifyPackage, verifyZip, verifySquirrel, verifyPE, verifyReleases, verifyNuspec } from '../../scripts/verify-artifacts.cjs';
import { selectedMakers } from '../../scripts/forge-verified.cjs';
import metadata from '../../package.json';
import identity from '../shared/application-identity.json';
import forge from '../../forge.config';

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
  await expect(verifyPackage(directory)).rejects.toThrow(/PE/);
});
it('requires explicit supported makers before cleanup or Forge execution', () => {
  expect(selectedMakers('make', ['--targets=@electron-forge/maker-squirrel'])).toEqual(['@electron-forge/maker-squirrel']);
  expect(selectedMakers('make', ['--targets=@electron-forge/maker-zip'])).toEqual(['@electron-forge/maker-zip']);
  for (const args of [[], ['--targets=unknown'], ['--skip-package'], ['--out=elsewhere'], ['--targets=@electron-forge/maker-zip', '--targets=@electron-forge/maker-squirrel']])
    expect(() => selectedMakers('make', args)).toThrow();
});
it('resolves selected Forge module names to the configured identity rather than maker defaults', () => {
  const maker = forge.makers?.find(maker => 'name' in maker && maker.name === '@electron-forge/maker-squirrel');
  if (!maker || !('config' in maker)) throw new Error('Configured resolvable Squirrel maker missing');
  expect(maker.config).toMatchObject({ name: identity.squirrelPackageId, title: identity.displayName,
    exe: identity.executableName + '.exe', setupExe: 'Setup.exe', noMsi: true, noDelta: true });
  expect(forge.packagerConfig).toMatchObject({ name: identity.packageName, executableName: identity.executableName, asar: true });
  expect(metadata.name).toBe(identity.packageName);
  expect(metadata.productName).toBe(identity.displayName);
  expect(identity.appUserModelId).toBe(`com.squirrel.${identity.squirrelPackageId}.${identity.executableName}`);
});
it('rejects incomplete installer output, invalid PE signatures, sections and architecture', async () => {
  await expect(verifySquirrel(directory, directory)).rejects.toThrow();
  fs.writeFileSync(path.join(directory, 'Setup.exe'), Buffer.alloc(1000001));
  await expect(verifySquirrel(directory, directory)).rejects.toThrow(/nupkg/);
  const bytes = Buffer.alloc(512); bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c);
  expect(() => verifyPE(bytes, 0x14c)).toThrow(/signature/);
  bytes.write('PE\0\0', 64); bytes.writeUInt16LE(0x14c, 68);
  expect(() => verifyPE(bytes, 0x8664)).toThrow(/architecture/);
  bytes.writeUInt16LE(1, 70); bytes.writeUInt16LE(96, 84);
  bytes.writeUInt32LE(1000, 64 + 24 + 96 + 16);
  expect(() => verifyPE(bytes, 0x14c)).toThrow(/section data/);
});
it('binds RELEASES to the exact local full package identity, size and hash', () => {
  const bytes = Buffer.from('fixture'), hash = createHash('sha1').update(bytes).digest('hex');
  const line = `${hash} ${identity.squirrelPackageId}-${metadata.version}-full.nupkg ${bytes.length}`;
  expect(() => verifyReleases(line, bytes)).not.toThrow();
  for (const changed of [line.replace(hash, '0'.repeat(40)), line.replace('full', 'delta'), line + '\n' + line, line.replace(/\d+$/, '999')])
    expect(() => verifyReleases(changed, bytes)).toThrow();
});
it('requires coherent NuGet metadata without remote branding or malformed XML', () => {
  const spec = `<package><metadata><id>${identity.squirrelPackageId}</id><title>${identity.displayName}</title><version>${metadata.version}</version><authors>${metadata.author.name}</authors><description>${metadata.description}</description></metadata></package>`;
  expect(() => verifyNuspec(Buffer.from(spec))).not.toThrow();
  for (const changed of [spec.replace(identity.squirrelPackageId, 'different'), spec.replace(metadata.version, '9.9.9'), spec.replace('</metadata>', '<iconUrl>https://example.com/icon.ico</iconUrl></metadata>'), spec + '<broken>', '<!DOCTYPE package>' + spec])
    expect(() => verifyNuspec(Buffer.from(changed))).toThrow();
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

// A pending promise can let an old Forge dependency exit zero without an artifact.
// Remove only this target's previous output, then check real fresh output in a parent.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { verifyPackage, verifyZip, verifySquirrel, packageDirectory, zipFile, squirrelDirectory } = require('./verify-artifacts.cjs');
function selectedMakers(command, args) {
  for (const arg of args) if (!['--platform=win32', '--arch=x64'].includes(arg) && !arg.startsWith('--targets='))
    throw new Error(`Unsupported verified-build argument: ${arg}`);
  const targets = args.filter(arg => arg.startsWith('--targets='));
  if (command === 'package') { if (targets.length) throw new Error('package takes no maker target'); return []; }
  if (targets.length !== 1) throw new Error('Select --targets=@electron-forge/maker-zip or --targets=@electron-forge/maker-squirrel explicitly');
  const makers = targets[0].slice('--targets='.length).split(',');
  if (new Set(makers).size !== makers.length || makers.some(maker => !['@electron-forge/maker-zip', '@electron-forge/maker-squirrel'].includes(maker)))
    throw new Error('Only Windows ZIP/Squirrel makers are verified');
  return makers;
}
async function run() {
  const [command, ...args] = process.argv.slice(2);
  if (!['package', 'make'].includes(command)) throw new Error('Expected package or make');
  const makers = selectedMakers(command, args);
  if (process.platform !== 'win32' || args.some(arg => /^(--platform|--arch)(=|$)/.test(arg)
    && !['--platform=win32', '--arch=x64'].includes(arg))) throw new Error('Verified distribution targets Windows x64; use --platform=win32 --arch=x64');
  const out = path.resolve(__dirname, '../out');
  for (const target of [packageDirectory, ...(makers.includes('@electron-forge/maker-zip') ? [zipFile] : []),
    ...(makers.includes('@electron-forge/maker-squirrel') ? [squirrelDirectory] : [])]) {
    if (!path.resolve(target).startsWith(out + path.sep)) throw new Error('Output cleanup escaped out/');
    fs.rmSync(target, { recursive: true, force: true });
  }
  const started = performance.now();
  const cli = path.join(path.dirname(require.resolve('@electron-forge/cli/package.json')), 'dist/electron-forge.js');
  const child = spawn(process.execPath, [cli, command, ...args], { stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  if (code !== 0) throw new Error(`Forge ${command} exited ${code}`);
  console.log(JSON.stringify(await verifyPackage()));
  if (makers.includes('@electron-forge/maker-zip')) console.log(JSON.stringify(await verifyZip()));
  if (makers.includes('@electron-forge/maker-squirrel')) console.log(JSON.stringify(await verifySquirrel()));
  console.log(`Verified Forge ${command}: ${((performance.now() - started) / 1000).toFixed(2)} s`);
}
module.exports = { selectedMakers };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });

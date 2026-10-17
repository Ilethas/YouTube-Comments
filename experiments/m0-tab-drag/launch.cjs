'use strict';
// Run with host Node, not the production package entry. No build required.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
if (args.some(a => a !== '--smoke')) throw new Error('Only --smoke is supported');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-comments-m0-'));
fs.writeFileSync(path.join(root, 'm0-owned.json'), JSON.stringify({ purpose: 'M0 fake tab experiment', createdBy: process.pid }));
console.log(`M0 disposable run: ${root}\nEvidence: ${path.join(root, 'events.ndjson')}`);
const env = { ...process.env, YOUTUBE_COMMENTS_M0_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, 'main.cjs'), ...args], { env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  console.log(`M0 exited: ${code ?? signal}. Only this disposable run directory was used; retained for evidence.`);
  process.exitCode = code ?? 1;
});

// Owner-operated physical input launcher. All data and ledgers stay in an owned
// OS-temp directory; resume only a marked directory created by this launcher.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
function validate(root) {
  assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('reader-m8-manual-'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'm8-owned.json'))).purpose, 'M8 physical drag verification');
}
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, BrowserWindow, Menu, screen, ipcMain } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT; validate(root);
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); app.setPath(name, dir); }
  const log = value => fs.appendFileSync(path.join(root, 'native-evidence.ndjson'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    const result = await handler(event, ...args);
    if (channel.startsWith('reader:transfer-')) log({ kind: 'ipc-result', channel, nativeWindow: BrowserWindow.fromWebContents(event.sender)?.id, ok: result?.ok, error: result?.error?.code });
    return result;
  });
  app.on('browser-window-created', (_event, window) => {
    for (const kind of ['show', 'hide', 'minimize', 'restore', 'focus', 'blur', 'closed']) window.on(kind, () => log({ kind, nativeWindow: window.id }));
    window.webContents.on('render-process-gone', () => log({ kind: 'renderer-lost', nativeWindow: window.id }));
  });
  app.whenReady().then(async () => {
    log({ kind: 'runtime', electron: process.versions.electron, chromium: process.versions.chrome, os: os.release(), displays: screen.getAllDisplays().map(d => ({ id: d.id, workArea: d.workArea, scaleFactor: d.scaleFactor })) });
    if (process.env.M8_MANUAL_FRESH === '1') {
      for (let n = 0; n < 1000; n++) {
        const windows = BrowserWindow.getAllWindows();
        if (windows[0]?.isVisible()) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      for (let n = 0; n < 2; n++) Menu.getApplicationMenu().getMenuItemById('new-reader-window').click();
    }
  });
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  const resume = process.argv[2] === '--resume' ? path.resolve(process.argv[3] ?? '') : undefined;
  const root = resume ?? fs.mkdtempSync(path.join(os.tmpdir(), 'reader-m8-manual-'));
  if (!resume) fs.writeFileSync(path.join(root, 'm8-owned.json'), JSON.stringify({ purpose: 'M8 physical drag verification' }));
  validate(root);
  console.log('M8 manual disposable profile and evidence:', root);
  console.log('Resume after Quit:', 'node scripts/manual-tab-drag.cjs --resume "' + root + '"');
  console.log('No physical gestures are automated. See docs/M8_MANUAL_VERIFICATION.md.');
  const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, M8_MANUAL_FRESH: resume ? '0' : '1' }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  child.once('error', error => { console.error(error); process.exitCode = 1; }); child.once('exit', code => { process.exitCode = code ?? 1; });
}

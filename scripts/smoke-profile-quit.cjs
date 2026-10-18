// M3 built-production-entry Quit ordering. Disposable development profile only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
if (process.versions.electron) {
  const { app, ipcMain } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m3-quit-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
  }
  const watchdog = setTimeout(() => { console.error('M3 Quit timeout'); app.exit(1); }, 60000);
  const fail = error => { console.error(error); app.exit(1); };
  process.on('uncaughtException', fail);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let release, count = 0, verified = false, closed = false, drains = 0;
  const { DatabaseSync } = require('node:sqlite'), close = DatabaseSync.prototype.close;
  DatabaseSync.prototype.close = function () { closed = true; return close.call(this); };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    const result = await handler(event, ...args);
    if (channel === 'reader:profile-drain' && ++drains === 1) await new Promise(resolve => { release = resolve; });
    return result;
  });
  app.on('browser-window-created', (_event, window) => {
    assert.equal(++count, 1, 'production creates one reader');
    window.hide(); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => void (async () => {
      const js = code => window.webContents.executeJavaScript(code);
      async function wait(condition, label) { for (let n = 0; n < 1000; n++) { if (await condition()) return; await pause(10); } throw new Error(label); }
      await wait(() => js("!!document.querySelector('.app-shell') && !!document.querySelector('.comment')"), 'App ready');
      await js("const e=document.querySelector('.query-controls input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'quit-pending');e.dispatchEvent(new Event('input',{bubbles:true}));void 0");
      closed = false;
      app.quit(); app.quit();
      await wait(() => !!release, 'Quit waiting on final checkpoint');
      assert.equal(window.isDestroyed(), false); assert.equal(closed, false, 'SQLite stays open until renderer drain');
      assert.equal(await js("document.querySelector('.app-shell').inert"), true);
      verified = true; release();
    })().catch(fail));
  });
  app.on('will-quit', () => {
    assert.equal(verified, true); assert.equal(closed, true); clearTimeout(watchdog);
    console.log('M3 built-entry Quit PASS: repeated explicit Quit joins one global drain; pending UI draft commits before SQLite closes; exactly one production reader.');
  });
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-m3-quit-'));
    try {
      const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('M3 Quit exited '+code))); });
      const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(path.join(root, 'youtube-comments-development', 'reader.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
        const row = db.prepare('SELECT draft_query_json FROM discussion_view_state WHERE item_id=?').get('video-demo');
        assert.equal(JSON.parse(row.draft_query_json).text, 'quit-pending');
        assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      } finally { db.close(); }
    } finally {
      assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m3-quit-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

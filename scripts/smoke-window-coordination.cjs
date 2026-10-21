// M1 only: disposable real Electron lifetimes + the unchanged built reader entry.
// Test-only windows/instrumentation never ship or expose another renderer API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const entry = path.resolve(__dirname, '../.vite/build/main.js');
const preload = path.resolve(__dirname, '../.vite/build/preload.js');

if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, BrowserWindow, ipcMain, dialog } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.M1_SMOKE_PHASE;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m1-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
  }
  const watchdog = setTimeout(() => { console.error(`M1 ${phase} timed out`); app.exit(1); }, 60000);
  app.on('will-quit', () => clearTimeout(watchdog));
  const fail = error => { console.error(error); app.exit(1); };
  process.on('uncaughtException', fail);
  const handlers = new Map(), events = new Map();
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    assert.equal(handlers.has(channel), false, `channel registered once: ${channel}`);
    handlers.set(channel, listener);
    handle(channel, (event, ...args) => { events.set(event.sender, event); return listener(event, ...args); });
  };
  app.on('browser-window-created', (_event, window) => { window.hide(); window.webContents.setBackgroundThrottling(false); });
  async function wait(expression, label) {
    for (let i = 0; i < 500; i++) { if (await expression()) return; await pause(20); }
    throw new Error(`Timed out: ${label}`);
  }
  const loaded = window => new Promise((resolve, reject) => {
    window.webContents.once('did-finish-load', resolve); window.webContents.once('did-fail-load', (_e, code, text) => reject(new Error(`${code} ${text}`)));
  });
  if (phase === 'reader') {
    let count = 0, verified = false, repositoryClosed = false;
    const { DatabaseSync } = require('node:sqlite'), close = DatabaseSync.prototype.close;
    DatabaseSync.prototype.close = function () { repositoryClosed = true; return close.call(this); };
    app.on('will-quit', () => {
      assert.equal(verified, true); assert.equal(repositoryClosed, true, 'normal quit awaited repository shutdown');
      console.log('M1 built-entry PASS: exactly one normal reader, reload/persistence, popup/navigation denial, last-window shutdown; schema 16, isolated demo root.');
    });
    app.on('browser-window-created', (_event, window) => {
      assert.equal(++count, 1, 'production startup creates one reader only');
      window.webContents.once('did-finish-load', () => void (async () => {
        const js = code => window.webContents.executeJavaScript(code);
        await wait(() => js("!!document.querySelector('.app-shell') && !!document.querySelector('.comment')"), 'normal reader');
        assert.equal(BrowserWindow.getAllWindows().length, 1);
        const preferences = window.webContents.getLastWebPreferences();
        assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
        const boot = await js('window.reader.bootstrap()'); assert.equal(boot.ok, true); assert.equal(boot.value.items.length, 2);
        const seen = await js("window.reader.toggleSeen({itemId:'video-demo',commentId:'v1',subtree:false,seen:false})"); assert.equal(seen.ok, true);
        const after = await js('window.reader.bootstrap()');
        const ready = loaded(window); window.webContents.reload(); await ready;
        await wait(() => js("!!document.querySelector('.app-shell')"), 'reloaded reader');
        assert.deepEqual((await js('window.reader.bootstrap()')).value, after.value);
        assert.deepEqual(await js("window.reader.toggleSeen({itemId:'video-demo',commentId:'v1',subtree:false,seen:false,windowId:'forged'})"), { ok: false, error: { code: 'INVALID_REQUEST' } });
        const expected = window.webContents.getURL();
        await js("window.open('https://example.invalid'); location.href='https://example.invalid'; void 0");
        await pause(100); assert.equal(window.webContents.getURL(), expected); assert.equal(BrowserWindow.getAllWindows().length, 1);
        repositoryClosed = false; verified = true;
        window.close(); // Exercise real window-all-closed -> before-quit -> shutdown.
      })().catch(fail));
    });
    require(entry);
  } else {
    const { WindowCoordinator, registerReaderIpc, createApplicationWindow, createHelperPicker, createDataBackupDialogs, readerChannels } = require(path.join(root, 'tools.cjs'));
    app.whenReady().then(async () => {
      const url = pathToFileURL(path.join(root, 'trusted.html')).href;
      const windows = new WindowCoordinator(url, preload), callers = new Map();
      const picker = createHelperPicker(caller => windows.originWindow(caller));
      const dialogs = createDataBackupDialogs(caller => windows.originWindow(caller));
      registerReaderIpc({ dispatch(operation, args, caller) {
        callers.set(caller.windowId, caller);
        if (operation === 'chooseHelper') return picker(args[0].kind, caller).then(value => ({ ok: true, value: value ?? null }));
        return { ok: true, value: { windowId: caller.windowId, rendererLease: caller.rendererLease } };
      } }, windows);
      const a = windows.createReaderWindow(), b = windows.createReaderWindow();
      const stranger = createApplicationWindow(preload);
      const strangerReady = loaded(stranger); void stranger.loadURL(url);
      await Promise.all([loaded(a), loaded(b), strangerReady]);
      const js = (window, code = 'window.reader.bootstrap()') => window.webContents.executeJavaScript(code);
      const first = await js(a), second = await js(b);
      assert.equal(first.ok, true); assert.equal(second.ok, true); assert.notEqual(first.value.windowId, second.value.windowId);
      const forbidden = { ok: false, error: { code: 'FORBIDDEN' } };
      assert.deepEqual(await js(stranger), forbidden, 'right URL and real preload without registration denied');
      const oldEvent = events.get(a.webContents), caller = callers.get(first.value.windowId);
      await js(a, "const child=document.createElement('iframe');child.srcdoc='<p>subframe</p>';document.body.append(child);void 0");
      await wait(() => a.webContents.mainFrame.frames.length === 1, 'real child frame');
      for (const channel of [...Object.values(readerChannels), 'reader:window-new', 'reader:application-quit']) {
        assert.deepEqual(await handlers.get(channel)({ sender: a.webContents, senderFrame: a.webContents.mainFrame.frames[0] }), forbidden);
        assert.deepEqual(await handlers.get(channel)({ sender: stranger.webContents, senderFrame: stranger.webContents.mainFrame }), forbidden);
      }
      const reloaded = loaded(a); a.webContents.reload(); await reloaded;
      const fresh = await js(a); assert.equal(fresh.value.windowId, first.value.windowId); assert.notEqual(fresh.value.rendererLease, first.value.rendererLease);
      assert.equal(caller.isCurrent(), false); assert.equal(windows.originWindow(caller), undefined);
      assert.deepEqual(await handlers.get(readerChannels.bootstrap)(oldEvent), forbidden, 'stale real Electron event denied');
      assert.equal(handlers.size, Object.keys(readerChannels).length + 4);
      let finish;
      dialog.showSaveDialog = (owner) => { assert.equal(owner, a); return new Promise(resolve => { finish = resolve; }); };
      const save = dialogs.save('en', callers.get(fresh.value.windowId));
      const ready = loaded(a); a.webContents.reload(); await ready;
      finish({ canceled: false, filePath: path.join(root, 'must-not-be-used.sqlite') }); assert.equal(await save, undefined);
      await js(a); const acceptedEvent = events.get(a.webContents);
      dialog.showOpenDialog = owner => { assert.equal(owner, a); return new Promise(resolve => { finish = resolve; }); };
      const choose = handlers.get(readerChannels.chooseHelper)(acceptedEvent, { kind: 'yt-dlp' });
      a.destroy(); finish({ canceled: false, filePaths: [path.join(root, 'ignored.exe')] });
      assert.deepEqual(await choose, { ok: true, value: null });
      assert.deepEqual(await handlers.get(readerChannels.bootstrap)(acceptedEvent), forbidden);
      assert.equal((await js(b)).ok, true, 'surviving registered peer retains its own authority');
      const peerCaller = callers.get(second.value.windowId), peerEvent = events.get(b.webContents);
      const gone = new Promise(resolve => b.webContents.once('render-process-gone', resolve));
      b.webContents.forcefullyCrashRenderer(); await gone;
      assert.equal(peerCaller.isCurrent(), false);
      assert.deepEqual(await handlers.get(readerChannels.bootstrap)(peerEvent), forbidden);
      const recovered = loaded(b); b.webContents.reload(); await recovered;
      const recoveredPeer = await js(b);
      assert.equal(recoveredPeer.value.windowId, second.value.windowId);
      assert.notEqual(recoveredPeer.value.rendererLease, second.value.rendererLease);
      // Programmatic main navigation bypasses will-navigate, but never the registry.
      const navigated = loaded(b); void b.loadURL('about:blank'); await navigated;
      assert.deepEqual(await handlers.get(readerChannels.bootstrap)({ sender: b.webContents, senderFrame: b.webContents.mainFrame }), forbidden);
      b.destroy(); stranger.destroy(); assert.equal(windows.size, 0);
      console.log('M1 coordinator PASS: real registered/unregistered windows, all-channel subframe rejection, stale event/reload/crash recovery, native dialog origin/death, navigation/destruction, one registration per channel.');
      app.quit();
    }).catch(fail);
  }
} else {
  (async () => {
    assert.ok(fs.existsSync(entry), 'Build the Forge application first');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-m1-'));
    try {
      fs.writeFileSync(path.join(root, 'trusted.html'), '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; frame-src about:"><title>M1 disposable security fixture</title>');
      const exports = ['window-coordinator:WindowCoordinator', 'reader-ipc:registerReaderIpc', 'application-window:createApplicationWindow', 'helper-picker:createHelperPicker', 'data-backup-dialogs:createDataBackupDialogs'];
      const contents = exports.map(value => { const [file, name] = value.split(':'); return `export {${name}} from ${JSON.stringify(path.resolve(__dirname, '../src/main', file + '.ts'))};`; }).join('\n')
        + `\nexport {readerChannels} from ${JSON.stringify(path.resolve(__dirname, '../src/shared/reader-api.ts'))};`;
      require('esbuild').buildSync({ stdin: { contents, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'tools.cjs') });
      console.log(`M1 disposable root: ${root}`);
      for (const phase of ['coordinator', 'reader']) {
        const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, M1_SMOKE_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`M1 ${phase} exited ${code}`))); });
      }
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(path.join(root, 'youtube-comments-development', 'reader.sqlite'), { readOnly: true });
      try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 16); assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
      finally { db.close(); }
    } finally {
      assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m1-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

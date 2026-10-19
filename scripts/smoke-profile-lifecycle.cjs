const { tabElement, viewId, seedPeerIdentity } = require('./window-view-fixtures.cjs');
// M3: real secured App/preload/IPC participants, one disposable SQLite authority.
// Dialog answers and deterministic stalls/failures are main-only test injection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const preload = path.resolve(__dirname, '../.vite/build/preload.js');
const page = path.resolve(__dirname, '../.vite/renderer/main_window/index.html');

if (process.versions.electron) {
  const { app, ipcMain } = require('electron');
  const root = process.env.M3_SMOKE_ROOT;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m3-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
  }
  const { WindowCoordinator, ReaderService, ReaderRepository } = require(path.join(root, 'tools.cjs'));
  const { registerReaderIpc } = require(path.join(root, 'tools.cjs'));
  const watchdog = setTimeout(() => { console.error('M3 lifecycle timeout'); app.exit(1); }, 120000);
  const fail = error => { console.error(error); app.exit(1); };
  process.on('uncaughtException', fail);
  const handlers = new Map(), senders = new Map();
  let delayChannel, delayContents, releaseReply, commandCount = 0, stagedCount = 0, drainedUndos = 0;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => {
    handlers.set(channel, handler);
    handle(channel, async (event, ...args) => {
      senders.set(event.sender, event);
      const result = await handler(event, ...args);
      if (channel === 'reader:profile-drain') commandCount++;
      if (channel === 'reader:profile-stage' && result.ok) stagedCount++;
      if (channel === 'reader:profile-drain' && args[2]?.kind === 'undoSeen' && result.ok) drainedUndos++;
      if (channel === delayChannel && event.sender === delayContents) {
        delayChannel = undefined;
        await new Promise(resolve => { releaseReply = resolve; });
      }
      return result;
    });
  };
  app.on('browser-window-created', (_event, window) => { window.hide(); window.webContents.setBackgroundThrottling(false); });
  async function wait(condition, label) {
    for (let n = 0; n < 1200; n++) { if (await condition()) return; await pause(10); }
    throw new Error('M3 timeout: ' + label);
  }
  app.whenReady().then(async () => {
    const file = path.join(root, 'profile', 'reader.sqlite'), snapshot = path.join(root, 'snapshot.sqlite');
    const repository = ReaderRepository.open(file); repository.initializeDemo();
    const windows = new WindowCoordinator(pathToFileURL(page).href, preload);
    let restart = false, choose, confirm = true, saveCount = 0, safetyReached, continueSafety;
    const dialogs = {
      save: async () => { saveCount++; return choose ? await new Promise(resolve => { choose = resolve; }) : saveCount === 1 ? snapshot : path.join(root, `snapshot-${saveCount}.sqlite`); },
      select: async () => snapshot,
      confirm: async () => confirm,
    };
    const diagnostics = [];
    const service = new ReaderService(() => repository, ['en'], error => diagnostics.push(String(error)), undefined, {}, undefined,
      value => windows.sendAcquisitionProgress(value), { databasePath: file, dialogs, restart: () => { restart = true; }, checkpoint: async phase => {
        if (phase === 'safety' && safetyReached) { safetyReached(); await new Promise(resolve => { continueSafety = resolve; }); }
      } });
    const lifecycle = registerReaderIpc(service, windows);
    seedPeerIdentity(windows, repository);
    const js = (window, code) => window.webContents.executeJavaScript(code);
    const invoke = async (window, method, payload) => {
      if (['openStoredItem','activateTab','closeTab','moveTab','openLibrary','openSettings'].includes(method)) {
        const state = (await js(window, 'window.reader.bootstrap()')).value;
        payload = { ...payload, expectedRevision: state.workspace.revision };
      }
      return js(window, `window.reader.${method}(${payload === undefined ? '' : JSON.stringify(payload)})`);
    };
    const ready = window => wait(() => js(window, "!!document.querySelector('.app-shell') && !!document.querySelector('.comment')"), 'App ready');
    const released = () => wait(async () => lifecycle.phase === 'RELEASED' && windows.participants().every(c => !lifecycle.blocks(c)), 'reconciled release');
    const edit = (window, id, text) => js(window, `(() => {const e=document.querySelector('[data-item-id=${id}] input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const a = windows.createReaderWindow(); let b = windows.createReaderWindow();
    await Promise.all([ready(a), ready(b)]);
    const callerA = windows.participants().find(c => windows.originWindow(c) === a);
    assert.ok(callerA);
    // Mount separate owned views and retain independent semantic checkpoints.
    await invoke(a, 'activateTab', { tabId: viewId((await invoke(a, 'bootstrap')).value, 'post-demo') });
    await wait(() => js(b, "!!document.querySelector('[data-item-id=video-demo] input[type=search]')"), 'independent video session');
    await invoke(a, 'activateTab', { tabId: viewId((await invoke(a, 'bootstrap')).value, 'video-demo') });
    await edit(a, 'video-demo', 'pending-A'); await edit(b, 'video-demo', 'pending-B');
    delayChannel = 'reader:toggle-seen'; delayContents = b.webContents;
    const seen = invoke(b, 'toggleSeen', { itemId: 'video-demo', commentId: 'v3', subtree: false, seen: true });
    await wait(() => !!releaseReply, 'slow accepted save');
    const backup = invoke(a, 'createBackup');
    await wait(() => lifecycle.phase === 'DRAINING' && commandCount > 0, 'first participant drained');
    assert.equal(saveCount, 0, 'no dialog/snapshot before slow accepted save drains');
    assert.equal((await invoke(b, 'updatePreferences', { appearance: 'dark' })).error.code, 'DATA_BUSY');
    assert.equal(await js(b, "document.querySelector('.app-shell').inert"), true, 'logical freeze is immediate');
    await wait(() => js(b, "!!document.querySelector('[role=dialog][aria-modal=true]')"), 'slow lifecycle progress becomes visible');
    // The IPC caller guard protects every new channel too.
    for (const channel of ['reader:profile-current', 'reader:profile-stage', 'reader:profile-submit', 'reader:profile-plan', 'reader:profile-drain', 'reader:profile-ack', 'reader:profile-refuse', 'reader:profile-resume']) {
      assert.equal((await handlers.get(channel)({ sender: {}, senderFrame: senders.get(b.webContents).senderFrame })).error.code, 'FORBIDDEN');
      assert.equal((await handlers.get(channel)({ ...senders.get(b.webContents), senderFrame: null })).error.code, 'FORBIDDEN');
    }
    releaseReply(); releaseReply = undefined; assert.equal((await seen).ok, true);
    assert.equal((await backup).value.status, 'created'); await released();
    const copy = ReaderRepository.open(snapshot);
    try {
      const state = copy.bootstrap(['en'], callerA.windowId), peerCaller = windows.participants().find(c => windows.originWindow(c) === b), peerState = copy.bootstrap(['en'], peerCaller.windowId);
      // Both independent checkpoint owners survive in one verified snapshot.
      assert.equal(state.discussionViews[viewId(state,'video-demo')].draft.text, 'pending-A');
      assert.equal(peerState.discussionViews[viewId(peerState,'video-demo')].draft.text, 'pending-B');
      assert.notEqual(viewId(state,'video-demo'), viewId(peerState,'video-demo'));
      assert.equal(state.comments['video-demo'].find(c => c.id === 'v3').seen, true);
    } finally { copy.close(); }
    console.log('M3 PASS: two UI participants, pending semantic checkpoints, slow accepted save, constrained drains, input freeze, authenticated IPC, verified backup and M2 release.');
    await invoke(a, 'bulkSeen', { itemId: 'video-demo', seen: true, target: { kind: 'all' } });
    await wait(() => js(b, "!!document.querySelector('.bulk-area > .text-button') && document.querySelector('[role=tabpanel]:not([hidden]) [data-domain-comment-id=\"v3\"]').querySelector('input[type=checkbox]').checked"), 'displayed recovery before queued Undo');
    delayChannel = 'reader:toggle-seen'; delayContents = b.webContents;
    await js(b, "document.querySelector('[role=tabpanel]:not([hidden]) [data-domain-comment-id=\"v3\"]').querySelector('input[type=checkbox]').click();void 0");
    await wait(() => !!releaseReply, 'UI checkbox acknowledgment held');
    await js(b, "document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));void 0");
    await wait(() => stagedCount === 1, 'main-issued queued Undo ticket');
    assert.equal(drainedUndos, 0, 'Undo must wait for earlier checkbox acknowledgment');
    const queuedBackup = invoke(a, 'createBackup'); await wait(() => lifecycle.phase === 'DRAINING', 'ticket barrier');
    assert.equal((await js(b, "window.reader.lifecycle.stage({kind:'updatePreferences',request:{appearance:'dark'}})")).ok, false, 'new intent cannot register after preparation');
    releaseReply(); releaseReply = undefined;
    const queuedResult = await queuedBackup;
    assert.equal(queuedResult.ok, true, JSON.stringify({ queuedResult, diagnostics, drainedUndos, stagedCount }));
    assert.equal(queuedResult.value.status, 'created'); await released();
    assert.equal(drainedUndos, 1, 'the pre-existing exact Undo ticket drained once in FIFO order');
    assert.equal(repository.bootstrap(['en']).seenUndo['video-demo'], null);
    console.log('M3 PASS: actual checkbox/Ctrl+Z FIFO, pre-registered Undo ticket drains exactly once, post-preparation ticket creation rejects.');
    // An actual native Close during pending checkpoint work stays alive/current
    // until its final bounded write is acknowledged. Duplicate Close joins it.
    delayChannel = 'reader:profile-drain'; delayContents = b.webContents;
    await edit(b, 'video-demo', 'native-close-pending');
    b.close(); b.close(); await wait(() => !!releaseReply, 'native Close held drain');
    assert.equal(b.isDestroyed(), false); assert.ok(windows.participants().some(c => windows.originWindow(c) === b));
    releaseReply(); releaseReply = undefined;
    await wait(() => b.isDestroyed(), 'native close completed'); await released();
    assert.equal((await invoke(a, 'updatePreferences', { appearance: 'light' })).ok, true, 'shared service survives peer close');
    // Controlled reload also drains before replacing the renderer incarnation.
    await edit(a, 'video-demo', 'controlled-reload-pending');
    delayChannel = 'reader:profile-drain'; delayContents = a.webContents;
    const oldCaller = windows.participants()[0]; windows.requestReload(a);
    await wait(() => !!releaseReply, 'intentional reload drain'); assert.equal(oldCaller.isCurrent(), true);
    releaseReply(); releaseReply = undefined;
    await wait(() => !oldCaller.isCurrent() && windows.participants().some(c => c.rendererLease !== oldCaller.rendererLease), 'new reload lease');
    await ready(a); await released();
    console.log('M3 PASS: actual native repeated Close with pending saves; peer remains usable; controlled actual reload fences old document.');
    b = windows.createReaderWindow(); await ready(b);
    let cancelFinal = true;
    const preventFinal = event => { if (lifecycle.phase === 'EXECUTING' && cancelFinal) { cancelFinal = false; event.preventDefault(); } };
    b.on('close', preventFinal); b.close();
    await wait(() => !cancelFinal && lifecycle.phase === 'RELEASED', 'later native listener cancelled final close'); await released();
    assert.equal(b.isDestroyed(), false); assert.equal(await js(b, "document.querySelector('.app-shell').inert"), false);
    assert.equal((await invoke(b, 'updatePreferences', { appearance: 'light' })).ok, true, 'cancelled final native close keeps usable authority');
    b.removeListener('close', preventFinal);
    // Failed durable writes keep Close cancelled and authorized, then retry.
    const saveView = repository.saveDiscussionView.bind(repository); let failSave = true;
    repository.saveDiscussionView = (request, windowId) => { if (failSave) { failSave = false; throw new Error('M3 injected durable failure'); } return saveView(request, windowId); };
    await edit(b, 'video-demo', 'failed-close-pending');
    b.close(); await wait(() => lifecycle.current()?.failed && lifecycle.phase === 'RELEASED', 'failed Close released'); await released();
    assert.equal(b.isDestroyed(), false); assert.ok(windows.participants().some(c => windows.originWindow(c) === b));
    await wait(() => js(b, "Array.from(document.querySelectorAll('[role=alert]')).some(e=>e.textContent.includes('could not be safely saved'))"), 'failed Close feedback rendered after release');
    b.close(); await wait(() => b.isDestroyed(), 'retried Close'); await released();
    b = windows.createReaderWindow(); await ready(b);
    // Cancellation before confirmation is global and retryable.
    confirm = false; assert.equal((await invoke(a, 'restoreBackup')).value.status, 'cancelled'); await released();
    // Origin loss during a pending native-dialog adapter cancels preflight.
    choose = true; const abandonedBackup = invoke(b, 'createBackup').catch(() => undefined);
    await wait(() => typeof choose === 'function', 'pending origin dialog');
    b.destroy(); choose(snapshot); choose = undefined; void abandonedBackup; await service.settleDataOperation(); await released();
    b = windows.createReaderWindow(); await ready(b);
    // Live nonresponding participants fail preflight, never timeout-success.
    await edit(b, 'video-demo', 'held-participant-pending');
    delayChannel = 'reader:profile-drain'; delayContents = b.webContents;
    const hanging = invoke(a, 'createBackup'); await wait(() => !!releaseReply, 'held participant');
    lifecycle.expire(); assert.equal((await hanging).ok, false); await released();
    releaseReply(); releaseReply = undefined;
    assert.equal((await invoke(a, 'updatePreferences', { appearance: 'dark' })).ok, true);
    console.log('M3 PASS: failed Close retained authority/retried; restore cancel; pending-dialog origin loss; deterministic hung drain failure/reconciliation.');
    // An uncontrolled native reload/crash cannot return unsent memory. It
    // revokes immediately, aborts preflight and rejoins from committed SQLite.
    for (const loss of ['reload', 'crash']) {
      await edit(b, 'video-demo', 'pending-' + loss);
      delayChannel = 'reader:profile-drain'; delayContents = b.webContents;
      const interrupted = invoke(a, 'createBackup'); await wait(() => !!releaseReply, 'pending ' + loss);
      let loaded;
      if (loss === 'reload') { loaded = new Promise(resolve => b.webContents.once('did-finish-load', resolve)); b.webContents.reload(); }
      else b.webContents.forcefullyCrashRenderer();
      assert.equal((await interrupted).ok, false);
      releaseReply(); releaseReply = undefined;
      if (loss === 'crash') { await wait(() => !windows.participants().some(c => windows.originWindow(c) === b), 'crash revoked'); loaded = new Promise(resolve => b.webContents.once('did-finish-load', resolve)); windows.requestReload(b); }
      await loaded; await ready(b); await released();
    }
    console.log('M3 PASS: actual uncontrolled reload and forced renderer crash during pending drain abort preflight, revoke leases and reconcile replacement documents.');
    // Confirmed restore remains app-owned after origin death. Both participants
    // drained before safety, and surviving old-profile UI stays inert forever.
    confirm = true;
    let hitSafety; const atSafety = new Promise(resolve => { hitSafety = resolve; }); safetyReached = hitSafety;
    const restoring = invoke(a, 'restoreBackup').catch(() => undefined); await atSafety;
    a.destroy(); assert.equal(lifecycle.phase, 'EXECUTING'); continueSafety();
    void restoring; await service.settleDataOperation(); await wait(() => restart, 'app-owned restore restart request');
    assert.equal(lifecycle.phase, 'RESTARTING'); assert.equal(service.restarting, true);
    assert.equal((await invoke(b, 'saveDiscussionView', { itemId: 'video-demo' })).error.code, 'DATA_BUSY');
    assert.equal(await js(b, "document.querySelector('.app-shell').inert"), true);
    assert.equal((await invoke(b, 'createBackup')).error.code, 'DATA_BUSY');
    await service.shutdown(); b.destroy(); clearTimeout(watchdog);
    console.log('M3 PASS: two-participant confirmed restore, independent safety, origin destroyed after confirmation, offline replacement, terminal old-profile IPC/UI fencing. Actual process relaunch/crash-gap recovery is covered by existing built-entry harnesses.');
    app.quit();
  }).catch(fail);
} else {
  (async () => {
    assert.ok(fs.existsSync(preload) && fs.existsSync(page), 'Build Forge application first');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-m3-'));
    try {
      const modules = ['window-coordinator:WindowCoordinator', 'reader-service:ReaderService', 'reader-ipc:registerReaderIpc', 'persistence/reader-repository:ReaderRepository'];
      const contents = modules.map(value => { const [file, name] = value.split(':'); return `export {${name}} from ${JSON.stringify(path.resolve(__dirname, '../src/main', file+'.ts'))};`; }).join('\n');
      require('esbuild').buildSync({ stdin: { contents, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'tools.cjs') });
      const env = { ...process.env, M3_SMOKE_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
      console.log('M3 disposable root: ' + root);
      const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('M3 exited '+code))); });
      const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(path.join(root, 'profile', 'reader.sqlite'), { readOnly: true });
      try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14); assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); } finally { db.close(); }
    } finally {
      assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m3-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

const { tabElement, viewId, seedPeerIdentity } = require('./window-view-fixtures.cjs');
// M2 only. Two secured test renderers share one real service/repository. No
// production new-window path, production profile, helper process or installer.
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
  const root = process.env.M2_SMOKE_ROOT;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m2-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
  }
  const { WindowCoordinator, ReaderService, ReaderRepository, registerReaderIpc, normalizeYtDlp } = require(path.join(root, 'tools.cjs'));
  let releaseReply, releaseUndo, delayReply = false, delayUndo = false;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    if (delayUndo && channel === 'reader:undo-seen') {
      delayUndo = false;
      await new Promise(resolve => { releaseUndo = resolve; });
    }
    const result = await handler(event, ...args);
    if (delayReply && ['reader:toggle-seen', 'reader:refresh'].includes(channel)) {
      delayReply = false;
      await new Promise(resolve => { releaseReply = resolve; });
    }
    return result;
  });
  app.on('browser-window-created', (_event, window) => { window.hide(); window.webContents.setBackgroundThrottling(false); });
  let service;
  const watchdog = setTimeout(() => { console.error('M2 smoke timeout'); app.exit(1); }, 90000);
  const fail = error => { console.error(error); app.exit(1); };
  async function wait(expression, label) {
    for (let n = 0; n < 600; n++) { if (await expression()) return; await pause(20); }
    throw new Error('Timeout: ' + label);
  }
  app.whenReady().then(async () => {
    const repository = ReaderRepository.open(path.join(root, 'reader.sqlite')); repository.initializeDemo();
    const windows = new WindowCoordinator(pathToFileURL(page).href, preload);
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json')));
    let finishExtraction;
    service = new ReaderService(() => repository, ['en'], console.error,
      async (_target, _signal, advance) => { advance('fetching'); await new Promise(resolve => { finishExtraction = resolve; }); return { extraction: normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context) }; },
      {}, undefined, value => windows.sendAcquisitionProgress(value));
    registerReaderIpc(service, windows);
    seedPeerIdentity(windows, repository);
    const a = windows.createReaderWindow(), b = windows.createReaderWindow();
    const js = async (window, code) => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw new Error('M2 expression failed: '+code, {cause:error}); } };
    const invoke = async (window, name, payload) => {
      if (['openLibrary','openSettings','openStoredItem','activateTab','closeTab','moveTab'].includes(name)) payload = { ...payload, expectedRevision: (await js(window,'window.reader.bootstrap()')).value.workspace.revision };
      return js(window, `window.reader.${name}(${payload === undefined ? '' : JSON.stringify(payload)})`);
    };
    const ready = window => wait(() => js(window, "!!document.querySelector('.comment')"), 'real reader');
    await Promise.all([ready(a), ready(b)]);
    for (const window of [a, b]) await js(window, "window.m2Events=[];window.m2Progress=[];window.reader.onSharedCommit(e=>window.m2Events.push(e));window.reader.onAcquisitionProgress(e=>window.m2Progress.push(e));void 0");
    const checkbox = "document.querySelector('[role=tabpanel]:not([hidden]) [data-domain-comment-id=\"v3\"]')?.querySelector('input[type=checkbox]')";
    // Apply seen filtering in both real readers, then preserve their membership.
    for (const window of [a, b]) {
      await js(window, "const s=document.querySelector('select[name=seen]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'unseen');s.dispatchEvent(new Event('change',{bubbles:true}));void 0");
      await js(window, "document.querySelector('.query-controls').requestSubmit();void 0");
      await wait(() => js(window, "!!document.querySelector('.applied-counts') && !document.querySelector('.query-status').textContent.includes('Evaluating')"), 'applied worker result');
    }
    const memberships = await Promise.all([a, b].map(w => js(w, "Array.from(document.querySelectorAll('.comment')).map(c=>[c.id,c.dataset.viewRole])")));
    const unseenBefore = await js(b, "Number(document.querySelector('.discussion-ruler').dataset.unseenCount)");
    // Genuine UI gesture produces explicit assignment and real peer IPC updates.
    await js(a, `${checkbox}.click();void 0`);
    await wait(() => js(b, `${checkbox}?.checked===true`), 'peer live checkbox');
    assert.equal(await js(b, "document.querySelector('.query-status').textContent.includes('Seen changes saved')"), true);
    assert.equal(await js(b, "Number(document.querySelector('.discussion-ruler').dataset.unseenCount)"), unseenBefore-1);
    for (let n = 0; n < 2; n++) assert.deepEqual(await js([a,b][n], "Array.from(document.querySelectorAll('.comment')).map(c=>[c.id,c.dataset.viewRole])"), memberships[n], 'frozen applied membership');
    // Delayed own reply after peer assignment cannot regress the UI.
    delayReply = true;
    await js(a, `${checkbox}.click();void 0`);
    await wait(() => !!releaseReply, 'held real IPC response');
    await invoke(b, 'toggleSeen', { itemId: 'video-demo', commentId: 'v3', subtree: false, seen: true });
    await wait(() => js(a, `${checkbox}?.checked===true`), 'newer peer state');
    releaseReply(); releaseReply = undefined; await pause(100);
    assert.equal(await js(a, `${checkbox}.checked`), true);
    await invoke(a, 'toggleSeen', { itemId: 'video-demo', commentId: 'v3', subtree: false, seen: false });
    await wait(async () => !(await js(a, `${checkbox}.checked`)) && !(await js(b, `${checkbox}.checked`)), 'both acknowledged unseen');
    const assignments = await Promise.all([a, b].map(window => invoke(window, 'toggleSeen', { itemId: 'video-demo', commentId: 'v3', subtree: false, seen: true })));
    assert.equal(assignments.reduce((sum, result) => sum + result.value.changedCount, 0), 1, 'same-state assignments transition only once');
    await wait(async () => (await js(a, `${checkbox}.checked`)) && (await js(b, `${checkbox}.checked`)), 'concurrent same-state convergence');
    // Delay a genuine Ctrl+Z intent before main compares its displayed operation ID.
    const first = await invoke(a, 'bulkSeen', { itemId: 'video-demo', seen: true, target: { kind: 'all' } });
    await wait(() => js(a, "!!document.querySelector('.bulk-area > .text-button')"), 'displayed Undo');
    delayUndo = true;
    await js(a, "document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));void 0");
    await wait(() => !!releaseUndo, 'held actual Ctrl+Z intent');
    const replacement = await invoke(b, 'bulkSeen', { itemId: 'video-demo', seen: false, target: { kind: 'all' } });
    releaseUndo(); releaseUndo = undefined; await pause(80);
    const stale = await invoke(a, 'undoSeen', { itemId: 'video-demo', expectedOperationId: first.value.undo.id });
    assert.equal(stale.error.code, 'UNDO_CONFLICT');
    assert.equal((await invoke(a, 'bootstrap')).value.seenUndo['video-demo'].id, replacement.value.undo.id);
    const undo = await invoke(b, 'undoSeen', { itemId: 'video-demo', expectedOperationId: replacement.value.undo.id }); assert.equal(undo.ok, true);
    // Atomic preferences/custom code drive both real Settings replicas.
    await invoke(a, 'openSettings'); await invoke(b, 'openSettings');
    await wait(() => js(b, "document.getElementById('panel-settings')?.hidden===false"), 'both Settings mounted');
    await invoke(a, 'updatePreferences', { translationTarget: 'custom', customTranslationTarget: 'uk-UA' });
    await invoke(a, 'updatePreferences', { appearance: 'dark' });
    await wait(() => js(b, "document.documentElement.dataset.appearance==='dark'"), 'peer preference');
    await invoke(a, 'openSettings'); await invoke(b, 'openSettings');
    await wait(() => js(b, "document.getElementById('panel-settings')?.hidden===false && document.querySelector('.translation-settings input')?.value==='uk-UA'"), 'peer custom target');
    // Reload has a new M1 document lease and reconstructs M2 state without a log.
    const reload = new Promise(resolve => b.webContents.once('did-finish-load', resolve)); b.webContents.reload(); await reload;
    await wait(() => js(b, "document.documentElement.dataset.appearance==='dark' && !!document.querySelector('.app-shell')"), 'reloaded peer');
    await js(b, "window.m2Progress=[];window.m2Events=[];window.reader.onAcquisitionProgress(e=>window.m2Progress.push(e));window.reader.onSharedCommit(e=>window.m2Events.push(e));void 0");
    // Acquisition completion is independent from progress settlement; both peers
    // receive progress and synchronize committed content through actual preload.
    const acquisition = invoke(a, 'acquire', { url: 'https://www.youtube.com/watch?v=VidDemo_001' });
    await wait(() => !!finishExtraction, 'accepted acquisition');
    const operation = await invoke(b, 'getAcquisitionProgress'); assert.equal(operation.ok, true); assert.equal(operation.value.stage, 'fetching');
    await wait(async () => (await js(a, 'window.m2Progress.length')) > 0 && (await js(b, 'window.m2Progress.length')) > 0, 'progress fanout');
    const reconnect = new Promise(resolve => b.webContents.once('did-finish-load', resolve)); b.webContents.reload(); await reconnect;
    await wait(() => js(b, "!!document.querySelector('.app-shell') && !!document.querySelector('.acquisition-status')"), 'reconnected participant queries active progress');
    assert.equal((await invoke(b, 'getAcquisitionProgress')).value.operationId, operation.value.operationId);
    await js(b, "window.m2Progress=[];window.reader.onAcquisitionProgress(e=>window.m2Progress.push(e));void 0");
    finishExtraction(); finishExtraction = undefined;
    const acquired = await acquisition; assert.equal(acquired.ok, true); const itemId = acquired.value.summary.itemId;
    await wait(async () => (await invoke(b, 'bootstrap')).value.items.some(item => item.id === itemId), 'peer acquisition content');
    assert.equal(await js(b, `!!${tabElement(itemId)}`), false, 'peer topology remains independent');
    await invoke(b, 'openStoredItem', { itemId });
    assert.equal(await js(b, 'window.m2Progress.some(e=>e.settled===true)'), true);
    // Remove while a committed Refresh reply is delayed: it must not resurrect.
    delayReply = true;
    await js(a, "document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').click();void 0"); await wait(() => !!finishExtraction, 'refresh fetching'); finishExtraction(); finishExtraction = undefined;
    await wait(() => !!releaseReply, 'held refresh reply');
    assert.equal((await invoke(b, 'removeLibraryItem', { itemId })).ok, true);
    await wait(() => js(a, `!${tabElement(itemId)}`), 'peer removal');
    releaseReply(); releaseReply = undefined; await pause(100);
    assert.equal(await js(a, `!!${tabElement(itemId)}`), false);
    // Accepted work remains profile-owned after the initiating renderer dies.
    const peerWorkspace = (await invoke(b,'bootstrap')).value.workspace;
    const abandoned = invoke(a, 'acquire', { url: 'https://www.youtube.com/watch?v=VidDemo_001' }); abandoned.catch(() => undefined);
    await wait(() => !!finishExtraction, 'origin-independent acquire'); a.destroy(); finishExtraction(); finishExtraction = undefined;
    await wait(() => repository.bootstrap(['en']).items.some(i=>!i.isDemo), 'commit after origin destruction');
    await wait(async () => (await invoke(b,'bootstrap')).value.items.some(i=>!i.isDemo), 'surviving peer observes commit');
    assert.deepEqual((await invoke(b,'bootstrap')).value.workspace,peerWorkspace,'origin death does not open a peer tab');
    await service.shutdown(); b.destroy();
    clearTimeout(watchdog);
    console.log('M2 Electron PASS: two real authorized reader replicas, shared UI/IPC/preload events, frozen matches/live seen, late replies, expected Undo, preferences/custom target, reload, global progress, removal versus delayed Refresh, commit after origin destruction.');
    app.quit();
  }).catch(fail);
} else {
  (async () => {
    assert.ok(fs.existsSync(preload) && fs.existsSync(page), 'Build Forge application first');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-m2-'));
    try {
      const modules = ['window-coordinator:WindowCoordinator', 'reader-service:ReaderService', 'reader-ipc:registerReaderIpc', 'persistence/reader-repository:ReaderRepository', 'extractors/yt-dlp:normalizeYtDlp'];
      const contents = modules.map(value => { const [file, name] = value.split(':'); return `export {${name}} from ${JSON.stringify(path.resolve(__dirname, '../src/main', file+'.ts'))};`; }).join('\n');
      require('esbuild').buildSync({ stdin: { contents, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'tools.cjs') });
      const env = { ...process.env, M2_SMOKE_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
      console.log('M2 disposable root: ' + root);
      const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('M2 exited '+code))); });
      const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(path.join(root, 'reader.sqlite'), { readOnly: true });
      try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 15); assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); } finally { db.close(); }
    } finally {
      assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m2-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

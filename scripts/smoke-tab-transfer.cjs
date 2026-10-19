// M7: actual production entry, three authorized native readers, real UI/preload/
// IPC/SQLite, plus actual subsequent processes. Never uses the owner's profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const dbFile = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');
function inspect(root, action) { const db = new DatabaseSync(dbFile(root), { readOnly: true }); try { return JSON.parse(JSON.stringify(action(db))); } finally { db.close(); } }
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, BrowserWindow, Menu, dialog, ipcMain, screen } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.M7_PHASE;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m7-electron-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) { const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); app.setPath(name, folder); }
  const fail = error => { console.error('M7', phase, error); app.exit(1); };
  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  const watchdog = setTimeout(() => fail(Error('M7 watchdog')), 120000);
  let verified = false, holdReady = false, readyGate, readyHeld, suppressRestart = false, failTransferStage, transferEntered = false, crashAfterCommit;
  const submittedHandoffs = new Map();
  const prepareSql = DatabaseSync.prototype.prepare, execSql = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.prepare = function(sql) {
    if (sql.startsWith('UPDATE tab_instances SET owner_window_id=')) {
      transferEntered = true;
      if (failTransferStage === 'owner') { failTransferStage = undefined; throw Error('M7 injected owner change failure'); }
    }
    if (sql.startsWith('UPDATE discussion_views SET intent_revision=intent_revision+1,collapse_revision=') && failTransferStage === 'lanes') {
      failTransferStage = undefined; throw Error('M7 injected lane failure');
    }
    return prepareSql.call(this, sql);
  };
  DatabaseSync.prototype.exec = function(sql) {
    if (sql === 'COMMIT' && transferEntered && failTransferStage === 'commit') { failTransferStage = undefined; transferEntered = false; throw Error('M7 injected COMMIT failure'); }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') transferEntered = false;
    return execSql.call(this, sql);
  };
  const created = [], handlers = new Map(), events = new Map(), originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => {
    handlers.set(channel, handler);
    originalHandle(channel, async (event, ...args) => {
      events.set(event.sender, event);
      if (channel === 'reader:transfer-move') submittedHandoffs.set(args[0].request.tabId, args[0].request.handoff);
      if (channel === 'reader:transfer-ready' && holdReady) {
        holdReady = false; readyHeld?.(); await new Promise(resolve => { readyGate = resolve; });
      }
      const result = await handler(event, ...args);
      if (channel === 'reader:transfer-move') console.log('M7 transfer result', JSON.stringify({ ok: result?.ok, error: result?.error }));
      if (channel === 'reader:transfer-move' && result?.ok && crashAfterCommit) { const victim = crashAfterCommit; crashAfterCommit = undefined; victim.webContents.forcefullyCrashRenderer(); }
      return result;
    });
  };
  let backupPath = path.join(root, 'barrier.sqlite'), failNextLoad = false;
  const loadURL = BrowserWindow.prototype.loadURL;
  BrowserWindow.prototype.loadURL = function(...args) { if (failNextLoad) { failNextLoad = false; return Promise.reject(Error('M7 injected provisional load failure')); } return loadURL.apply(this, args); };
  dialog.showErrorBox = () => { /* Test-only failure notification; source feedback is asserted. */ };
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: backupPath });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(root, 'snapshot.sqlite')] });
  dialog.showMessageBox = async () => ({ response: 1 });
  // Exercise the production single helper/acquisition path with saved public
  // fixture bytes. The dummy EXE is never executed and no live request is made.
  const helper = path.join(root, 'fixture-helper.exe'); fs.writeFileSync(helper, 'M7 fixture, never executed');
  process.env.YOUTUBE_COMMENTS_YTDLP_EXE = helper;
  const childProcess = require('node:child_process'), spawnChild = childProcess.spawn;
  const extraction = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json')));
  let releaseFetch, fetches = 0;
  childProcess.spawn = (file, args, ...rest) => {
    if (file !== helper) return spawnChild(file, args, ...rest);
    const child = new (require('node:events').EventEmitter)();
    child.stdout = new (require('node:stream').PassThrough)(); child.stderr = new (require('node:stream').PassThrough)();
    child.kill = () => { child.emit('close', 1); return true; };
    if (args.includes('--version')) setImmediate(() => { child.stdout.write('2026.08.19\n'); child.emit('close', 0); });
    else { fetches++; releaseFetch = () => { child.stdout.write(JSON.stringify(extraction.raw)); child.emit('close', 0); }; }
    return child;
  };
  app.relaunch = () => { suppressRestart = true; };
  const originalQuit = app.quit.bind(app); app.quit = () => { if (!suppressRestart) originalQuit(); };
  app.on('browser-window-created', (_event, window) => {
    created.push(window); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('preload-error', (_event, _file, error) => fail(error));
  });
  const js = (w, code) => w.webContents.executeJavaScript(code);
  async function wait(check, label) { for (let n = 0; n < 1500; n++) { if (await check()) return; await pause(10); } throw Error('M7 timeout: ' + label); }
  const boot = async w => { const result = await js(w, 'window.reader.bootstrap()'); assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  const ready = w => wait(() => js(w, "!!document.querySelector('.app-shell')"), 'reader bootstrap');
  const windows = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  async function invoke(w, name, payload) {
    if (['openLibrary', 'openSettings', 'openStoredItem', 'activateTab', 'closeTab'].includes(name)) payload = { ...payload, expectedRevision: (await boot(w)).workspace.revision };
    const result = await js(w, 'window.reader.' + name + '(' + (payload === undefined ? '' : JSON.stringify(payload)) + ')');
    assert.equal(result.ok, true, name + ': ' + JSON.stringify(result)); return result.value;
  }
  async function press(w, keyCode, modifiers = []) {
    w.focus(); await wait(() => w.isFocused() && js(w, 'document.hasFocus()'), 'native keyboard focus');
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') w.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await pause(40);
  }
  const tabSelector = id => 'document.getElementById(' + JSON.stringify('tab-' + id) + ')';
  const panelSelector = id => 'document.getElementById(' + JSON.stringify('panel-' + id) + ')';
  async function menu(w, id, newWindow = false) {
    await js(w, tabSelector(id) + '.focus();void 0'); await press(w, 'F10', ['shift']);
    await wait(() => js(w, '!!document.querySelector("[role=menu]")'), 'keyboard context menu');
    // New Window is last. Window chooser precedes it. Real Electron key events.
    await press(w, 'End'); if (!newWindow) await press(w, 'Up'); await press(w, 'Enter');
    await wait(() => js(w, '!!document.querySelector("dialog[open]")'), 'move dialog');
  }
  async function choose(w, label) {
    await wait(() => js(w, 'Array.from(document.querySelectorAll("dialog[open] button")).some(b=>b.textContent===' + JSON.stringify(label) + ')'), 'destination ' + label);
    await js(w, 'Array.from(document.querySelectorAll("dialog[open] button")).find(b=>b.textContent===' + JSON.stringify(label) + ').focus();void 0');
    await press(w, 'Enter');
  }
  const owner = id => inspect(root, db => db.prepare('SELECT owner_window_id FROM tab_instances WHERE id=?').get(id)?.owner_window_id);
  const knownWindowIds = new Map();
  async function chooseTarget(source, target) {
    const tab = (await boot(target)).workspace.tabs[0];
    if (tab) knownWindowIds.set(target, owner(tab.id));
    const targetId = knownWindowIds.get(target); assert.ok(targetId);
    const destinations = await js(source, 'window.reader.transfers.destinations()'); assert.equal(destinations.ok, true);
    const number = destinations.value.find(d => d.windowId === targetId)?.number; assert.ok(number);
    await choose(source, 'Window ' + number);
  }
  async function holdMove(source, id, target) {
    let reached = false;
    holdReady = true; readyGate = undefined; readyHeld = () => { reached = true; };
    await menu(source, id); await chooseTarget(source, target);
    await wait(async () => {
      if (!reached && await js(source, 'Array.from(document.querySelectorAll("[role=status]")).some(e=>e.textContent.includes("could not be moved"))')) throw Error('Source rejected preflight');
      return reached;
    }, 'held target readiness');
    assert.ok(readyGate); return () => readyGate();
  }
  async function recover(w) {
    const loaded = new Promise(resolve => w.webContents.once('did-finish-load', resolve)); w.webContents.reload(); await loaded; await ready(w);
  }
  const sourceUsable = async w => {
    await wait(() => js(w, '!document.querySelector(".app-shell").inert'), 'cancelled source usable');
    await js(w, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  };
  async function moved(w, id) { await wait(() => js(w, '!!' + tabSelector(id)), 'moved destination tab'); await wait(() => js(w, panelSelector(id) + '?.hidden===false && !!' + panelSelector(id) + '.querySelector("form")'), 'live target panel'); }
  function capture() { return inspect(root, db => Object.fromEntries(['app_windows', 'window_tabs', 'tab_instances', 'discussion_view_intent', 'view_collapse', 'view_collapse_overrides', 'item_resume_view', 'window_restore'].map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]))); }
  app.whenReady().then(async () => {
    await wait(() => windows().length > 0, 'startup native'); await ready(created[0]);
    if (phase === 'write') {
      const a = created[0];
      await invoke(a, 'updatePreferences', { locale: 'en' });
      for (let n = 0; n < 2; n++) { Menu.getApplicationMenu().getMenuItemById('new-reader-window').click(); await wait(() => created.length === n + 2, 'new equal window'); await ready(created[n + 1]); }
      const b = created[1]; let c = created[2];
      const displays = screen.getAllDisplays();
      if (displays.length > 1) { const area = displays[1].workArea; b.setBounds({ x: area.x, y: area.y, width: Math.min(1000, area.width), height: Math.min(800, area.height) }); }
      console.log('M7 displays', JSON.stringify(displays.map(d => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor }))));
      await invoke(b, 'openStoredItem', { itemId: 'video-demo' }); await invoke(c, 'openStoredItem', { itemId: 'post-demo' });
      const original = await boot(a), video = original.workspace.tabs.find(t => t.kind === 'discussion' && t.itemId === 'video-demo').id;
      const post = original.workspace.tabs.find(t => t.kind === 'discussion' && t.itemId === 'post-demo').id;
      const sourceOwner = owner(video), bOwner = owner((await boot(b)).workspace.activeTabId);
      await invoke(a, 'activateTab', { tabId: video });
      await wait(() => js(a, '!!' + panelSelector(video) + '.querySelector("form")'), 'source reader');
      await js(a, '(()=>{const e=' + panelSelector(video) + '.querySelector("select[aria-label=missing]")||Array.from(' + panelSelector(video) + '.querySelectorAll("select")).find(s=>Array.from(s.options).some(o=>o.value==="unseen"));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"unseen");e.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await js(a, panelSelector(video) + '.querySelector("form").requestSubmit();void 0'); await pause(100);
      const roles = w => js(w, 'Array.from(' + panelSelector(video) + '.querySelectorAll("[data-view-role=match]")).map(e=>e.dataset.domainCommentId)');
      const frozen = await roles(a); assert.ok(frozen.length);
      await invoke(b, 'toggleSeen', { itemId: 'video-demo', commentId: frozen[0], subtree: false, seen: true });
      await js(a, 'Array.from(' + panelSelector(video) + '.querySelectorAll("button")).find(b=>b.textContent==="Select comments").click();void 0');
      await js(a, panelSelector(video) + '.querySelector(".selection-circle").click();void 0');
      await press(a, 'F3');
      // A dirty draft stays separate from the accepted unseen result.
      await js(a, '(()=>{const e=' + panelSelector(video) + '.querySelector("input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"M7 unsent draft");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await menu(a, video); holdReady = true;
      let frozenReached; const frozenWait = new Promise(resolve => { frozenReached = resolve; }); readyHeld = frozenReached;
      await choose(a, 'Window 2');
      await Promise.race([frozenWait, pause(10000).then(async () => { throw Error('Source did not reach target readiness: ' + await js(a, 'JSON.stringify({status:Array.from(document.querySelectorAll("[role=status]")).map(e=>e.textContent),inert:document.querySelector(".app-shell").inert,dialog:document.querySelector("dialog[open]")?.textContent,active:document.activeElement?.outerHTML.slice(0,500)})')); })]);
      assert.equal(owner(video), sourceOwner); assert.equal(await js(a, '!!' + tabSelector(video)), true, 'source stays mounted before commit');
      assert.equal((await boot(b)).workspace.tabs.some(t => t.id === video), false);
      readyGate(); await moved(b, video);
      const frozenHandoff = submittedHandoffs.get(video);
      assert.equal(owner(video), bOwner); assert.equal(await js(a, '!!' + tabSelector(video)), false);
      assert.deepEqual(await roles(b), frozen, 'move retains frozen unseen membership despite shared seen');
      assert.equal(await js(b, panelSelector(video) + '.querySelector("input[type=search]").value'), 'M7 unsent draft');
      assert.equal(await js(b, '!!' + panelSelector(video) + '.querySelector("[data-bulk-selected=true]")'), true);
      assert.equal(await js(b, 'document.activeElement?.id'), 'tab-' + video);
      assert.equal((await boot(b)).workspace.tabs.filter(t => t.kind === 'discussion' && t.itemId === 'video-demo').length, 2);
      // Real transaction failures after placement deletion must roll everything
      // back. Readiness stays renderer-owned; only main's SQL is fault injected.
      for (const stage of ['owner', 'lanes', 'commit']) {
        const release = await holdMove(b, video, c), before = capture(); failTransferStage = stage; release();
        assert.deepEqual(submittedHandoffs.get(video).result, frozenHandoff.result, 'destination exports the exact frozen source results');
        assert.deepEqual(submittedHandoffs.get(video).bulkSelected, frozenHandoff.bulkSelected);
        await sourceUsable(b); assert.equal(failTransferStage, undefined, 'injection reached ' + stage);
        const after = capture();
        for (const table of ['app_windows', 'window_tabs', 'tab_instances', 'item_resume_view']) assert.deepEqual(after[table], before[table], stage + ' rollback ' + table);
        assert.equal(owner(video), bOwner); assert.equal(await js(b, '!!' + tabSelector(video)), true);
      }
      // Losing the exact target/source document before COMMIT cannot move the
      // tab. Recovery uses committed semantics after an actual renderer crash.
      {
        const release = await holdMove(b, video, c), gone = new Promise(resolve => c.webContents.once('render-process-gone', resolve));
        c.webContents.forcefullyCrashRenderer(); await gone; await sourceUsable(b); release(); await recover(c);
        assert.equal(owner(video), bOwner);
      }
      {
        const release = await holdMove(b, video, c), gone = new Promise(resolve => b.webContents.once('render-process-gone', resolve));
        b.webContents.forcefullyCrashRenderer(); await gone; await pause(150); release(); await recover(b);
        assert.equal(owner(video), bOwner); await moved(b, video);
      }
      for (const reloading of [b, c]) {
        const release = await holdMove(b, video, c), loaded = new Promise(resolve => reloading.webContents.once('did-finish-load', resolve));
        reloading.focus(); Menu.getApplicationMenu().items.find(i => i.label === 'View').submenu.items.find(i => i.label === 'Reload').click();
        await loaded; await ready(reloading); release(); await sourceUsable(b);
        assert.equal(owner(video), bOwner, 'controlled source/target reload cancels before ownership COMMIT');
      }
      // M3 Close cancels the rendezvous, drains healthy windows and removes only
      // its native member. A replacement equal reader is then created normally.
      {
        const release = await holdMove(b, video, c); c.close();
        await wait(() => c.isDestroyed(), 'mid-transfer target native Close'); release(); await sourceUsable(b);
        assert.equal(owner(video), bOwner);
        const count = created.length; Menu.getApplicationMenu().getMenuItemById('new-reader-window').click();
        await wait(() => created.length === count + 1, 'replacement third native'); c = created.at(-1); await ready(c);
        await invoke(c, 'openStoredItem', { itemId: 'post-demo' });
      }
      // A backup barrier also cancels an uncommitted handoff before sealing its
      // manifests; it must complete without a late transfer releasing M3 queues.
      {
        const release = await holdMove(b, video, c), backup = invoke(a, 'createBackup');
        await sourceUsable(b); release(); assert.equal((await backup).status, 'created'); assert.equal(owner(video), bOwner);
      }
      backupPath = path.join(root, 'snapshot.sqlite');
      // A successful shared Refresh during a handoff cancels ownership changes,
      // then reevaluates the source's own criteria after unfreezing. Progress and
      // existing shared seen/Undo keep their one-service behavior.
      {
        const acquisition = invoke(a, 'acquire', { url: 'https://www.youtube.com/watch?v=' + extraction.raw.id });
        await wait(() => !!releaseFetch, 'fixture acquisition child');
        for (const w of [a, b, c]) await wait(() => js(w, '!!document.querySelector(".acquisition-status")'), 'shared acquisition progress');
        releaseFetch(); releaseFetch = undefined; const acquired = await acquisition;
        const remote = acquired.summary.itemId, remoteTab = (await boot(a)).workspace.activeTabId;
        await moved(a, remoteTab); const release = await holdMove(a, remoteTab, b);
        extraction.raw.comments.push({ id: 'm7-new-root', parent: 'root', text: 'M7 fixture discovery', timestamp: 1790856000 });
        const refresh = invoke(c, 'refresh', { itemId: remote }); await wait(() => !!releaseFetch, 'fixture Refresh child');
        releaseFetch(); releaseFetch = undefined; await refresh; await sourceUsable(a); release();
        assert.equal(owner(remoteTab), sourceOwner); assert.equal(fetches, 2);
        await wait(async () => js(a, panelSelector(remoteTab) + '.querySelector(".virtual-reader")?.dataset.rowCount===' + JSON.stringify(String((await boot(a)).comments[remote].length))), 'source replays accepted Refresh');
        const bulk = await invoke(b, 'bulkSeen', { itemId: remote, target: { kind: 'all' }, seen: true });
        await invoke(c, 'undoSeen', { itemId: remote, expectedOperationId: bulk.undo.id });
        await menu(a, remoteTab); await chooseTarget(a, b); await moved(b, remoteTab);
      }
      const oldAuthority = (await boot(b)).viewInstances[video];
      await menu(b, video); await choose(b, 'Window 1'); await moved(a, video);
      await menu(a, video); await choose(a, 'Window 2'); await moved(b, video);
      const late = await js(b, 'window.reader.saveDiscussionView(' + JSON.stringify({ ...(await boot(b)).discussionViews[video], viewId: video,
        expectedRevision: (await boot(b)).viewInstances[video].intentRevision, ownerGeneration: oldAuthority.ownerGeneration }) + ')');
      assert.equal(late.ok, false); assert.equal(late.error.code, 'FORBIDDEN');
      const lateCollapse = await js(b, 'window.reader.setDiscussionCollapse(' + JSON.stringify({ viewId: video, expectedRevision: (await boot(b)).viewInstances[video].collapseRevision,
        ownerGeneration: oldAuthority.ownerGeneration, kind: 'all', collapsed: true }) + ')');
      assert.equal(lateCollapse.ok, false); assert.equal(lateCollapse.error.code, 'FORBIDDEN');
      // Same source normal discussion -> existing Community instance never merges.
      await menu(a, post); await choose(a, 'Window 3'); await moved(c, post);
      assert.equal((await boot(c)).workspace.tabs.filter(t => t.kind === 'discussion' && t.itemId === 'post-demo').length, 2);
      // Singleton merges activate target identity and retain target's local filter.
      await invoke(a, 'openLibrary'); const library = (await boot(a)).workspace.activeTabId;
      await invoke(b, 'openLibrary'); const targetLibrary = (await boot(b)).workspace.activeTabId;
      await js(b, '(()=>{const e=document.querySelector(".library-filter input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"target filter");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await menu(a, library); await choose(a, 'Window 2'); await wait(async () => !(await boot(a)).workspace.tabs.some(t => t.id === library), 'Library merged');
      assert.equal((await boot(b)).workspace.activeTabId, targetLibrary); assert.equal(await js(b, 'document.querySelector(".library-filter input").value'), 'target filter');
      await invoke(a, 'openSettings'); const settings = (await boot(a)).workspace.activeTabId; await invoke(b, 'openSettings'); const targetSettings = (await boot(b)).workspace.activeTabId;
      const customDraft = async (w, draft) => {
        await js(w, '(()=>{const e=document.querySelector(".translation-settings select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"custom");e.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await wait(() => js(w, '!!document.querySelector(".translation-settings input")'), 'custom draft editor');
        await js(w, '(()=>{const e=document.querySelector(".translation-settings input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(draft) + ');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
      };
      await customDraft(a, 'pt-BR'); await customDraft(b, 'ja-Kana');
      await menu(a, settings); assert.equal(await js(a, 'Array.from(document.querySelectorAll("dialog[open] button")).some(b=>b.textContent.startsWith("Window "))'), false);
      await choose(a, 'Keep editing'); assert.equal(await js(a, 'document.querySelector(".translation-settings input").value'), 'pt-BR');
      await menu(a, settings); await choose(a, 'Discard draft and continue'); await choose(a, 'Window 2');
      await wait(async () => !(await boot(a)).workspace.tabs.some(t => t.id === settings), 'Settings merged'); assert.equal((await boot(b)).workspace.activeTabId, targetSettings);
      assert.equal(await js(b, 'document.querySelector(".translation-settings input").value'), 'ja-Kana', 'destination custom draft survives source merge');
      assert.equal((await boot(b)).preferences.translationTarget, 'app', 'drafts are not committed preferences');
      // Final source tab moves to a provisional secured native. Source remains open/empty.
      await invoke(a, 'openStoredItem', { itemId: 'post-demo' }); const last = (await boot(a)).workspace.activeTabId;
      for (const tab of (await boot(a)).workspace.tabs) if (tab.id !== last) await invoke(a, 'closeTab', { tabId: tab.id });
      // A failed hidden native never enters restore membership or removes the
      // source. Its logical row may remain dormant, matching the M6 policy.
      {
        const intended = inspect(root, db => db.prepare('SELECT window_id FROM window_restore ORDER BY position').all());
        const count = created.length; failNextLoad = true; await menu(a, last, true); await choose(a, 'Move to New Window');
        await wait(() => created.length === count + 1 && created.at(-1).isDestroyed(), 'failed provisional native cleaned'); await sourceUsable(a);
        assert.deepEqual(inspect(root, db => db.prepare('SELECT window_id FROM window_restore ORDER BY position').all()), intended);
        assert.equal((await boot(a)).workspace.activeTabId, last); assert.equal(windows().length, 3);
      }
      await menu(a, last, true); await choose(a, 'Move to New Window');
      await wait(() => windows().length === 4, 'provisional native created'); const d = created.at(-1); await ready(d); await moved(d, last);
      knownWindowIds.set(d, owner(last));
      assert.deepEqual((await boot(a)).workspace.tabs, []); assert.equal(a.isDestroyed(), false); assert.equal(a.isVisible(), true);
      assert.equal(windows().length, 4); assert.equal(windows().every(w => w.isVisible()), true);
      // Death after COMMIT can only recover the committed owner, never clone
      // the tab back. Exercise both the old source and the new target process.
      {
        let gone = new Promise(resolve => d.webContents.once('render-process-gone', resolve)); crashAfterCommit = d;
        await menu(d, last); await chooseTarget(d, c); await gone; await recover(d);
        assert.deepEqual((await boot(d)).workspace.tabs, []); assert.equal((await boot(c)).workspace.activeTabId, last);
        gone = new Promise(resolve => d.webContents.once('render-process-gone', resolve)); crashAfterCommit = d;
        await menu(c, last); await chooseTarget(c, d).catch(async error => { if (!d.webContents.isDestroyed()) throw error; });
        await gone; await recover(d); await moved(d, last); assert.equal((await boot(c)).workspace.tabs.some(t => t.id === last), false);
      }
      await invoke(b, 'createBackup');
      fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify(capture()));
      verified = true; app.quit();
    } else if (phase === 'restart') {
      await wait(() => created.length === 4, 'restored four readers'); for (const w of created) await ready(w);
      assert.deepEqual(capture(), JSON.parse(fs.readFileSync(path.join(root, 'expected.json'))));
      await wait(() => windows().every(w => w.isVisible()), 'restored native show batch');
      assert.equal(windows().every(w => w.isVisible()), true);
      // A real crash after committed transfer retains target DB ownership.
      created[1].webContents.forcefullyCrashRenderer(); await pause(200);
      created[1].webContents.reload(); await ready(created[1]);
      const result = await invoke(created[0], 'restoreBackup'); assert.equal(result.status, 'restarting');
      verified = true; clearTimeout(watchdog); console.log('M7 PASS restore offline'); app.exit(0);
    } else {
      await wait(() => created.length === 4, 'backup restore session'); for (const w of created) await ready(w);
      assert.deepEqual(capture(), JSON.parse(fs.readFileSync(path.join(root, 'expected.json'))));
      verified = true; app.quit();
    }
  }).catch(fail);
  app.on('will-quit', () => { assert.equal(verified, true); clearTimeout(watchdog); console.log('M7 PASS', phase); });
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-m7-electron-'));
    try {
      for (const phase of ['write', 'restart', 'restored']) {
        const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, M7_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('M7 ' + phase + ' exited ' + code))); });
      }
      console.log('M7 production-entry transfer/restart/restore PASS', root);
    } finally { assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m7-electron-')); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

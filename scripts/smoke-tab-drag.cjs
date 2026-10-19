// Category A: synthetic DOM DragEvents through actual production React/preload/

// authenticated IPC/SQLite. Native windows are real; no OS drag loop is claimed.

const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');

const { spawn } = require('node:child_process');

const { DatabaseSync } = require('node:sqlite');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const mime = 'application/x-youtube-comments-tab-v1';

if (process.versions.electron) {

  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();

  const { app, BrowserWindow, Menu, ipcMain, dialog, screen } = require('electron');

  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.M8_PHASE;

  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m8-electron-'));

  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); app.setPath(name, dir); }

  let verified = false, holdReady, releaseReady, readyReached, failLoad = false, cursor;

  const tickets = new Map(), handoffs = new Map(), created = [], gestures = new Map();

  const fail = error => { console.error('M8', phase, error); app.exit(1); };

  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);

  const watchdog = setTimeout(() => fail(Error('M8 watchdog')), 180000);

  const handle = ipcMain.handle.bind(ipcMain);

  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {

    if (channel === 'reader:transfer-ready' && holdReady) { holdReady = false; readyReached = true; await new Promise(resolve => { releaseReady = resolve; }); }

    if (channel === 'reader:transfer-move') handoffs.set(args[0].request.tabId, args[0].request.handoff);

    const result = await handler(event, ...args);

    if (channel === 'reader:transfer-drag-prepare' && result.ok) tickets.set(event.sender, result.value);

    if (channel === 'reader:transfer-drag-start' && result.ok) gestures.set(event.sender, args[0].token);

    return result;

  });

  const loadURL = BrowserWindow.prototype.loadURL;

  BrowserWindow.prototype.loadURL = function(...args) { if (failLoad) { failLoad = false; return Promise.reject(Error('M8 injected load failure')); } return loadURL.apply(this, args); };

  let backup = path.join(root, 'snapshot.sqlite'), restarting = false;

  dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });

  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(root, 'snapshot.sqlite')] });

  dialog.showMessageBox = async () => ({ response: 1 }); dialog.showErrorBox = () => undefined;

  app.relaunch = () => { restarting = true; }; const quit = app.quit.bind(app); app.quit = () => { if (!restarting) quit(); };

  app.on('browser-window-created', (_e, window) => { created.push(window); window.webContents.setBackgroundThrottling(false); window.webContents.on('console-message', event => { if (event.level === 'error') console.error('M8 renderer:', event.message); }); });

  const js = (w, code) => w.webContents.executeJavaScript(code).catch(error => { console.error('M8 failed test command', code.slice(0, 180)); throw error; });

  async function wait(check, label) { for (let n = 0; n < 2000; n++) { if (await check()) return; await pause(10); } throw Error('M8 timeout: ' + label); }

  const boot = async w => { const r = await js(w, 'window.reader.bootstrap()'); assert.equal(r.ok, true); return r.value; };

  const ready = w => wait(() => !w.isDestroyed() && js(w, '!!document.querySelector(".app-shell")'), 'shell');

  const live = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());

  function inspect(action) { const db = new DatabaseSync(path.join(root, 'youtube-comments-development', 'reader.sqlite'), { readOnly: true }); try { return JSON.parse(JSON.stringify(action(db))); } finally { db.close(); } }

  const capture = () => inspect(db => Object.fromEntries(['window_tabs', 'tab_instances', 'discussion_views', 'discussion_view_intent', 'view_collapse', 'view_collapse_overrides', 'item_resume_view', 'window_restore'].map(t => [t, db.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all()])));

  async function invoke(w, name, payload) {

    if (['activateTab', 'openLibrary', 'openSettings', 'openStoredItem', 'closeTab'].includes(name)) payload = { ...payload, expectedRevision: (await boot(w)).workspace.revision };

    const r = await js(w, 'window.reader.' + name + '(' + JSON.stringify(payload ?? {}) + ')'); assert.equal(r.ok, true, JSON.stringify(r)); return r.value;

  }

  const tab = id => 'document.getElementById(' + JSON.stringify('tab-' + id) + ')';

  const panel = id => 'document.getElementById(' + JSON.stringify('panel-' + id) + ')';

  async function begin(w, id) {

    tickets.delete(w.webContents); gestures.delete(w.webContents);

    await js(w, `(()=>{const t=${tab(id)},r=t.getBoundingClientRect();t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,isPrimary:true,pointerType:'mouse',clientX:r.left+20,clientY:r.top+10}));})()`);

    await wait(() => tickets.has(w.webContents), 'prepared ticket');

    await js(w, `(()=>{window.__m8=new DataTransfer();${tab(id)}.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:window.__m8}));})()`);

    await wait(() => gestures.has(w.webContents), 'main started gesture');

    assert.deepEqual(await js(w, 'Array.from(window.__m8.types)'), [mime]);

    return tickets.get(w.webContents);

  }

  async function targetDrop(w, token, beforeId) {

    await js(w, `(()=>{const d=new DataTransfer();d.setData(${JSON.stringify(mime)},${JSON.stringify(token)}); const strip=document.querySelector('.tabs');

      const row=${beforeId ? tab(beforeId) + '.closest(".tab")' : 'null'},r=row?.getBoundingClientRect(); const x=r?r.left+2:strip.getBoundingClientRect().right-1;

      strip.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:d}));strip.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:d,clientX:x}));

      strip.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d,clientX:x}));})()`);

  }

  const end = (w, id) => js(w, `${tab(id)}.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:window.__m8}));void 0`);

  const settled = w => wait(() => js(w, '!document.querySelector(".app-shell").inert'), 'source usable');

  const moved = (w, id) => wait(() => js(w, `!!${tab(id)} && !${panel(id)}?.hidden`), 'committed target');

  async function attach(a, b, id, beforeId = null) {

    const kind = (await boot(a)).workspace.tabs.find(t => t.id === id).kind;

    const ticket = await begin(a, id); await targetDrop(b, ticket.token, beforeId);

    assert.equal((await boot(a)).workspace.tabs.some(t => t.id === id), true, 'source owned through terminal event');

    await end(a, id);

    if (kind === 'discussion') await moved(b, id); else await wait(async () => !(await boot(a)).workspace.tabs.some(t => t.id === id) && (await boot(b)).workspace.tabs.some(t => t.kind === kind), 'singleton merge');

    await settled(a); return ticket;

  }

  async function detach(w, id) {

    const ticket = await begin(w, id);

    await js(w, `document.querySelector('.tabs').dispatchEvent(new DragEvent('dragleave',{bubbles:true,dataTransfer:window.__m8}));void 0`);

    await end(w, id); return ticket;

  }

  async function button(w, text) { await wait(() => js(w, `Array.from(document.querySelectorAll('dialog[open] button')).some(b=>b.textContent===${JSON.stringify(text)})`), text); await js(w, `Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent===${JSON.stringify(text)}).click();void 0`); }

  app.whenReady().then(async () => {

    const getCursor = screen.getCursorScreenPoint.bind(screen);

    screen.getCursorScreenPoint = () => cursor ?? getCursor(); // Synthetic outcome sample, not native-release evidence.

    await wait(() => created.length > 0, 'startup'); await ready(created[0]);

    console.log('M8 category A synthetic DragEvents; real displays', JSON.stringify(screen.getAllDisplays().map(d => ({ id: d.id, workArea: d.workArea, scaleFactor: d.scaleFactor }))));

    if (phase === 'write') {

      const a = created[0]; await invoke(a, 'updatePreferences', { locale: 'en' });

      for (let n = 0; n < 2; n++) { Menu.getApplicationMenu().getMenuItemById('new-reader-window').click(); await wait(() => created.length === n + 2, 'equal reader'); await ready(created[n + 1]); }

      const b = created[1], c = created[2];

      await invoke(b, 'openStoredItem', { itemId: 'video-demo' }); await invoke(b, 'openLibrary'); await invoke(b, 'openSettings'); await invoke(c, 'openStoredItem', { itemId: 'post-demo' });

      const state = await boot(a), video = state.workspace.tabs.find(t => t.itemId === 'video-demo').id, post = state.workspace.tabs.find(t => t.itemId === 'post-demo').id;

      const initialActive = state.workspace.activeTabId, first = state.workspace.tabs[0].id;

      // Local reorder: existing native DOM stays mounted, one CAS commit, active unchanged.

      await begin(a, first); await targetDrop(a, tickets.get(a.webContents).token, null); await end(a, first);

      await wait(async () => (await boot(a)).workspace.tabs.at(-1).id === first, 'local reorder');

      const local = (await boot(a)).workspace; assert.equal(local.revision, state.workspace.revision + 1); assert.equal(local.activeTabId, initialActive);

      await begin(a, first); await targetDrop(a, tickets.get(a.webContents).token, null); await end(a, first); await pause(80);

      assert.equal((await boot(a)).workspace.revision, local.revision, 'no-op has no SQL commit');

      await invoke(a, 'activateTab', { tabId: video }); await wait(() => js(a, `!!${panel(video)}?.querySelector('form')`), 'source reading');

      await js(a, `(()=>{const p=${panel(video)},s=Array.from(p.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value==='unseen')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'unseen');s.dispatchEvent(new Event('change',{bubbles:true}));p.querySelector('form').requestSubmit();})()`); await pause(100);

      const roles = w => js(w, `Array.from(${panel(video)}.querySelectorAll('[data-view-role=match]')).map(e=>e.dataset.domainCommentId)`);

      const frozen = await roles(a); assert.ok(frozen.length);

      await invoke(b, 'toggleSeen', { itemId: 'video-demo', commentId: frozen[0], seen: true, subtree: false });

      await js(a, `Array.from(${panel(video)}.querySelectorAll('button')).find(b=>b.textContent==='Select comments').click();void 0`);

      await js(a, `${panel(video)}.querySelector('.selection-circle').click();void 0`);

      const before = (await boot(b)).workspace.tabs[1].id, ticket = await begin(a, video);

      holdReady = true; readyReached = false; await targetDrop(b, ticket.token, before); await end(a, video);

      await wait(() => readyReached, 'held M7 readiness'); assert.equal(await js(a, `!!${tab(video)}`), true);

      releaseReady(); await moved(b, video); await settled(a);

      assert.deepEqual(await roles(b), frozen); assert.equal(await js(b, `!!${panel(video)}.querySelector('[data-bulk-selected=true]')`), true);

      let target = (await boot(b)).workspace.tabs; assert.equal(target[target.findIndex(t => t.id === video) + 1].id, before);

      assert.equal(target.filter(t => t.itemId === 'video-demo').length, 2, 'normal same-item never merges');

      const sharedBulk = await invoke(b, 'bulkSeen', { itemId: 'video-demo', target: { kind: 'all' }, seen: true });
      assert.ok(sharedBulk.undo); await invoke(a, 'undoSeen', { itemId: 'video-demo', expectedOperationId: sharedBulk.undo.id });
      assert.deepEqual(await roles(b), frozen, 'shared seen/Undo preserves frozen transferred results');
      const oldAuthority = (await boot(b)).viewInstances[video];

      const firstHandoff = handoffs.get(video); await attach(b, a, video); await attach(a, b, video);

      const finalHandoff = handoffs.get(video); assert.deepEqual(finalHandoff.result, firstHandoff.result); assert.deepEqual(finalHandoff.bulkSelected, firstHandoff.bulkSelected); assert.deepEqual(finalHandoff.intent, firstHandoff.intent);

      const current = (await boot(b)).viewInstances[video];

      const stale = await js(b, `window.reader.saveDiscussionView(${JSON.stringify({ viewId: video, expectedRevision: current.intentRevision, ownerGeneration: oldAuthority.ownerGeneration, ...finalHandoff.intent })})`); assert.equal(stale.ok, false, 'ABA stale owner rejected');

      assert.equal((await js(c, `window.reader.transfers.offerDrag(${JSON.stringify({ token: ticket.token, expectedRevision: (await boot(c)).workspace.revision, beforeTabId: null })})`)).ok, false, 'replay rejected');

      await attach(a, c, post);
      for (const other of (await boot(c)).workspace.tabs.filter(t => t.id !== post)) await invoke(c, 'closeTab', { tabId: other.id });

      // Actual delivered Escape cannot detach; global backup revokes uncommitted gestures.

      await begin(c, post); await js(c, "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));void 0"); await end(c, post); assert.equal(live().length, 3);

      await begin(c, post); backup = path.join(root, 'barrier.sqlite'); await invoke(b, 'createBackup'); await end(c, post); assert.equal(live().length, 3);

      // Singleton merge and explicit dirty source decision use the same M7 UI.

      await invoke(a, 'openLibrary'); const library = (await boot(a)).workspace.tabs.find(t => t.kind === 'library').id;

      await attach(a, b, library);

      await invoke(a, 'openSettings'); const settings = (await boot(a)).workspace.tabs.find(t => t.kind === 'settings').id;

      await js(a, `(()=>{const s=document.querySelector('.translation-settings select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'custom');s.dispatchEvent(new Event('change',{bubbles:true}));})()`);

      await js(a, `(()=>{const input=document.querySelector('.custom-translation-controls input'); if(!input) throw Error('translation input missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'xx');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);

      const st = await begin(a, settings); await targetDrop(b, st.token, null); await end(a, settings); await button(a, 'Keep editing'); assert.equal((await boot(a)).workspace.tabs.some(t => t.id === settings), true);

      const st2 = await begin(a, settings); await targetDrop(b, st2.token, null); await end(a, settings); await button(a, 'Discard draft and continue'); await button(a, 'Move to Window\u2026');

      await wait(async () => !(await boot(a)).workspace.tabs.some(t => t.id === settings), 'Settings merged');

      // Controlled cursor samples only: no claim of desktop mouse release.

      const area = screen.getPrimaryDisplay().workArea; for (const w of live()) w.setBounds({ x: area.x, y: area.y, width: Math.min(800, area.width), height: Math.min(600, area.height) });

      cursor = { x: area.x + area.width - 2, y: area.y + area.height - 2 };

      const intended = inspect(db => db.prepare('SELECT * FROM window_restore ORDER BY position').all());

      const count = created.length; failLoad = true; await detach(c, post); await wait(() => created.length === count + 1 && created.at(-1).isDestroyed(), 'failed provisional cleanup'); await settled(c);

      assert.deepEqual(inspect(db => db.prepare('SELECT * FROM window_restore ORDER BY position').all()), intended);

      await detach(c, post); await wait(() => live().length === 4, 'new detached native'); const d = created.at(-1); await ready(d); await moved(d, post); await settled(c); cursor = undefined;

      const bounds = d.getBounds(), display = screen.getDisplayMatching(bounds).workArea;

      assert.ok(bounds.x >= display.x && bounds.y >= display.y && bounds.x + bounds.width <= display.x + display.width && bounds.y + bounds.height <= display.y + display.height);

      assert.equal(c.isVisible(), true); assert.deepEqual((await boot(c)).workspace.tabs, [], 'empty source stays open after detach');
      const priorCount = created.length; Menu.getApplicationMenu().getMenuItemById('new-reader-window').click();
      await wait(() => created.length === priorCount + 1, 'extra equal empty reader'); await ready(created.at(-1));
      c.close(); await wait(() => c.isDestroyed() && live().length === 4, 'ordinary Close removes the empty former source'); await settled(b);

      backup = path.join(root, 'snapshot.sqlite'); await invoke(b, 'createBackup'); fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify(capture()));

      verified = true; app.quit();

    } else {

      await wait(() => created.length === 4, 'restore four'); for (const w of created) await ready(w);

      assert.deepEqual(capture(), JSON.parse(fs.readFileSync(path.join(root, 'expected.json')))); assert.equal(live().every(w => w.isVisible()), true);

      if (phase === 'restart') { const result = await invoke(created[0], 'restoreBackup'); assert.equal(result.status, 'restarting'); verified = true; clearTimeout(watchdog); console.log('M8 PASS offline restore'); app.exit(0); }

      verified = true; app.quit();

    }

  }).catch(fail);

  app.on('will-quit', () => { assert.equal(verified, true); clearTimeout(watchdog); console.log('M8 PASS', phase); });

  require(path.resolve(__dirname, '../.vite/build/main.js'));

} else {

  (async () => {

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-m8-electron-'));

    try {

      for (const phase of ['write', 'restart', 'restored']) {

        const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, M8_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;

        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });

        await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('M8 ' + phase + ' exited ' + code))); });

      }

      console.log('M8 category A production-entry PASS', root);

    } finally { assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m8-electron-')); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }

  })().catch(error => { console.error(error); process.exitCode = 1; });

}


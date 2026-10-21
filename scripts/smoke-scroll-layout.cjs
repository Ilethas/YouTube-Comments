// Real production entry/Chromium geometry, offline data and owned OS-temp paths.
// --baseline verifies the original normal-flow feedback cause before the fix.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const panel = "document.querySelector('.reader-panel:not([hidden])')";
const messages = {
  pending: 'Moving tab…', sent: 'Tab moved to the destination window.',
  received: 'Moved tab activated in this window.',
  failed: 'The tab could not be moved. Its source is preserved. Try again from the tab menu.',
};
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, Menu, ipcMain } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-scroll-layout-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); app.setPath(name, folder);
  }
  const baseline = process.env.SCROLL_LAYOUT_BASELINE === '1', created = [], samples = [];
  const artifacts = path.resolve(__dirname, '../.packaging-diagnostics/scroll-layout');
  fs.mkdirSync(artifacts, { recursive: true });
  const ids = JSON.parse(fs.readFileSync(path.join(root, 'ids.json')));
  const fail = error => { console.error(error); app.exit(1); };
  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  const notificationVerification = process.env.NOTIFICATION_VERIFICATION === '1';
  const watchdog = setTimeout(() => fail(Error('scroll layout watchdog')), notificationVerification ? 240000 : 120000);
  let verified = false, holdReady = false, releaseReady, held = false, failOwner = false, submittedAnchor;
  const prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(sql) {
    if (failOwner && sql.startsWith('UPDATE tab_instances SET owner_window_id=')) {
      failOwner = false; throw Error('Scroll regression: injected transfer rollback');
    }
    return prepare.call(this, sql);
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    if (channel === 'reader:transfer-move') submittedAnchor = args[0].request.handoff?.intent.anchor;
    if (channel === 'reader:transfer-ready' && holdReady) {
      holdReady = false; held = true; await new Promise(resolve => { releaseReady = resolve; });
    }
    return handler(event, ...args);
  });
  app.on('browser-window-created', (_event, w) => { created.push(w); w.webContents.setBackgroundThrottling(false); });
  const js = async (w, code) => {
    try { return await w.webContents.executeJavaScript(code); }
    catch (error) { throw Error('Renderer expression failed: ' + code, { cause: error }); }
  };
  async function wait(check, label) {
    for (let n = 0; n < 1200; n++) { if (await check()) return; await pause(10); }
    throw Error('Scroll layout timeout: ' + label);
  }
  const frames = w => js(w, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const ready = w => wait(() => js(w, "!!document.querySelector('.app-shell') && !document.querySelector('.app-shell').inert"), 'ready');
  async function boot(w) { const r = await js(w, 'window.reader.bootstrap()'); assert.equal(r.ok, true); return r.value; }
  async function invoke(w, method, request) {
    const r = await js(w, `window.reader.${method}(${JSON.stringify(request)})`);
    assert.equal(r.ok, true, JSON.stringify(r)); await frames(w); return r.value;
  }
  async function activate(w, id) {
    // Use App's activation path, including its outgoing view flush/focus lane.
    await js(w, `document.getElementById(${JSON.stringify('tab-' + id)}).click();void 0`);
    await wait(() => js(w, `${panel}?.dataset.viewId===${JSON.stringify(id)} && !!${panel}.querySelector('.virtual-reader')`), 'active reader');
    await frames(w);
  }
  const status = (w, text) => wait(() => js(w, `Array.from(document.querySelectorAll('[role=status]')).some(e=>e.textContent===${JSON.stringify(text)})`), text);
  async function move(w, id, targetNumber) {
    await js(w, `document.getElementById(${JSON.stringify('tab-' + id)}).dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}));void 0`);
    await wait(() => js(w, "!!document.querySelector('[role=menu]')"), 'tab menu');
    await js(w, `Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent==='Move to Window…').click();void 0`);
    await wait(() => js(w, "!!document.querySelector('dialog[open] .move-tab-option input')"), 'move chooser');
    await js(w, `Array.from(document.querySelectorAll('.move-tab-option')).find(e=>e.querySelector('strong')?.textContent===${JSON.stringify('Window ' + targetNumber)}).querySelector('input').click();void 0`);
    await js(w, "document.querySelector('.move-tab-primary').click();void 0");
  }
  async function geometry(w, label, text) {
    if (text) await status(w, text);
    await frames(w);
    const g = await js(w, `(()=>{const d=document.scrollingElement,p=${panel},t=document.querySelector('.app-toolbar'),s=Array.from(document.querySelectorAll('[role=status]')).find(e=>e.textContent===${JSON.stringify(text ?? '')});return {
      viewport:innerHeight,document:d.scrollHeight,client:d.clientHeight,body:document.body.scrollHeight,scroll:scrollY,
      toolbarTop:t.getBoundingClientRect().top,panelHeight:p?.clientHeight,panelScroll:p?.scrollTop,panelContent:p?.scrollHeight,
      mounted:p?.querySelectorAll('[data-domain-comment-id]').length,rows:p?.querySelector('.virtual-reader')?.dataset.rowCount,
      status:s?{role:s.getAttribute('role'),live:s.getAttribute('aria-live'),inert:!!s.closest('[inert]'),display:getComputedStyle(s).display,position:getComputedStyle(s).position,top:s.getBoundingClientRect().top,bottom:s.getBoundingClientRect().bottom}:null,
      htmlOverflow:getComputedStyle(document.documentElement).overflowY,bodyOverflow:getComputedStyle(document.body).overflowY};})()`);
    samples.push({ label, ...g });
    if (!baseline) {
      assert.equal(g.document, g.client, label + ': document fits viewport: ' + JSON.stringify(g));
      assert.equal(g.client, g.viewport); assert.equal(g.scroll, 0); assert.equal(g.toolbarTop, 0);
      assert.ok(!['hidden', 'clip'].includes(g.htmlOverflow) && !['hidden', 'clip'].includes(g.bodyOverflow), 'no document overflow mask');
      await js(w, 'window.scrollTo(0,100000);void 0');
      assert.equal(await js(w, 'scrollY'), 0, label + ': document cannot scroll');
    }
    if (text) {
      assert.equal(g.status.role, 'status'); assert.equal(g.status.live, 'polite');
      assert.equal(g.status.inert, false); assert.notEqual(g.status.display, 'none');
      if (!baseline) assert.ok(g.status.top >= 0 && g.status.bottom <= g.viewport && g.status.bottom > g.status.top, 'visible feedback inside viewport');
    }
    return g;
  }
  async function scroll(w, bottom = false) {
    // Reapply the bottom as virtual heights converge, rather than trusting the estimate.
    for (let n = 0; n < 8; n++) {
      await js(w, `${panel}.scrollTop=${bottom ? `${panel}.scrollHeight` : '70000'};void 0`); await frames(w);
    }
    await wait(() => js(w, `${panel}.querySelectorAll('[data-domain-comment-id]').length>0`), 'mounted virtual rows');
    if (bottom) await wait(() => js(w, `${panel}.scrollHeight-${panel}.clientHeight-${panel}.scrollTop<=1`), 'reader bottom');
    const g = await geometry(w, bottom ? 'reader bottom' : 'reader middle');
    assert.ok(g.panelContent > g.panelHeight * 20); assert.ok(g.panelScroll > 1000);
    assert.equal(g.rows, String(ids.seen.length)); assert.ok(g.mounted > 0 && g.mounted < 100, 'virtual rows remain bounded');
  }
  async function wheel(w, upward) {
    w.focus(); w.webContents.focus(); await frames(w);
    const before = await js(w, `${panel}.scrollTop`);
    const point = await js(w, `(()=>{const r=${panel}.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    w.webContents.sendInputEvent({ type: 'mouseWheel', ...point, deltaY: upward ? 240 : -240, deltaX: 0 });
    await wait(() => js(w, `${panel}.scrollTop${upward ? '<' : '>'}${before}`), 'native reader wheel');
    // Capture cached-tab anchors only after the native wheel's full scroll
    // sequence, rather than racing the first frame of Chromium's scrolling.
    await js(w, `new Promise(resolve=>{let previous=-1,stable=0,frames=0;const tick=()=>{const top=${panel}.scrollTop;stable=Math.abs(top-previous)<.1?stable+1:0;previous=top;if(stable>=4||++frames>=120)resolve();else requestAnimationFrame(tick)};requestAnimationFrame(tick)})`);
    await geometry(w, 'native wheel after transfer');
  }
  async function anchor(w) {
    return js(w, `(()=>{const p=${panel},top=p.getBoundingClientRect().top,r=Array.from(p.querySelectorAll('.virtual-comment')).find(r=>r.getBoundingClientRect().bottom>top);return r?{id:r.dataset.commentId,offset:r.getBoundingClientRect().top-top}:null;})()`);
  }
  app.whenReady().then(async () => {
    await wait(() => created.length === 1, 'source'); const a = created[0]; await ready(a);
    Menu.getApplicationMenu().getMenuItemById('new-reader-window').click();
    await wait(() => created.length === 2, 'target'); const b = created[1]; await ready(b);
    await invoke(b, 'openStoredItem', { itemId: 'post-demo', expectedRevision: (await boot(b)).workspace.revision });
    const post = (await boot(b)).workspace.activeTabId;
    await activate(a, ids.view); await scroll(a); const before = await anchor(a);
    const initial = await geometry(a, 'before any feedback'); assert.equal(initial.document, initial.client);
    holdReady = true; await move(a, ids.view, 2); await wait(() => held, 'pending readiness');
    await geometry(a, 'pending transfer', messages.pending);
    const pendingAnchor = await anchor(a);
    releaseReady(); await ready(a); await status(a, messages.sent); await status(b, messages.received);
    const sent = await geometry(a, 'source success', messages.sent), received = await geometry(b, 'destination success', messages.received);
    if (baseline) {
      assert.ok(sent.document > sent.client && received.document > received.client);
      await js(b, 'window.scrollTo(0,100000);void 0');
      assert.ok(await js(b, "scrollY>0 && document.querySelector('.app-toolbar').getBoundingClientRect().top<0"));
      // Remove only the status paragraph from layout: prove the causal link.
      await js(b, `Array.from(document.querySelectorAll('[role=status]')).find(e=>e.textContent===${JSON.stringify(messages.received)}).style.display='none';void 0`);
      const removed = await geometry(b, 'only feedback removed'); assert.equal(removed.document, removed.client);
      console.log('BASELINE CONFIRMED: feedback alone overflows the document and outer scrolling moves the toolbar.');
    } else {
      await wait(() => js(b, `${panel}?.dataset.viewId===${JSON.stringify(ids.view)}`), 'destination panel'); await frames(b);
      // Compare the final frozen source checkpoint, after move preparation and
      // measurement, with the adopted destination. No restart reconstruction.
      await wait(async () => { const a = await anchor(b); return a?.id === submittedAnchor.commentId && Math.abs(a.offset + submittedAnchor.offset) < 3; }, 'adopted logical anchor');
      const after = await anchor(b); assert.equal(after.id, before.id);
      assert.ok(Math.abs(after.offset - pendingAnchor.offset) < 3, JSON.stringify({pendingAnchor,submittedAnchor,after}));
      await wheel(b, false); await scroll(b, true); await wheel(b, true);
      const savedAnchor = await anchor(b);
      await activate(b, post);
      await geometry(b, 'switch to Community', messages.received);
      await js(b, "document.getElementById('settings-toggle').click();void 0");
      await wait(() => js(b, "!!document.querySelector('.reader-panel:not([hidden]) .settings-view')"), 'Settings tab');
      await geometry(b, 'switch to Settings', messages.received);
      await activate(b, ids.view);
      try { await wait(async () => (await anchor(b))?.id === savedAnchor.id, 'cached tab anchor restored'); }
      catch (error) { console.error('Cached anchor evidence', JSON.stringify({savedAnchor,actual:await anchor(b),state:(await boot(b)).discussionViews[ids.view],geometry:await geometry(b,'cached anchor failure'),rows:await js(b,`(()=>{const p=${panel},l=p.querySelector('.virtual-reader');return {panelTop:p.getBoundingClientRect().top,listTop:l.getBoundingClientRect().top,items:[...p.querySelectorAll('.virtual-comment')].map(e=>({index:e.dataset.index,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,transform:e.style.transform}))}})()`)})); throw error; }
      const restored = await anchor(b);
      assert.equal(restored.id, savedAnchor.id); assert.ok(Math.abs(restored.offset - savedAnchor.offset) < 3);
      for (const size of [{width:720,height:520},{width:1280,height:900},{width:900,height:650}]) {
        b.setBounds(size); await frames(b); await scroll(b, true); await wheel(b, true);
        await geometry(b, 'resize ' + JSON.stringify(size), messages.received);
        if (size.width === 720) fs.writeFileSync(path.join(artifacts, 'narrow-after-transfer.png'), (await b.webContents.capturePage()).toPNG());
      }
      await wait(() => js(b, `!!${panel}.querySelector('.back-to-top')`), 'floating Back to Top');
      const ruler = await js(b, `(()=>{const r=${panel}.querySelector('.discussion-ruler').getBoundingClientRect(),p=${panel}.getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,panelTop:p.top,panelBottom:p.bottom,width:innerWidth};})()`);
      assert.ok(ruler.top >= ruler.panelTop && ruler.bottom <= ruler.panelBottom + 1 && ruler.right <= ruler.width);
      await js(b, `${panel}.querySelector('.back-to-top').click();void 0`);
      await wait(() => js(b, `${panel}.scrollTop===0`), 'Back to Top'); await geometry(b, 'floating Back to Top', messages.received);
      // Fail a real ownership transaction, then retry the same source successfully.
      failOwner = true; await move(b, ids.view, 1); await status(b, messages.failed); await ready(b);
      assert.equal(failOwner, false); await geometry(b, 'failed transfer', messages.failed);
      fs.writeFileSync(path.join(artifacts, 'failed-transfer.png'), (await b.webContents.capturePage()).toPNG());
      assert.equal((await boot(b)).workspace.activeTabId, ids.view); await scroll(b); await wheel(b, false);
      await move(b, ids.view, 1); await status(b, messages.sent); await status(a, messages.received);
      await geometry(b, 'retry source', messages.sent); await geometry(a, 'retry target', messages.received);
      await scroll(a, true); await wheel(a, true);
      assert.deepEqual((await boot(a)).comments[ids.item].map(c => c.seen), ids.seen, 'scrolling/transfers never mark seen');
      console.log('Scroll layout PASS: pending/success/rollback/retry, 3k virtual rows, anchor, tab switches, bottom, resize, native wheel, ruler and floating control.');
    }
    if (notificationVerification) {
      const notice = "document.querySelector('.move-feedback')";
      const close = "document.querySelector('.notification-close')";
      const empty = w => wait(() => js(w, `${notice}.textContent===''`), 'dismissed notification');
      const visible = (w, text) => js(w, `${notice}.textContent===${JSON.stringify(text)}`);
      async function settings(w) {
        await js(w, "document.getElementById('settings-toggle').click();void 0");
        await wait(() => js(w, "!!document.querySelector('.reader-panel:not([hidden]) .notification-settings')"), 'notification settings');
      }
      async function preference(w, label, value) {
        await js(w, `(()=>{const s=Array.from(document.querySelectorAll('.notification-settings label')).find(e=>e.textContent.startsWith(${JSON.stringify(label)})).querySelector('select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,${JSON.stringify(String(value))});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await wait(() => js(w, "!document.querySelector('.notification-settings select').disabled"), 'acknowledged notification preference');
      }
      const settingsValues = w => js(w, "Array.from(document.querySelectorAll('.notification-settings select')).map(e=>e.value)");
      await settings(a); await settings(b);
      assert.deepEqual(await settingsValues(a), ['manual']);
      await preference(b, 'Dismissal mode', 'automatic');
      await wait(async () => (await settingsValues(a))[0] === 'automatic', 'mode sync to peer Settings');
      for (const seconds of [3,5,10,15,30]) {
        await preference(b, 'Dismiss after', seconds);
        await wait(async () => (await settingsValues(a))[1] === String(seconds), 'duration sync to peer Settings');
        assert.equal((await boot(a)).preferences.notificationDurationSeconds, seconds);
      }
      await preference(b, 'Dismiss after', 3); await activate(a, ids.view);
      holdReady = true; await move(a, ids.view, 2); await wait(() => held, 'held pending notification');
      await pause(3300); assert.equal(await visible(a, messages.pending), true, 'pending does not time out');
      assert.equal(await js(a, `${close}.closest('[role=dialog]')!==null && !${close}.closest('[inert]')`), true);
      // A native click reaches the pending close button above the blocking surface.
      const hit = await js(a, `(()=>{const r=${close}.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      a.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...hit}); a.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...hit});
      await empty(a); assert.equal(await js(a, "document.querySelector('.app-shell').inert"), true, 'dismissal does not cancel the operation');
      releaseReady(); await ready(a); await status(a, messages.sent); await status(b, messages.received);
      await geometry(b, 'notification overlay before dismiss', messages.received);
      // Hover and keyboard focus overlap: neither may release the other's pause.
      b.focus(); b.webContents.focus();
      const hover = await js(b, `(()=>{const r=document.querySelector('.notification-overlay').getBoundingClientRect();return {x:Math.round(r.x+8),y:Math.round(r.y+8)}})()`);
      b.webContents.sendInputEvent({type:'mouseMove',...hover}); await pause(3300); assert.equal(await visible(b, messages.received), true);
      await js(b, `${close}.focus();void 0`); b.webContents.sendInputEvent({type:'mouseMove',x:10,y:180});
      await pause(3300); assert.equal(await visible(b, messages.received), true, 'focus keeps notification visible after pointer leaves');
      const region = await js(b, `(()=>{const r=${notice},c=${close};return {role:r.getAttribute('role'),live:r.getAttribute('aria-live'),atomic:r.getAttribute('aria-atomic'),label:c.getAttribute('aria-label'),separate:!r.contains(c),focused:document.activeElement===c}})()`);
      assert.deepEqual(region, {role:'status',live:'polite',atomic:'true',label:'Dismiss notification',separate:true,focused:true});
      b.webContents.debugger.attach('1.3');
      try {
        const { nodes } = await b.webContents.debugger.sendCommand('Accessibility.getFullAXTree');
        const live = nodes.find(node => !node.ignored && node.role?.value === 'status' && node.properties?.some(property => property.name === 'live' && property.value.value === 'polite'));
        assert.ok(live, 'Chromium exposes the polite status region');
        assert.ok(live.properties.some(property => property.name === 'atomic' && property.value.value === true));
        assert.ok(nodes.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === 'Dismiss notification'), 'Chromium exposes the named close button');
        fs.writeFileSync(path.join(artifacts, 'notification-accessibility.json'), JSON.stringify(nodes.filter(node => node.nodeId === live.nodeId || node.name?.value === 'Dismiss notification'), null, 2));
      } finally { b.webContents.debugger.detach(); }
      b.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'}); b.webContents.sendInputEvent({type:'char',keyCode:'\r'}); b.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'}); await empty(b);
      assert.equal(await js(b, "document.activeElement===document.body"), true, 'close does not move focus to a reader control');
      await geometry(b, 'notification manually dismissed');
      // Real native transfers with each actual timeout. Reader height stays fixed.
      let source=b, target=a, targetNumber=1;
      for (const seconds of [3,5,10,15,30]) {
        await invoke(source, 'updatePreferences', {notificationDurationSeconds:seconds});
        await move(source, ids.view, targetNumber); await ready(source); await status(source, messages.sent); await status(target, messages.received);
        const before = await geometry(target, 'automatic '+seconds, messages.received);
        await pause(seconds*1000+150); await empty(source); await empty(target);
        const after = await geometry(target, 'expired '+seconds);
        assert.equal(after.panelHeight, before.panelHeight, 'overlay never resizes reading viewport');
        [source,target]=[target,source]; targetNumber=targetNumber===1?2:1;
      }
      await invoke(source, 'updatePreferences', {notificationDurationSeconds:3});
      failOwner=true; await move(source, ids.view, targetNumber); await ready(source); await status(source,messages.failed);
      await pause(3300); assert.equal(await visible(source,messages.failed),true,'failure never times out');
      await js(source, `${close}.click();void 0`); await empty(source);
      await invoke(source, 'updatePreferences', {notificationDismissal:'manual'});
      await move(source,ids.view,targetNumber); await ready(source); await status(source,messages.sent); await status(target,messages.received);
      await pause(3300); assert.equal(await visible(target,messages.received),true,'manual success stays visible');
      await js(target, `${close}.click();void 0`); await empty(target);
      target.webContents.reload(); await wait(() => js(target,"!!document.querySelector('.app-shell')"),'reload'); await ready(target);
      assert.equal((await boot(target)).preferences.notificationDismissal,'manual'); assert.equal((await boot(target)).preferences.notificationDurationSeconds,3); await empty(target);
      await settings(target); assert.deepEqual(await settingsValues(target),['manual']);
      console.log('Notifications PASS: native transfers, pending close/settlement, persistent failure/manual mode, every real timeout, hover/focus, keyboard/live-region semantics, peer Settings synchronization, reload and fixed viewport.');
    }
    const report = path.join(artifacts, baseline ? 'baseline.json' : 'fixed.json');
    fs.writeFileSync(report, JSON.stringify(samples, null, 2)); console.log('Scroll geometry:', report);
    verified = true; app.quit();
  }).catch(fail);
  app.on('will-quit', () => { assert.equal(verified, true); clearTimeout(watchdog); });
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    assert.ok(fs.existsSync(path.resolve(__dirname, '../.vite/build/main.js')), 'Build Forge first');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-scroll-layout-'));
    try {
      require('esbuild').buildSync({ stdin: { contents: `export {ReaderRepository} from './src/main/persistence/reader-repository'; export {normalizeYtDlp} from './src/main/extractors/yt-dlp';`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: path.join(root, 'seed.cjs') });
      const { ReaderRepository, normalizeYtDlp } = require(path.join(root, 'seed.cjs'));
      const repo = ReaderRepository.open(path.join(root, 'youtube-comments-development', 'reader.sqlite'));
      try {
        repo.initializeDemo();
        const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json')));
        fixture.raw.comments.push(...Array.from({ length: 3000 }, (_, i) => ({ id: 'scroll-row-' + i, parent: i % 10 ? 'scroll-row-' + (i - i % 10) : 'root', text: `Scroll regression row ${i}\n${'Variable height fictional discussion. '.repeat(1 + i % 7)}`, timestamp: 1790856000 + i })));
        const item = repo.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), undefined, true).itemId;
        repo.updatePreferences({ locale: 'en' }, ['en']); const state = repo.bootstrap(['en']);
        assert.equal(state.preferences.notificationDismissal, 'automatic'); assert.equal(state.preferences.notificationDurationSeconds, 5);
        repo.updatePreferences({ notificationDismissal: 'manual' }, ['en']);
        const view = state.workspace.tabs.find(t => t.itemId === item).id;
        fs.writeFileSync(path.join(root, 'ids.json'), JSON.stringify({ item, view, seen: state.comments[item].map(c => c.seen) }));
      } finally { repo.close(); }
      const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, NOTIFICATION_VERIFICATION: process.argv.includes('--notifications') ? '1' : '0', SCROLL_LAYOUT_BASELINE: process.argv.includes('--baseline') ? '1' : '0' }; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); assert.equal(code, 0);
    } finally {
      assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-scroll-layout-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

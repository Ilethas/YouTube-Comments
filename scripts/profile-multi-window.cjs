// M9.1 production-entry scale verification. Timings are observations, never gates.
// All privileged hooks are confined to this runner; no application test API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const fixture = require('./m91-fixture.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve(__dirname, '../.packaging-diagnostics/m91');
function inspect(root, action) {
  const db = new DatabaseSync(fixture.database(root), { readOnly: true });
  try { return action(db); } finally { db.close(); }
}
// Hash every authoritative row, including evidence, optional/dormant views and Undo.
function digest(file, exclude = []) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .filter(r => !exclude.includes(r.name)).map(({ name }) => [name, createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all())).digest('hex')]));
  } finally { db.close(); }
}
// Install before scripts execute, using CDP; never wraps or exposes the preload bridge.
const rendererProbe = `(()=>{
  const p=window.__m91={workers:[],longTasks:[],frames:[],started:performance.now()};
  new PerformanceObserver(list=>{for(const e of list.getEntries())p.longTasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});
  let last=performance.now();function frame(t){if(p.frames.length<20000)p.frames.push(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);
  const post=Worker.prototype.postMessage;
  Worker.prototype.postMessage=function(value,...rest){
    const sample={id:value.id,count:value.comments?.length,at:performance.now()};p.workers.push(sample);
    const listener=e=>{if(e.data.id===value.id){sample.roundtripMs=performance.now()-sample.at;sample.ok=e.data.outcome?.ok;this.removeEventListener('message',listener);}};
    this.addEventListener('message',listener);const start=performance.now();const result=post.call(this,value,...rest);sample.postMs=performance.now()-start;return result;
  };
})();`;
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, BrowserWindow, ipcMain, Menu, dialog, screen, session } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.M91_PHASE;
  const artifactPrefix = process.env.M91_LABEL+'-'+process.env.M91_WINDOWS+'-'+phase;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m91-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); app.setPath(name, dir);
  }
  const start = performance.now(), launchToEntryMs = Date.now()-Number(process.env.M91_LAUNCH_AT), loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
  const created = [], ipc = {}, notifications = {}, operations = [], handoffs = [];
  const cpu = process.env.M91_CPU === '1';
  let mainProfiler;
  const profileCommand = (method) => new Promise((resolve,reject)=>mainProfiler.post(method,(error,result)=>error?reject(error):resolve(result)));
  if (cpu) { mainProfiler = new (require('node:inspector').Session)(); mainProfiler.connect(); mainProfiler.post('Profiler.enable'); mainProfiler.post('Profiler.start'); }
  let verified = false, backupPath = path.join(root, 'snapshot.sqlite'), heldReady, releaseReady, failDrain = false, failOwner = false, transferBefore;
  const fail = error => { console.error('M9.1', phase, error, 'operations',operations,'IPC',ipc); app.exit(1); };
  dialog.showErrorBox = (title, detail) => fail(Error(title + ': ' + detail));
  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  const watchdog = setTimeout(() => fail(Error('M9.1 hang guard')), 300000);
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(sql) {
    if (failOwner && sql.startsWith('UPDATE tab_instances SET owner_window_id=')) {
      transferBefore = digest(fixture.database(root), ['window_geometry','window_session']);
      failOwner = false; throw Error('M91 injected transfer failure');
    }
    return originalPrepare.call(this, sql);
  };
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    if (channel === 'reader:profile-drain' && failDrain) { failDrain = false; return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
    if (channel === 'reader:transfer-ready' && heldReady) { heldReady(); heldReady = undefined; await new Promise(resolve => { releaseReady = resolve; }); }
    if (channel === 'reader:transfer-move') handoffs.push(args[0]?.request?.handoff);
    const at = performance.now(), result = await handler(event, ...args), elapsed = performance.now() - at;
    const stat = ipc[channel] ??= { calls: 0, totalMs: 0, maxMs: 0, requestBytes: 0, responseBytes: 0 };
    stat.calls++; stat.totalMs += elapsed; stat.maxMs = Math.max(stat.maxMs, elapsed);
    // JSON UTF-8 size is a repeatable proxy, not Electron wire size. Sizing is
    // outside handler timing but contributes to overall wall time/main stalls.
    stat.requestBytes += Buffer.byteLength(JSON.stringify(args)); stat.responseBytes += Buffer.byteLength(JSON.stringify(result) ?? '');
    return result;
  });
  const load = BrowserWindow.prototype.loadURL;
  BrowserWindow.prototype.loadURL = async function(...args) {
    // CDP commands need a renderer; initialize only an inert blank document.
    await load.call(this, 'about:blank');
    if (!this.webContents.debugger.isAttached()) this.webContents.debugger.attach('1.3');
    await this.webContents.debugger.sendCommand('Page.enable');
    await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: rendererProbe });
    if (cpu) { await this.webContents.debugger.sendCommand('Profiler.enable'); await this.webContents.debugger.sendCommand('Profiler.start'); }
    return load.apply(this, args);
  };
  app.on('browser-window-created', (_e, w) => {
    console.log('M91 native',phase,created.length); created.push(w); w.webContents.setBackgroundThrottling(false);
    const send = w.webContents.send.bind(w.webContents);
    w.webContents.send = (channel,...args) => {
      const stat = notifications[channel] ??= { calls:0,bytes:0 };
      stat.calls++;stat.bytes+=Buffer.byteLength(JSON.stringify(args));return send(channel,...args);
    };
  });
  const js = (w, code) => w.webContents.executeJavaScript(code);
  async function wait(check, label) {
    const deadline = performance.now() + 120000;
    while (performance.now() < deadline) { if (await check()) return; await pause(20); }
    throw Error('M91 timeout: ' + label);
  }
  const panel = "document.querySelector('.reader-panel:not([hidden])')";
  const ready = w => wait(() => js(w, `!!${panel}?.querySelector('form') && !${panel}.querySelector('.query-status')?.textContent.includes('Evaluating') && !document.querySelector('.app-shell[inert]')`), 'usable reader');
  const released = () => Promise.all(created.filter(w=>!w.isDestroyed()).map(w=>wait(()=>js(w,'!document.querySelector(".app-shell[inert]")'),'all participants acknowledge release')));
  async function invoke(w, method, value) {
    const r = await js(w, `window.reader.${method}(${value === undefined ? '' : JSON.stringify(value)})`);
    assert.equal(r.ok, true, method + ': ' + JSON.stringify(r)); return r.value;
  }
  const metadata = w => invoke(w, 'getSharedMetadata');
  async function active(w, id) { const before = await metadata(w); await invoke(w, 'activateTab', { tabId: id, expectedRevision: before.workspace.revision }); await ready(w); await wait(() => js(w, `${panel}?.dataset.viewId===${JSON.stringify(id)}`), 'active view'); }
  async function control(w, selector, value) {
    await js(w, `(()=>{const e=${panel}.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
  }
  async function timed(name, action) { const at = performance.now(); const result = await action(); const sample={ name, ms: performance.now() - at };operations.push(sample);console.log('M91 operation',JSON.stringify(sample));return result; }
  async function apply(w) {
    const count = await js(w, 'window.__m91.workers.length');
    await js(w, `${panel}.querySelector('form').requestSubmit();void 0`);
    await wait(() => js(w, `window.__m91.workers.length>${count} && window.__m91.workers.at(-1).roundtripMs!==undefined`), 'query worker');
    assert.equal(await js(w, 'window.__m91.workers.at(-1).ok'), true);
    await ready(w);
  }
  async function move(w, id, targetIndex) {
    await js(w, `document.getElementById(${JSON.stringify('tab-' + id)}).dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true,cancelable:true}));void 0`);
    await wait(() => js(w, '!!document.querySelector("[role=menu]")'), 'tab menu');
    await js(w, `Array.from(document.querySelectorAll('[role=menuitem]')).find(e=>e.textContent.includes('Move to Window')).click();void 0`);
    await wait(() => js(w, '!!document.querySelector("dialog[open]")'), 'chooser');
    const windows = inspect(root, db => db.prepare('SELECT window_id FROM window_restore ORDER BY position').all().map(r => r.window_id));
    const dest = await invoke(w, 'transfers.destinations');
    const number = dest.find(d => d.windowId === windows[targetIndex]).number;
    await js(w, `(()=>{const e=Array.from(document.querySelectorAll('.move-tab-option')).find(e=>e.querySelector('strong')?.textContent==='Window ${number}').querySelector('input');e.click();})()`);
    await js(w, 'document.querySelector(".move-tab-primary").click();void 0');
  }
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: backupPath });
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(root, 'snapshot.sqlite')] });
  dialog.showMessageBox = async () => ({ response: 1 });
  // Production helper resolution/probe/normalization/merge, deterministic bytes.
  const helper = path.join(root,'fixture-helper.exe'); fs.writeFileSync(helper,'M91 never executed');
  process.env.YOUTUBE_COMMENTS_YTDLP_EXE = helper;
  process.env.YOUTUBE_COMMENTS_POST_ARCHIVER_EXE = path.join(root,'missing.exe');
  const childProcess = require('node:child_process'), launch = childProcess.spawn;
  childProcess.spawn = (file,args,...rest) => {
    if (file !== helper) return launch(file,args,...rest);
    const child = new (require('node:events').EventEmitter)();
    child.stdout = new (require('node:stream').PassThrough)(); child.stderr = new (require('node:stream').PassThrough)();
    child.kill = () => { child.emit('close',1); return true; };
    setImmediate(()=>{child.stdout.write(args.includes('--version') ? '2026.08.19\n' : fs.readFileSync(path.join(root,'refresh.json')));child.emit('close',0);});
    return child;
  };
  // Parent starts a genuinely new Electron process after offline replacement.
  let restored = false; app.relaunch = () => { restored = true; };
  const quit = app.quit.bind(app); app.quit = () => { if (!restored) quit(); };
  async function measure(label) {
    const renderers = [];
    for (const w of created.filter(w => !w.isDestroyed())) {
      const heap = await w.webContents.debugger.sendCommand('Runtime.getHeapUsage');
      renderers.push({ pid: w.webContents.getOSProcessId(), bounds:w.getBounds(),zoom:w.webContents.getZoomFactor(),heap, probe: await js(w, 'window.__m91'), dom: await js(w, `({rows:document.querySelectorAll('article.comment').length,panels:document.querySelectorAll('.reader-panel').length,width:innerWidth,height:innerHeight,devicePixelRatio})`) });
    }
    return { label, atMs: performance.now() - start, mainMemory: process.memoryUsage(), processes: app.getAppMetrics(), renderers,
      mainLoop: { maxMs: loop.max / 1e6, p99Ms: loop.percentile(99) / 1e6, meanMs: loop.mean / 1e6 } };
  }
  async function save(record) {
    fs.writeFileSync(path.join(root, phase + '.json'), JSON.stringify({ ...record, launchToEntryMs, ipc, notifications, operations, versions: process.versions, displays: screen.getAllDisplays().map(d => ({ bounds: d.bounds, scaleFactor: d.scaleFactor })) }, null, 2));
  }
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_r, cb) => cb({ cancel: true }));
    const expectedWindows = Number(process.env.M91_WINDOWS);
    await wait(() => created.length === expectedWindows, 'intended native set');
    const usable = await Promise.all(created.map(async w => { await ready(w); await wait(() => w.isVisible(), 'visible shell'); return performance.now() - start; }));
    console.log('M91 usable', phase, expectedWindows, usable.map(v => Math.round(v)));
    const initial = await measure('initial'); loop.reset();
    const queryErrors=await Promise.all(created.map(w=>js(w,`${panel}.querySelector('.query-error')?.textContent??null`)));
    if(queryErrors.some(Boolean)) {
      await save({usableMs:usable,measurements:[initial],queryErrors,failed:true});
      fs.copyFileSync(path.join(root,phase+'.json'),path.join(output,artifactPrefix+'-failed.json'));
      assert.fail('initial applied query reconstructed with error: '+JSON.stringify(queryErrors));
    }
    if (phase !== 'restored' && fs.existsSync(path.join(root,'restart-digest.json'))) {
      assert.deepEqual(digest(fixture.database(root),['window_geometry','window_session']),JSON.parse(fs.readFileSync(path.join(root,'restart-digest.json'))),'real process restart retains complete topology/shared/private rows');
    }
    if (cpu) {
      fs.writeFileSync(path.join(output,artifactPrefix+'-main.cpuprofile'),JSON.stringify((await profileCommand('Profiler.stop')).profile)); mainProfiler.disconnect();
      for (const [i,w] of created.entries()) fs.writeFileSync(path.join(output,artifactPrefix+'-renderer-'+i+'.cpuprofile'),JSON.stringify((await w.webContents.debugger.sendCommand('Profiler.stop')).profile));
    }
    if (phase.startsWith('sample')) {
      await save({ usableMs: usable, measurements: [initial] }); verified = true; app.quit(); return;
    }
    if (phase === 'restored') {
      const expected = JSON.parse(fs.readFileSync(path.join(root, 'backup-digest.json')));
      assert.deepEqual(digest(fixture.database(root), ['window_geometry', 'window_session']), expected, 'complete restored authoritative rows (native geometry/focus can acknowledge startup)');
      await save({ usableMs: usable, measurements: [initial], restoredEquality: true });
      // Abrupt main-process exit intentionally skips Quit/renderer checkpoints.
      // The following process compares only committed storage, never unsent JS.
      verified = true; app.exit(0); return;
    }
    if (phase === 'crash-restart') {
      assert.deepEqual(inspect(root,db=>db.prepare('PRAGMA foreign_key_check').all()),[]);
      assert.equal(inspect(root,db=>db.prepare('PRAGMA integrity_check').get().integrity_check),'ok');
      const pending=[];
      for(const [i,w] of created.entries()) {
        const id=(await metadata(w)).workspace.activeTabId,text='M91 Quit pending '+i;
        await control(w,'input[type=search]',text);pending.push({id,text});
      }
      const last=pending.at(-1);
      assert.notEqual(inspect(root,db=>JSON.parse(db.prepare('SELECT draft_query_json FROM discussion_view_intent WHERE view_id=?').get(last.id).draft_query_json).text),last.text,'Quit begins with unsaved renderer intent');
      fs.writeFileSync(path.join(root,'quit-intents.json'),JSON.stringify(pending));
      await save({ usableMs:usable,measurements:[initial],crashRestartEquality:true });verified=true;app.quit();return;
    }
    if (phase === 'quit-restart') {
      const expected=JSON.parse(fs.readFileSync(path.join(root,'quit-intents.json')));
      for(const row of expected) assert.equal(inspect(root,db=>JSON.parse(db.prepare('SELECT draft_query_json FROM discussion_view_intent WHERE view_id=?').get(row.id).draft_query_json).text),row.text,'coordinated Quit drains every large view draft');
      await save({usableMs:usable,measurements:[initial],quitRestartEquality:true});verified=true;app.quit();return;
    }
    const [a,b] = created, id = (await metadata(a)).workspace.activeTabId;
    const counts = await Promise.all(created.map(w => js(w, `${panel}.querySelector('.query-status').textContent`)));
    // Instantiate a second same-item view in EVERY renderer; keep distinct filters.
    for (const w of created) {
      const m = await metadata(w), source = m.workspace.tabs.find(t => t.id === m.workspace.activeTabId);
      const sibling = m.workspace.tabs.find(t => t.kind === 'discussion' && t.itemId === source.itemId && t.id !== source.id);
      await timed('second-view', () => active(w, sibling.id));
      await control(w, 'input[type=search]', 'needle'); await timed('selective-filter', () => apply(w));
      await control(w, 'input[type=search]', 'independent unsent draft');
    }
    await active(a, id);
    const frozen = await js(a, `${panel}.querySelector('.query-status').textContent`);
    await timed('shared-seen', () => invoke(b, 'toggleSeen', { itemId: 'm91-50000', commentId: 'm91-50000-1', subtree: false, seen: true }));
    await wait(() => js(a, `${panel}.querySelector('.query-status').textContent.includes('changes saved')`), 'stale frozen view');
    assert.ok(frozen.includes('33,333'), frozen);
    const bulk = await timed('bulk-50k', () => invoke(b, 'bulkSeen', { itemId: 'm91-50000', seen: true, target: { kind: 'all' } }));
    assert.equal(bulk.changedCount, 33332);
    await timed('undo-50k', () => invoke(a, 'undoSeen', { itemId: 'm91-50000', expectedOperationId: bulk.undo.id }));
    // Actual worker, sorting, distant navigation and scrolling, all views retained.
    const beforeNavigation=inspect(root,db=>db.prepare('SELECT * FROM comment_state ORDER BY comment_id').all());
    await control(a, '.discussion-sort select', 'newest');
    await timed('scroll-and-paint', () => js(a, `${panel}.scrollTop=500000;${panel}.dispatchEvent(new Event('scroll'));new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`));
    await timed('navigation-and-paint', () => js(a, `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'F3',bubbles:true,cancelable:true}));new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`));
    assert.ok(await js(a, `${panel}.querySelectorAll('article.comment').length<100`));
    assert.equal(await js(a,`!!${panel}.querySelector('[data-selected=true]')`),true,'navigation resolves and mounts an exact application target');
    assert.deepEqual(inspect(root,db=>db.prepare('SELECT * FROM comment_state ORDER BY comment_id').all()),beforeNavigation,'sort/scroll/navigation never mark seen');
    // Failure during owner update must roll back every topology/private row.
    failOwner = true; await move(a, id, 1);
    await wait(() => !failOwner, 'injected owner failure'); await wait(() => js(a, '!document.querySelector(".app-shell[inert]")'), 'cancel release');
    assert.deepEqual(digest(fixture.database(root), ['window_geometry','window_session']), transferBefore, 'failed ownership transaction retains EVERY shared/private/topology row after final source checkpoints');
    const targetWorkersBeforeMove=await js(b,'window.__m91.workers.length');
    await timed('transfer-50k', async () => {
      await move(a, id, 1);
      await wait(() => js(b, `!!document.getElementById(${JSON.stringify('panel-'+id)})?.querySelector('form')`), 'adopted live result');
    });
    assert.equal(handoffs.at(-1).result.matchCount, 33333, 'frozen unseen membership survives changes and move');
    assert.equal(handoffs.at(-1).seenStale, true);
    const targetStatus=await js(b,`document.getElementById(${JSON.stringify('panel-'+id)}).querySelector('.query-status').textContent`);
    assert.ok(targetStatus.includes('33,333')&&targetStatus.includes('changes saved'), 'destination displays frozen matches/staleness rather than fresh live Unseen membership');
    assert.equal(await js(b,'window.__m91.workers.length'),targetWorkersBeforeMove,'adopting a live 50k transfer does not reevaluate the query');
    const moved = await metadata(b); assert.equal(moved.workspace.tabs.filter(t=>t.id===id).length,1);
    assert.equal((await metadata(a)).workspace.tabs.some(t=>t.id===id),false);
    let gateReached = false; heldReady = () => { gateReached = true; };
    await move(b,id,0); await wait(()=>gateReached,'held large transfer readiness');
    await invoke(created.at(-1),'toggleSeen',{itemId:'m91-50000',commentId:'m91-50000-2',subtree:false,seen:true});
    releaseReady();
    await wait(()=>js(b,'!document.querySelector(".app-shell[inert]")'),'concurrent seen cancels rendezvous');
    assert.equal((await metadata(b)).workspace.tabs.some(t=>t.id===id),true,'concurrent source change retains owner');
    await timed('refresh-50k',()=>invoke(b,'refresh',{itemId:'m91-50000'}));
    await wait(()=>inspect(root,db=>db.prepare("SELECT count(*) AS n FROM comments WHERE item_id='m91-50000'").get().n)===50001,'accepted new discovery');
    assert.equal(inspect(root,db=>db.prepare("SELECT seen FROM comment_state WHERE comment_id='m91-50000-1'").get().seen),1,'Refresh retains shared seen');
    // Failed M3 drain leaves ALL large readers usable and backup absent.
    backupPath = path.join(root,'failed.sqlite'); failDrain = true;
    const failed = await js(b, 'window.reader.createBackup()'); assert.equal(failed.ok,false); assert.equal(fs.existsSync(backupPath),false);
    await released();
    backupPath = path.join(root,'snapshot.sqlite');
    await timed('backup-60k', () => invoke(b, 'createBackup'));
    await released();
    assert.deepEqual(digest(backupPath), digest(fixture.database(root)), 'all tables snapshot equality');
    fs.writeFileSync(path.join(root,'backup-digest.json'),JSON.stringify(digest(backupPath,['window_geometry','window_session'])));
    // Crash/reload ONE renderer, healthy peers continue shared mutation authority.
    a.webContents.forcefullyCrashRenderer(); await pause(100); a.webContents.reload(); await ready(a);
    await invoke(b, 'toggleSeen', { itemId:'m91-10000',commentId:'m91-10000-1',subtree:false,seen:true });
    const loaded = await measure('two-views-and-transfer');
    let gcAudit;
    if (process.env.M91_GC_AUDIT === '1') {
      // Separate diagnostic only: ordinary timings/heap samples never force GC.
      const inspector = new (require('node:inspector').Session)(); inspector.connect();
      try { await new Promise((resolve,reject)=>inspector.post('HeapProfiler.collectGarbage',error=>error?reject(error):resolve())); }
      finally { inspector.disconnect(); }
      for (const w of created.filter(w=>!w.isDestroyed())) await w.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
      gcAudit = await measure('after-forced-gc');
    }
    const closing = (await metadata(a)).workspace.activeTabId;
    await control(a,'input[type=search]','M91 Close pending draft');
    await timed('ordinary-close-pending-save',async()=>{a.close();await wait(()=>a.isDestroyed(),'acknowledged ordinary Close');});
    assert.equal(inspect(root,db=>JSON.parse(db.prepare('SELECT draft_query_json FROM discussion_view_intent WHERE view_id=?').get(closing).draft_query_json).text),'M91 Close pending draft');
    await timed('restore-60k', () => invoke(b, 'restoreBackup'));
    assert.equal(restored,true);
    assert.equal((await js(b,'window.reader.updatePreferences({appearance:"dark"})')).error.code,'DATA_BUSY');
    await save({ usableMs: usable, initialCounts:counts, measurements:[initial,loaded], gcAudit, restored:true });
    verified = true; app.exit(0);
  }).catch(fail);
  app.on('will-quit', () => { assert.equal(verified,true); clearTimeout(watchdog); });
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else if (process.argv[2] === '--prepare') {
  // Keep fixture generation/structuredClone heaps OUT of the benchmark parent.
  const root = process.argv[3], windows = Number(process.argv[4]);
  assert.ok(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('reader-m91-'));
  const exports = [ ['src/main/persistence/reader-repository.ts','ReaderRepository'],['src/domain/discussion-query.ts','queryComments, evaluateDiscussionQuery'],['src/renderer/discussion-presentation.ts','projectReaderRows'] ];
  require('esbuild').buildSync({stdin:{contents:exports.map(([file,names])=>'export {'+names+'} from '+JSON.stringify(path.resolve(__dirname,'..',file))+';').join('\n'),resolveDir:path.resolve(__dirname,'..'),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:path.join(root,'repository.cjs')});
  const { ReaderRepository, queryComments, evaluateDiscussionQuery, projectReaderRows }=require(path.join(root,'repository.cjs'));
  fixture.seed(root,ReaderRepository,windows);
  const refresh = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../src/main/extractors/__fixtures__/yt-nested-a.json'))).raw;
  refresh.id='M91large001';refresh.title='M9.1 50000';
  refresh.comments=inspect(root,db=>db.prepare("SELECT source_comment_id,parent_id,text,published_at,like_count FROM comments WHERE item_id='m91-50000' ORDER BY position").all())
    .map(r=>({id:r.source_comment_id,parent:r.parent_id??'root',text:r.text,timestamp:Date.parse(r.published_at)/1000,like_count:r.like_count}));
  refresh.comments.push({id:'m91-new-root',parent:'root',text:'needle new discovery',timestamp:1790856000});refresh.comment_count=50001;
  fs.writeFileSync(path.join(root,'refresh.json'),JSON.stringify(refresh));
  const repo=ReaderRepository.open(fixture.database(root)), materialization=[];
  try {
    for(let n=0;n<3;n++){
      const at=performance.now(),state=repo.bootstrap(['en']),readMs=performance.now()-at,cloneAt=performance.now();
      structuredClone(state);materialization.push({readMs,cloneMs:performance.now()-cloneAt,jsonBytes:Buffer.byteLength(JSON.stringify(state))});
    }
    const state=repo.bootstrap(['en']), algorithms=[];
    for(const count of [10000,50000]) for(const criteria of [{...fixture.query,text:'needle'},{...fixture.query,seen:'unseen'},{...fixture.query,text:'camera \\d+',mode:'regex'}]) {
      const comments=state.comments['m91-'+count],at=performance.now(),projection=queryComments(comments,state.items.find(i=>i.id==='m91-'+count)),projectMs=performance.now()-at;
      const cloneAt=performance.now();structuredClone(projection);const cloneMs=performance.now()-cloneAt;
      const queryAt=performance.now(),outcome=evaluateDiscussionQuery(projection,{...criteria,publicationBounds:undefined}),queryMs=performance.now()-queryAt;assert.equal(outcome.ok,true);
      const sortAt=performance.now();projectReaderRows(comments,outcome.result,'newest');
      algorithms.push({count,criteria,projectMs,cloneMs,queryMs,sortAndPresentationMs:performance.now()-sortAt,workerJsonBytes:Buffer.byteLength(JSON.stringify(projection)),matches:outcome.result.matchCount,context:outcome.result.visibleCommentIds.length});
    }
    fs.writeFileSync(path.join(root,'materialization.json'),JSON.stringify({snapshots:materialization,algorithms,databaseBytes:fs.statSync(fixture.database(root)).size}));
  } finally { repo.close(); }
} else {
  (async () => {
    const label = process.argv.find(a => a.startsWith('--label='))?.split('=')[1] ?? 'current';
    assert.match(label,/^[a-z0-9-]+$/);
    const samples = Number(process.argv.find(a => a.startsWith('--samples='))?.split('=')[1] ?? 3);
    assert.ok(Number.isInteger(samples) && samples>0 && samples<=10);
    assert.ok(!process.argv.includes('--only-stress') || process.argv.includes('--stress'),'--only-stress requires --stress');
    fs.mkdirSync(output,{recursive:true});
    const windowCounts=(process.argv.find(a=>a.startsWith('--windows='))?.split('=')[1]??'2,4').split(',').map(Number);
    assert.ok(windowCounts.length>0&&windowCounts.every(n=>[2,3,4].includes(n)));
    const report = { label, build:{mainSha256:createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../.vite/build/main.js'))).digest('hex'),preloadSha256:createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../.vite/build/preload.js'))).digest('hex')},environment:{node:process.versions,os:os.version(),release:os.release(),arch:os.arch(),cpus:os.cpus(),totalMemory:os.totalmem(),freeMemory:os.freemem()},runs:[] };
    for (const windows of windowCounts) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(),'reader-m91-'));
      try {
        const prepared=spawnSync(process.execPath,[__filename,'--prepare',root,String(windows)],{stdio:'inherit',windowsHide:true});
        assert.equal(prepared.status,0,'isolated fixture preparation');
        const materialization=JSON.parse(fs.readFileSync(path.join(root,'materialization.json')));
        for (const phase of [...(process.argv.includes('--only-stress')?[]:Array.from({length:samples},(_,i)=>'sample-'+i)),...(process.argv.includes('--stress')?['stress','restored','crash-restart','quit-restart']:[])]) {
          const env={...process.env,YOUTUBE_COMMENTS_DEMO_ROOT:root,M91_LABEL:label,M91_PHASE:phase,M91_WINDOWS:String(windows),M91_CPU:process.argv.includes('--cpu')?'1':'0',M91_GC_AUDIT:process.argv.includes('--gc-audit')?'1':'0',M91_LAUNCH_AT:String(Date.now())};delete env.ELECTRON_RUN_AS_NODE;
          const at=performance.now(),child=spawn(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});
          await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('M91 '+phase+' exit '+code)));});
          const record=JSON.parse(fs.readFileSync(path.join(root,phase+'.json')));
          if (phase !== 'stress') fs.writeFileSync(path.join(root,'restart-digest.json'),JSON.stringify(digest(fixture.database(root),['window_geometry','window_session'])));
          report.runs.push({windows,phase,processWallMs:performance.now()-at,materialization,...record});
          fs.writeFileSync(path.join(output,label+'.json'),JSON.stringify(report,null,2));
        }
      } finally {
        assert.ok(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('reader-m91-'));
        fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
      }
    }
    console.log('M9.1 PASS',path.join(output,label+'.json'));
  })().catch(error=>{console.error(error);process.exitCode=1;});
}

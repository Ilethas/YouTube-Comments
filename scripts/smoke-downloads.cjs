// Real secured Electron renderers/preload/IPC/SQLite; deterministic extraction gates.
// No network, installed helper or normal-account profile is used.
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
  const { app } = require('electron');
  const root = process.env.DOWNLOADS_SMOKE_ROOT;
  assert.ok(root && path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-downloads-smoke-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
  }
  const { WindowCoordinator, ReaderService, ReaderRepository, registerReaderIpc, normalizeYtDlp, recoverProfile } = require(path.join(root, 'tools.cjs'));
  const watchdog = setTimeout(() => { console.error('Downloads smoke timeout'); app.exit(1); }, 120000);
  app.on('browser-window-created', (_event, w) => { w.hide(); w.webContents.setBackgroundThrottling(false); });
  async function wait(check, label) { for (let i = 0; i < 1000; i++) { if (await check()) return; await pause(10); } throw Error('Downloads timeout: ' + label); }
  const js = (w, code) => w.webContents.executeJavaScript(code);
  const invoke = (w, name, request) => js(w, `window.reader.${name}(${request === undefined ? '' : JSON.stringify(request)})`);
  const current = async w => { const r = await invoke(w, 'downloads.current'); assert.equal(r.ok, true); return r.value; };
  const state = async w => (await invoke(w, 'bootstrap')).value;
  const active = job => !['queued', 'completed', 'failed', 'cancelled'].includes(job.state);
  const pending = job => job.state === 'queued' || active(job);
  app.whenReady().then(async () => {
    fs.mkdirSync(path.join(root, 'profile'));
    const databasePath = path.join(root, 'profile', 'reader.sqlite'), backup = path.join(root, 'backup.sqlite');
    const repository = ReaderRepository.open(databasePath), windows = new WindowCoordinator(pathToFileURL(page).href, preload);
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
    const starts = [], signals = new Map(), releases = new Map(); let restart = false;
    const service = new ReaderService(() => repository, ['en'], console.error, async (target, signal, advance, report, title) => {
      starts.push(target.sourceId); signals.set(target.sourceId, signal); advance('fetching'); report({ fetched: 1755, estimatedTotal: 8721 });
      title(`Early title ${target.sourceId}`);
      await new Promise(resolve => { releases.set(target.sourceId, resolve); if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
      advance('processing');
      return { extraction: normalizeYtDlp(JSON.stringify({ ...fixture.raw, id: target.sourceId }), fixture.context) };
    }, {}, undefined, value => windows.sendAcquisitionProgress(value), {
      databasePath, dialogs: { save: async () => backup, select: async () => backup, confirm: async () => true }, restart: () => { restart = true; },
    });
    registerReaderIpc(service, windows);
    const a = windows.createReaderWindow(), b = windows.createReaderWindow();
    const ready = w => wait(() => js(w, "!!document.getElementById('downloads-toggle')"), 'renderer ready');
    await Promise.all([ready(a), ready(b)]);
    for (const w of [a, b]) await js(w, 'window.downloadEvents=[];window.reader.downloads.onChanged(e=>window.downloadEvents.push(e));void 0');
    const submitted = [];
    for (let i = 0; i < 8; i++) {
      const r = await invoke(a, 'downloads.submit', { kind: 'acquire', url: `https://www.youtube.com/watch?v=Video_${String(i).padStart(5, '0')}&list=ignored` });
      assert.equal(r.ok, true); submitted.push(r.value.job);
    }
    await wait(() => starts.length === 3, 'three active helpers');
    let snap = await current(b); assert.equal(snap.jobs.filter(active).length, 3); assert.equal(snap.jobs.filter(j => j.state === 'queued').length, 5);
    assert.deepEqual(await current(a), snap);
    assert.equal(snap.jobs.filter(active).every(j => j.label === `Early title ${j.sourceId}` && j.comments.fetched === 1755), true);
    assert.equal(snap.jobs.filter(j => j.state === 'queued').every(j => j.label === j.sourceId), true);
    assert.equal((await invoke(b, 'downloads.dismiss', { operationId: submitted[0].operationId })).error.code, 'NOT_FOUND');
    assert.equal((await invoke(b, 'downloads.dismiss', { operationId: submitted[7].operationId })).error.code, 'NOT_FOUND');
    assert.equal((await invoke(b, 'downloads.dismiss', { operationId: submitted[0].operationId, extra: true })).error.code, 'INVALID_REQUEST');
    for (const w of [a, b]) await wait(() => js(w, "document.querySelector('.downloads-badge')?.textContent==='3'"), 'active-only badge');
    const same = await invoke(b, 'downloads.submit', { kind: 'acquire', url: 'https://youtu.be/Video_00000?t=2' }); assert.equal(same.value.reused, true); assert.equal(same.value.job.operationId, submitted[0].operationId);
    assert.equal(starts.length, 3);
    const c = windows.createReaderWindow(); await ready(c);
    await wait(() => js(c, "document.querySelector('.downloads-badge')?.textContent==='3'"), 'late-window hydration');
    assert.deepEqual(await current(c), await current(b));
    await js(b, "document.getElementById('downloads-toggle').click();void 0");
    await wait(() => js(b, "document.querySelectorAll('.downloads-panel progress').length===3"), 'numeric progress panel');
    assert.equal(await js(b, "document.querySelector('.downloads-panel').textContent.includes('≈20%')"), true);
    await js(b, "document.querySelector('.downloads-panel').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));void 0");
    assert.equal(await js(b, "document.activeElement.id"), 'downloads-toggle');
    // Acknowledged setting fans out through repository M2; scheduling responds immediately.
    await invoke(a, 'openSettings', { expectedRevision: (await state(a)).workspace.revision });
    await wait(() => js(a, "Array.from(document.querySelectorAll('label')).some(e=>e.textContent.includes('Maximum concurrent downloads'))"), 'concurrency settings');
    await js(a, "(()=>{const e=Array.from(document.querySelectorAll('label')).find(e=>e.textContent.includes('Maximum concurrent downloads')).querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'4');e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await wait(() => starts.length === 4, 'increased limit schedules fourth');
    await wait(async () => (await state(b)).preferences.maximumConcurrentDownloads === 4, 'peer setting');
    await invoke(b, 'updatePreferences', { maximumConcurrentDownloads: 2 });
    assert.equal([...signals.values()].some(s => s.aborted), false);
    assert.equal((await invoke(b, 'createBackup')).error.code, 'DATA_BUSY');
    const queued = snap.jobs.find(j => j.state === 'queued' && j.sourceId === 'Video_00007');
    assert.equal((await invoke(c, 'downloads.cancel', { operationId: queued.operationId })).ok, true);
    assert.equal(starts.includes(queued.sourceId), false);
    assert.equal((await invoke(c, 'downloads.cancel', { operationId: submitted[1].operationId })).ok, true);
    await wait(async () => (await current(b)).jobs.find(j => j.operationId === submitted[1].operationId).state === 'cancelled', 'independent cancellation');
    assert.equal(signals.get(submitted[0].sourceId).aborted, false);
    releases.get(submitted[0].sourceId)(); releases.get(submitted[2].sourceId)();
    await wait(() => starts.length === 5, 'replacement only below lowered limit');
    // Finish the remaining queue, retaining cancelled rows.
    for (let round = 0; round < 20 && (await current(b)).jobs.some(pending); round++) {
      for (const release of releases.values()) release(); await pause(20);
    }
    await wait(async () => !(await current(b)).jobs.some(pending), 'all settled');
    for (const w of [a, b, c]) await wait(() => js(w, "!document.querySelector('.downloads-badge')"), 'badge hides');
    assert.equal(starts.includes(queued.sourceId), false);
    assert.deepEqual(await current(a), await current(b));
    const eventsA = await js(a, 'window.downloadEvents'), eventsB = await js(b, 'window.downloadEvents'); assert.deepEqual(eventsA, eventsB);
    assert.equal(/stderr|executable|arguments|provenance|remote_json/.test(JSON.stringify(eventsA)), false);
    const completed = (await current(b)).jobs.find(j => j.sourceId === 'Video_00000'), itemId = completed.itemId;
    for (const w of [a, b]) await invoke(w, 'openStoredItem', { itemId, expectedRevision: (await state(w)).workspace.revision });
    await Promise.all([a, b].map(w => wait(() => js(w, "!!document.querySelector('.reader-panel:not([hidden]) .comment')"), 'stored readers')));
    const before = await state(b), commentId = before.comments[itemId][0].id;
    const refreshing = await invoke(a, 'downloads.submit', { kind: 'refresh', itemId });
    const dedup = await invoke(b, 'downloads.submit', { kind: 'refresh', itemId }); assert.equal(dedup.value.job.operationId, refreshing.value.job.operationId);
    for (const w of [a, b]) await wait(() => js(w, "document.querySelector('.reader-panel:not([hidden]) .download-status')?.textContent.includes('≈20%')"), 'same discussion status across windows');
    assert.equal((await current(b)).jobs.find(j => j.operationId === refreshing.value.job.operationId).label, completed.label, 'known title retained');
    await js(b, "document.getElementById('downloads-toggle').click();void 0");
    for (const mode of ['light', 'dark', 'charcoal', 'custom']) {
      if (mode === 'custom') {
        const definition = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/shared/themes/charcoal.json'), 'utf8'));
        definition.name = 'Download spinner fixture'; definition.tokens.accent = '#db8fd4'; definition.tokens.border = '#596473';
        repository.importTheme(definition, ['en'], repository.readerAppearance().revision);
      } else await invoke(b, 'updatePreferences', { appearance: mode });
      await wait(() => js(b, `document.documentElement.dataset.appearance===${JSON.stringify(mode)}`), 'spinner theme ' + mode);
      const evidence = await js(b, `(()=>{
        const roots=[document.querySelector('.downloads-panel'),document.querySelector('.reader-panel:not([hidden])')];
        return roots.map(root=>{const status=root.querySelector('.download-status:has(.acquisition-spinner)'), spinner=status.querySelector('.acquisition-spinner'), text=spinner.nextElementSibling;
          const animations=spinner.getAnimations();animations.forEach(a=>{a.pause();a.currentTime=0;});
          const r=spinner.getBoundingClientRect(), t=text.getBoundingClientRect(), css=getComputedStyle(spinner);
          const probe=document.createElement('span');probe.style.color='var(--accent)';probe.style.borderColor='var(--border)';status.append(probe);
          const accent=getComputedStyle(probe).color, border=getComputedStyle(probe).borderColor;probe.remove();animations.forEach(a=>a.play());
          return {width:r.width,height:r.height,gap:t.left-r.right,center:Math.abs((r.top+r.height/2)-(t.top+t.height/2)),
            animation:css.animationName,top:css.borderTopColor,bottom:css.borderBottomColor,accent,border};});
      })()`);
      for (const e of evidence) { assert.equal(e.width, 16, mode); assert.equal(e.height, 16, mode); assert.equal(e.gap, 6, mode); assert.ok(e.center <= 1, mode); assert.equal(e.animation, 'acquisition-spin'); assert.equal(e.top, e.accent); assert.equal(e.bottom, e.border); }
    }
    await js(b, "document.getElementById('downloads-toggle').click();void 0");
    await invoke(b, 'toggleSeen', { itemId, commentId, seen: true, subtree: false });
    const reload = new Promise(resolve => b.webContents.once('did-finish-load', resolve)); windows.requestReload(b); await reload; await ready(b);
    await wait(() => js(b, "document.querySelector('.download-status')?.textContent.includes('≈20%')"), 'reloaded job hydration');
    assert.equal((await current(b)).jobs.find(j => j.operationId === refreshing.value.job.operationId).state, 'fetching');
    // Closing a tab and then its initiating native window leaves the shared job alive.
    const aState = await state(a); await invoke(a, 'closeTab', { tabId: aState.workspace.activeTabId, expectedRevision: aState.workspace.revision });
    await invoke(a, 'closeWindow'); await wait(() => a.isDestroyed(), 'native origin close');
    assert.equal(signals.get(completed.sourceId).aborted, false);
    releases.get(completed.sourceId)(); await wait(async () => (await current(b)).jobs.find(j => j.operationId === refreshing.value.job.operationId).state === 'completed', 'shared refresh completion');
    await wait(async () => (await state(b)).comments[itemId].find(j => j.id === commentId).seen, 'seen survives refresh');
    // Retry is a fresh attempt; stale cancellation cannot affect it.
    const retried = await invoke(b, 'downloads.retry', { operationId: submitted[1].operationId }); assert.equal(retried.ok, true); assert.notEqual(retried.value.job.operationId, submitted[1].operationId);
    assert.equal((await invoke(b, 'downloads.cancel', { operationId: submitted[1].operationId })).ok, false);
    await wait(() => signals.has(submitted[1].sourceId) && !signals.get(submitted[1].sourceId).aborted, 'retry child'); releases.get(submitted[1].sourceId)();
    await wait(async () => !(await current(b)).jobs.some(pending), 'retry settled');
    // A new acquisition whose origin closes saves only to Library.
    const peerWorkspace = (await state(b)).workspace;
    const orphan = await invoke(c, 'downloads.submit', { kind: 'acquire', url: 'https://youtu.be/Video_99999' });
    await wait(() => releases.has('Video_99999'), 'orphan fetching'); await invoke(c, 'closeWindow'); await wait(() => c.isDestroyed(), 'acquire origin close');
    releases.get('Video_99999')(); await wait(async () => (await current(b)).jobs.find(j => j.operationId === orphan.value.job.operationId).state === 'completed', 'orphan Library commit');
    assert.deepEqual((await state(b)).workspace, peerWorkspace);
    // UI dismissal is session-only; both renderers accept the new revision.
    const beforeDismiss = await state(b), historyBeforeDismiss = repository.history();
    await js(b, "document.getElementById('downloads-toggle').click();void 0");
    const dismissId = orphan.value.job.operationId;
    await wait(() => js(b, `!!document.querySelector('[data-download-id="${dismissId}"]')?.closest('li').querySelector('.download-dismiss')`), 'settled dismiss control');
    await js(b, `document.querySelector('[data-download-id="${dismissId}"]').closest('li').querySelector('.download-dismiss').click();void 0`);
    await wait(async () => !(await current(b)).jobs.some(j => j.operationId === dismissId), 'per-job dismissal');
    assert.equal((await invoke(b, 'downloads.dismiss', { operationId: dismissId })).error.code, 'NOT_FOUND');
    assert.equal((await invoke(b, 'downloads.retry', { operationId: dismissId })).error.code, 'NOT_FOUND');
    const d = windows.createReaderWindow(); await ready(d);
    assert.deepEqual(await current(d), await current(b));
    const clearingPending = await invoke(d, 'downloads.submit', { kind: 'refresh', itemId });
    await wait(async () => (await current(b)).jobs.find(j => j.operationId === clearingPending.value.job.operationId)?.state === 'fetching', 'clear preserves running job');
    await js(b, "Array.from(document.querySelectorAll('.downloads-panel button')).find(e=>e.textContent==='Clear finished').click();void 0");
    await wait(async () => (await current(b)).jobs.length === 1, 'clear finished');
    assert.deepEqual(await current(d), await current(b));
    assert.equal((await current(d)).jobs[0].operationId, clearingPending.value.job.operationId);
    assert.deepEqual(await state(b), beforeDismiss); assert.deepEqual(repository.history(), historyBeforeDismiss);
    releases.get(completed.sourceId)(); await wait(async () => !(await current(b)).jobs.some(pending), 'remaining refresh completes');
    await invoke(d, 'closeWindow'); await wait(() => d.isDestroyed(), 'dismissal peer close');
    await js(b, "document.getElementById('downloads-toggle').click();void 0");
    // Real M3 backup/confirmed replacement fences and drains the complete queue.
    assert.equal((await invoke(b, 'createBackup')).value.status, 'created');
    for (let i = 10; i < 18; i++) assert.equal((await invoke(b, 'downloads.submit', { kind: 'acquire', url: `https://youtu.be/Video_${String(i).padStart(5, '0')}` })).ok, true);
    await wait(async () => (await current(b)).jobs.filter(active).length === 2, 'restore has running and queued jobs');
    const startsBeforeRestore = starts.length;
    const restored = await invoke(b, 'restoreBackup'); assert.equal(restored.ok, true); assert.equal(restored.value.status, 'restarting');
    await wait(() => restart, 'restart handoff'); assert.equal(starts.length, startsBeforeRestore);
    assert.equal([...signals.values()].slice(-2).every(s => s.aborted), true);
    assert.equal((await invoke(b, 'downloads.submit', { kind: 'acquire', url: 'https://youtu.be/Video_88888' })).error.code, 'DATA_BUSY');
    await service.shutdown();
    await recoverProfile(databasePath);
    const restoredRepo = ReaderRepository.open(databasePath);
    assert.equal(restoredRepo.preferences(['en']).maximumConcurrentDownloads, 2); assert.equal(restoredRepo.bootstrap(['en']).comments[itemId].find(c => c.id === commentId).seen, true);
    restoredRepo.close(); clearTimeout(watchdog);
    console.log('Downloads Electron PASS: scheduling, early titles/progress across windows, queued fallback, stored titles, spinner dimensions/alignment/colors in Light/Dark/Charcoal/custom in panel/header, dismiss/clear UI and IPC/revisions, stored data preservation, cancellation, reload/Close, retry, backup/restore drain.');
    b.destroy(); app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
} else {
  (async () => {
    assert.ok(fs.existsSync(preload) && fs.existsSync(page), 'Build Forge application first');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-downloads-smoke-'));
    try {
      const modules = ['window-coordinator:WindowCoordinator', 'reader-service:ReaderService', 'reader-ipc:registerReaderIpc', 'persistence/reader-repository:ReaderRepository', 'extractors/yt-dlp:normalizeYtDlp', 'persistence/profile-restore:recoverProfile'];
      const contents = modules.map(value => { const [file, name] = value.split(':'); return `export {${name}} from ${JSON.stringify(path.resolve(__dirname, '../src/main', file + '.ts'))};`; }).join('\n');
      require('esbuild').buildSync({ stdin: { contents, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: path.join(root, 'tools.cjs') });
      const env = { ...process.env, DOWNLOADS_SMOKE_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('Downloads exited ' + code))); });
    } finally {
      assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-downloads-smoke-'));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

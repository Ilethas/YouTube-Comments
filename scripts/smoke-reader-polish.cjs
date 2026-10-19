// M8.2: production entry, native windows, disposable data only. Frame captures
// sample Electron's compositor; they are not a physical desktop video recording.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const database = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');
function inspect(root, sql) { const db = new DatabaseSync(database(root), { readOnly: true }); try { return JSON.parse(JSON.stringify(db.prepare(sql).all())); } finally { db.close(); } }
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, BrowserWindow, Menu, ipcMain } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, baseline = process.env.M82_BASELINE === '1', phase = process.env.M82_PHASE;
  assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m82-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); app.setPath(name, dir); }
  const fail = error => { console.error(error); app.exit(1); };
  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  const watchdog = setTimeout(() => fail(Error('M8.2 watchdog')), 180000);
  const created = []; let holdAck = false, releaseAck, held = false, verified = false, failSave = false, failResume, seenCalls = 0;
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    if (channel === 'reader:toggle-seen' || channel === 'reader:bulk-seen') seenCalls++;
    if (channel === 'reader:profile-drain' && failSave) { failSave = false; return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
    if (channel === 'reader:profile-resume' && event.sender === failResume) { failResume = undefined; return { ok: false, error: { code: 'DATA_BUSY' } }; }
    if (channel === 'reader:profile-ack' && holdAck) { holdAck = false; held = true; await new Promise(resolve => { releaseAck = resolve; }); }
    return handler(event, ...args);
  });
  app.on('browser-window-created', (_e, w) => { created.push(w); w.webContents.setBackgroundThrottling(false); });
  const js = (w, code) => w.webContents.executeJavaScript(code);
  async function wait(check, label) { for (let n = 0; n < 1800; n++) { if (await check()) return; await pause(10); } throw Error('M8.2 ' + label); }
  const ready = w => wait(() => js(w, '!!document.querySelector(".app-shell")'), 'ready');
  async function press(w, keyCode, modifiers = []) {
    w.focus(); await wait(() => w.isFocused() && js(w, 'document.hasFocus()'), 'native keyboard focus');
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter') w.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }
  const boot = async w => { const result = await js(w, 'window.reader.bootstrap()'); assert.equal(result.ok, true); return result.value; };
  async function invoke(w, name, payload) {
    if (['openStoredItem', 'activateTab', 'closeTab'].includes(name)) payload = { ...payload, expectedRevision: (await boot(w)).workspace.revision };
    const result = await js(w, 'window.reader.' + name + '(' + (payload === undefined ? '' : JSON.stringify(payload)) + ')'); assert.equal(result.ok, true, name + ': ' + JSON.stringify(result)); return result.value;
  }
  const ids = () => inspect(root, 'SELECT window_id FROM window_restore ORDER BY position').map(r => r.window_id);
  const capture = async (w, name) => {
    await js(w, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const image = await w.webContents.capturePage(); fs.writeFileSync(path.join(artifacts, name + '.png'), image.toPNG()); return image;
  };
  async function menu(w, label) {
    await js(w, 'document.querySelector(".application-menu-trigger").click();void 0');
    await wait(() => js(w, '!!document.querySelector("[role=menu]")'), 'menu');
    await js(w, `Array.from(document.querySelectorAll('[role=menuitem]')).find(b=>b.querySelector('span')?.textContent===${JSON.stringify(label)}).click();void 0`);
  }
  async function newWindow(w) {
    const count = created.length; await menu(w, (await boot(w)).preferences.locale === 'pl' ? 'Nowe okno' : 'New Window');
    await wait(() => created.length === count + 1, 'menu new native'); const next = created.at(-1); await ready(next); return next;
  }
  async function screenshots(w) {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json')));
    await invoke(w, 'openStoredItem', { itemId: data.itemId });
    const panel = '.reader-panel:not([hidden])';
    await wait(() => js(w, `!!document.querySelector('${panel} .virtual-reader')`), 'deep reader');
    const beforeSeen = inspect(root, 'SELECT * FROM comment_state ORDER BY comment_id');
    for (const [locale, theme, width, zoom] of [['en', 'light', 1240, 1], ['pl', 'dark', 1240, 1], ['pl', 'light', 720, 1.25], ['en', 'dark', 720, 2]]) {
      await invoke(w, 'updatePreferences', { locale }); await invoke(w, 'updatePreferences', { appearance: theme });
      await invoke(w, 'updatePreferences', { selectionControls: 'always' }); w.setBounds({ width, height: 900 }); w.webContents.setZoomFactor(zoom);
      await wait(() => js(w, `document.documentElement.lang===${JSON.stringify(locale)} && !!document.querySelector('${panel} .selection-circle')`), 'localized selection');
      await js(w, `document.querySelector('${panel}').scrollTop=0;void 0`); await pause(100);
      const geometry = await js(w, `(()=>{const p=document.querySelector('${panel}');return {overflow:p.scrollWidth>p.clientWidth+1,rows:[...p.querySelectorAll('.virtual-comment')].map(e=>{const a=e.querySelector('.avatar').getBoundingClientRect(),s=e.querySelector('.selection-circle').getBoundingClientRect(),c=e.querySelector('article').getBoundingClientRect(),r=e.querySelector('.child-rail')?.getBoundingClientRect();return {id:e.dataset.commentId,depth:+e.dataset.depth,gap:a.left-s.right,dy:(a.top+a.height/2)-(s.top+s.height/2),rail:r?Math.abs(r.left-(a.left+a.width/2)):0,contentWidth:c.width,hit:s.top>=p.getBoundingClientRect().top&&s.bottom<innerHeight?document.elementFromPoint(s.left+s.width/2,s.top+s.height/2)?.closest('.selection-circle')!==null:true};})};})()`);
      assert.equal(geometry.overflow, false); assert.ok(geometry.rows.some(row => row.depth >= 5));
      for (const row of geometry.rows) { assert.ok(Math.abs(row.gap - 10) < 1, JSON.stringify(row)); assert.ok(Math.abs(row.dy) < 1); assert.ok(row.rail < 1); assert.ok(row.contentWidth >= 180); assert.equal(row.hit, true); }
      await capture(w, `selection-${locale}-${theme}-${zoom}`);
      // Scroll to the compact/clamped portion, keeping real variable-height rows.
      await js(w, `document.querySelector('${panel}').scrollTop+=500;void 0`); await pause(100);
      assert.ok(await js(w, `Array.from(document.querySelectorAll('${panel} .virtual-comment')).some(e=>+e.dataset.depth>=9)`));
      await capture(w, `selection-deep-${locale}-${theme}-${zoom}`);
      const stable = await js(w, `Array.from(document.querySelectorAll('${panel} .virtual-comment'),e=>[e.dataset.commentId,e.querySelector('.avatar').getBoundingClientRect().left])`);
      await invoke(w, 'updatePreferences', { selectionControls: 'on-demand' });
      await wait(() => js(w, `!document.querySelector('${panel} .selection-circle')`), 'hide circles');
      const hidden = await js(w, `Array.from(document.querySelectorAll('${panel} .virtual-comment'),e=>[e.dataset.commentId,e.querySelector('.avatar').getBoundingClientRect().left])`);
      for (const [id, x] of hidden) { const prior = stable.find(row => row[0] === id); if (prior) assert.equal(x, prior[1], 'selection visibility does not move avatars'); }
      await js(w, `Array.from(document.querySelectorAll('${panel} button')).find(b=>b.textContent===${JSON.stringify(locale === 'en' ? 'Select comments' : 'Zaznacz komentarze')}).click();void 0`);
      await wait(() => js(w, `document.querySelectorAll('${panel} .selection-circle').length>2`), 'selection mode');
      await js(w, `(()=>{const s=document.querySelectorAll('${panel} .selection-circle');s[0].click();s[2].dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));})()`);
      assert.equal(await js(w, `document.querySelectorAll('${panel} .selection-circle[aria-pressed=true]').length`), 3);
      await js(w, `Array.from(document.querySelectorAll('${panel} button')).find(b=>b.textContent===${JSON.stringify(locale === 'en' ? 'Exit selection mode' : 'Wyjdź z trybu zaznaczania')}).click();void 0`);
      await js(w, 'document.querySelector(".application-menu-trigger").click();void 0');
      await wait(() => js(w, '!!document.querySelector("[role=menu]")'), 'localized menu');
      const bounds = await js(w, '(()=>{const r=document.querySelector("[role=menu]").getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()');
      assert.ok(bounds.left>=0 && bounds.right<=bounds.width && bounds.bottom<=bounds.height);
      await capture(w, `menu-${locale}-${theme}-${zoom}`);
      await js(w, 'document.querySelector("[role=menu]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));void 0');
      assert.equal(await js(w, 'document.activeElement===document.querySelector(".application-menu-trigger")'), true);
    }
    assert.deepEqual(inspect(root, 'SELECT * FROM comment_state ORDER BY comment_id'), beforeSeen); assert.equal(seenCalls, 0);
    w.webContents.setZoomFactor(1); w.setBounds({ width: 1240, height: 900 });
    await invoke(w, 'updatePreferences', { locale: 'en' });
    console.log('M8.2 selection geometry/Shift range/no seen writes, EN/PL themes/zoom and menu screenshots PASS');
  }
  const artifacts = path.resolve(__dirname, '../.packaging-diagnostics/m82'); fs.mkdirSync(artifacts, { recursive: true });
  app.whenReady().then(async () => {
    if (phase === 'restart' || phase === 'restored') {
      const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')));
      await wait(() => created.length === expected.length, 'Quit restored all natives'); for (const w of created) await ready(w);
      assert.deepEqual(ids(), expected); verified = true;
      if (phase === 'restart') await press(created[0], 'Q', ['control', 'shift']); else app.quit(); return;
    }
    await wait(() => created.length === 1, 'first native'); const a = created[0]; await ready(a);
    Menu.getApplicationMenu().getMenuItemById('new-reader-window').click();
    await wait(() => created.length === 2, 'peer'); const b = created[1]; await ready(b);
    if (!baseline) await screenshots(a);
    if (!baseline) {
      const tabs = (await boot(a)).workspace.tabs.length;
      await press(a, 'W', ['control']); await wait(async () => (await boot(a)).workspace.tabs.length === tabs - 1, 'Ctrl+W closes tab');
      assert.equal(a.isDestroyed(), false); assert.equal(ids().length, 2);
      const count = created.length; await press(a, 'N', ['control']); await wait(() => created.length === count + 1, 'one native Ctrl+N');
      const peer = created.at(-1); await ready(peer); assert.equal(created.length, count + 1);
      await press(peer, 'W', ['control', 'shift']); await wait(() => peer.isDestroyed() && ids().length === 2, 'Ctrl+Shift+W closes just its window');
      await invoke(b, 'openStoredItem', { itemId: 'video-demo' });
      await wait(() => js(b, '!!document.querySelector(".reader-panel:not([hidden]) .virtual-reader")'), 'surviving populated reader');
    }
    await js(b, `window.__m82={events:[],samples:[],frames:[],document:performance.timeOrigin};window.reader.lifecycle.onEvent(e=>window.__m82.events.push({kind:e.kind,phase:e.phase,at:performance.now()}));
      const sample=()=>({inert:document.querySelector('.app-shell').inert,overlay:!!document.querySelector('.profile-operation-overlay'),at:performance.now()});
      new MutationObserver(()=>window.__m82.samples.push(sample())).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['inert']});
      const frame=()=>{if(window.__m82.frames.length<2048){window.__m82.frames.push(sample());requestAnimationFrame(frame);}};requestAnimationFrame(frame);void 0`);
    const beforeImage = await capture(b, baseline ? 'baseline-before' : 'quick-before');
    holdAck = true; a.close(); await wait(() => held, 'held native close');
    const state = await js(b, '({inert:document.querySelector(".app-shell").inert,overlay:!!document.querySelector(".profile-operation-overlay"),events:window.__m82.events,document:window.__m82.document})');
    assert.equal(state.inert, true); assert.ok(state.events.some(e => e.kind === 'close' && e.phase === 'DRAINING'));
    assert.equal(state.overlay, baseline, 'baseline mounts overlay synchronously; M8.2 delays only its presentation');
    const pendingImage = await capture(b, baseline ? 'baseline-close' : 'quick-close');
    if (!baseline) assert.deepEqual(pendingImage.crop({ x: 200, y: 300, width: 600, height: 250 }).toBitmap(), beforeImage.crop({ x: 200, y: 300, width: 600, height: 250 }).toBitmap(), 'survivor content compositor pixels stable during quick native Close');
    releaseAck(); await wait(() => a.isDestroyed() && js(b, '!document.querySelector(".app-shell").inert'), 'native close release');
    assert.equal(await js(b, 'performance.timeOrigin'), state.document, 'surviving document did not reload');
    const evidence = await js(b, '({samples:window.__m82.samples,frames:window.__m82.frames})');
    if (!baseline) assert.equal(evidence.samples.some(s => s.overlay), false, 'quick Close never mounted progress');
    fs.writeFileSync(path.join(artifacts, baseline ? 'baseline.json' : 'close.json'), JSON.stringify({ ...state, ...evidence }, null, 2));
    if (baseline) { verified = true; app.quit(); return; }
    assert.equal(ids().length, 1, 'ordinary Close excludes only its source');
    await pause(220); assert.equal(await js(b, '!!document.querySelector(".profile-operation-overlay")'), false, 'no late overlay');
    // Repeat without any drain gate: ordinary native Close on a peer while an
    // actual populated reader survives. Record every DOM transition/frame.
    let c = await newWindow(b);
    const mark = await js(b, '({samples:window.__m82.samples.length,events:window.__m82.events.length,frames:window.__m82.frames.length})');
    await menu(c, 'Close Window'); await wait(() => c.isDestroyed() && js(b, '!document.querySelector(".app-shell").inert'), 'ordinary ungated native Close');
    const ordinary = await js(b, `({samples:window.__m82.samples.slice(${mark.samples}),events:window.__m82.events.slice(${mark.events}),frames:window.__m82.frames.slice(${mark.frames})})`);
    assert.equal(ordinary.samples.some(s => s.overlay), false, 'ordinary quick Close never mounted progress');
    const ordinaryImage = await capture(b, 'ordinary-close-after');
    assert.deepEqual(ordinaryImage.crop({ x: 200, y: 300, width: 600, height: 250 }).toBitmap(), beforeImage.crop({ x: 200, y: 300, width: 600, height: 250 }).toBitmap());
    fs.writeFileSync(path.join(artifacts, 'ordinary-close.json'), JSON.stringify(ordinary, null, 2));
    // Actual menu Close held past threshold must show themed, accessible progress.
    c = await newWindow(b); held = false; holdAck = true;
    await menu(c, 'Close Window'); await wait(() => held, 'slow Close drain');
    await wait(() => js(b, '!!document.querySelector(".profile-operation-overlay")'), 'slow progress visible');
    await capture(b, 'slow-close'); releaseAck(); await wait(() => c.isDestroyed() && js(b, '!document.querySelector(".app-shell").inert'), 'slow release');
    // A checkpoint rejection retains the closing native and an immediate error.
    c = await newWindow(b); await invoke(c, 'openStoredItem', { itemId: 'video-demo' });
    await wait(() => js(c, '!!document.querySelector(".reader-panel:not([hidden]) input[type=search]")'), 'dirty source');
    await js(c, `(()=>{const e=document.querySelector('.reader-panel:not([hidden]) input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'M8.2 save failure');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    failSave = true; await menu(c, 'Close Window');
    await wait(() => js(c, '!!document.querySelector(".app-shell > [role=alert]") && !document.querySelector(".app-shell").inert'), 'failed Close usable');
    assert.equal(c.isDestroyed(), false); assert.equal(ids().length, 2); assert.equal(failSave, false, 'actual checkpoint failure injected');
    // Retry succeeds; failed release keeps the survivor frozen with immediate Retry.
    failResume = b.webContents; await menu(c, 'Close Window');
    await wait(() => js(b, '!!document.querySelector("[data-profile-retry]")'), 'failed release Retry');
    assert.equal(await js(b, 'document.querySelector(".app-shell").inert'), true);
    await js(b, 'document.querySelector("[data-profile-retry]").click();void 0');
    await wait(() => c.isDestroyed() && js(b, '!document.querySelector(".app-shell").inert'), 'successful release retry');
    await newWindow(b); await newWindow(b); assert.equal(ids().length, 3);
    fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify(ids()));
    console.log('M8.2 Close fast/slow/failure/retry and restore membership PASS');
    verified = true; await menu(b, 'Quit Application');
  }).catch(fail);
  app.on('will-quit', () => { assert.equal(verified, true); clearTimeout(watchdog); console.log('M8.2', baseline ? 'baseline cause confirmed' : 'PASS'); });
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-m82-'));
    try {
      const baseline = process.argv.includes('--baseline');
      if (!baseline) {
        const tool = path.join(root, 'tools.cjs');
        require('esbuild').buildSync({ stdin: { contents: `export {ReaderRepository} from ${JSON.stringify(path.resolve(__dirname, '../src/main/persistence/reader-repository.ts'))};export {normalizeYtDlp} from ${JSON.stringify(path.resolve(__dirname, '../src/main/extractors/yt-dlp.ts'))};`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: tool });
        const { ReaderRepository, normalizeYtDlp } = require(tool), repo = ReaderRepository.open(database(root));
        try {
          repo.initializeDemo(); repo.updatePreferences({ locale: 'en' }, ['en']); repo.updatePreferences({ appearance: 'dark' }, ['en']);
          const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json')));
          fixture.raw.title = 'Nested conversation — selection beside each avatar';
          fixture.raw.comments = Array.from({ length: 24 }, (_, i) => ({ id: 'm82-' + i, parent: i ? 'm82-' + (i - 1) : 'root', text: 'Reply ' + i + ': Shared layout follows the effective nesting depth. Zażółć gęślą jaźń.', author: 'Reader ' + i, author_id: 'UC_Reader' + i, timestamp: 1790856000 }));
          fixture.raw.comment_count = 24; const result = repo.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), undefined, true);
          fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ itemId: result.itemId }));
        } finally { repo.close(); }
      }
      for (const phase of baseline ? ['baseline'] : ['write', 'restart', 'restored']) {
        const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, M82_BASELINE: baseline ? '1' : '0', M82_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('M8.2 exit ' + code))); });
      }
    } finally { assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-m82-')); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

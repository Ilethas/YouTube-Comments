const { tabElement, viewId } = require('./window-view-fixtures.cjs');
// Offline built-entry checks. All profile/cache/backup bytes belong to this harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const database = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');

if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, shell } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.MILESTONE_PHASE;
  const itemId = fs.readFileSync(path.join(root, 'item-id'), 'utf8');
  const opened = []; shell.openExternal = async url => { opened.push(new URL(url).searchParams.get('tl')); };
  const watchdog = setTimeout(() => { console.error('Usability milestone timed out'); app.exit(1); }, 90000);
  app.on('browser-window-created', (_event, window) => {
    window.hide(); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => verify(window).then(() => {
      clearTimeout(watchdog); app.quit();
    }).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); }));
  });
  async function verify(window) {
    const contents = window.webContents, js = code => contents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}: ${code.slice(0, 240)}`); });
    const panel = "document.querySelector('[role=tabpanel]:not([hidden])')";
    async function wait(expression) {
      for (let i = 0; i < 800; i++) { if (await js(expression)) return; await pause(25); }
      console.error(await js(`(()=>{const p=${panel};return {rows:[...p.querySelectorAll('.virtual-comment')].slice(0,10).map(e=>({index:e.dataset.index,top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,article:e.querySelector('article').getBoundingClientRect().height,transform:e.style.transform}))};})()`));
      throw new Error(`Timed out: ${expression}`);
    }
    const boot = () => js('window.reader.bootstrap().then(r=>r.value)');
    async function input(selector, value) {
      await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    }
    async function settings() { await js("document.getElementById('settings-toggle').click()"); await wait("!!document.querySelector('#panel-settings:not([hidden]) .preferences')"); }
    async function reader() { await js(`${tabElement(itemId)}.click()`); await wait(`${panel}?.dataset.itemId===${JSON.stringify(itemId)} && !!${panel}.querySelector('.query-controls')`); }
    const filter = name => `.reader-panel:not([hidden]) [name="publication-${name}"]`;
    const count = number => `${panel}.querySelector('.applied-counts')?.textContent.includes(${JSON.stringify(new Intl.NumberFormat('en').format(number))})`;
    async function apply() { await js(`${panel}.querySelector('.query-controls').requestSubmit()`); await pause(120); }
    await wait("!!document.querySelector('.app-shell')");
    const db = new DatabaseSync(database(root), { readOnly: true });
    try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); } finally { db.close(); }
    const before = await boot();
    contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Warsaw' });
    if (phase === 'restart') {
      assert.equal(before.preferences.translationTarget, 'custom'); assert.equal(before.preferences.customTranslationTarget, 'uk');
      await reader(); await wait(count(5000));
      assert.equal(await js(`document.querySelector('${filter('fromTime')}').value`), '14:30');
      assert.equal(await js(`document.querySelector('${filter('toTime')}').value`), '09:15');
      await js(`${panel}.querySelector('.action-translate button').click()`); await wait("!document.querySelector('.action-translate button:disabled')");
      assert.deepEqual(opened, ['uk']);
    } else {
      await settings();
      await input('.preferences select:nth-of-type(1)', 'en'); // Language is the first select in its label.
      const target = '.translation-settings select';
      await input(target, 'custom'); await wait("!!document.querySelector('.custom-translation-controls input')");
      await input('.custom-translation-controls input', ' uk ');
      await js("document.querySelector('.custom-translation-controls button:last-child').click()");
      await wait("!document.querySelector('.preferences select:disabled')");
      assert.equal((await boot()).preferences.customTranslationTarget, 'uk');
      await reader(); await js(`${panel}.querySelector('.action-translate button').click()`); await pause(80); assert.equal(opened.at(-1), 'uk');
      await settings(); await input(target, 'fr'); await wait("!document.querySelector('.preferences select:disabled')");
      await reader(); await js(`${panel}.querySelector('.action-translate button').click()`); await pause(80); assert.equal(opened.at(-1), 'fr');
      await settings(); await input(target, 'custom'); await wait("!document.querySelector('.preferences select:disabled')");
      assert.equal(await js("document.querySelector('.custom-translation-controls input').value"), 'uk'); await reader();
      await js(`${panel}.querySelector('.query-dates').open=true`);
      await input(filter('from'), '2026-10-16'); await input(filter('to'), '2026-10-17');
      await apply(); await wait(count(10000));
      await input(filter('fromTime'), '14:30'); await input(filter('toTime'), '09:15');
      assert.equal(await js(count(10000)), true, 'Editing times keeps prior applied rows');
      await apply(); await wait(count(5000));
      assert.ok(await js(`${panel}.querySelector('.query-status').textContent.includes('14:30') && ${panel}.querySelector('.query-status').textContent.includes('09:15')`));
      assert.ok((await js(`${panel}.querySelectorAll('.virtual-comment').length`)) < 100);
      await input(filter('from'), '2026-10-17'); await input(filter('fromTime'), '10:00'); await apply();
      await wait(`!!${panel}.querySelector('.query-error')`); assert.equal(await js(count(5000)), true);
      // Chromium native badInput cannot silently become an omitted whole-day bound.
      await input(filter('from'), '2026-10-16'); await input(filter('fromTime'), '14:30');
      await js(`(()=>{const e=document.querySelector('${filter('toTime')}');e.setCustomValidity('Incomplete native time');${panel}.querySelector('.query-controls').requestSubmit();})()`);
      assert.equal(await js(count(5000)), true);
      await js(`document.querySelector('${filter('toTime')}').setCustomValidity('')`);
      await input(filter('toTime'), '');
      window.show(); window.focus(); contents.focus();
      await js(`document.querySelector('${filter('toTime')}').focus()`);
      for (const keyCode of ['0', '9']) {
        contents.sendInputEvent({ type: 'keyDown', keyCode }); contents.sendInputEvent({ type: 'char', keyCode }); contents.sendInputEvent({ type: 'keyUp', keyCode });
      }
      assert.equal(await js(`document.querySelector('${filter('toTime')}').validity.badInput`), true, 'Native partially entered time is badInput');
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] }); await pause(80);
      assert.equal(await js(count(5000)), true, 'Ctrl+Enter cannot apply a partial native clock');
      await input(filter('toTime'), '09:15'); await apply();
      await wait(`!${panel}.querySelector('.query-error')`);
      for (const motion of ['no-preference', 'reduce']) {
        await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: motion }] });
        await js("(()=>{const s=document.createElement('span');s.id='motion-probe';s.className='acquisition-spinner';s.style.display='block';document.body.append(s);})()");
        assert.equal(await js("getComputedStyle(document.getElementById('motion-probe')).animationName"), 'acquisition-spin');
        const transform = await js("getComputedStyle(document.getElementById('motion-probe')).transform"); await pause(160);
        assert.notEqual(await js("getComputedStyle(document.getElementById('motion-probe')).transform"), transform, 'Spinner actually rotates');
        await js("document.getElementById('motion-probe').remove()");
      }
      // Compare actual layout at multiple nested depths, themes, locales and zooms.
      for (const [locale, theme, zoom, width] of [['en', 'light', 1, 1100], ['pl', 'dark', 1.25, 720], ['en', 'dark', .8, 720]]) {
        await settings(); await input('.preferences label:first-child select', locale); await wait("!document.querySelector('.preferences select:disabled')");
        await input('.preferences label:nth-child(2) select', theme); await wait("!document.querySelector('.preferences select:disabled')");
        await reader(); window.setSize(width, 800); contents.setZoomFactor(zoom); await pause(180);
        await js(`${panel}.querySelector('.query-dates').open=false`);
        const hiddenGeometry = await js(`(()=>{const p=${panel};return [...p.querySelectorAll('.virtual-comment')].map(e=>{const a=e.querySelector('.avatar').getBoundingClientRect(),r=e.querySelector('.child-rail')?.getBoundingClientRect();return r?Math.abs(r.left-(a.left+a.width/2)):0;});})()`);
        assert.ok(hiddenGeometry.every(delta => delta < 1), 'Avatar gutters agree before toggling selection controls');
        // Toggle on-demand selection through its existing discussion action.
        if (!await js(`${panel}.querySelector('.selection-circle')!==null`)) await js(`${panel}.querySelector('.selection-toolbar button')?.click()`);
        // The ordinary select-comments action is outside the toolbar until enabled.
        if (!await js(`${panel}.querySelector('.selection-circle')!==null`)) await js(`[...${panel}.querySelectorAll('button')].find(e=>/^(Select comments|Zaznacz komentarze)$/.test(e.textContent.trim())).click()`);
        await pause(120);
        const geometry = await js(`(()=>{const p=${panel};return {overflow:p.scrollWidth>p.clientWidth+1,rows:[...p.querySelectorAll('.virtual-comment')].slice(0,16).map(e=>{const a=e.querySelector('.avatar').getBoundingClientRect(),s=e.querySelector('.selection-circle').getBoundingClientRect(),r=e.querySelector('.child-rail')?.getBoundingClientRect();return {depth:+e.dataset.depth,dy:(a.top+a.height/2)-(s.top+s.height/2),rail:r?Math.abs(r.left-(a.left+a.width/2)):0,gap:a.left-s.right};})};})()`);
        assert.equal(geometry.overflow, false); assert.ok(geometry.rows.some(row => row.depth >= 5));
        for (const row of geometry.rows) { assert.ok(Math.abs(row.dy) < 1); assert.ok(row.rail < 1); assert.ok(row.gap >= 8); }
        await js(`(()=>{const p=${panel};p.scrollTop+=p.querySelector('.virtual-reader').getBoundingClientRect().top-p.getBoundingClientRect().top+50;})()`);
        await pause(180);
        await wait(`(()=>{const rows=[...${panel}.querySelectorAll('.virtual-comment')];return rows.every((row,i)=>!rows[i+1]||+rows[i+1].dataset.index!==+row.dataset.index+1||row.querySelector('article').getBoundingClientRect().bottom<=rows[i+1].querySelector('article').getBoundingClientRect().top+1)})()`);
        await js(`(()=>{const p=${panel},row=[...p.querySelectorAll('.virtual-comment')].find(e=>e.getBoundingClientRect().bottom>p.getBoundingClientRect().top&&e.getBoundingClientRect().top<p.getBoundingClientRect().bottom);row.querySelector('.selection-circle').click();})()`);
        assert.ok(await js(`${panel}.querySelector('[data-bulk-selected=true] .selection-circle[aria-pressed=true]')!==null`));
        window.showInactive(); await pause(100);
        fs.writeFileSync(path.resolve(__dirname, `../.vite/usability-${locale}-${theme}-${zoom}.png`), (await contents.capturePage()).toPNG());
        await js(`${panel}.querySelector('[data-bulk-selected=true] .selection-circle').click()`);
      }
      // Leave a valid applied view and language for restart assertions.
      await settings(); await input('.preferences label:first-child select', 'en'); await wait("!document.querySelector('.preferences select:disabled')"); await reader();
      await pause(450);
    }
    const after = await boot(); assert.deepEqual(after.comments, before.comments, 'Filtering/geometry/translation preserve seen and all comment data');
    contents.debugger.detach();
    console.log(`Usability milestone Electron PASS ${phase}: schema 11→12, custom uk/preset/restart, query clock bounds/draft/errors/restart, motion emulation, 10k virtual rows, selection geometry/themes/locales/zoom`);
  }
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-milestone-electron-'));
    try {
      const bundle = path.join(root, 'tools.cjs');
      require('esbuild').buildSync({ stdin: { contents: "export {ReaderRepository} from './src/main/persistence/reader-repository'; export {normalizeYtDlp} from './src/main/extractors/yt-dlp'; export {downgradeCustomTranslationFixture} from './src/main/persistence/testing/schema-10';", resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
      const { ReaderRepository, normalizeYtDlp, downgradeCustomTranslationFixture } = require(bundle), repo = ReaderRepository.open(database(root));
      const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
      const dates = ['2026-10-16T12:29:59Z', '2026-10-16T12:30:00Z', '2026-10-17T07:15:59Z', '2026-10-17T07:16:00Z'];
      const raw = { ...fixture.raw, comments: Array.from({ length: 10000 }, (_, i) => ({ id: `UgMilestone${i}`, parent: i % 12 === 0 ? 'root' : `UgMilestone${i - 1}`, text: `Minute fixture ${i}`, timestamp: Date.parse(dates[i % 4]) / 1000 })) };
      const { itemId } = repo.ingest(normalizeYtDlp(JSON.stringify(raw), fixture.context), undefined, true);
      repo.updatePreferences({ locale: 'en' }, ['en']); repo.updatePreferences({ appearance: 'light' }, ['en']); repo.prepareOffline(); repo.close();
      const db = new DatabaseSync(database(root)); downgradeCustomTranslationFixture(db); db.close();
      fs.writeFileSync(path.join(root, 'item-id'), itemId);
      for (const phase of ['first', 'restart']) {
        const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, MILESTONE_PHASE: phase };
        for (const key of ['ELECTRON_RUN_AS_NODE', 'YOUTUBE_COMMENTS_YTDLP_EXE', 'YOUTUBE_COMMENTS_POST_ARCHIVER_EXE']) delete env[key];
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`))); });
      }
    } finally {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-milestone-electron-')) throw new Error('Unsafe cleanup');
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

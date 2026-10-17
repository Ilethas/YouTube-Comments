// Actual built-entry Electron interactions. Offline, disposable profiles only.
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
  const { app, clipboard, shell } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.SELECTION_SMOKE_PHASE;
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'), 'utf8'));
  const opened = []; shell.openExternal = async url => { opened.push(new URL(url).hostname); };
  let oldClipboard = '';
  const watchdog = setTimeout(() => app.exit(1), 180000);
  app.on('browser-window-created', (_event, window) => {
    window.hide(); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => verify(window).then(async () => {
      await clipboard.writeText(oldClipboard); clearTimeout(watchdog); app.quit();
    }).catch(async error => { console.error(error); await clipboard.writeText(oldClipboard); clearTimeout(watchdog); app.exit(1); }));
  });
  async function verify(window) {
    oldClipboard = await clipboard.readText();
    window.show(); window.focus(); window.webContents.focus();
    const contents = window.webContents, js = code => contents.executeJavaScript(code);
    const panel = "document.querySelector('[role=tabpanel]:not([hidden])')";
    async function wait(expression) {
      for (let i = 0; i < 800; i++) { if (await js(expression)) return; await pause(25); }
      console.error('Selection UI timeout state', await js(`({top:${panel}?.scrollTop, height:${panel}?.scrollHeight, focus:document.activeElement?.outerHTML.slice(0,150), rows:Array.from(${panel}?.querySelectorAll('.virtual-comment')??[],e=>({index:e.dataset.index,id:e.querySelector('article')?.id})), toolbar:!!${panel}?.querySelector('.floating-selection-toolbar')})`));
      throw new Error(`Timed out: ${expression}`);
    }
    const button = (label, scope = panel) => js(`Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
    const article = index => `document.getElementById(${JSON.stringify('comment-' + fixture.ids[index])})`;
    const circle = index => `${article(index)}.querySelector('.selection-circle')`;
    const inspect = sql => {
      const db = new DatabaseSync(database(root), { readOnly: true });
      try { return db.prepare(sql).all(); } finally { db.close(); }
    };
    const seenCount = () => Number(inspect('SELECT sum(seen) AS n FROM comment_state')[0].n);
    async function key(keyCode, modifiers = []) {
      window.focus(); contents.focus();
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      if (keyCode === 'Enter') contents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
      if (keyCode === 'Space') contents.sendInputEvent({ type: 'char', keyCode: ' ', modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await pause(80);
    }
    async function mouse(selector, buttonName = 'left', modifiers = []) {
      const point = await js(`(()=>{const r=${selector}.getBoundingClientRect();return {x:Math.round(r.left+Math.min(10,r.width/2)),y:Math.round(r.top+r.height/2)};})()`);
      contents.sendInputEvent({ type: 'mouseDown', ...point, button: buttonName, clickCount: 1, modifiers });
      contents.sendInputEvent({ type: 'mouseUp', ...point, button: buttonName, clickCount: 1, modifiers }); await pause(80);
    }
    async function menu(index) {
      // A retained row may already exist inside a hidden discussion while the
      // ordered workspace acknowledgment is still being reconciled.
      await wait(`${panel}?.contains(${article(index)}) && !document.querySelector('.tabs button:disabled')`);
      await js(`${article(index)}.focus({preventScroll:true})`);
      await wait(`document.activeElement===${article(index)}`);
      await key('F10', ['shift']); await wait("!!document.querySelector('[role=menu]')");
    }
    async function confirm() { await button('Continue', "document.querySelector('dialog[open]')"); await wait("!document.querySelector('dialog[open]')"); }
    async function undo() {
      await wait(`Array.from(${panel}.querySelectorAll('button')).some(b=>b.textContent.trim()==='Undo'&&!b.disabled)`);
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await js(`${panel}.focus()`); await key('Z', ['control']);
      try { await wait(`${panel}.textContent.includes('Restored')`); }
      catch (error) {
        console.error('Undo UI state', await js(`({focus:document.activeElement?.tagName,dialog:!!document.querySelector('dialog[open]'),menu:!!document.querySelector('[role=menu]'),undo:Array.from(${panel}.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Undo').map(b=>({disabled:b.disabled}))})`));
        throw error;
      }
    }
    await wait(`!!${panel}?.querySelector('.virtual-reader')`);
    if (phase === 'read') {
      assert.equal(await js('document.documentElement.lang'), 'pl');
      assert.equal(await js('document.documentElement.dataset.appearance'), 'dark');
      assert.equal(await js(`${panel}.querySelectorAll('[data-bulk-selected=true]').length`), 0);
      assert.ok(await js(`${panel}.querySelectorAll('.selection-circle').length>0`));
      const prefs = inspect('SELECT * FROM preferences')[0]; assert.equal(prefs.selection_controls, 'always'); assert.equal(prefs.include_collapsed_in_prefix, 0);
      assert.equal(seenCount(), 0); console.log(`Selection Electron PASS restart ${fixture.count}: preferences/collapse, empty session selection, Polish/dark`); return;
    }
    assert.equal(await js(`${panel}.querySelector('.selection-circle')===null`), true);
    await button('Select comments'); await js(`${circle(0)}.focus()`); await key('Space');
    await wait(`${circle(0)}.getAttribute('aria-pressed')==='true'`);
    await button('Previous unseen'); await wait(`!!${article(fixture.count - 1)}`); await pause(250);
    await mouse(circle(fixture.count - 1), 'left', ['shift']);
    await wait(`${panel}.querySelector('.selection-toolbar [role=status]').textContent.startsWith(${JSON.stringify(new Intl.NumberFormat('en').format(fixture.count))})`);
    const mountedRows = await js(`${panel}.querySelectorAll('.virtual-comment').length`);
    assert.ok(mountedRows < 100, 'Selecting an offscreen range keeps the full reader virtualized');
    assert.equal(await js(`${panel}.querySelectorAll('.discussion-ruler svg path').length`), 3);
    console.log(JSON.stringify({ selectionUiScale: fixture.count, mountedRows, rulerPaths: 3 }));
    await wait(`!!${panel}.querySelector('.floating-selection-toolbar') && !!${panel}.querySelector('.back-to-top')`);
    fs.writeFileSync(path.join(__dirname, `../.vite/selection-floating-${fixture.count}-en-light.png`), (await contents.capturePage()).toPNG());
    const readingPoint = () => js(`(()=>{const p=${panel}.getBoundingClientRect();const row=Array.from(${panel}.querySelectorAll('article.comment')).find(e=>{const r=e.getBoundingClientRect();return r.bottom>p.top && r.top<p.bottom});return row && {id:row.id,offset:row.getBoundingClientRect().top-p.top}})()`);
    const farAnchor = await readingPoint();
    const start = Date.now();
    await js(`${panel}.querySelector('.floating-selection-toolbar button[aria-label="Mark selected read"]').click()`);
    assert.equal(await js("document.activeElement.textContent.trim()"), 'Cancel'); await confirm();
    assert.equal(seenCount(), fixture.count); await undo(); assert.equal(seenCount(), 0);
    const afterAnchor = await readingPoint();
    assert.equal(afterAnchor.id, farAnchor.id, 'Floating confirmed marking and Undo retain reading identity');
    assert.ok(Math.abs(afterAnchor.offset - farAnchor.offset) < 1, 'Reading offset survives bulk-feedback header reflow');
    // Native top scrolling must preserve logical selection, seen and query. Force
    // reduced motion through Chromium's media emulation, then exercise keyboard.
    contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const selectedBeforeTop = await js(`${panel}.querySelector('.selection-toolbar [role=status]').textContent`);
    await js(`${panel}.querySelector('.back-to-top').focus()`); await key('Enter');
    await wait(`${panel}.scrollTop===0 && !${panel}.querySelector('.back-to-top') && !${panel}.querySelector('.floating-selection-toolbar')`);
    assert.equal(await js(`document.activeElement===${panel}`), true, 'Removing a focused floating control returns focus to its reader without scrolling');
    assert.equal(await js(`${panel}.querySelector('.selection-toolbar [role=status]').textContent`), selectedBeforeTop);
    assert.equal(seenCount(), 0);
    await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); contents.debugger.detach();
    await button('Clear selection'); await button('Next unseen'); await wait(`!!${article(0)}`); await pause(200);
    // Actual native text selection and ordinary right mouse invocation.
    const copied = await js(`(()=>{const t=${article(0)}.querySelector('.comment-text').firstChild,r=document.createRange();r.setStart(t,0);r.setEnd(t,7);const s=getSelection();s.removeAllRanges();s.addRange(r);return s.toString();})()`);
    await mouse(`${article(0)}.querySelector('.comment-text')`, 'right'); await wait("!!document.querySelector('[role=menu]')");
    assert.equal(await js('getSelection().toString()'), copied);
    await button('Copy selection', "document.querySelector('[role=menu]')"); await pause(100); assert.equal(await clipboard.readText(), copied);
    assert.equal(seenCount(), 0);
    // Native clipboard shortcut retains the same original text.
    await key('C', ['control']); assert.equal(await clipboard.readText(), copied);
    await js('getSelection().removeAllRanges()');
    await js(`${article(0)}.querySelector('.reply-toggle').click()`); await pause(200);
    await wait(`!!${article(20)}`);
    await menu(20); await button('Mark everything up to here as read', "document.querySelector('[role=menu]')");
    assert.ok(await js("document.querySelector('dialog').textContent.includes('21 comments') && document.querySelector('dialog').textContent.includes('Includes 19 comments hidden')"));
    await key('Escape'); assert.equal(seenCount(), 0);
    await menu(20); await button('Mark everything up to here as read', "document.querySelector('[role=menu]')"); await confirm();
    assert.equal(seenCount(), 21); await undo(); assert.equal(seenCount(), 0);
    // Two explicit selected thread assignments never recurse or write seen.
    await js(`${circle(0)}.click()`); await js(`${circle(20)}.click()`);
    await js(`${panel}.scrollTo({top:${panel}.scrollHeight,behavior:'instant'})`);
    await wait(`!!${panel}.querySelector('.floating-selection-toolbar')`);
    await js(`${panel}.querySelector('.selection-overflow summary').click()`);
    const floating = `${panel}.querySelector('.floating-selection-toolbar')`;
    await button('Collapse selected threads', floating); await wait(`${floating}.querySelector('[role=status]').textContent.includes('2 selected')`);
    assert.equal(seenCount(), 0); await button('Expand selected threads', floating); await button('Clear selection', floating);
    await js(`${panel}.querySelector('.back-to-top').click()`); await wait(`${panel}.scrollTop===0 && !!${article(0)}`);
    await js(`${article(0)}.querySelector('.reply-toggle').click()`); await pause(100);
    await js("document.getElementById('settings-toggle').click()");
    await wait("!!document.querySelector('#panel-settings:not([hidden])')");
    await js("(()=>{const e=document.querySelectorAll('.preferences select')[3];e.value='always';e.dispatchEvent(new Event('change',{bubbles:true}));})()"); await pause(100);
    await js("document.querySelector('.preferences input[type=checkbox]').click()"); await pause(100);
    await js(`document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)}).click()`); await wait(`!!${article(20)}`);
    await menu(20); await button('Mark everything up to here as read', "document.querySelector('[role=menu]')");
    assert.ok(await js("document.querySelector('dialog').textContent.includes('2 comments') && document.querySelector('dialog').textContent.includes('Includes 0 comments hidden')"));
    await confirm(); assert.equal(seenCount(), 2); await undo(); assert.equal(seenCount(), 0);
    // Menu bounds, keyboard movement, outside click and scroll dismissal.
    await js(`${article(20)}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-1,clientY:innerHeight-1}))`);
    assert.ok(await js("(()=>{const r=document.querySelector('[role=menu]').getBoundingClientRect();return r.right<=innerWidth && r.bottom<=innerHeight && r.left>=0 && r.top>=0})()"));
    const point = await js("(()=>{const r=document.querySelectorAll('[role=menuitem]')[2].getBoundingClientRect();return {x:Math.round(r.left+10),y:Math.round(r.top+r.height/2)}})()");
    contents.sendInputEvent({ type: 'mouseMove', ...point }); await pause(100);
    assert.equal(await js("document.querySelectorAll('[role=menuitem]')[2].dataset.active"), 'true');
    await key('Down'); await pause(100);
    assert.ok(await js("document.querySelectorAll('[role=menuitem]')[3].dataset.active==='true' && document.querySelectorAll('[role=menuitem][data-active=true]').length===1"));
    assert.ok(await js("getComputedStyle(document.querySelectorAll('[role=menuitem]')[2]).outlineStyle==='none'"), 'Stationary hovered entry loses its highlight after keyboard navigation');
    contents.sendInputEvent({ type: 'mouseMove', x: point.x + 1, y: point.y }); await pause(100);
    assert.equal(await js("document.querySelectorAll('[role=menuitem]')[2].dataset.active"), 'true');
    await key('Up'); await key('Escape');
    await menu(20); await js(`${panel}.dispatchEvent(new Event('scroll'))`); await wait("!document.querySelector('[role=menu]')");
    // Safe external capabilities are intercepted, never launch a real browser.
    await menu(20); await button('Translate in browser', "document.querySelector('[role=menu]')"); await pause(100);
    await menu(20); await button('Open original comment in browser', "document.querySelector('[role=menu]')"); await pause(100);
    await menu(20); await button('Copy comment link', "document.querySelector('[role=menu]')"); await pause(100);
    assert.deepEqual(opened, ['translate.google.com', 'www.youtube.com']);
    assert.ok((await clipboard.readText()).startsWith('https://www.youtube.com/watch?v='));
    // Restrictive complete trees include context; newest moves the second tree first.
    await js(`(()=>{const e=${panel}.querySelector('.query-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'SELECTION_NEEDLE');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js(`${panel}.querySelector('.query-controls').requestSubmit()`);
    await wait(`${panel}.querySelector('.discussion-ruler').dataset.matchCount==='2'`);
    await js(`(()=>{const e=${panel}.querySelector('.discussion-sort select');e.value='newest';e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(200);
    await menu(21); await button('Mark everything up to here as read', "document.querySelector('[role=menu]')");
    assert.ok(await js("document.querySelector('dialog').textContent.includes('2 comments') && document.querySelector('dialog').textContent.includes('Includes context-only comments')"));
    await confirm(); assert.equal(seenCount(), 2);
    assert.deepEqual(new Set(inspect('SELECT comment_id FROM comment_state WHERE seen=1').map(row => row.comment_id)), new Set([fixture.ids[20], fixture.ids[21]]));
    await undo(); assert.equal(seenCount(), 0);
    assert.ok(await js(`${panel}.querySelectorAll('.virtual-comment').length<100`));
    assert.equal(await js(`${panel}.querySelectorAll('.discussion-ruler svg path').length`), 3);
    fs.writeFileSync(path.join(__dirname, `../.vite/selection-${fixture.count}-en-light.png`), (await contents.capturePage()).toPNG());
    await js("document.getElementById('settings-toggle').click()");
    for (const [index, value] of [[0, 'pl'], [1, 'dark']]) {
      await js(`(()=>{const e=document.querySelectorAll('.preferences select')[${index}];e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(100);
    }
    await js(`document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)}).click()`); await pause(250);
    // Scattered selection remains usable in Polish/dark at the minimum window
    // width and 125% zoom. Overflow opens upward without touching the ruler.
    await js(`${circle(20)}.click();${circle(21)}.click();${panel}.scrollTo({top:${panel}.scrollHeight,behavior:'instant'})`);
    await wait(`!!${panel}.querySelector('.floating-selection-toolbar')`);
    window.setSize(720, 650); contents.setZoomFactor(1.25); await pause(400);
    await js(`${panel}.querySelector('.selection-overflow summary').click()`);
    assert.ok(await js(`(()=>{const p=${panel}.getBoundingClientRect(),f=${panel}.querySelector('.floating-reader-controls').getBoundingClientRect(),r=${panel}.querySelector('.discussion-ruler').getBoundingClientRect(),a=${panel}.querySelector('.selection-overflow-actions').getBoundingClientRect();return f.left>=p.left && f.right<r.left && f.bottom<=p.bottom && a.top>=p.top && a.right<=r.left})()`));
    fs.writeFileSync(path.join(__dirname, `../.vite/selection-${fixture.count}-pl-dark.png`), (await contents.capturePage()).toPNG());
    await js("document.getElementById('library-toggle').click()"); await pause(150);
    assert.equal(await js("Array.from(document.querySelectorAll('.floating-reader-controls')).filter(e=>e.getClientRects().length).length"), 0);
    await js(`document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)}).click()`); await pause(150);
    await js(`${panel}.querySelector('.back-to-top').click()`);
    await wait(`${panel}.scrollTop===0`);
    await js(`${panel}.querySelector('.selection-toolbar button:last-child').click()`);
    assert.equal(await js(`${panel}.querySelector('.floating-selection-toolbar')===null`), true);
    console.log(`Selection Electron PASS ${fixture.count}: floating confirmed assignment/Undo/group collapse/Clear, native Back to Top/reduced motion, Space/Shift range, text/Copy/Ctrl+C, exact prefixes 21/2, restrictive newest context, stationary-pointer menu highlight, Polish/dark/720px/125% zoom, safe actions, bounded DOM/ruler; workflow ${Date.now() - start}ms`);
  }
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    for (const count of [10000, 50000]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-selection-electron-'));
      try {
        const bundle = path.join(root, 'tools.cjs');
        require('esbuild').buildSync({ stdin: { contents: `export {ReaderRepository} from './src/main/persistence/reader-repository'; export {normalizeYtDlp} from './src/main/extractors/yt-dlp';`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
        const { ReaderRepository, normalizeYtDlp } = require(bundle), repo = ReaderRepository.open(database(root));
        const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
        fixture.raw.comments = Array.from({ length: count }, (_, i) => ({ id: `UgSelection${i}`, parent: i % 20 ? `UgSelection${i - 1}` : 'root',
          text: `${i === 1 || i === 21 ? 'SELECTION_NEEDLE' : 'Comment'} ${i}: Zażółć\n${'Reply text. '.repeat(i % 6)}`, timestamp: 1758000000 + i }));
        const itemId = repo.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), undefined, true).itemId;
        const rows = repo.bootstrap(['en']).comments[itemId];
        repo.updatePreferences({ locale: 'en' }, ['en']); repo.updatePreferences({ appearance: 'light' }, ['en']);
        fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ itemId, count, ids: rows.map(row => row.id) })); repo.close();
        for (const phase of ['write', 'read']) {
          const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, SELECTION_SMOKE_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
          const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
          await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Selection ${count} ${phase} exited ${code}`))); });
        }
      } finally {
        if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-selection-electron-')) throw new Error('Unsafe cleanup');
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

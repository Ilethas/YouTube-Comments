// Built-entry Electron UI/restart regression, offline and disposable profiles only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const database = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');

if (process.versions.electron) {
  const { app } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.COLLAPSE_SMOKE_PHASE;
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'), 'utf8'));
  const watchdog = setTimeout(() => app.exit(1), 120000);
  app.on('browser-window-created', (_event, window) => {
    window.hide(); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => verify(window).then(() => {
      clearTimeout(watchdog); app.quit();
    }).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); }));
  });
  async function verify(window) {
    window.show(); window.focus(); window.webContents.focus();
    const contents = window.webContents, js = code => contents.executeJavaScript(code);
    const panel = "document.querySelector('[role=tabpanel]:not([hidden])')";
    async function wait(expression) {
      for (let i = 0; i < 400; i++) { if (await js(expression)) return; await pause(25); }
      throw new Error(`Timed out: ${expression}`);
    }
    const click = label => js(`Array.from(${panel}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
    const count = () => js(`Number(${panel}.querySelector('.virtual-reader').dataset.rowCount)`);
    const visibleSelected = () => js(`(()=>{const p=${panel},a=p.querySelector('[data-selected=true]'),r=a?.getBoundingClientRect(),v=p.getBoundingClientRect();return !!r&&r.bottom>v.top&&r.top<v.bottom;})()`);
    const seen = () => {
      const db = new DatabaseSync(database(root), { readOnly: true });
      try { return db.prepare('SELECT * FROM comment_state ORDER BY comment_id').all(); } finally { db.close(); }
    };
    const persisted = () => {
      const db = new DatabaseSync(database(root), { readOnly: true });
      try { return { default: db.prepare('SELECT default_collapsed FROM discussion_collapse WHERE item_id=?').get(fixture.itemId)?.default_collapsed,
        overrides: db.prepare('SELECT comment_id FROM comment_collapse_overrides WHERE item_id=?').all(fixture.itemId).map(row => row.comment_id) }; }
      finally { db.close(); }
    };
    await wait(`${panel}?.querySelector('.query-controls') !== null && !!${panel}?.querySelector('.virtual-reader')`);
    const originalSeen = seen();
    if (phase === 'write') {
      assert.equal(await count(), 1001);
      await js(`${panel}.querySelector('.reply-toggle').click()`); assert.equal(await count(), 982);
      // Native Enter/Space on the same focusable control, no document-wide binding.
      await js(`${panel}.querySelector('.reply-toggle').focus()`); await pause(100);
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); contents.sendInputEvent({ type: 'char', keyCode: '\r' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await wait(`${panel}.querySelector('.reply-toggle').getAttribute('aria-expanded')==='true'`);
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); contents.sendInputEvent({ type: 'char', keyCode: ' ' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
      await wait(`${panel}.querySelector('.reply-toggle').getAttribute('aria-expanded')==='false'`);
      await click('Expand all'); assert.equal(await count(), 1001);
      await click('Collapse all'); assert.equal(await count(), 50); await pause(150);
      fs.writeFileSync(path.join(__dirname, '../.vite/collapse-en-light.png'), (await contents.capturePage()).toPNG());
      assert.deepEqual(persisted(), { default: 1, overrides: [] });
      await js(`(()=>{const e=${panel}.querySelector('.query-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'COLLAPSE_NEEDLE');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await js(`${panel}.querySelector('.query-controls').requestSubmit()`);
      await wait(`${panel}.querySelector('.discussion-ruler').dataset.matchCount==='2'`);
      assert.equal(await count(), 2);
      await js(`${panel}.dispatchEvent(new KeyboardEvent('keydown',{key:'F3',bubbles:true}))`);
      await wait(`${panel}.querySelector('[data-selected=true]')?.id===${JSON.stringify('comment-' + fixture.firstMatch)}`);
      await pause(200); assert.equal(await visibleSelected(), true);
      assert.equal(await js(`${panel}.querySelector('.query-navigation span').textContent`), '1 / 2');
      assert.equal(persisted().overrides.length, 19, 'Only first target ancestors expand');
      await js(`${panel}.dispatchEvent(new KeyboardEvent('keydown',{key:'F3',shiftKey:true,bubbles:true}))`);
      await wait(`${panel}.querySelector('[data-selected=true]')?.id===${JSON.stringify('comment-' + fixture.lastMatch)}`);
      assert.equal(await js(`${panel}.querySelector('.query-navigation span').textContent`), '2 / 2');
      await click('Collapse all'); assert.equal(await count(), 2);
      await click('Previous unseen');
      await wait(`${panel}.querySelector('[data-selected=true]') !== null`);
      await pause(200); assert.equal(await visibleSelected(), true);
      await click('Collapse all');
      await js(`(()=>{const r=${panel}.querySelector('.discussion-ruler'),b=r.getBoundingClientRect(),y=Number(/M13,([\\d.]+)/.exec(r.querySelector('.ruler-new').getAttribute('d'))[1]);r.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:b.left+14,clientY:b.top+y+1}));})()`);
      await wait(`${panel}.querySelector('[data-selected=true]')?.id===${JSON.stringify('comment-' + fixture.lastMatch)}`);
      await pause(200); assert.equal(await visibleSelected(), true);
      await click('Collapse all');
      // Keyboard NEW-lane End+Enter reveals the same hidden exact target.
      for (const key of ['ArrowRight','ArrowRight','End','Enter']) await js(`${panel}.querySelector('.discussion-ruler').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
      await wait(`${panel}.querySelector('[data-selected=true]')?.id===${JSON.stringify('comment-' + fixture.lastMatch)}`);
      await click('Collapse all'); await pause(400);
      assert.deepEqual(seen(), originalSeen);
      await js("document.getElementById('settings-toggle').click()");
      await wait("!!document.querySelector('#panel-settings:not([hidden]) .preferences')");
      for (const [index, value] of [[0, 'pl'], [1, 'dark']]) {
        await js(`(()=>{const e=document.querySelectorAll('.preferences select')[${index}];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await pause(150);
      }
      await js(`document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)}).click()`);
      await wait(`${panel}.querySelector('.virtual-reader') !== null`);
      assert.equal(await count(), 2);
      await pause(200); await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(__dirname, '../.vite/collapse-pl-dark.png'), (await contents.capturePage()).toPNG());
    } else {
      assert.equal(await js('document.documentElement.lang'), 'pl');
      assert.equal(await js('document.documentElement.dataset.appearance'), 'dark');
      assert.equal(await count(), 2); assert.deepEqual(persisted(), { default: 1, overrides: [] });
      assert.equal(await js(`${panel}.querySelector('[data-selected=true]')===null`), true, 'Hidden logical selection is not focused/mounted');
      await click('Rozwiń wszystko'); assert.equal(await count(), 41);
      await click('Zwiń wszystko'); await pause(150);
      const collapse = persisted();
      await js(`document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)}).nextElementSibling.click()`);
      await wait(`!document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)})`);
      await js("document.getElementById('library-toggle').click()");
      await wait("!!document.querySelector('.library-entry')");
      await js("document.querySelector('.library-entry button').click()");
      await wait(`${panel}.querySelector('.virtual-reader') !== null`);
      assert.equal(await count(), 2); assert.deepEqual(persisted(), collapse); assert.deepEqual(seen(), originalSeen);
    }
    assert.ok(await js(`${panel}.querySelectorAll('.virtual-comment').length<=200`));
    assert.equal(await js(`${panel}.querySelectorAll('.discussion-ruler svg path').length`), 3);
    console.log(`Collapse Electron PASS ${phase}: native Enter/Space, F3/reverse, hidden unseen, pointer/keyboard NEW ruler, persisted All, Polish/dark, close/reopen, unchanged seen`);
  }
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-collapse-electron-'));
    try {
      const bundle = path.join(root, 'tools.cjs');
      require('esbuild').buildSync({ stdin: { contents: `export {ReaderRepository} from './src/main/persistence/reader-repository'; export {normalizeYtDlp} from './src/main/extractors/yt-dlp';`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
      const { ReaderRepository, normalizeYtDlp } = require(bundle), repo = ReaderRepository.open(database(root));
      const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
      const comments = Array.from({ length: 1000 }, (_, i) => ({ id: `UgCollapse${i}`, parent: i % 20 ? `UgCollapse${i - 1}` : 'root',
        text: `${i === 19 ? 'COLLAPSE_NEEDLE' : 'Comment'} ${i}: variable height\n${'Reply text. '.repeat(i % 8)}`, timestamp: 1758000000 + i }));
      const raw = { ...fixture.raw, comments }, observation = normalizeYtDlp(JSON.stringify(raw), fixture.context);
      const itemId = repo.ingest(observation, undefined, true).itemId;
      raw.comments.push({ id: 'UgCollapse1000', parent: 'UgCollapse999', text: 'COLLAPSE_NEEDLE new reply', timestamp: 1758001000 });
      repo.ingest(normalizeYtDlp(JSON.stringify(raw), fixture.context));
      const rows = repo.bootstrap(['en']).comments[itemId];
      repo.updatePreferences({ locale: 'en' }, ['en']); repo.updatePreferences({ appearance: 'light' }, ['en']);
      fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ itemId, firstMatch: rows.find(row => row.source.commentId === 'UgCollapse19').id, lastMatch: rows.find(row => row.source.commentId === 'UgCollapse1000').id }));
      repo.close();
      for (const phase of ['write', 'read']) {
        const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, COLLAPSE_SMOKE_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Collapse ${phase} exited ${code}`))); });
      }
    } finally {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-collapse-electron-')) throw new Error('Unsafe cleanup');
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

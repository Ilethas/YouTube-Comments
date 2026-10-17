// Built application, native decoder, actual protocol/CSP and Chromium layout.
// All discussions, cache files and snapshots belong to this disposable harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const database = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');
const sourceId = 'YE7VzlLtp-4';

if (process.versions.electron) {
  const { app, shell, dialog } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.THUMBNAIL_PHASE;
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixture.json'))), png = fs.readFileSync(path.join(root, 'fixture.png'));
  const opened = [];
  shell.openPath = async file => { opened.push(file); return ''; };
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(root, 'snapshot.sqlite') });
  const requests = require('./thumbnail-fixture-network.cjs').installThumbnailNetwork(url => {
    if (phase === 'offline') throw new Error('Offline fixture');
    if (url.includes(sourceId)) return { status: 200, headers: { 'content-type': 'image/png', etag: '"fixture"' }, bytes: png };
    return { status: 200, headers: { 'content-type': 'text/html' }, bytes: Buffer.from('invalid image') };
  });
  const watchdog = setTimeout(() => { console.error('Thumbnail smoke timed out'); app.exit(1); }, 90000);
  app.on('browser-window-created', (_event, window) => {
    window.hide(); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => verify(window).then(() => { clearTimeout(watchdog); app.quit(); }).catch(error => {
      console.error(error); clearTimeout(watchdog); app.exit(1);
    }));
  });
  async function verify(window) {
    const contents = window.webContents, js = code => contents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}: ${code.slice(0, 180)}`); });
    const panel = "document.querySelector('[role=tabpanel]:not([hidden])')", image = `${panel}.querySelector('.video-thumbnail')`;
    async function wait(expression) {
      for (let i = 0; i < 400; i++) { try { if (await js(expression)) return; } catch { /* React may still be mounting the selected panel. */ } await pause(25); }
      throw new Error(`Timed out: ${expression}`);
    }
    const boot = () => js('window.reader.bootstrap().then(r=>r.value)');
    await wait(`${image}?.querySelector('img').naturalWidth===1280 && !${image}.parentElement.hidden`);
    const before = await boot();
    const compact = await js(`${image}.getBoundingClientRect().width`); assert.ok(Math.abs(compact - 360) < 1);
    assert.equal(await js(`${image}.parentElement.previousElementSibling.className`), 'item-actions');
    assert.equal(await js(`${image}.parentElement.nextElementSibling.className`), 'item-title');
    assert.equal(await js(`${image}.getAttribute('aria-label')`), 'Expand thumbnail');
    assert.equal(opened.length, 0);
    await js(`${image}.click()`); await pause(60);
    const expanded = await js(`${image}.getBoundingClientRect().width`); assert.ok(expanded > 800);
    assert.ok(Math.abs((await js(`${image}.getBoundingClientRect().height`)) - expanded * 9 / 16) < 1);
    await js(`${image}.click()`); assert.ok(Math.abs((await js(`${image}.getBoundingClientRect().width`)) - 360) < 1);
    window.show(); window.focus(); contents.focus(); await js(`${image}.focus()`); await pause(50);
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); contents.sendInputEvent({ type: 'char', keyCode: ' ' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await wait(`${image}.getAttribute('aria-expanded')==='true'`);
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); contents.sendInputEvent({ type: 'char', keyCode: '\r' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await wait(`${image}.getAttribute('aria-expanded')==='false'`);
    assert.equal(await js(`getComputedStyle(${image}).outlineStyle`), 'solid');
    await js(`${image}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:30,clientY:200}))`);
    await wait("!!document.querySelector('[role=menuitem]')");
    assert.equal(await js("document.querySelector('[role=menuitem]').textContent"), 'Open in image viewer');
    await js("document.querySelector('[role=menuitem]').click()");
    await wait("!document.querySelector('[role=menu]')"); await pause(30);
    assert.equal(opened.length, 1);
    assert.equal(path.dirname(opened[0]), path.join(root, 'youtube-comments-development', 'thumbnails'));
    assert.deepEqual(fs.readFileSync(opened[0]), png);
    assert.deepEqual(await js(`window.reader.openThumbnail({itemId:${JSON.stringify(fixture.itemId)},path:'C:/private.exe'})`), { ok: false, error: { code: 'INVALID_REQUEST' } });
    // Resize the header while already far into the virtual reader; row identity
    // and offset must stay stable without a new selection/query/seen assignment.
    await js(`${panel}.scrollTop=60000`); await pause(200);
    const anchor = await js(`(()=>{const p=${panel},r=[...p.querySelectorAll('.virtual-comment')].find(r=>r.getBoundingClientRect().bottom>p.getBoundingClientRect().top);return {id:r.dataset.commentId,top:r.getBoundingClientRect().top,scroll:p.scrollTop,margin:p.querySelector('.virtual-reader').getBoundingClientRect().top+p.scrollTop};})()`);
    await js(`${image}.click()`); await pause(150);
    const afterTop = await js(`document.querySelector('[data-comment-id="${anchor.id}"]').getBoundingClientRect().top`);
    assert.ok(Math.abs(afterTop - anchor.top) < 2, `Header resize moved row ${afterTop-anchor.top}: ${JSON.stringify(anchor)}, after ${await js(`${panel}.scrollTop`)}`);
    await js(`${panel}.scrollTop=0`); await js(`${image}.click()`);
    window.setSize(720, 760); contents.setZoomFactor(1.25); await pause(150);
    await js(`${image}.click()`);
    assert.equal(await js(`${panel}.scrollWidth<=${panel}.clientWidth+1`), true);
    assert.equal(await js(`${image}.getBoundingClientRect().right<=${panel}.getBoundingClientRect().right`), true);
    assert.ok((await js(`${panel}.querySelectorAll('.virtual-comment').length`)) < 50);
    await js("document.documentElement.lang='pl';document.documentElement.dataset.appearance='dark'");
    // Persist real locale preferences through existing Settings/acknowledgment.
    await js("document.getElementById('settings-toggle').click()");
    await wait("!!document.querySelector('#panel-settings:not([hidden]) .preferences')");
    for (const [index, value] of [[0, 'pl'], [1, 'dark']]) {
      await js(`(()=>{const e=document.querySelectorAll('.preferences select')[${index}];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`); await pause(100);
    }
    await js(`document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)}).click()`);
    await wait(`${image}?.getAttribute('aria-label')==='Pomniejsz miniaturę'`);
    await js(`${image}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))`);
    assert.equal(await js("document.querySelector('[role=menuitem]').textContent"), 'Otwórz w przeglądarce obrazów');
    await js("document.querySelector('[role=menu]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    // Native database snapshot has no thumbnail bytes; bytes remain in the cache.
    if (phase === 'first') {
      assert.equal((await js('window.reader.createBackup()')).ok, true);
      assert.equal(fs.readFileSync(path.join(root, 'snapshot.sqlite')).includes(png), false);
    }
    const after = await boot(); assert.deepEqual(after.comments, before.comments); assert.deepEqual(after.items, before.items);
    assert.equal(opened.length, 1, 'No automatic shell invocation');
    if (phase === 'first') assert.equal(requests.filter(request => request.url.includes(sourceId)).length, 1);
    if (phase === 'restart') assert.equal(requests.filter(request => request.url.includes(sourceId)).length, 0);
    if (phase === 'offline') assert.ok(requests.filter(request => request.url.includes(sourceId)).length <= 8);
    // Invalid/no-image discussion has no image area after bounded attempts.
    await js(`window.reader.openStoredItem({itemId:${JSON.stringify(fixture.invalidId)}})`);
    // Open through Library so React receives the workspace acknowledgment.
    await js("document.getElementById('library-toggle').click()");
    await wait("!!document.querySelector('.library-entry')");
    await js("[...document.querySelectorAll('.library-entry')].find(e=>e.textContent.includes('Invalid thumbnail')).querySelector('button').click()");
    await wait(`${panel}?.querySelector('h1')?.textContent==='Invalid thumbnail'`); await pause(150);
    assert.equal(await js(`${panel}.querySelector('.video-thumbnail-row')===null`), true);
    console.log(`Thumbnail Electron PASS ${phase}: actual protocol/CSP/decoder, 360px/expanded/narrow 125%, native keys/focus, EN/light PL/dark, menu/mocked shell, anchor, restart/offline, backup exclusion, invalid image`);
  }
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-thumbnails-electron-'));
    try {
      const bundle = path.join(root, 'tools.cjs');
      require('esbuild').buildSync({ stdin: { contents: "export {ReaderRepository} from './src/main/persistence/reader-repository'; export {normalizeYtDlp} from './src/main/extractors/yt-dlp'; export {thumbnailPng} from './src/fixtures/thumbnail-image';", resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
      const { ReaderRepository, normalizeYtDlp, thumbnailPng } = require(bundle), repository = ReaderRepository.open(database(root));
      const context = { provenance: { backend: 'yt-dlp', version: '2026.08.19', evidence: ['Offline thumbnail interaction fixture'] } };
      const observation = (id, title, count) => normalizeYtDlp(JSON.stringify({ id, title, comments: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, parent: 'root', text: `Stored comment ${i}. ${'Reading context. '.repeat(i%6)}` })) }), context);
      const itemId = repository.ingest(observation(sourceId, 'Existing video (offline fixture)', 2000), undefined, true).itemId;
      const invalidId = repository.ingest(observation('zzzzzzzzzzz', 'Invalid thumbnail', 1)).itemId;
      fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ itemId, invalidId }));
      fs.writeFileSync(path.join(root, 'fixture.png'), thumbnailPng()); repository.close();
      for (const phase of ['first', 'restart', 'offline']) {
        // Reset only this disposable profile's view/preferences between phases.
        const repo = ReaderRepository.open(database(root)); repo.updatePreferences({ locale: 'en' }, ['en']); repo.updatePreferences({ appearance: 'light' }, ['en']); repo.changeWorkspace('openStoredItem', itemId); repo.close();
        if (phase === 'offline') {
          const manifestPath = path.join(root, 'youtube-comments-development', 'thumbnails', `${sourceId}.json`);
          const manifest = JSON.parse(fs.readFileSync(manifestPath)); manifest.checkedAt = 0; manifest.attemptedAt = 0; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        }
        const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, THUMBNAIL_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`))); });
      }
    } finally {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-thumbnails-electron-')) throw new Error('Unsafe cleanup');
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

// Production main/preload/renderer, native decoder/protocol, disposable data only.
// Native picker results are controlled here, never by a shipped test capability.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const panel = "document.querySelector('.reader-panel:not([hidden])')";
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, dialog, nativeImage } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.APPEARANCE_PHASE;
  assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-appearance-electron-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); app.setPath(name, folder);
  }
  const ids = JSON.parse(fs.readFileSync(path.join(root, 'ids.json'))), windows = [];
  let selected, expectedParent, finished = false, backupTarget = path.join(root, 'snapshot.sqlite');
  dialog.showOpenDialog = async (parent, options) => {
    assert.equal(parent, expectedParent);
    assert.deepEqual(options.properties, ['openFile']);
    return { canceled: !selected, filePaths: selected ? [selected] : [] };
  };
  dialog.showSaveDialog = async parent => { assert.equal(parent, expectedParent); return { canceled: false, filePath: backupTarget }; };
  dialog.showMessageBox = async (_parent, options) => ({ response: options.buttons?.length === 2 ? 1 : 0 });
  dialog.showErrorBox = (_title, message) => { throw Error(message); };
  app.relaunch = () => { fs.writeFileSync(path.join(root, 'relaunch'), 'requested'); };
  const fail = error => { console.error(error); app.exit(1); };
  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  const watchdog = setTimeout(() => fail(Error('Appearance watchdog')), 120000);
  app.on('browser-window-created', (_event, w) => { windows.push(w); w.webContents.setBackgroundThrottling(false); });
  const js = (w, code) => w.webContents.executeJavaScript(code);
  async function wait(check, label) { for (let n = 0; n < 1000; n++) { try { if (await check()) return; } catch {} await pause(15); } throw Error('Appearance timeout: ' + label); }
  const frames = w => js(w, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const boot = async w => { const r = await js(w, 'window.reader.bootstrap()'); assert.equal(r.ok, true); return r.value; };
  async function invoke(w, method, request) {
    const r = await js(w, `window.reader.${method}(${request === undefined ? '' : JSON.stringify(request)})`);
    assert.equal(r.ok, true, JSON.stringify(r)); await frames(w); return r.value;
  }
  const ready = w => wait(() => js(w, "!!document.querySelector('.app-shell') && !document.querySelector('.app-shell').inert"), 'ready');
  async function open(w) {
    const state = await boot(w);
    await invoke(w, 'openStoredItem', { itemId: ids.item, expectedRevision: state.workspace.revision });
    await wait(() => js(w, `!!${panel}?.querySelector('.virtual-reader')`), 'reader');
  }
  async function settings(w) { await js(w, "document.getElementById('settings-toggle').click();void 0"); await wait(() => js(w, "!!document.querySelector('#panel-settings:not([hidden]) .appearance-settings')"), 'settings'); }
  const bg = w => js(w, "getComputedStyle(document.body).backgroundColor");
  const capture = async (w, name) => {
    const directory = path.resolve(__dirname, '../.packaging-diagnostics/appearance'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, name + '.png'), (await w.webContents.capturePage()).toPNG());
  };
  async function geometry(w) {
    await frames(w);
    const g = await js(w, `(()=>{const p=${panel},r=p.querySelector('.discussion-ruler'),c=p.querySelector('.reading-column'),b=document.querySelector('.discussion-viewport:not([hidden]) .reader-surface-layer'),im=document.querySelector('.discussion-viewport:not([hidden]) .reader-wallpaper');const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,left:r.left,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};return {doc:document.scrollingElement.scrollHeight,client:document.scrollingElement.clientHeight,viewport:innerHeight,overflow:p.scrollWidth>p.clientWidth+1,mounted:p.querySelectorAll('.virtual-comment').length,p:rect(p),r:rect(r),c:rect(c),b:b&&rect(b),image:im&&rect(im),opacity:getComputedStyle(c).opacity,filter:getComputedStyle(c).filter,backdrop:getComputedStyle(c).backdropFilter,blur:b&&getComputedStyle(b).backdropFilter};})()`);
    assert.equal(g.doc, g.client); assert.equal(g.client, g.viewport); assert.equal(g.overflow, false);
    assert.ok(g.mounted < 100 && g.mounted > 0); assert.equal(g.opacity, '1'); assert.equal(g.filter, 'none'); assert.equal(g.backdrop, 'none');
    assert.ok(g.r.top >= g.p.top && g.r.bottom <= g.p.bottom + 1);
    if (g.b) { assert.ok(Math.abs(g.b.left - g.c.left) < 1 && Math.abs(g.b.width - g.c.width) < 1); assert.ok(g.b.height <= g.p.height + 1); assert.equal(g.image.height, g.p.height); }
    return g;
  }
  app.whenReady().then(async () => {
    await wait(() => windows.length > 0, 'first window'); const a = windows[0]; expectedParent = a; await ready(a);
    if (phase === 'first') {
      await invoke(a, 'newWindow'); await wait(() => windows.length === 2, 'second native'); const b = windows[1]; await ready(b); await open(a); await open(b);
      const before = await boot(a); assert.equal(before.comments[ids.item].length, 3000);
      a.webContents.debugger.attach('1.3');
      for (const dark of [true, false]) {
        await invoke(a, 'updatePreferences', { appearance: 'system' });
        await a.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
        await wait(async () => await bg(a) === (dark ? 'rgb(21, 27, 35)' : 'rgb(242, 244, 246)'), 'OS palette');
      }
      await invoke(a, 'updatePreferences', { appearance: 'charcoal' });
      await wait(async () => await bg(a) === 'rgb(21, 21, 21)' && await bg(b) === 'rgb(21, 21, 21)', 'shared charcoal');
      assert.equal(await js(a, 'getComputedStyle(document.documentElement).colorScheme'), 'dark');
      selected = path.join(root, 'theme.json'); await invoke(a, 'importTheme');
      await wait(() => js(b, "document.documentElement.dataset.appearance==='custom'"), 'custom peer');
      const valid = (await boot(a)).preferences;
      selected = path.join(root, 'invalid.json');
      assert.deepEqual(await js(a, 'window.reader.importTheme()'), { ok: false, error: { code: 'INVALID_THEME' } }); assert.deepEqual((await boot(a)).preferences, valid);
      assert.equal((await js(a, 'window.reader.importWallpaper({path:"C:/private"})')).error.code, 'INVALID_WALLPAPER');
      await settings(a); await js(a, "[...document.querySelectorAll('.appearance-settings button')].find(e=>e.textContent.startsWith('Import JSON')).click();void 0");
      await wait(() => js(a, "!!document.querySelector('.appearance-settings [role=alert]')"), 'invalid import UI');
      assert.deepEqual((await boot(a)).preferences, valid);
      backupTarget=path.join(root,'after-invalid.sqlite'); await invoke(a,'createBackup'); await ready(a); await ready(b);
      backupTarget=path.join(root,'snapshot.sqlite'); await open(a);
      selected = path.join(root, 'image.png'); await invoke(a, 'importWallpaper');
      // Real Chromium WebP encoding followed by the actual privileged native decode.
      const webp = await js(a, "(()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');x.fillStyle='#465d4b';x.fillRect(0,0,640,360);return c.toDataURL('image/webp').split(',')[1]})()");
      fs.writeFileSync(path.join(root, 'image.webp'), Buffer.from(webp, 'base64')); selected = path.join(root, 'image.webp'); await invoke(a, 'importWallpaper');
      const jpg = nativeImage.createFromPath(path.join(root, 'image.png')).toJPEG(85); fs.writeFileSync(path.join(root, 'image.jpg'), jpg); selected = path.join(root, 'image.jpg'); await invoke(a, 'importWallpaper');
      const approved = (await boot(a)).preferences;
      fs.unlinkSync(selected); fs.unlinkSync(path.join(root, 'image.png')); fs.unlinkSync(path.join(root, 'image.webp')); fs.unlinkSync(path.join(root, 'theme.json'));
      await wait(() => js(a, "!!document.querySelector('.reader-wallpaper')?.naturalWidth"), 'wallpaper decoded');
      await wait(() => js(b, "!!document.querySelector('.reader-wallpaper')?.naturalWidth"), 'peer wallpaper');
      const url = await invoke(a, 'getWallpaper'); assert.match(url, /^reader-wallpaper:\/\/asset\/[a-f0-9-]{36}$/);
      const original = (await boot(a)).preferences.readerAppearance;
      const change = { expectedRevision: original.revision, customThemeId: original.customThemeId, wallpaperEnabled: true, surfaceOpacity: 86, blur: 12 };
      await js(a, `${panel}.scrollTop=45000;void 0`); await pause(180);
      const anchor = await js(a, `(()=>{const p=${panel},r=[...p.querySelectorAll('.virtual-comment')].find(e=>e.getBoundingClientRect().bottom>p.getBoundingClientRect().top);return {id:r.dataset.commentId,top:r.getBoundingClientRect().top,scroll:p.scrollTop}})()`);
      await invoke(b, 'updatePreferences', { readerAppearance: change }); await invoke(b, 'updatePreferences', { appearance: 'charcoal' });
      await wait(() => js(a, "getComputedStyle(document.documentElement).getPropertyValue('--reader-background-blur')==='12px'"), 'peer blur');
      assert.ok(Math.abs(await js(a, `document.querySelector('[data-comment-id="${anchor.id}"]').getBoundingClientRect().top`) - anchor.top) < 2);
      assert.equal((await js(a, `document.querySelector('.reader-wallpaper').getBoundingClientRect().top`)), (await js(a, `${panel}.getBoundingClientRect().top`)));
      await geometry(a); await capture(a, 'charcoal-wallpaper');
      for (const [width, zoom] of [[720,1], [1240,1.25], [1440,1]]) { a.setSize(width,800); a.webContents.setZoomFactor(zoom); await pause(200); await geometry(a); }
      assert.deepEqual((await boot(a)).comments[ids.item].map(c => c.seen), before.comments[ids.item].map(c => c.seen));
      const cached = await js(a, `(()=>{const p=${panel},r=[...p.querySelectorAll('.virtual-comment')].find(e=>e.getBoundingClientRect().bottom>p.getBoundingClientRect().top);return {id:r.dataset.commentId,offset:r.getBoundingClientRect().top-p.getBoundingClientRect().top}})()`);
      await settings(a); await open(a);
      try { await wait(() => js(a, `(()=>{const p=${panel},r=[...p.querySelectorAll('.virtual-comment')].find(e=>e.getBoundingClientRect().bottom>p.getBoundingClientRect().top);return r?.dataset.commentId===${JSON.stringify(cached.id)} && Math.abs(r.getBoundingClientRect().top-p.getBoundingClientRect().top-(${cached.offset}))<3})()`), 'wallpaper cached anchor'); }
      catch(error) { console.error('Wallpaper cached evidence',JSON.stringify({cached,actual:await js(a,`(()=>{const p=${panel},r=[...p.querySelectorAll('.virtual-comment')].find(e=>e.getBoundingClientRect().bottom>p.getBoundingClientRect().top);return {id:r?.dataset.commentId,offset:r&&r.getBoundingClientRect().top-p.getBoundingClientRect().top,scroll:p.scrollTop,rows:[...p.querySelectorAll('.virtual-comment')].map(r=>r.dataset.index)}})()`)}));throw error; }
      await settings(a); a.show(); a.focus(); a.webContents.focus();
      await js(a, "document.querySelectorAll('.appearance-settings input[type=range]')[0].focus();void 0");
      const revision = (await boot(a)).preferences.readerAppearance.revision;
      for (const keyCode of ['End', 'Home', 'Right']) { a.webContents.sendInputEvent({ type:'keyDown', keyCode }); a.webContents.sendInputEvent({ type:'keyUp', keyCode }); await pause(40); }
      assert.equal(await js(a, "document.querySelector('.appearance-settings input[type=range]').value"), '1');
      assert.equal((await boot(a)).preferences.readerAppearance.revision, revision, 'slider input makes no writes');
      await js(a, "[...document.querySelectorAll('.appearance-settings button')].find(e=>e.textContent==='Apply wallpaper settings').click();void 0");
      await wait(async () => (await boot(b)).preferences.readerAppearance.surfaceOpacity === 1, 'keyboard draft acknowledged');
      const current = (await boot(a)).preferences.readerAppearance;
      await invoke(a, 'updatePreferences', { readerAppearance: { ...change, expectedRevision: current.revision } });
      await open(a); await open(b);
      await a.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
      assert.equal(await js(a, "getComputedStyle(document.querySelector('.reader-wallpaper')).display"), 'none');
      await a.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); a.webContents.debugger.detach();
      await invoke(a, 'createBackup');
      fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify((await boot(a)).preferences));
      assert.equal(approved.readerAppearance.wallpaperEnabled, true);
    } else {
      await wait(() => windows.length === 2, 'restored native membership'); const b = windows[1]; await ready(b); await open(a); await open(b);
      const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')));
      assert.deepEqual((await boot(a)).preferences, expected); assert.deepEqual((await boot(b)).preferences, expected);
      if (phase === 'restart') {
        await wait(() => js(a, "!!document.querySelector('.reader-wallpaper')?.naturalWidth"), 'restart owned wallpaper'); await geometry(a);
        await invoke(a, 'updatePreferences', { appearance: 'light' }); await invoke(a, 'updatePreferences', { removeWallpaper: { expectedRevision: (await boot(a)).preferences.readerAppearance.revision } });
        selected = path.join(root, 'snapshot.sqlite'); finished = true;
        await invoke(a, 'restoreBackup'); return;
      }
      if (phase === 'restored') { await wait(() => js(a, "!!document.querySelector('.reader-wallpaper')?.naturalWidth"), 'restored wallpaper'); await geometry(a); }
      if (phase === 'missing') {
        await wait(() => js(a, '!document.querySelector(".reader-wallpaper")'), 'missing fallback'); await geometry(a); await settings(a);
        assert.equal(await js(a, "document.querySelector('.appearance-settings').textContent.includes('missing or invalid')"), true);
      }
    }
    console.log('Appearance Electron PASS ' + phase); finished = true; app.quit();
  }).catch(fail);
  app.on('will-quit', () => { assert.equal(finished, true); clearTimeout(watchdog); });
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-appearance-electron-'));
    try {
      const bundle = path.join(root, 'seed.cjs');
      require('esbuild').buildSync({ stdin: { contents: "export {ReaderRepository} from './src/main/persistence/reader-repository'; export {normalizeYtDlp} from './src/main/extractors/yt-dlp'; export {thumbnailPng} from './src/fixtures/thumbnail-image';", resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform:'node', format:'cjs', outfile:bundle });
      const { ReaderRepository, normalizeYtDlp, thumbnailPng } = require(bundle);
      const repo = ReaderRepository.open(path.join(root, 'youtube-comments-development', 'reader.sqlite'));
      const observation = normalizeYtDlp(JSON.stringify({ id:'YE7VzlLtp-4', title:'Fictional wallpaper reading check', comments:Array.from({length:3000},(_,i)=>({id:`c${i}`,parent:i%7 ? `c${i-i%7}`:'root',text:`Fictional comment ${i}. ${'Variable height reading. '.repeat(1+i%5)}`})) }), { provenance: {backend:'yt-dlp',version:'2026.08.19',evidence:['Offline appearance fixture']} });
      const item = repo.ingest(observation, undefined, true).itemId; repo.updatePreferences({locale:'en'},['en']); repo.close();
      fs.writeFileSync(path.join(root,'ids.json'),JSON.stringify({item})); fs.writeFileSync(path.join(root,'image.png'),thumbnailPng(3200,1800));
      fs.copyFileSync(path.resolve(__dirname,'../docs/examples/warm-graphite.json'),path.join(root,'theme.json')); fs.writeFileSync(path.join(root,'invalid.json'),'{"css":"url(https://evil.test)"}');
      for (const phase of ['first','restart','restored','missing']) {
        if (phase === 'missing') {
          const expected = JSON.parse(fs.readFileSync(path.join(root,'expected.json')));
          fs.unlinkSync(path.join(root,'youtube-comments-development','appearance','wallpapers',expected.readerAppearance.wallpaperId+'.jpg'));
        }
        const env = {...process.env,YOUTUBE_COMMENTS_DEMO_ROOT:root,APPEARANCE_PHASE:phase}; delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});
        const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}); assert.equal(code,0,phase);
      }
    } finally {
      assert.ok(path.dirname(root)===os.tmpdir() && path.basename(root).startsWith('reader-appearance-electron-'));
      fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  })().catch(error=>{console.error(error);process.exitCode=1;});
}

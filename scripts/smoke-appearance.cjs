// Production main/preload/renderer, native decoder/protocol, disposable data only.
// Native picker results are controlled here, never by a shipped test capability.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const palettes = Object.fromEntries(['light', 'dark', 'charcoal'].map(name => [name, require('../src/shared/themes/' + name + '.json')]));
const cssRgb = hex => 'rgb(' + [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(', ') + ')';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const panel = "document.querySelector('.reader-panel:not([hidden])')";
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, dialog, nativeImage, nativeTheme, shell } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.APPEARANCE_PHASE;
  assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-appearance-electron-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); app.setPath(name, folder);
  }
  const ids = JSON.parse(fs.readFileSync(path.join(root, 'ids.json'))), windows = [];
  let selected, expectedParent, finished = false, exportTarget, backupTarget = path.join(root, 'snapshot.sqlite');
  const themesFolder = path.join(root, 'youtube-comments-development', 'themes'), openedFolders = [];
  // Exercise the production shell adapter without leaving Explorer windows open.
  shell.openPath = async directory => { openedFolders.push(directory); return ''; };
  dialog.showOpenDialog = async (parent, options) => {
    assert.equal(parent, expectedParent);
    assert.deepEqual(options.properties, ['openFile']);
    return { canceled: !selected, filePaths: selected ? [selected] : [] };
  };
  dialog.showSaveDialog = async (parent, options) => {
    assert.equal(parent, expectedParent);
    if (options.filters?.[0]?.extensions?.[0] === 'json') {
      assert.equal(path.dirname(options.defaultPath), app.getPath('documents'));
      return { canceled: !exportTarget, filePath: exportTarget };
    }
    return { canceled: false, filePath: backupTarget };
  };
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
  async function contrastMatrix(w, wallpaper) {
    for (const [mode, dark] of [['light', false], ['dark', true], ['charcoal', true], ['system', false], ['system', true]]) {
      await w.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
      await invoke(w, 'updatePreferences', { appearance: mode });
      const resolved = mode === 'system' ? dark ? 'dark' : 'light' : mode;
      await wait(() => js(w, `document.documentElement.dataset.appearance===${JSON.stringify(mode)} && getComputedStyle(document.documentElement).colorScheme===${JSON.stringify(dark ? 'dark' : 'light')}`), 'matrix palette');
      const tokens = palettes[resolved].tokens;
      for (const [token, color] of Object.entries(tokens)) {
        const property = token === 'unseen-surface' ? 'unseen-background' : token;
        assert.equal(await js(w, `getComputedStyle(document.documentElement).getPropertyValue('--${property}').trim()`), color, `${resolved} ${token}`);
      }
      for (const scroll of [0, 45000, 1e9]) {
        await js(w, `${panel}.scrollTop=${scroll};void 0`); await pause(100);
        await geometry(w);
        const evidence = await js(w, `(()=>{
          const p=${panel}, rows=[...p.querySelectorAll('article.comment')];
          const unseen=rows.filter(r=>r.classList.contains('is-unseen'));
          const seen=rows.filter(r=>r.classList.contains('is-seen'));
          const old=document.createElement('div');old.style.background='color-mix(in srgb, var(--accent-soft) 65%, transparent)';p.append(old);
          const legacy=getComputedStyle(old).backgroundColor;old.remove();
          return {unseen:unseen.map(r=>getComputedStyle(r).backgroundColor),seen:seen.map(r=>getComputedStyle(r).backgroundColor),legacy,
            text:unseen.map(r=>getComputedStyle(r.querySelector('.comment-text')).color),
            nested:p.querySelectorAll('.virtual-comment[data-depth]').length,
            badge:unseen[0]?.querySelector('.unseen-badge') && getComputedStyle(unseen[0].querySelector('.unseen-badge')).backgroundColor};
        })()`);
        assert.ok(evidence.unseen.length && evidence.seen.length, 'mixed seen/unseen virtual rows');
        assert.ok(evidence.seen.every(c => c === 'rgba(0, 0, 0, 0)'), 'seen remains transparent');
        assert.ok(evidence.nested > 0, 'nested virtual rows remain mounted');
        const expected = tokens['unseen-surface'] ? cssRgb(tokens['unseen-surface']) : evidence.legacy;
        assert.ok(evidence.unseen.every(c => c === expected), JSON.stringify({mode,wallpaper,evidence}));
        assert.ok(evidence.text.every(c => c === cssRgb(tokens.text)), `${resolved} opaque unread text`);
        assert.equal(evidence.badge, cssRgb(tokens['accent-soft']), `${resolved} unread badge surface`);
        if (scroll === 45000) await capture(w, `${mode}${mode==='system'?dark?'-dark':'-light':''}-${wallpaper?'wallpaper':'plain'}`);
      }
      // Real query roles, NEW and selection keep their separate semantic styles.
      async function search(text) {
        await js(w, `(()=>{const e=${panel}.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await frames(w);
        await js(w, `${panel}.querySelector('form.query-controls').requestSubmit();void 0`);
      }
      await search('Fictional comment 2999.');
      await wait(() => js(w, `!!${panel}.querySelector('.match-badge') && !!${panel}.querySelector('.context-badge') && !!${panel}.querySelector('.new-badge')`), 'MATCH/CONTEXT/NEW');
      await js(w, `${panel}.querySelectorAll('.query-navigation button')[1].click();void 0`);
      await wait(() => js(w, `!!${panel}.querySelector('.comment[data-selected=true]')`), 'selection');
      const styles = await js(w, `(()=>{
        const p=${panel},c=getComputedStyle(p.querySelector('.comment[data-selected=true]'));
        const checkbox=p.querySelector('.comment[data-selected=true] .seen-control input');checkbox.focus();
        return {selection:c.outlineWidth,selectionColor:c.outlineColor,focus:getComputedStyle(checkbox.closest('.seen-control')).outlineWidth,
          focusColor:getComputedStyle(checkbox.closest('.seen-control')).outlineColor,accent:getComputedStyle(checkbox).accentColor,
          match:getComputedStyle(p.querySelector('.match-badge')).borderTopStyle,
          matchColor:getComputedStyle(p.querySelector('.match-badge')).color,unseenColor:getComputedStyle(p.querySelector('.unseen-badge')).color,
          context:getComputedStyle(p.querySelector('.context-badge')).backgroundColor,
          new:getComputedStyle(p.querySelector('.new-badge')).backgroundColor};
      })()`);
      assert.equal(styles.selection,'2px');assert.equal(styles.focus,'2px');assert.equal(styles.match,'solid');assert.equal(styles.context,'rgba(0, 0, 0, 0)');
      assert.equal(styles.selectionColor,cssRgb(tokens.focus));assert.equal(styles.focusColor,cssRgb(tokens.focus));
      assert.equal(styles.accent,cssRgb(tokens.accent));assert.equal(styles.matchColor,cssRgb(tokens.accent));assert.equal(styles.unseenColor,cssRgb(tokens.unseen));
      assert.equal(styles.new,resolved==='light'?'rgb(255, 240, 189)':'rgb(78, 64, 33)');
      await capture(w, `${resolved}-${wallpaper?'wallpaper':'plain'}-badges`);
      await search('');
      await wait(() => js(w, `Number(${panel}.querySelector('.virtual-reader')?.dataset.rowCount)===3000`), 'clear applied query');
    }
    console.log('Appearance contrast matrix PASS wallpaper=' + wallpaper);
  }
  app.whenReady().then(async () => {
    await wait(() => windows.length > 0, 'first window'); const a = windows[0]; expectedParent = a; await ready(a);
    if (phase === 'first') {
      await invoke(a, 'newWindow'); await wait(() => windows.length === 2, 'second native'); const b = windows[1]; await ready(b); await open(a); await open(b);
      const before = await boot(a); assert.equal(before.comments[ids.item].length, 3000);
      const legacy = before.preferences.readerAppearance.themes[0];
      assert.equal(legacy.id, ids.legacyTheme);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(themesFolder, legacy.id + '.json'), 'utf8')), legacy.definition);
      assert.equal(fs.readdirSync(path.join(themesFolder, 'examples')).length, 4);
      a.webContents.debugger.attach('1.3');
      await contrastMatrix(a, false);
      for (const dark of [true, false]) {
        await invoke(a, 'updatePreferences', { appearance: 'system' });
        await a.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
        await wait(async () => await bg(a) === (dark ? 'rgb(21, 27, 35)' : 'rgb(242, 244, 246)'), 'OS palette');
      }
      await invoke(a, 'updatePreferences', { appearance: 'charcoal' });
      await wait(async () => await bg(a) === 'rgb(21, 21, 21)' && await bg(b) === 'rgb(21, 21, 21)', 'shared charcoal');
      assert.equal(await js(a, 'getComputedStyle(document.documentElement).colorScheme'), 'dark');
      // Offline starter export, real native Save API and importer round-trips.
      await settings(a);
      exportTarget = path.join(root, 'youtube-comments-development', 'reader.sqlite');
      const profileBefore = (await boot(a)).preferences;
      assert.equal((await js(a, "window.reader.exportTheme({source:'light'})")).error.code,'DATA_WRITE_FAILED');
      assert.deepEqual((await boot(a)).preferences,profileBefore,'export cannot replace profile state');
      for (const source of ['light', 'dark', 'charcoal', 'warm-graphite']) {
        const preferences = (await boot(a)).preferences;
        exportTarget = path.join(root, source + '.json');
        await js(a, `(()=>{const e=[...document.querySelectorAll('.appearance-settings select')].find(e=>[...e.options].some(o=>o.value==='warm-graphite'));const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(e,${JSON.stringify(source)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await js(a, "[...document.querySelectorAll('.appearance-settings button')].find(e=>e.textContent==='Export theme as JSON…').click();void 0");
        await wait(() => fs.existsSync(exportTarget), 'export file');
        await wait(() => js(a, "!document.querySelector('.appearance-settings').disabled"), 'export settled');
        assert.deepEqual((await boot(a)).preferences, preferences, 'export never changes theme or revision');
        const exported = JSON.parse(fs.readFileSync(exportTarget, 'utf8'));
        const template = JSON.parse(fs.readFileSync(path.resolve(__dirname, source==='warm-graphite'?'../docs/examples/warm-graphite.json':'../src/shared/themes/'+source+'.json'), 'utf8'));
        assert.deepEqual(exported, template);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(themesFolder, 'examples', source + '.json'), 'utf8')), template);
        selected = exportTarget; await invoke(a, 'importTheme');
        assert.deepEqual((await boot(a)).preferences.readerAppearance.themes.at(-1).definition, template);
        exportTarget = path.join(root, 'current.json'); await invoke(a, 'exportTheme', {source:'current'});
        assert.deepEqual(JSON.parse(fs.readFileSync(exportTarget,'utf8')),template);
      }
      const unchanged = (await boot(a)).preferences;
      exportTarget = undefined; await invoke(a, 'exportTheme', {source:'light'});
      assert.deepEqual((await boot(a)).preferences,unchanged);
      for (const dark of [true,false]) {
        nativeTheme.themeSource = dark ? 'dark' : 'light';
        await invoke(a,'updatePreferences',{appearance:'system'});
        exportTarget=path.join(root,'system.json'); await invoke(a,'exportTheme',{source:'current'});
        assert.equal(JSON.parse(fs.readFileSync(exportTarget,'utf8')).name,dark?'Dark':'Light');
      }
      nativeTheme.themeSource='system';
      // Real files + authenticated preload/IPC + two production renderers.
      await invoke(a, 'openThemesFolder'); assert.deepEqual(openedFolders, [themesFolder]);
      assert.equal((await js(a, 'window.reader.refreshThemes({path:"C:/private"})')).ok, true, 'payload-free bridge never forwards paths');
      const copyBefore = (await boot(a)).preferences.appearance;
      await invoke(a, 'saveThemeCopy', { source: 'charcoal' });
      assert.equal((await boot(a)).preferences.appearance, copyBefore);
      const editable = path.join(themesFolder, 'editable.json'), renamed = path.join(themesFolder, 'renamed.json');
      fs.copyFileSync(path.join(themesFolder, 'examples', 'warm-graphite.json'), editable);
      await invoke(a, 'refreshThemes');
      let theme = (await boot(a)).preferences.readerAppearance.themes.at(-1);
      await invoke(a, 'updatePreferences', { selectTheme: { id: theme.id, expectedRevision: (await boot(a)).preferences.readerAppearance.revision } });
      await wait(() => js(b, "document.documentElement.dataset.appearance==='custom'"), 'file theme peer activation');
      const changed = {...theme.definition, name: 'Edited native theme', tokens: {...theme.definition.tokens, background:'#232425'}};
      fs.writeFileSync(editable, JSON.stringify(changed));
      assert.equal((await boot(a)).preferences.readerAppearance.themes.at(-1).definition.name, theme.definition.name, 'explicit refresh only');
      await invoke(b, 'refreshThemes');
      await wait(async () => await bg(a) === 'rgb(35, 36, 37)' && await bg(b) === 'rgb(35, 36, 37)', 'edited active theme in both windows');
      fs.renameSync(editable, renamed); await invoke(a, 'refreshThemes');
      assert.equal((await boot(a)).preferences.readerAppearance.customThemeId, theme.id);
      fs.writeFileSync(renamed, '{'); fs.writeFileSync(path.join(themesFolder, 'invalid-file.json'), '{}');
      fs.copyFileSync(path.join(themesFolder, 'examples', 'light.json'), path.join(themesFolder, 'valid-addition.json'));
      const refreshed = await invoke(a, 'refreshThemes'); assert.equal(refreshed.issues.length, 2);
      assert.equal((await boot(a)).preferences.readerAppearance.themes.find(t => t.id === theme.id).definition.name, 'Edited native theme');
      assert.equal(await bg(b), 'rgb(35, 36, 37)');
      fs.writeFileSync(renamed, JSON.stringify(changed)); fs.copyFileSync(renamed, path.join(themesFolder, 'duplicate-name.json'));
      await Promise.all([invoke(a, 'refreshThemes'), invoke(b, 'refreshThemes')]); await settings(a);
      const labels = await js(a, "[...document.querySelector('.appearance-settings select').options].map(o=>o.textContent)");
      assert.equal(labels.filter(label => label.startsWith('Edited native theme (')).length, 2);
      fs.unlinkSync(renamed); fs.unlinkSync(path.join(themesFolder, 'invalid-file.json')); await invoke(a, 'refreshThemes');
      assert.equal((await boot(a)).preferences.appearance, 'system');
      fs.writeFileSync(path.join(themesFolder, 'examples', 'warm-graphite.json'), 'owner edit'); await invoke(a, 'refreshThemes');
      assert.equal(fs.readFileSync(path.join(themesFolder, 'examples', 'warm-graphite.json'), 'utf8'), 'owner edit');
      await open(a);
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
      // A nonuniform light/dark/color pattern exercises opacity and bounded blur,
      // rather than proving wallpaper behavior only against a flat image.
      const patterned = await js(a, "(()=>{const c=document.createElement('canvas');c.width=3200;c.height=1800;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,3200,1800);g.addColorStop(0,'#f7e5a9');g.addColorStop(.5,'#145778');g.addColorStop(1,'#090d1a');x.fillStyle=g;x.fillRect(0,0,3200,1800);for(let i=0;i<12;i++){x.fillStyle=i%2?'#f7f0db':'#243649';x.fillRect(i*300,300+i%3*280,180,500);}return c.toDataURL('image/png').split(',')[1]})()");
      fs.writeFileSync(path.join(root,'image.png'),Buffer.from(patterned,'base64'));
      selected = path.join(root, 'image.png'); await invoke(a, 'importWallpaper');
      // Real Chromium WebP encoding followed by the actual privileged native decode.
      const webp = await js(a, "(()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');x.fillStyle='#465d4b';x.fillRect(0,0,640,360);return c.toDataURL('image/webp').split(',')[1]})()");
      fs.writeFileSync(path.join(root, 'image.webp'), Buffer.from(webp, 'base64')); selected = path.join(root, 'image.webp'); await invoke(a, 'importWallpaper');
      const jpg = nativeImage.createFromPath(path.join(root, 'image.png')).toJPEG(85); fs.writeFileSync(path.join(root, 'image.jpg'), jpg); selected = path.join(root, 'image.jpg'); await invoke(a, 'importWallpaper');
      const approved = (await boot(a)).preferences;
      fs.unlinkSync(selected); fs.unlinkSync(path.join(root, 'image.png')); fs.unlinkSync(path.join(root, 'image.webp')); fs.unlinkSync(path.join(root, 'theme.json'));
      await wait(() => js(a, "!!document.querySelector('.reader-wallpaper')?.naturalWidth"), 'wallpaper decoded');
      await wait(() => js(b, "!!document.querySelector('.reader-wallpaper')?.naturalWidth"), 'peer wallpaper');
      await contrastMatrix(a, true);
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
      try {
        const observation = normalizeYtDlp(JSON.stringify({ id:'YE7VzlLtp-4', title:'Fictional wallpaper reading check', comments:Array.from({length:3000},(_,i)=>({id:`c${i}`,parent:i%7 ? `c${i-i%7}`:'root',text:`Fictional comment ${i}. ${'Variable height reading. '.repeat(1+i%5)}`})) }), { provenance: {backend:'yt-dlp',version:'2026.08.19',evidence:['Offline appearance fixture']} });
        const item = repo.ingest({...observation,collection:{status:'present',comments:observation.collection.comments.slice(0,2999)}}, undefined, true).itemId;
        repo.ingest(observation,undefined,true);
        repo.bulkSeen({itemId:item,seen:true,target:{kind:'matching',ids:repo.bootstrap(['en']).comments[item].filter((_,i)=>i%2===0).map(c=>c.id)}});
        repo.updatePreferences({locale:'en'},['en']);
        repo.importTheme(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/shared/themes/light.json'), 'utf8')), ['en'], 0);
        fs.writeFileSync(path.join(root,'ids.json'),JSON.stringify({item, legacyTheme:repo.readerAppearance().customThemeId})); fs.writeFileSync(path.join(root,'image.png'),thumbnailPng(3200,1800));
      } finally { repo.close(); }
      fs.copyFileSync(path.resolve(__dirname,'../docs/examples/warm-graphite.json'),path.join(root,'theme.json')); fs.writeFileSync(path.join(root,'invalid.json'),'{"css":"url(https://evil.test)"}');
      for (const phase of ['first','restart','restored','missing']) {
        if (phase === 'missing') {
          // Recreate a restored profile's theme files solely from its SQLite snapshot.
          fs.renameSync(path.join(root,'youtube-comments-development','themes'), path.join(root,'held-themes'));
          fs.renameSync(path.join(root,'youtube-comments-development','theme-files.json'), path.join(root,'held-theme-files.json'));
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

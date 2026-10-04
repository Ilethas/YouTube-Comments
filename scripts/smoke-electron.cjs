// Focused verification of the real built entry points. Run after Forge builds;
// this script is never shipped as the application entry or exposed to renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const entry = path.join(__dirname, '../.vite/build/main.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// A real Chromium paint check: jsdom cannot verify hover/pseudo-element layering.
async function verifyTabHover(window) {
  const contents = window.webContents;
  const js = code => contents.executeJavaScript(code);
  const debuggerApi = contents.debugger;
  const backgroundThrottling = contents.getBackgroundThrottling();
  contents.setBackgroundThrottling(false);
  // A visible surface is required for Chromium pixel capture; do not steal focus.
  window.showInactive();
  debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('DOM.enable');
    await debuggerApi.sendCommand('CSS.enable');
    await debuggerApi.sendCommand('Page.enable');
    const { root } = await debuggerApi.sendCommand('DOM.getDocument');
    const selectors = ['.tab[data-active=true] [role=tab]', '.tab[data-active=true] .tab-close'];
    for (const theme of ['light', 'dark']) {
      await js(`document.documentElement.dataset.appearance=${JSON.stringify(theme)}`);
      const rect = await js(`(() => {const r=document.querySelector('.tab[data-active=true]').getBoundingClientRect();
        return {x:Math.round(r.left)+5,y:Math.round(r.top)+2,width:Math.floor(r.width)-10,height:1};})()`);
      const line = async () => {
        const { data } = await debuggerApi.sendCommand('Page.captureScreenshot');
        return require('electron').nativeImage.createFromBuffer(Buffer.from(data, 'base64')).crop(rect).toBitmap();
      };
      const baseline = await line();
      assert.ok(baseline.length > 0, 'Active accent has painted pixels');
      for (let i = 4; i < baseline.length; i += 4) assert.deepEqual(baseline.subarray(i, i + 4), baseline.subarray(0, 4), 'Accent is continuous across both buttons');
      for (const selector of selectors) {
        const { nodeId } = await debuggerApi.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
        await debuggerApi.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        assert.deepEqual(await line(), baseline, `${theme}: ${selector} hover preserves the complete accent`);
        const geometry = await js(`(() => {const tab=document.querySelector('.tab[data-active=true]'),button=document.querySelector(${JSON.stringify(selector)}),r=button.getBoundingClientRect(),p=tab.getBoundingClientRect();
          return {hit:document.elementFromPoint(r.left+r.width/2,r.top+1)===button,
            inset:r.top>p.top+1&&r.right<p.right-1&&r.bottom<p.bottom,
            rounded:parseFloat(getComputedStyle(button).borderTopRightRadius)>0};})()`);
        assert.equal(geometry.hit, true, 'Accent overlay does not intercept button input');
        if (selector.endsWith('.tab-close')) { assert.equal(geometry.inset, true, 'Close hover stays inside tab'); assert.equal(geometry.rounded, true); }
        await debuggerApi.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus-visible'] });
        const focus = await js(`(() => {const button=document.querySelector(${JSON.stringify(selector)});button.focus();const s=getComputedStyle(button);return {focused:document.activeElement===button,width:s.outlineWidth,style:s.outlineStyle,overflow:getComputedStyle(button.parentElement).overflow};})()`);
        assert.equal(focus.focused, true); assert.equal(focus.width, '2px'); assert.equal(focus.style, 'solid'); assert.equal(focus.overflow, 'visible', 'Tab does not clip focus outlines');
        await debuggerApi.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      }
    }
  } finally {
    await js("document.documentElement.dataset.appearance='system'");
    debuggerApi.detach();
    contents.setBackgroundThrottling(backgroundThrottling);
    window.hide();
  }
}

async function verifyWindow(window, nativeTheme) {
  window.hide();
  const contents = window.webContents;
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  const phase = process.env.YOUTUBE_COMMENTS_SMOKE_PHASE;
  const checkpoint = path.join(root, 'checkpoint.json');
  const js = code => contents.executeJavaScript(code);
  async function waitFor(code, label) {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await js(code)) return;
      await pause(30);
    }
    throw new Error(`Timed out: ${label}; ${await js('document.body.innerText')}`);
  }
  async function snapshot() {
    const result = await js('window.reader.bootstrap()');
    assert.equal(result.ok, true);
    // Normalize absent optional values for the serialized restart checkpoint.
    return JSON.parse(JSON.stringify(result.value));
  }
  async function preference(index, value) {
    const previous = (await snapshot()).workspace.activeTabId;
    await js("document.getElementById('settings-toggle').click()");
    await waitFor("document.querySelector('#panel-settings:not([hidden])') !== null && !!document.querySelector('.preferences select')", 'Settings tab');

    await js(`(() => { const select = document.querySelectorAll('.preferences select')[${index}];
      select.value = '${value}'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await waitFor(`document.querySelectorAll('.preferences select')[${index}].value === '${value}'
      && !document.querySelector('.preferences select:disabled')`, `preference ${value}`);
    if (previous) {
      await js(`document.getElementById(${JSON.stringify('tab-' + previous)}).click()`);
      await waitFor(`document.querySelector('[role=tab][aria-selected=true]').id === ${JSON.stringify('tab-' + previous)}`, 'return from Settings');
    }
  }

  await waitFor("document.querySelectorAll('input[type=checkbox]').length >= 24", 'bootstrap');
  assert.deepEqual(await js('Object.keys(window.reader).sort()'), ['acquire', 'activateTab', 'bootstrap', 'closeTab', 'moveTab', 'openLibrary', 'openSettings', 'openStoredItem', 'refresh', 'removeLibraryItem', 'toggleSeen', 'updatePreferences']);
  assert.deepEqual(await js("window.reader.acquire({url:'https://www.youtube.com/watch?v=abcdefghijk',executable:'evil'})"),
    { ok: false, error: { code: 'INVALID_REQUEST' } });
  assert.deepEqual(await js("window.reader.refresh({itemId:'video-demo',url:'https://example.com'})"),
    { ok: false, error: { code: 'INVALID_REQUEST' } });
  assert.deepEqual(await js("window.reader.refresh({itemId:'video-demo'})"),
    { ok: false, error: { code: 'NOT_REFRESHABLE' } });
  assert.equal(await js('typeof window.require'), 'undefined');
  assert.equal(await js('typeof window.process'), 'undefined');
  const options = contents.getLastWebPreferences();
  assert.equal(options.contextIsolation, true);
  assert.equal(options.sandbox, true);
  assert.equal(options.nodeIntegration, false);
  assert.deepEqual(await js("window.reader.toggleSeen({itemId:'video-demo',commentId:'v2',subtree:'true'})"),
    { ok: false, error: { code: 'INVALID_REQUEST' } });
  const original = await snapshot();
  if (phase === 'write') {
    await verifyTabHover(window);
    assert.equal(original.items.length, 2);
    assert.equal(original.preferences.appearance, 'system');
    await preference(0, 'en');
    await js("document.querySelectorAll('#panel-video-demo .seen-control input')[2].click()");
    await waitFor("document.querySelectorAll('#panel-video-demo .seen-control input')[2].checked && !document.querySelector('input:disabled')", 'ordinary click');
    let state = await snapshot();
    assert.deepEqual(state.comments['video-demo'].map(comment => comment.seen),
      original.comments['video-demo'].map(comment => comment.id === 'v3' ? !comment.seen : comment.seen));
    await js("document.querySelectorAll('#panel-video-demo .seen-control input')[1].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))");
    await waitFor("!document.querySelectorAll('#panel-video-demo .seen-control input')[1].checked && !document.querySelector('input:disabled')", 'Ctrl click');
    state = await snapshot();
    assert.deepEqual(state.comments['video-demo'].map(comment => comment.seen),
      original.comments['video-demo'].map(comment => ['v2', 'v3', 'v4'].includes(comment.id) ? false : comment.seen));
    assert.deepEqual(state.comments['post-demo'], original.comments['post-demo']);
    // An ordinary edit outside the subtree must also survive the real restart.
    await js("document.querySelectorAll('#panel-video-demo .seen-control input')[5].click()");
    await waitFor("document.querySelectorAll('#panel-video-demo .seen-control input')[5].checked && !document.querySelector('input:disabled')", 'independent ordinary click');
    await js("document.querySelectorAll('[role=tab]')[1].click()");
    await waitFor("document.querySelector('[role=tabpanel]:not([hidden])').id === 'panel-post-demo'", 'tab selection');
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden])').id"), 'panel-post-demo');
    await js("document.querySelectorAll('[role=tab]')[0].click()");
    await waitFor("document.querySelector('[role=tabpanel]:not([hidden])').id === 'panel-video-demo'", 'tab return');
    for (const mode of ['light', 'dark', 'system']) {
      await preference(1, mode);
      assert.equal(await js('document.documentElement.dataset.appearance'), mode);
    }
    await preference(0, 'pl');
    assert.equal(await js('document.documentElement.lang'), 'pl');
    assert.equal(await js("document.querySelector('.brand strong').textContent"), 'Czytnik dyskusji');
    await preference(1, 'dark');
    assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"), '#151b23');
    state = await snapshot();
    assert.deepEqual(state.comments['video-demo'].map(comment => comment.seen), original.comments['video-demo'].map(comment =>
      ['v2', 'v3', 'v4'].includes(comment.id) ? false : comment.id === 'v6' ? true : comment.seen));
    assert.deepEqual(state.comments['post-demo'], original.comments['post-demo']);
    async function acquire(url) {
      assert.equal(await js("document.querySelector('#source-url') === null"), true);
      await js("document.querySelector('[aria-controls=acquisition-form]').click()");
      await js(`(() => { const input = document.querySelector('#source-url');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url)});
        input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
      await waitFor("!document.querySelector('.acquisition-bar button').disabled", 'URL ready');
      await js("document.querySelector('.acquisition-bar button').click()");
      await waitFor("document.querySelector('.acquisition-status') !== null", 'acquisition progress');
      assert.equal(await js("Array.from(document.querySelectorAll('input[type=checkbox]')).every(input => !input.disabled)"), true);
      await waitFor("document.querySelector('#source-url') === null && !document.body.innerText.includes('Pobieranie…')", 'acquisition acknowledgment');
      assert.equal(await js("document.querySelector('[role=alert]') === null"), true);
      return snapshot();
    }
    state = await acquire('https://www.youtube.com/watch?v=VidDemo_001');
    const video = state.items.find(item => item.sourceId === 'VidDemo_001');
    assert.ok(video);
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden])').id"), `panel-${video.id}`);
    assert.equal(state.comments[video.id].length, 3);
    assert.ok(state.comments[video.id].every(comment => !comment.seen));
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .seen-control input').click()");
    await waitFor("document.querySelector('[role=tabpanel]:not([hidden]) .seen-control input').checked && !document.querySelector('input[type=checkbox]:disabled')", 'acquired seen');
    state = await snapshot();
    const seenId = state.comments[video.id].find(comment => comment.seen).id;
    async function draftQuery(text, seen = 'all', regex = false) {
      await js(`(() => { const panel=document.querySelector('[role=tabpanel]:not([hidden])'); const input=panel.querySelector('.query-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true}));
        const select=panel.querySelector('.query-controls select'); select.value=${JSON.stringify(seen)}; select.dispatchEvent(new Event('change',{bubbles:true}));
        const toggle=panel.querySelectorAll('.query-controls button[type=button]')[1]; if ((toggle.getAttribute('aria-pressed')==='true')!==${regex}) toggle.click(); })()`);
    }
    async function applyQuery() {
      await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-controls button[type=submit]').click()");
      await waitFor("!document.querySelector('[role=tabpanel]:not([hidden]) .query-status').textContent.includes('Obliczanie')", 'worker applied');
    }
    const visibleMatches = () => js("Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) [data-view-role=match]'), row => row.id)");
    // Real bundled same-origin worker under the shipped CSP, including rejected drafts.
    await draftQuery(state.comments[video.id][0].text.slice(0, 8)); await applyQuery();
    assert.ok((await visibleMatches()).length > 0);
    const previousMatches = await visibleMatches();
    await draftQuery('[', 'all', true); await applyQuery();
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-error').textContent.includes('Nieprawidłowe')"), true);
    assert.deepEqual(await visibleMatches(), previousMatches);
    await draftQuery('\\p{L}+', 'unseen', true); await applyQuery();
    assert.ok((await visibleMatches()).length > 0);
    const beforeNavigation = await snapshot();
    await js("document.querySelector('[role=tabpanel]:not([hidden])').dispatchEvent(new KeyboardEvent('keydown',{key:'F3',bubbles:true,cancelable:true}))");
    assert.ok(await js("!!document.querySelector('[role=tabpanel]:not([hidden]) [data-selected=true]')"));
    assert.deepEqual((await snapshot()).comments, beforeNavigation.comments);
    await draftQuery('smoke', 'unseen'); await applyQuery();
    await draftQuery('unapplied draft');
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').click()");
    await waitFor("Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) .comment-text')).some(row=>row.textContent.includes('New smoke comment'))", 'refresh applied query');
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-search input').value"), 'unapplied draft');
    assert.ok((await visibleMatches()).length > 0);
    await draftQuery(''); await applyQuery();
    state = await snapshot();
    assert.equal(state.items.length, 3);
    assert.equal(state.comments[video.id].length, 4);
    assert.equal(state.comments[video.id].find(comment => comment.id === seenId).seen, true);
    assert.equal(state.comments[video.id].find(comment => comment.source.commentId === 'smoke-new').seen, false);
    const validState = state;
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').click()");
    await waitFor("document.querySelector('[role=alert]') !== null", 'failed refresh');
    assert.deepEqual(await snapshot(), validState);
    state = await acquire('https://www.youtube.com/post/UgkDemoPost_0123456789');
    const post = state.items.find(item => item.sourceId === 'UgkDemoPost_0123456789');
    assert.ok(post);
    assert.equal(state.comments[post.id].length, 4);
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').click()");
    await waitFor("!document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').disabled", 'Community refresh');
    state = await snapshot();
    assert.equal(state.items.length, 4);
    const priorComments = state.comments;
    await js(`document.getElementById('tab-discussion:${video.id}').nextElementSibling.click()`);
    await waitFor(`document.getElementById('tab-discussion:${video.id}') === null`, 'close background video');
    assert.equal((await snapshot()).workspace.activeTabId, 'discussion:' + post.id);
    await js("document.querySelector('#library-toggle').click()");
    await waitFor("document.querySelector('#panel-library:not([hidden])') !== null", 'Library tab');
    await js("Array.from(document.querySelectorAll('.library-entry')).find(row => row.textContent.includes('Invented workshop')).querySelector('button').click()");
    await waitFor(`document.querySelector('[role=tabpanel]:not([hidden])').id === 'panel-${video.id}'`, 'Library reopen video');
    await js(`document.getElementById('tab-discussion:${post.id}').nextElementSibling.click()`);
    await waitFor(`document.getElementById('tab-discussion:${post.id}') === null`, 'close Community workspace view');
    state = await snapshot();
    assert.deepEqual(state.comments, priorComments);
    assert.equal(state.items.length, 4);
    assert.equal(state.workspace.tabs.filter(tab => tab.kind === 'discussion').length, 3);
    // Real mouse dragging reorders a background app tab without activating it.
    const activeBefore = state.workspace.activeTabId;
    const start = await js("(() => { const r=document.getElementById('tab-library').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()");
    const target = await js("Math.round(document.querySelector('.tabs').getBoundingClientRect().left+4)");
    contents.sendInputEvent({ type: 'mouseMove', ...start });
    contents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
    await pause(30);
    contents.sendInputEvent({ type: 'mouseMove', x: target, y: start.y, button: 'left' });
    await pause(50);
    contents.sendInputEvent({ type: 'mouseUp', x: target, y: start.y, button: 'left', clickCount: 1 });
    await waitFor("document.querySelector('.tab').dataset.tabId === 'library' && !document.querySelector('[role=tab]:disabled')", 'native pointer reorder');
    state = await snapshot(); assert.equal(state.workspace.activeTabId, activeBefore);
    await js("document.getElementById('tab-settings').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true}))");
    await waitFor("!document.querySelector('[role=tab]:disabled')", 'keyboard reorder');
    state = await snapshot();
    // Delete the closed real Community discussion through the actual modal.
    await js("document.getElementById('library-toggle').click()");
    await waitFor("document.querySelector('#panel-library:not([hidden])') !== null", 'Library removal view');
    await js("Array.from(document.querySelectorAll('.library-entry')).find(row => row.textContent.includes('Invented Community')).querySelector('.destructive').click()");
    await waitFor("document.querySelector('dialog[open]') !== null", 'remove confirmation');
    assert.equal(await js("document.getElementById('remove-description').textContent.includes('trwałe usunięcie')"), true);
    assert.equal(await js("document.activeElement === document.querySelector('dialog .dialog-actions button')"), true);
    assert.equal((await snapshot()).items.length, 4);
    await js("document.querySelector('dialog .dialog-actions button').click()");
    await waitFor("document.querySelector('dialog') === null", 'cancel removal');
    await js("Array.from(document.querySelectorAll('.library-entry')).find(row => row.textContent.includes('Invented Community')).querySelector('.destructive').click()");
    await waitFor("document.querySelector('dialog[open]') !== null", 'remove confirmation again');
    await js("document.querySelector('dialog .destructive').click()");
    await waitFor("document.querySelector('dialog') === null && document.querySelectorAll('.library-entry').length === 3", 'remove committed');
    assert.equal((await snapshot()).items.some(item => item.id === post.id), false);
    await js(`document.getElementById('tab-discussion:${video.id}').click()`);
    await waitFor(`document.querySelector('[role=tabpanel]:not([hidden])').id === 'panel-${video.id}'`, 'active video checkpoint');
    state = await snapshot();
    assert.equal(state.workspace.activeTabId, 'discussion:' + video.id);
    fs.writeFileSync(checkpoint, JSON.stringify(state));
  } else {
    const saved = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
    assert.deepEqual(original, saved);
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden])').id"), `panel-${saved.workspace.tabs.find(tab => tab.id === saved.workspace.activeTabId).itemId}`);
    assert.equal(await js("document.querySelectorAll('[role=tab]').length"), saved.workspace.tabs.length);
    assert.equal(await js('document.documentElement.lang'), saved.preferences.locale);
    assert.equal(await js('document.documentElement.dataset.appearance'), saved.preferences.appearance);
    // Check that the persisted states are actually reflected in the UI.
    assert.deepEqual(await js("Array.from(document.querySelectorAll('#panel-video-demo .seen-control input'), input => input.checked)"),
      saved.comments['video-demo'].map(comment => comment.seen));
    if (phase === 'read') {
      await preference(1, 'system');
      nativeTheme.themeSource = 'light';
      await waitFor("getComputedStyle(document.documentElement).getPropertyValue('--background').trim() === '#f2f4f6'", 'System light');
      nativeTheme.themeSource = 'dark';
      await waitFor("getComputedStyle(document.documentElement).getPropertyValue('--background').trim() === '#151b23'", 'live System dark');
      await preference(1, 'light');
      assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"), '#f2f4f6');
      await preference(1, 'system');
      await preference(0, 'en');
      assert.equal(await js("document.querySelector('.brand strong').textContent"), 'Discussion reader');
      const state = await snapshot();
      assert.deepEqual(state.comments, saved.comments);
      fs.writeFileSync(checkpoint, JSON.stringify(state));
    }
  }
  assert.equal(await js("document.querySelector('[role=alert]') === null"), true);
  console.log(`Electron smoke PASS ${phase}: ${JSON.stringify({ electron: process.versions.electron,
    node: process.versions.node, sqlite: process.versions.sqlite, preferences: (await snapshot()).preferences })}`);
  nativeTheme.themeSource = 'system';
}

if (process.versions.electron && process.type === 'browser') {
  // Test-only process injection before the built entry imports node:child_process.
  // No fake-execution switch or generic process capability is shipped in the app.
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const helpers = path.join(process.env.YOUTUBE_COMMENTS_DEMO_ROOT, 'helpers');
  let videoRuns = 0;
  childProcess.spawn = (file, args, options) => {
    if (path.dirname(file) !== helpers) return originalSpawn(file, args, options);
    assert.equal(options.shell, false);
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    setTimeout(() => {
      let code = 0;
      if (args.includes('--version')) child.stdout.emit('data', Buffer.from(path.basename(file) === 'yt-dlp.exe' ? '2026.08.19\n' : 'post-archiver 0.4.0\n'));
      else if (path.basename(file) === 'yt-dlp.exe') {
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json'), 'utf8')).raw;
        for (const comment of raw.comments) delete comment.author_thumbnail; // Offline smoke makes no image network requests.
        videoRuns++;
        if (videoRuns > 1) raw.comments = [{ ...raw.comments[2], text: 'Updated smoke root' }, { id: 'smoke-new', parent: 'root', text: 'New smoke comment' }];
        if (videoRuns === 3) code = 1;
        child.stdout.emit('data', Buffer.from(JSON.stringify(raw)));
      } else {
        assert.equal(options.env.PYTHONUTF8, '1');
        assert.equal(options.env.PYTHONIOENCODING, 'utf-8');
        const output = args[args.indexOf('--output') + 1];
        const config = args[args.indexOf('--config') + 1];
        assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')), { scraping: { cookies_file: null, download_images: false } });
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/main/extractors/__fixtures__/community-thread-a.json'), 'utf8')).raw;
        delete raw.posts[0].author_thumbnail;
        const pending = [...raw.posts[0].comments];
        while (pending.length) { const comment = pending.pop(); delete comment.author_thumbnail; pending.push(...comment.replies); }
        fs.writeFileSync(path.join(output, 'posts_unknown_20261003_120000.json'), JSON.stringify(raw));
      }
      child.emit('close', code);
    }, args.includes('--version') ? 0 : 150);
    return child;
  };
  const { app, nativeTheme } = require('electron');
  const watchdog = setTimeout(() => { console.error('Electron smoke timed out'); app.exit(1); }, 30000);
  let rendererFailed = false;
  app.on('browser-window-created', (_event, window) => {
    window.hide();
    window.webContents.on('preload-error', (_event, _file, error) => { rendererFailed = true; console.error(error); });
    window.webContents.on('console-message', (_event, details) => {
      if (details.level === 'error') { rendererFailed = true; console.error(details.message); }
    });
    window.webContents.once('did-finish-load', () => {
      verifyWindow(window, nativeTheme).then(() => {
        clearTimeout(watchdog);
        assert.equal(rendererFailed, false, 'Renderer/preload errors during smoke check');
        app.quit();
      }).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); });
    });
  });
  require(entry);
} else {
  async function verifyRestarts() {
    if (!fs.existsSync(entry)) throw new Error('Build Forge main/preload/renderer bundles first with npm run package');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-comments-electron-test-'));
    try {
      const helpers = path.join(directory, 'helpers');
      fs.mkdirSync(helpers);
      for (const name of ['yt-dlp.exe', 'post-archiver.exe']) fs.writeFileSync(path.join(helpers, name), 'test-only fake executable');
      for (const phase of ['write', 'read', 'readsystem']) {
        const environment = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: directory, YOUTUBE_COMMENTS_SMOKE_PHASE: phase };
        environment.PATH = `${helpers}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
        delete environment.Path;
        delete environment.ELECTRON_RUN_AS_NODE;
        delete environment.YOUTUBE_COMMENTS_YTDLP_EXE;
        delete environment.YOUTUBE_COMMENTS_POST_ARCHIVER_EXE;
        const child = spawn(require('electron'), [__filename], { env: environment, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`)));
        });
      }
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(path.join(directory, 'youtube-comments-development', 'reader.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
        assert.equal(db.prepare('SELECT count(*) AS count FROM extraction_attempts').get().count, 7);
        assert.equal(db.prepare("SELECT count(*) AS count FROM extraction_attempts WHERE backend <> 'synthetic-demo'").get().count, 3);
        assert.equal(db.prepare('SELECT count(*) AS count FROM comments').get().count, 28);
        assert.deepEqual({ ...db.prepare('SELECT locale, appearance FROM preferences').get() }, { locale: 'en', appearance: 'system' });
      } finally { db.close(); }
      console.log('Electron smoke PASS: two real restarts and closed-file SQLite persistence');
    } finally {
      // Clean only the newly created test directory, never a configured profile.
      if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('youtube-comments-electron-test-')) throw new Error('Unsafe cleanup');
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  verifyRestarts().catch(error => { console.error(error); process.exitCode = 1; });
}

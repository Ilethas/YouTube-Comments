// Focused verification of the real built entry points. Run after Forge builds;
// this script is never shipped as the application entry or exposed to renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const entry = path.join(__dirname, '../.vite/build/main.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const dateEvaluationNow = Date.parse('2026-10-07T12:00:00Z');
const helperChoices = [], helperExecutions = [];

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
  // Virtualized reveal and control commits need animation frames even while the
  // disposable smoke window is hidden. Never wait on throttled hidden-tab RAF.
  contents.setBackgroundThrottling(false);
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  const phase = process.env.YOUTUBE_COMMENTS_SMOKE_PHASE;
  const checkpoint = path.join(root, 'checkpoint.json');
  const js = async code => {
    try { return await contents.executeJavaScript(code); }
    catch (error) { console.error('Smoke expression failed:', code); throw error; }
  };
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
  async function verifyHelperSettings() {
    const helpers = path.join(root, 'helpers');
    const status = async kind => {
      const result = await js(`window.reader.getHelperStatus({kind:${JSON.stringify(kind)}})`);
      assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes('private diagnostic'), false);
      return result.value;
    };
    for (const operation of ['getHelperStatus', 'chooseHelper', 'clearHelper']) {
      for (const payload of [{kind:'other'}, {kind:'yt-dlp',path:'evil.exe'}, {kind:'yt-dlp',arguments:['--exec','evil']}]) {
        assert.deepEqual(await js(`window.reader.${operation}(${JSON.stringify(payload)})`), { ok:false,error:{code:'INVALID_REQUEST'} });
      }
    }
    if (phase === 'environment') {
      assert.equal((await status('yt-dlp')).mode, 'environment');
      assert.equal((await status('yt-dlp')).state, 'ready');
      assert.equal((await status('post-archiver')).state, 'invalid-path');
      for (const kind of ['yt-dlp','post-archiver']) for (const operation of ['chooseHelper','clearHelper'])
        assert.deepEqual(await js(`window.reader.${operation}({kind:${JSON.stringify(kind)}})`), {ok:false,error:{code:'FORBIDDEN'}});
      await js("document.querySelector('.workspace-actions button:last-child').click()");
      await waitFor("document.querySelectorAll('.helper-tool[aria-busy=false]').length===2", 'environment helper status');
      assert.equal(await js("[...document.querySelectorAll('.helper-tool .helper-actions button:not(:last-child)')].every(button=>button.disabled)"), true);
      return;
    }
    for (const kind of ['yt-dlp','post-archiver']) {
      const initial = await status(kind);
      assert.equal(initial.mode, phase === 'read' ? 'configured' : 'PATH');
      assert.equal(initial.state, 'ready');
      assert.equal(initial.path, path.join(helpers, `${phase === 'read' ? 'chosen-' : ''}${kind}.exe`));
      if (phase === 'write') {
        for (const choice of [undefined, path.join(helpers,'missing.exe'), path.join(helpers,'incompatible.exe'), path.join(helpers,`chosen-${kind}.exe`)]) {
          helperChoices.push(choice);
          const result = await js(`window.reader.chooseHelper({kind:${JSON.stringify(kind)}})`);
          if (choice === undefined) assert.deepEqual(result, {ok:true,value:null});
          else if (choice.endsWith('missing.exe')) assert.deepEqual(result, {ok:false,error:{code:'HELPER_UNAVAILABLE'}});
          else if (choice.endsWith('incompatible.exe')) assert.deepEqual(result, {ok:false,error:{code:'HELPER_INCOMPATIBLE'}});
          else { assert.equal(result.value.mode,'configured'); assert.equal(result.value.path,choice); }
          if (!choice || !choice.includes('chosen-')) assert.equal((await status(kind)).path,initial.path);
        }
      } else if (phase === 'read') {
        const reset = await js(`window.reader.clearHelper({kind:${JSON.stringify(kind)}})`);
        assert.equal(reset.value.mode,'PATH'); assert.equal(reset.value.path,path.join(helpers,`${kind}.exe`));
      }
    }
  }
  // Query clocks are overridden only in this disposable verification renderer.
  // Source timestamps are manufactured only in test-only helper fixtures below.
  await js(`Date.now = () => ${dateEvaluationNow}; void 0`);
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

  async function bulkUi(scope, seen, dates = {}) {
    await js(`(() => {const panel=document.querySelector('[role=tabpanel]:not([hidden])'); panel.querySelector('.bulk-controls').open=true;
      const fields=panel.querySelector('.bulk-fields'), selects=fields.querySelectorAll('select');
      selects[0].value=${JSON.stringify(String(seen))}; selects[0].dispatchEvent(new Event('change',{bubbles:true}));
      selects[1].value=${JSON.stringify(scope)}; selects[1].dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(20);
    for (const [index, date] of Object.values(dates).entries()) await js(`(() => {const input=document.querySelector('[role=tabpanel]:not([hidden]) .bulk-fields').querySelectorAll('input')[${index}];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(date)}); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .bulk-fields button').click()");
    await waitFor("document.querySelector('dialog[open]') !== null", 'bulk confirmation');
    assert.equal(await js("document.activeElement === document.querySelector('dialog .dialog-actions button')"), true, 'Bulk Cancel initially focused');
    if (phase === 'write' && scope === 'between') {
      window.showInactive(); await pause(30);
      fs.writeFileSync(path.join(__dirname, '../.vite/bulk-confirm-pl-dark.png'), (await contents.capturePage()).toPNG());
      window.hide();
    }
    await js("document.querySelector('dialog .dialog-actions button:last-child').click()");
    await waitFor("!document.querySelector('dialog') && !document.querySelector('[role=tabpanel]:not([hidden]) .bulk-fields button:disabled')", 'bulk committed');
    return snapshot();
  }
  async function undoUi() {
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .bulk-area > button').click()");
    await waitFor("!document.querySelector('[role=tabpanel]:not([hidden]) .bulk-area > button') && !document.querySelector('[role=tabpanel]:not([hidden]) .seen-control input:disabled')", 'Undo committed');
    return snapshot();
  }
  // Native Chromium key input complements synthetic DOM/unit routing checks.
  async function verifyKeyboardShortcuts() {
    const before = await snapshot();
    const key = (keyCode, modifiers = []) => {
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    };
    const active = async id => {
      await waitFor(`document.querySelector('[role=tab][aria-selected=true]')?.id === ${JSON.stringify('tab-' + id)} && !document.querySelector('.tabs button:disabled')`, 'keyboard tab activation');
    };
    key('F1');
    await waitFor("document.activeElement.id === 'keyboard-shortcuts' && !document.querySelector('.tabs button:disabled')", 'F1 opens Settings and targets help');
    assert.equal((await snapshot()).workspace.tabs.filter(tab => tab.kind === 'settings').length, 1);
    await js("document.querySelector('.preferences select').focus()");
    key('F1'); await waitFor("document.activeElement.id === 'keyboard-shortcuts' && !document.querySelector('.tabs button:disabled')", 'F1 from active Settings');
    // Record preventDefault after the application's own document listener.
    await js("document.addEventListener('keydown',event=>{window.__smokeDefaultPrevented=event.defaultPrevented},{once:true})");
    key('F', ['control']);
    await waitFor('window.__smokeDefaultPrevented !== undefined', 'Settings browser-find dispatch');
    assert.equal(await js('window.__smokeDefaultPrevented'), false);
    await js('delete window.__smokeDefaultPrevented');
    key('Tab', ['control']); await active(before.workspace.tabs[0].id); // forward wrap
    key('Tab', ['control', 'shift']); await active('settings'); // backward wrap
    key('Tab', ['control']); await active(before.workspace.tabs[0].id);
    key('F', ['control']); await waitFor("document.activeElement.matches('.query-search input')", 'discussion focus search');
    contents.insertText('desk');
    await waitFor("document.activeElement.value === 'desk'", 'native search typing');
    key('Left'); contents.insertText('x');
    await waitFor("document.activeElement.value === 'desxk'", 'search arrows and typing');
    key('F', ['control']);
    await waitFor('document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === 5', 'discussion search selection');
    assert.deepEqual(await js('({start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})'), { start: 0, end: 5 });
    contents.insertText(''); // Do not change the applied view.
    key('L', ['control']); await waitFor("document.activeElement.id === 'source-url'", 'URL reveal/focus');
    contents.insertText('https://youtu.be/abcdefghijk');
    await waitFor("document.activeElement.value === 'https://youtu.be/abcdefghijk'", 'URL typing');
    key('L', ['control']);
    await waitFor('document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === document.activeElement.value.length', 'URL select existing text');
    contents.insertText('xy'); key('Left'); contents.insertText('z');
    await waitFor("document.activeElement.value === 'xzy'", 'URL retains ordinary editing');
    key('Escape'); await waitFor("document.getElementById('source-url') === null", 'URL Escape');
    await js("document.getElementById('library-toggle').click()"); await active('library');
    key('F', ['control']); await waitFor("document.activeElement.matches('.library-filter input')", 'Library filter focus');
    contents.insertText('quiet');
    await waitFor("document.activeElement.value === 'quiet'", 'Library filter typing committed');
    key('F', ['control']);
    await waitFor('document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === 5', 'Library filter selection');
    const tabs = (await snapshot()).workspace.tabs;
    for (const tab of tabs) { key('Tab', ['control']); await active(tab.id); }
    key('W', ['control']); await active('settings'); // closing final Library chooses left
    assert.equal(window.isDestroyed(), false, 'Ctrl+W closes a workspace tab, never the native window');
    await js("document.getElementById('library-toggle').click()"); await active('library');
    await js("document.getElementById('tab-settings').click()"); await active('settings');
    key('W', ['control']); await active('library'); // closing Settings chooses right
    key('F1'); await waitFor("document.activeElement.id === 'keyboard-shortcuts' && !document.querySelector('.tabs button:disabled')", 'F1 reopens singleton');
    const rows = await js("Array.from(document.querySelectorAll('#panel-settings tr[data-shortcut-id]'),row=>({id:row.dataset.shortcutId,keys:row.querySelector('td').textContent}))");
    assert.equal(rows.length, 19); assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.equal(rows.find(row => row.id === 'previous-tab').keys, 'Ctrl+Shift+Tab');
    const hints = await js("({apply:document.querySelector('#panel-video-demo .query-controls button[type=submit]').title,next:document.querySelector('#panel-video-demo .query-navigation button:nth-child(2)').title,add:document.querySelector('[aria-controls=acquisition-form]').title,seen:document.querySelector('.seen-control').title,tab:document.querySelector('[role=tab]').title})");
    assert.match(hints.apply, /Ctrl\+Enter/); assert.match(hints.next, /F3/); assert.match(hints.add, /Ctrl\+L/);
    assert.match(hints.seen, /Ctrl\+Click/); assert.match(hints.tab, /Alt\+Left/);
    // Ignored local captures allow agent visual inspection in both locales/themes.
    const size = window.getSize(); window.setSize(1240, 1400); window.showInactive();
    for (const [locale, theme] of [['en', 'light'], ['pl', 'dark']]) {
      await preference(0, locale); await preference(1, theme);
      await js("document.getElementById('panel-settings').scrollTop=0");
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(__dirname, `../.vite/keyboard-shortcuts-${locale}-${theme}.png`), (await contents.capturePage()).toPNG());
      await js("document.getElementById('panel-settings').scrollTop=document.getElementById('panel-settings').scrollHeight");
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(__dirname, `../.vite/keyboard-shortcuts-${locale}-${theme}-end.png`), (await contents.capturePage()).toPNG());
    }
    window.hide(); window.setSize(...size);
    await preference(0, before.preferences.locale); await preference(1, before.preferences.appearance);
    await js("(() => { for (const selector of ['.library-filter input','#panel-video-demo .query-search input']) { const input=document.querySelector(selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,''); input.dispatchEvent(new Event('input',{bubbles:true})); } })()");
    await waitFor("document.querySelector('.library-filter input').value === ''", 'restore Library draft');
    // Restore the original workspace through the UI; all stored data stays intact.
    for (const id of ['settings', 'library']) {
      await js(`document.getElementById('tab-${id}').nextElementSibling.click()`);
      await waitFor(`document.getElementById('tab-${id}') === null && !document.querySelector('.tabs button:disabled')`, 'close temporary app tab');
    }
    await js(`document.getElementById(${JSON.stringify('tab-' + before.workspace.activeTabId)}).click()`);
    await active(before.workspace.activeTabId);
    assert.deepEqual((await snapshot()).comments, before.comments);
    assert.deepEqual((await snapshot()).items, before.items);
  }

  await waitFor("document.querySelectorAll('input[type=checkbox]').length >= 24", 'bootstrap');
  await verifyHelperSettings();
  if (phase === 'environment') return;
  assert.deepEqual(await js('Object.keys(window.reader).sort()'), ['acquire', 'activateTab', 'bootstrap', 'bulkSeen', 'chooseHelper', 'clearHelper', 'closeTab', 'getHelperStatus', 'moveTab', 'openLibrary', 'openSettings', 'openStoredItem', 'refresh', 'removeLibraryItem', 'toggleSeen', 'undoSeen', 'updatePreferences']);
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
    await verifyKeyboardShortcuts();
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
    assert.equal(state.items.find(item => item.id === video.id).latestAcceptedDiscoveryId, video.baselineDiscoveryId);
    assert.equal(await js("document.querySelectorAll('[role=tabpanel]:not([hidden]) .new-badge').length"), 0, 'Real baseline is never NEW');
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) .ruler-match').getAttribute('d')"), '', 'Unrestricted identity set has no match lane');
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .seen-control input').click()");
    await waitFor("document.querySelector('[role=tabpanel]:not([hidden]) .seen-control input').checked && !document.querySelector('input[type=checkbox]:disabled')", 'acquired seen');
    state = await snapshot();
    const seenId = state.comments[video.id].find(comment => comment.seen).id;
    async function draftQuery(text, seen = 'all', regex = false) {
      await js(`(() => { const panel=document.querySelector('[role=tabpanel]:not([hidden])'); const input=panel.querySelector('.query-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true}));
        const select=panel.querySelector('.query-controls select[name=seen]'); select.value=${JSON.stringify(seen)}; select.dispatchEvent(new Event('change',{bubbles:true}));
        const toggle=panel.querySelectorAll('.query-controls button[type=button]')[1]; if ((toggle.getAttribute('aria-pressed')==='true')!==${regex}) toggle.click(); })()`);
    }
    async function applyQuery() {
      await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-controls button[type=submit]').click()");
      await waitFor("!document.querySelector('[role=tabpanel]:not([hidden]) .query-status').textContent.includes('Obliczanie')", 'worker applied');
    }
    const visibleMatches = () => js("Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) [data-view-role=match]'), row => row.id)");
    async function dateControl(name, value) {
      const selector = `[role=tabpanel]:not([hidden]) [name=${name}]`;
      await js(`(() => {const input=document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
        input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
      await waitFor(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`, `date control ${name}`);
    }
    const localDate = instant => js(`(() => {const date=new Date(${instant}); return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');})()`);
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-dates').open=true");
    const todayDate = await localDate(dateEvaluationNow);
    const baselineReply = state.comments[video.id].find(row => row.source.commentId === 'Ug.demo+reply:02');
    for (const [preset, expected] of [['today', (await localDate(Date.parse(baselineReply.publishedAt))) === todayDate ? 1 : 0], ['last-24-hours', 1], ['last-7-days', 1]]) {
      await dateControl('publication-preset', preset); await applyQuery();
      assert.equal((await visibleMatches()).length, expected, `Publication preset ${preset}`);
      assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) [name=publication-from]').disabled"), true);
    }
    await dateControl('publication-preset', 'all');
    const replyDate = await localDate(Date.parse(baselineReply.publishedAt));
    await dateControl('publication-from', replyDate); await dateControl('publication-to', replyDate); await applyQuery();
    assert.deepEqual(await visibleMatches(), ['comment-' + encodeURIComponent(baselineReply.id)], 'Whole local-day custom range');
    const customMatches = await visibleMatches();
    await dateControl('publication-from', '2030-01-01'); await applyQuery();
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-error').getAttribute('role')"), 'alert');
    assert.deepEqual(await visibleMatches(), customMatches, 'Invalid dates preserve applied view');
    await dateControl('publication-preset', 'all'); await dateControl('discovery', 'new'); await applyQuery();
    assert.equal((await visibleMatches()).length, 0, 'Baseline fails NEW-only');
    await dateControl('discovery', 'all'); await applyQuery();
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-dates').open=false");
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
    await draftQuery('smoke', 'unseen'); await dateControl('publication-preset', 'last-24-hours'); await applyQuery();
    await draftQuery('unapplied draft');
    const beforeRefreshSeen = await snapshot();
    const recoveryBeforeRefresh = await bulkUi('all', false);
    assert.ok(recoveryBeforeRefresh.seenUndo[video.id]);
    // The applied rolling criteria resolve against this fresh clock on Refresh.
    await js(`Date.now = () => ${dateEvaluationNow + 3600000}; void 0`);
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').click()");
    await waitFor("Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) .comment-text')).some(row=>row.textContent.includes('New smoke comment'))", 'refresh applied query');
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-search input').value"), 'unapplied draft');
    assert.ok((await visibleMatches()).length > 0);
    const afterRefreshUndo = await undoUi();
    for (const row of beforeRefreshSeen.comments[video.id]) assert.equal(afterRefreshUndo.comments[video.id].find(comment=>comment.id===row.id).seen,row.seen);
    assert.equal(afterRefreshUndo.comments[video.id].find(comment=>comment.source.commentId==='smoke-new').seen,false);
    await draftQuery(''); await dateControl('publication-preset', 'all'); await applyQuery();
    state = await snapshot();
    assert.equal(state.items.length, 3);
    assert.equal(state.comments[video.id].length, 4);
    assert.equal(state.comments[video.id].find(comment => comment.id === seenId).seen, true);
    assert.equal(state.comments[video.id].find(comment => comment.source.commentId === 'smoke-new').seen, false);
    const discovered = state.comments[video.id].find(comment => comment.source.commentId === 'smoke-new');
    assert.equal(state.items.find(item => item.id === video.id).latestAcceptedDiscoveryId, discovered.discovery.firstDiscoveryId);
    await waitFor("document.querySelectorAll('[role=tabpanel]:not([hidden]) .new-badge').length === 1", 'Durable NEW badge');
    await draftQuery('smoke', 'unseen'); await dateControl('publication-preset', 'last-24-hours'); await dateControl('discovery', 'new'); await applyQuery();
    assert.deepEqual(await visibleMatches(), ['comment-' + encodeURIComponent(discovered.id)], 'Search AND unseen AND date AND NEW');
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) .discussion-ruler').dataset.matchCount"), '1');
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) .discussion-ruler').dataset.newCount"), '1');
    await draftQuery(''); await dateControl('publication-preset', 'today'); await applyQuery();
    const todayMatches = (await localDate(Date.parse(discovered.publishedAt))) === (await localDate(dateEvaluationNow + 3600000))
      ? ['comment-' + encodeURIComponent(discovered.id)] : [];
    assert.deepEqual(await visibleMatches(), todayMatches, 'Today uses stored estimate in the runtime system zone');
    await dateControl('publication-preset', 'all'); await applyQuery();
    assert.deepEqual(await visibleMatches(), ['comment-' + encodeURIComponent(discovered.id)], 'NEW-only before manual seen');
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-dates').open=true");
    window.showInactive();
    await pause(50);
    fs.writeFileSync(path.join(__dirname, '../.vite/date-controls-pl-dark.png'), (await contents.capturePage()).toPNG());
    window.hide();
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-dates').open=false");
    const beforeRuler = await snapshot();
    await js("document.querySelector('[role=tabpanel]:not([hidden]) .discussion-ruler').focus()");
    for (const key of ['End', 'ArrowRight', 'ArrowRight', 'Enter']) {
      await js(`document.querySelector('[role=tabpanel]:not([hidden]) .discussion-ruler').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`);
      await pause(30);
    }
    await waitFor(`document.activeElement.id === ${JSON.stringify('comment-' + encodeURIComponent(discovered.id))}`, 'Ruler reveals NEW target');
    assert.deepEqual(await snapshot(), beforeRuler, 'Ruler navigation never saves seen');
    await js(`document.getElementById(${JSON.stringify('comment-' + encodeURIComponent(discovered.id))}).querySelector('input').click()`);
    await waitFor(`document.getElementById(${JSON.stringify('comment-' + encodeURIComponent(discovered.id))}).querySelector('input').checked && !document.querySelector('input[type=checkbox]:disabled')`, 'NEW marked seen');
    assert.equal(await js("document.querySelectorAll('[role=tabpanel]:not([hidden]) .new-badge').length"), 1, 'Seen NEW remains NEW');
    await applyQuery();
    assert.deepEqual(await visibleMatches(), ['comment-' + encodeURIComponent(discovered.id)], 'Seen NEW still matches discovery-only');
    await dateControl('discovery', 'all'); await applyQuery();
    state = await snapshot();
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
    const modalWorkspace = (await snapshot()).workspace;
    await js("window.__smokeModalKeys=[]; window.__smokeModalListener=event=>window.__smokeModalKeys.push(event.defaultPrevented); document.addEventListener('keydown',window.__smokeModalListener)");
    for (const [keyCode, modifiers] of [['W', ['control']], ['L', ['control']], ['F1', []]]) {
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    }
    await waitFor('window.__smokeModalKeys.length === 3', 'modal keyboard ownership');
    assert.deepEqual(await js('window.__smokeModalKeys'), [false, false, false]);
    assert.equal(await js("document.activeElement === document.querySelector('dialog .dialog-actions button')"), true);
    assert.deepEqual((await snapshot()).workspace, modalWorkspace);
    assert.equal(await js("document.getElementById('source-url') === null"), true);
    await js('document.removeEventListener(\'keydown\',window.__smokeModalListener); delete window.__smokeModalListener; delete window.__smokeModalKeys');
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
    const bulkOriginal = await snapshot();
    for (const seen of [true, false]) {
      const marked = await bulkUi('all', seen);
      assert.ok(marked.comments[video.id].every(comment=>comment.seen===seen));
      assert.deepEqual((await undoUi()).comments, bulkOriginal.comments, 'All bulk then Undo restores mixture');
    }
    // Frozen APPLIED matching membership survives seen writes; Apply is explicit.
    await bulkUi('all', false);
    await draftQuery('smoke', 'unseen'); await applyQuery();
    const frozen = await visibleMatches(); assert.equal(frozen.length, 2);
    await bulkUi('matching', true);
    assert.deepEqual(await visibleMatches(), frozen, 'Bulk leaves applied membership frozen');
    await applyQuery(); assert.equal((await visibleMatches()).length,0);
    await undoUi(); assert.equal((await visibleMatches()).length,0, 'Undo does not revert Apply');
    await applyQuery(); assert.deepEqual(await visibleMatches(), frozen);
    // A date action resolves all stored rows even with no displayed conversations.
    await draftQuery('no displayed match'); await applyQuery();
    assert.equal(await js("document.querySelectorAll('[role=tabpanel]:not([hidden]) .comment').length"),0);
    const dateBefore = await snapshot();
    const dated = await bulkUi('between', true, { from:'2000-01-01', to:'2099-12-31' });
    assert.equal(dated.comments[video.id].filter(comment=>comment.seen).length,dated.comments[video.id].filter(comment=>comment.publishedAt).length);
    assert.deepEqual((await undoUi()).comments,dateBefore.comments);
    await draftQuery(''); await applyQuery();
    // Restore starting live state using ordinary acknowledged clicks.
    for (const row of bulkOriginal.comments[video.id]) if ((await snapshot()).comments[video.id].find(comment=>comment.id===row.id).seen !== row.seen) {
      await js(`document.getElementById(${JSON.stringify('comment-' + encodeURIComponent(row.id))}).querySelector('input').click()`);
      await waitFor("!document.querySelector('[role=tabpanel]:not([hidden]) .seen-control input:disabled')", 'restore verification row');
    }
    // Mixed Ctrl+click subtree is recoverable through the established gesture.
    await js("document.getElementById('tab-discussion:video-demo').click()");
    await waitFor("document.querySelector('[role=tabpanel]:not([hidden])').id==='panel-video-demo'", 'demo subtree');
    await js("document.getElementById('comment-v3').querySelector('input').click()");
    await waitFor("document.getElementById('comment-v3').querySelector('input').checked && !document.querySelector('.seen-control input:disabled')", 'mixed subtree preparation');
    const mixed = await snapshot();
    await js("document.getElementById('comment-v2').querySelector('input').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))");
    await waitFor("document.getElementById('comment-v2').querySelector('input').checked && !document.querySelector('.seen-control input:disabled')", 'mixed subtree assignment');
    assert.deepEqual((await undoUi()).comments,mixed.comments,'Undo restores mixed subtree');
    await js("document.getElementById('comment-v3').querySelector('input').click()");
    await waitFor("!document.getElementById('comment-v3').querySelector('input').checked && !document.querySelector('.seen-control input:disabled')", 'restore demo');
    await js(`document.getElementById('tab-discussion:${video.id}').click()`);
    await waitFor(`document.querySelector('[role=tabpanel]:not([hidden])').id==='panel-${video.id}'`, 'restart recovery preparation');
    assert.deepEqual((await snapshot()).comments,bulkOriginal.comments);
    const restartOperation = await bulkUi('all',true);
    const laterEdit = bulkOriginal.comments[video.id].find(comment=>!comment.seen);
    await js(`document.getElementById(${JSON.stringify('comment-' + encodeURIComponent(laterEdit.id))}).querySelector('input').click()`);
    await waitFor(`!document.getElementById(${JSON.stringify('comment-' + encodeURIComponent(laterEdit.id))}).querySelector('input').checked && !document.querySelector('.seen-control input:disabled')`, 'later manual edit before restart');
    assert.ok(restartOperation.seenUndo[video.id].changedCount > 1);
    fs.writeFileSync(path.join(root,'seen-before.json'),JSON.stringify(bulkOriginal));
    state = await snapshot();
    fs.writeFileSync(checkpoint, JSON.stringify(state));
  } else {
    const saved = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
    assert.deepEqual(original, saved);
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden])').id"), `panel-${saved.workspace.tabs.find(tab => tab.id === saved.workspace.activeTabId).itemId}`);
    assert.equal(await js("document.querySelectorAll('[role=tab]').length"), saved.workspace.tabs.length);
    await waitFor("document.querySelectorAll('[role=tabpanel]:not([hidden]) .new-badge').length === 1", 'Real seen NEW survives process restart');
    assert.notEqual(await js("document.querySelector('[role=tabpanel]:not([hidden]) .ruler-new').getAttribute('d')"), '', 'Durable NEW ruler survives restart');
    assert.equal(await js('document.documentElement.lang'), saved.preferences.locale);
    assert.equal(await js('document.documentElement.dataset.appearance'), saved.preferences.appearance);
    // Check that the persisted states are actually reflected in the UI.
    assert.deepEqual(await js("Array.from(document.querySelectorAll('#panel-video-demo .seen-control input'), input => input.checked)"),
      saved.comments['video-demo'].map(comment => comment.seen));
    if (phase === 'read') {
      const itemId = saved.workspace.tabs.find(tab=>tab.id===saved.workspace.activeTabId).itemId;
      assert.ok(saved.seenUndo[itemId], 'Durable recovery exposed after real restart');
      await js("document.querySelector('[role=tabpanel]:not([hidden])').focus()");
      contents.sendInputEvent({ type:'keyDown',keyCode:'Z',modifiers:['control'] });
      contents.sendInputEvent({ type:'keyUp',keyCode:'Z',modifiers:['control'] });
      await waitFor("!document.querySelector('[role=tabpanel]:not([hidden]) .bulk-area > button')",'native Ctrl+Z after restart');
      const beforeBulk = JSON.parse(fs.readFileSync(path.join(root,'seen-before.json'),'utf8'));
      assert.deepEqual((await snapshot()).comments,beforeBulk.comments,'Restart Undo preserves later edit and restores other rows');
      assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden]) .bulk-area [role=status]').textContent.includes('1')"),true,'Partial Undo feedback');
      saved.comments = beforeBulk.comments;

      await preference(1, 'system');
      nativeTheme.themeSource = 'light';
      await waitFor("getComputedStyle(document.documentElement).getPropertyValue('--background').trim() === '#f2f4f6'", 'System light');
      nativeTheme.themeSource = 'dark';
      await waitFor("getComputedStyle(document.documentElement).getPropertyValue('--background').trim() === '#151b23'", 'live System dark');
      await preference(1, 'light');
      assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"), '#f2f4f6');
      await preference(1, 'system');
      await preference(0, 'en');
      await js("document.querySelector('[role=tabpanel]:not([hidden]) .bulk-controls').open=true; document.documentElement.dataset.appearance='light'; void 0");
      window.showInactive(); await pause(30);
      fs.writeFileSync(path.join(__dirname, '../.vite/bulk-controls-en-light.png'), (await contents.capturePage()).toPNG());
      window.hide();
      assert.equal(await js("document.querySelector('.brand strong').textContent"), 'Discussion reader');
      await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-dates').open=true; document.documentElement.dataset.appearance='light'; void 0");
      window.showInactive(); await pause(50);
      fs.writeFileSync(path.join(__dirname, '../.vite/date-controls-en-light.png'), (await contents.capturePage()).toPNG());
      window.hide();
      await js("document.querySelector('[role=tabpanel]:not([hidden]) .query-dates').open=false; document.documentElement.dataset.appearance='system'; void 0");
      const state = await snapshot();
      assert.deepEqual(state.comments, saved.comments);
      fs.writeFileSync(checkpoint, JSON.stringify(state));
    }
  }
  assert.equal(await js("document.querySelector('[role=alert]') === null"), true);
  if (phase === 'write') {
    for (const kind of ['yt-dlp','post-archiver']) assert.ok(helperExecutions.some(run=>run.file===path.join(root,'helpers',`chosen-${kind}.exe`) && !run.probe), `Configured ${kind} used without restart`);
  }
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
    helperExecutions.push({file,probe:args.includes('--version')});
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    setTimeout(() => {
      let code = 0;
      if (args.includes('--version')) child.stdout.emit('data', Buffer.from(path.basename(file) === 'incompatible.exe' ? 'unsupported' : path.basename(file).includes('yt-dlp') ? '2026.08.19\n' : 'post-archiver 0.4.0\n'));
      else if (path.basename(file).includes('yt-dlp')) {
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json'), 'utf8')).raw;
        raw.comments[1].timestamp = dateEvaluationNow / 1000 - 23 * 3600;
        raw.comments[2].timestamp = dateEvaluationNow / 1000 - 8 * 24 * 3600;
        for (const comment of raw.comments) delete comment.author_thumbnail; // Offline smoke makes no image network requests.
        videoRuns++;
        if (videoRuns > 1) raw.comments = [{ ...raw.comments[2], text: 'Updated smoke root' }, { id: 'smoke-new', parent: 'root', text: 'New smoke comment', timestamp: dateEvaluationNow / 1000 - 3600 }];
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
  const { app, nativeTheme, dialog } = require('electron');
  // Test-only main native-dialog seam; the renderer never supplies selected paths.
  dialog.showOpenDialog = async (parent, options) => {
    assert.equal(parent.constructor.name, 'BrowserWindow');
    assert.deepEqual(options.properties,['openFile']);
    assert.deepEqual(options.filters[0].extensions,['exe']);
    const selected=helperChoices.shift(); return {canceled:selected===undefined,filePaths:selected ? [selected] : []};
  };
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
      for (const name of ['yt-dlp.exe', 'post-archiver.exe','chosen-yt-dlp.exe','chosen-post-archiver.exe','incompatible.exe']) fs.writeFileSync(path.join(helpers, name), 'test-only fake executable');
      for (const phase of ['write', 'read', 'readsystem', 'environment']) {
        const environment = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: directory, YOUTUBE_COMMENTS_SMOKE_PHASE: phase };
        environment.PATH = `${helpers}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
        delete environment.Path;
        delete environment.ELECTRON_RUN_AS_NODE;
        delete environment.YOUTUBE_COMMENTS_YTDLP_EXE;
        delete environment.YOUTUBE_COMMENTS_POST_ARCHIVER_EXE;
        if (phase==='environment') {
          environment.YOUTUBE_COMMENTS_YTDLP_EXE=path.join(helpers,'yt-dlp.exe');
          environment.YOUTUBE_COMMENTS_POST_ARCHIVER_EXE=path.join(helpers,'missing.exe');
        }
        const child = spawn(require('electron'), [__filename], { env: environment, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`)));
        });
      }
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(path.join(directory, 'youtube-comments-development', 'reader.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
        assert.equal(db.prepare('SELECT count(*) AS count FROM helper_settings').get().count,0);
        assert.equal(db.prepare('SELECT count(*) AS count FROM extraction_attempts').get().count, 7);
        assert.equal(db.prepare("SELECT count(*) AS count FROM extraction_attempts WHERE backend <> 'synthetic-demo'").get().count, 3);
        assert.equal(db.prepare('SELECT count(*) AS count FROM comments').get().count, 28);
        assert.deepEqual({ ...db.prepare('SELECT locale, appearance FROM preferences').get() }, { locale: 'en', appearance: 'system' });
      } finally { db.close(); }
      console.log('Electron smoke PASS: real restarts, helper selection/reset/environment authority, bulk recovery and safe partial Undo');
    } finally {
      // Clean only the newly created test directory, never a configured profile.
      if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('youtube-comments-electron-test-')) throw new Error('Unsafe cleanup');
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  verifyRestarts().catch(error => { console.error(error); process.exitCode = 1; });
}

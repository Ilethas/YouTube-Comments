// Production entry, disposable profile, Chromium mouse/key input (not physical input).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app, ipcMain } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  assert.ok(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('reader-tab-keys-'));
  for (const name of ['appData', 'userData', 'sessionData', 'logs', 'crashDumps']) {
    const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); app.setPath(name, folder);
  }
  const baseline = process.env.TAB_KEYS_BASELINE === '1';
  const fail = error => { console.error(error); app.exit(1); };
  process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
  const watchdog = setTimeout(() => fail(Error('tab keyboard watchdog')), 60000);
  let window, verified = false, hold, release, held = false;
  const calls = [];
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    if (['reader:activate-tab', 'reader:move-tab'].includes(channel)) {
      calls.push({ channel, request: args[0] });
      if (hold === channel) { hold = undefined; held = true; await new Promise(resolve => { release = resolve; }); }
    }
    const result = await handler(event, ...args);
    return result;
  });
  app.on('browser-window-created', (_event, native) => { window = native; native.webContents.setBackgroundThrottling(false); });
  const js = code => window.webContents.executeJavaScript(code);
  async function wait(check, label) { for (let n = 0; n < 1000; n++) { if (await check()) return; await pause(10); } throw Error('Timeout: ' + label); }
  const ready = () => wait(() => js('!!document.querySelector("[role=tab]") && !document.querySelector(".tabs button:disabled")'), 'enabled tabs');
  const boot = async () => { const r = await js('window.reader.bootstrap()'); assert.equal(r.ok, true); return r.value; };
  const focus = () => js('document.activeElement.id || document.activeElement.tagName');
  async function key(keyCode, modifiers = []) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause(30);
  }
  async function click(selector) {
    const point = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  }
  app.whenReady().then(async () => {
    await wait(() => window && js('!!document.querySelector(".app-shell")'), 'bootstrap'); await ready();
    window.show(); window.focus(); window.webContents.focus();
    await wait(() => js('document.hasFocus()'), 'native focus');
    const initial = (await boot()).workspace;
    const id = initial.tabs.find(t => t.kind === 'discussion' && t.id !== initial.activeTabId).id;
    const selector = `[id="tab-${id}"]`;
    await js(`window.__keys=[];document.addEventListener('keydown',e=>window.__keys.push({key:e.key,alt:e.altKey,ctrl:e.ctrlKey,shift:e.shiftKey,target:e.target.id||e.target.tagName}),true);void 0`);
    // Hold before production handler, so disabled focus and outstanding CAS are observable.
    hold = 'reader:activate-tab'; await click(selector); await wait(() => held, 'held click activation');
    await wait(() => js('!!document.querySelector(".tabs button:disabled")'), 'disabled tabs painted');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const during = await focus();
    release(); await ready();
    await wait(async () => (await boot()).workspace.activeTabId === id, 'clicked active');
    const after = await focus();
    const before = (await boot()).workspace;
    await key('Left', ['alt']); await ready();
    const reordered = (await boot()).workspace;
    console.log(JSON.stringify({ baseline, during, after, before: before.tabs.map(t => t.id), afterAlt: reordered.tabs.map(t => t.id), keys: await js('window.__keys') }));
    if (baseline) {
      assert.equal(after, 'BODY'); assert.deepEqual(reordered, before);
      await js(`document.querySelector(${JSON.stringify(selector)}).focus();void 0`);
      await key('Left', ['alt']); await ready();
      assert.notDeepEqual((await boot()).workspace.tabs, before.tabs, 'native Alt reaches focused tab');
      console.log('Baseline confirmed: disabling clicked tab drops focus to BODY; native Alt delivery works with explicit focus.');
    } else {
      assert.equal(after, 'tab-' + id);
      assert.equal(reordered.tabs.findIndex(t => t.id === id), before.tabs.findIndex(t => t.id === id) - 1);
      assert.equal(await focus(), 'tab-' + id, 'reorder retains keyboard focus');
      // An already-active click does not disable the tab or enter the CAS lane.
      const activations = calls.filter(c => c.channel === 'reader:activate-tab').length;
      await click(selector); await pause(40); await ready();
      assert.equal(await focus(), 'tab-' + id);
      assert.equal(calls.filter(c => c.channel === 'reader:activate-tab').length, activations);
      await key('Right', ['alt']); await ready();
      assert.equal((await boot()).workspace.tabs[1].id, id);
      assert.equal(await focus(), 'tab-' + id);
      const panel = '.reader-panel:not([hidden])', search = panel + ' input[type=search]';
      await wait(() => js(`!!document.querySelector('${search}')`), 'active discussion reader');
      await js(`document.querySelector('${panel}').focus();void 0`);
      const activeReader = await js(`document.querySelector('${panel}').id`);
      const state = await js(`window.__readerNode=document.querySelector('${panel}');window.__searchNode=document.querySelector('${search}');({comments:[...document.querySelectorAll('${panel} [data-domain-comment-id]')].map(e=>e.dataset.domainCommentId)})`);
      await key('PageUp', ['control', 'shift']); await ready();
      assert.equal((await boot()).workspace.tabs[0].id, id);
      assert.equal(await focus(), activeReader, 'global reorder retains reader focus');
      assert.equal(await js(`document.querySelector('${panel}')===window.__readerNode && document.querySelector('${search}')===window.__searchNode`), true);
      assert.deepEqual(await js(`({comments:[...document.querySelectorAll('${panel} [data-domain-comment-id]')].map(e=>e.dataset.domainCommentId)})`), state);
      let count = calls.filter(c => c.channel === 'reader:move-tab').length;
      const revision = (await boot()).workspace.revision;
      await key('PageUp', ['control', 'shift']); await ready();
      assert.equal(calls.filter(c => c.channel === 'reader:move-tab').length, count, 'left boundary no IPC');
      // Native bursts while main has not committed cannot reuse the old revision.
      hold = 'reader:move-tab'; held = false;
      await key('PageDown', ['control', 'shift']); await wait(() => held, 'held global move');
      await key('PageDown', ['control', 'shift']); await key('PageUp', ['control', 'shift']);
      await key('Tab', ['control']); await key('W', ['control']);
      assert.equal(calls.filter(c => c.channel === 'reader:move-tab').length, count + 1);
      release(); await ready();
      await wait(async () => (await boot()).workspace.tabs[1].id === id, 'global move committed');
      await ready();
      assert.equal((await boot()).workspace.activeTabId, id);
      assert.equal(calls.filter(c => c.channel === 'reader:move-tab').at(-1).request.expectedRevision, revision);
      count++;
      await key('PageDown', ['control', 'shift']); await ready();
      assert.equal(calls.filter(c => c.channel === 'reader:move-tab').length, count, 'right boundary no IPC');
      // Focus transferred during disabled paint revokes implicit tab restoration.
      await click(selector); await ready();
      hold = 'reader:move-tab'; held = false;
      await key('Left', ['alt']); await wait(() => held, 'held focused move');
      await wait(() => js('!!document.querySelector(".tabs button:disabled")'), 'disabled move');
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.equal(await focus(), 'BODY');
      await click(search);
      assert.equal(await js(`document.activeElement===document.querySelector('${search}')`), true);
      release(); await ready();
      assert.equal(await js(`document.activeElement===document.querySelector('${search}')`), true, 'ack never steals later focus');
      // Exact global chord also works in editing controls without editing text.
      await key('PageDown', ['control', 'shift']); await ready();
      assert.equal((await boot()).workspace.tabs[1].id, id);
      assert.equal(await js(`document.activeElement===document.querySelector('${search}')`), true);
      const unchanged = (await boot()).workspace;
      for (const modifiers of [[], ['control'], ['shift'], ['alt'], ['control', 'shift', 'alt']]) await key('PageUp', modifiers);
      assert.deepEqual((await boot()).workspace, unchanged, 'unassigned editing chords do not reorder');
      // Menus own keys even though a workspace tab is active.
      await click('.application-menu-trigger');
      await wait(() => js('!!document.querySelector("[role=menu]")'), 'menu');
      await key('PageUp', ['control', 'shift']); assert.deepEqual((await boot()).workspace, unchanged);
      await key('Escape');
      await key('Tab', ['control']); await ready();
      assert.notEqual((await boot()).workspace.activeTabId, id, 'Ctrl+Tab still navigates');
      await key('Tab', ['control', 'shift']); await ready();
      assert.equal((await boot()).workspace.activeTabId, id, 'Ctrl+Shift+Tab still navigates');
      await key('W', ['control']); await ready();
      assert.equal((await boot()).workspace.tabs.length, initial.tabs.length - 1, 'Ctrl+W still closes tab');
      console.log('Native click/active click/Alt, global Page reader/editable, boundaries, pending bursts, focus handoff, menus and existing navigation/close PASS');
    }
    verified = true; app.quit();
  }).catch(fail);
  app.on('will-quit', () => { assert.equal(verified, true); clearTimeout(watchdog); console.log('Tab keyboard PASS'); });
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-tab-keys-'));
    try {
      const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, TAB_KEYS_BASELINE: process.argv.includes('--baseline') ? '1' : '0' }; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
      const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
      assert.equal(code, 0);
    } finally {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-tab-keys-')) throw Error('Unsafe temporary cleanup');
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

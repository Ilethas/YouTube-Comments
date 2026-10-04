// Optional development UI check on a consistent disposable backup of existing data.
// No raw public text is logged or committed. Main still owns the copied SQLite file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync, backup } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 9349;
async function connect() {
  for (let attempt = 0; attempt < 250; attempt++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find(page => page.type === 'page');
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let next = 0; const requests = new Map();
        socket.onmessage = event => { const result = JSON.parse(event.data); if (result.id) {
          const request = requests.get(result.id); requests.delete(result.id);
          if (result.error) request.reject(new Error(result.error.message)); else request.resolve(result.result);
        } };
        socket.onclose = () => { for (const request of requests.values()) request.reject(new Error('Development debugger closed')); requests.clear(); };
        const send = (method, params = {}) => new Promise((resolve, reject) => {
          const id = ++next; requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
        });
        const js = async expression => {
          const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          if (value.exceptionDetails) throw new Error('Development renderer expression failed');
          return value.result.value;
        };
        return { socket, send, js };
      }
    } catch { /* Wait for Forge. */ }
    await pause(100);
  }
  throw new Error('Development debugger unavailable');
}
async function run() {
  const source = process.env.YOUTUBE_COMMENTS_QUERY_DATABASE || path.join(process.env.APPDATA, 'youtube-comments-development', 'reader.sqlite');
  assert.ok(fs.existsSync(source), 'Existing development database required');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-tabs-dev-'));
  let child, client, exited;
  try {
    const directory = path.join(root, 'youtube-comments-development'); fs.mkdirSync(directory);
    const original = new DatabaseSync(source, { readOnly: true });
    try { await backup(original, path.join(directory, 'reader.sqlite')); } finally { original.close(); }
    const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    const log = fs.openSync(path.join(root, 'forge.log'), 'w');
    child = spawn(process.execPath, [path.join(__dirname, '../node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start', '--', `--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: ['ignore', log, log] });
    fs.closeSync(log); exited = new Promise(resolve => child.once('exit', resolve));
    client = await connect(); const { js, send } = client;
    async function waitFor(expression) {
      for (let i = 0; i < 250; i++) { if (await js(expression)) return; await pause(20); }
      throw new Error('Timed out waiting for renderer');
    }
    await waitFor("!!document.querySelector('.tabs')");
    const state = (await js('window.reader.bootstrap()')).value;
    const video = state.items.find(item => item.kind === 'video' && item.sourceId === 'IFPKfypw2CQ');
    assert.ok(video, 'Existing ~154-comment discussion required');
    // Open all stored discussions through React's Library controls, no public capture is committed.
    await js("document.getElementById('library-toggle').click()");
    await waitFor("!!document.querySelector('#panel-library:not([hidden])') && !document.querySelector('[role=tab]:disabled')");
    for (let i = 0; i < state.items.length; i++) {
      await js(`document.querySelectorAll('.library-entry')[${i}].querySelector('button').click()`);
      await waitFor("!document.querySelector('[role=tab]:disabled')");
      await js("document.getElementById('library-toggle').click()");
      await waitFor("!!document.querySelector('#panel-library:not([hidden])') && !document.querySelector('[role=tab]:disabled')");
    }
    await js("document.getElementById('settings-toggle').click()");
    await waitFor("!!document.querySelector('#panel-settings:not([hidden])') && !document.querySelector('[role=tab]:disabled')");
    const ids = [`discussion:${video.id}`, 'library', 'settings'];
    const measurements = [];
    for (let repeat = 0; repeat < 3; repeat++) for (const id of ids) {
      measurements.push(await js(`new Promise(resolve => {
        window.__readerWork = {};
        const start = performance.now();
        document.getElementById(${JSON.stringify('tab-' + id)}).click();
        function ready() {
          if (document.querySelector('[role=tab][aria-selected=true]').id !== ${JSON.stringify('tab-' + id)} || document.querySelector('[role=tab]:disabled')) { requestAnimationFrame(ready); return; }
          requestAnimationFrame(() => resolve({ target: ${JSON.stringify(id === 'library' || id === 'settings' ? id : 'video')}, ms: Math.round(performance.now()-start), work: window.__readerWork }));
        }
        requestAnimationFrame(ready);
      })`));
    }
    if (process.argv.includes('--interactions')) {
      await js("document.querySelector('.tabs').style.width='800px'");
      await send('Page.bringToFront');
      await send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await js(`document.getElementById(${JSON.stringify('tab-discussion:' + video.id)}).click()`);
      await waitFor(`document.querySelector('[role=tabpanel]:not([hidden])').id===${JSON.stringify('panel-' + video.id)} && !document.querySelector('[role=tab]:disabled')`);
      const snapshot = async () => (await js('window.reader.bootstrap()')).value;
      const before = await snapshot();
      await js("document.querySelector('.tabs').scrollLeft=0;document.querySelector('.tabs').addEventListener('pointerdown',e=>window.__dragPointer=e.pointerId)");
      await pause(100);
      const point = await js("(() => {const r=document.querySelector('.tab [role=tab]').getBoundingClientRect();return {x:r.left+30,y:r.top+r.height/2};})()");
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 760, y: 450, button: 'left', buttons: 1 });
      assert.equal(await js("!!document.querySelector('[data-dragging=true]') && document.querySelector('.tabs').hasPointerCapture(window.__dragPointer)"), true);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 450, button: 'left', buttons: 1 });
      assert.equal(await js("!!document.querySelector('[data-dragging=true]')"), true);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 790, y: point.y, button: 'left', buttons: 1 });
      await pause(180); // Edge auto-scroll continues while the pointer is stationary.
      assert.ok(await js("document.querySelector('.tabs').scrollLeft") > 0);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: point.y, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: point.y, button: 'left', clickCount: 1 });
      await waitFor("!document.querySelector('[role=tab]:disabled') && !document.querySelector('[data-dragging=true]')");
      const after = await snapshot();
      assert.equal(after.workspace.revision, before.workspace.revision + 1, 'Exactly one drag persistence write');
      assert.equal(after.workspace.activeTabId, before.workspace.activeTabId, 'Drag does not activate');
      assert.notDeepEqual(after.workspace.tabs, before.workspace.tabs);
      await js("document.querySelector('.tabs').scrollLeft=0");
      const cancelPoint = await js("(() => {const r=document.querySelector('.tab [role=tab]').getBoundingClientRect();return {x:r.left+25,y:r.top+r.height/2};})()");
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...cancelPoint, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 400, button: 'left', buttons: 1 });
      assert.equal(await js("!!document.querySelector('[data-dragging=true]')"), true);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await pause(100);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...cancelPoint, button: 'left', clickCount: 1 });
      assert.equal(await js("!!document.querySelector('[data-dragging=true]')"), false);
      assert.deepEqual((await snapshot()).workspace, after.workspace, 'Escape plus delayed release neither reorders nor activates');
      await js("document.querySelector('.tabs').scrollLeft=0");
      const wheelBefore = await snapshot();
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: point.y, deltaX: 0, deltaY: 180 });
      await waitFor("document.querySelector('.tabs').scrollLeft>0");
      assert.deepEqual((await snapshot()).workspace, wheelBefore.workspace);
      await js("document.querySelector('[role=tabpanel]:not([hidden])').scrollTop=0");
      const stripScroll = await js("document.querySelector('.tabs').scrollLeft");
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 400, y: 600, deltaX: 0, deltaY: 220 });
      await waitFor("document.querySelector('[role=tabpanel]:not([hidden])').scrollTop>0");
      assert.equal(await js("document.querySelector('.tabs').scrollLeft"), stripScroll);
      // Native ordinary captured clicks still activate, and rapid mixed switches remain responsive.
      for (const id of ids) {
        const position = await js(`(() => {const tab=document.getElementById(${JSON.stringify('tab-' + id)});tab.scrollIntoView({block:'nearest',inline:'nearest'});const r=tab.getBoundingClientRect();return {x:r.left+15,y:r.top+r.height/2};})()`);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', clickCount: 1 });
        await waitFor(`document.getElementById(${JSON.stringify('tab-' + id)}).getAttribute('aria-selected')==='true' && !document.querySelector('[role=tab]:disabled')`);
      }
      console.log(JSON.stringify({ nativeDevelopmentChecks: 'PASS', dragIntoReaderAndBack: true, capturedOnStrip: true, scrolledStripDrag: true, stationaryEdgeAutoScroll: true, oneReorderWrite: true, escapeDelayedRelease: true, wheelTabs: true, panelWheelVertical: true, rapidNativeMixedSwitches: true }));
    }
    // Measure the existing compact workspace IPC separately from React rendering.
    const ipc = await js(`(async () => {const times=[];for(let i=0;i<6;i++){const start=performance.now();await window.reader.activateTab({tabId:i%2?'settings':'library'});times.push(performance.now()-start);}return times;})()`);
    console.log(JSON.stringify({ comments: state.comments[video.id].length, openDiscussions: state.items.length, measurements, ipcMs: ipc.map(Math.round) }));
    await send('Browser.close').catch(()=>{}); client.socket.close(); client=undefined;
    await exited; child=undefined;
  } catch (error) {
    console.error('Development verification failed:', error);
    throw error;
  } finally {
    if (client) { await client.send('Browser.close').catch(()=>{}); client.socket.close(); }
    if (child) { child.kill(); await exited; }
    if (path.dirname(root)!==os.tmpdir() || !path.basename(root).startsWith('reader-tabs-dev-')) throw new Error('Unsafe cleanup');
    try { fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
    catch { console.error('Disposable verification artifacts retained:', root); }
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});

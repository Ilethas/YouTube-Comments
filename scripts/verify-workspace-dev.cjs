// Optional real development UI/live check. Never part of offline npm test.
// Requires explicit executable overrides; creates and owns a disposable profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 9347;
async function connect() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find(page => page.type === 'page');
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let next = 0;
        const requests = new Map();
        socket.onmessage = event => { const value = JSON.parse(event.data); if (value.id) {
          const request = requests.get(value.id); requests.delete(value.id);
          if (value.error) request.reject(new Error(value.error.message)); else request.resolve(value.result);
        } };
        socket.onclose = () => { for (const request of requests.values()) request.reject(new Error('Debugger closed')); requests.clear(); };
        const send = (method, params = {}) => new Promise((resolve, reject) => {
          const id = ++next; requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
        });
        const js = async expression => {
          const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          if (value.exceptionDetails) throw new Error('Development renderer expression failed');
          return value.result.value;
        };
        return { send, js, socket };
      }
    } catch { /* Wait for Forge and the renderer. */ }
    await pause(100);
  }
  throw new Error('Development debugger unavailable');
}
async function run() {
  assert.ok(process.env.YOUTUBE_COMMENTS_YTDLP_EXE, 'Explicit yt-dlp executable required');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-workspace-dev-'));
  let child, client;
  try {
    let saved;
    for (const phase of ['write', 'restart']) {
      const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
      const log = fs.openSync(path.join(root, `forge-${phase}.log`), 'w');
      child = spawn(process.execPath, [path.join(__dirname, '../node_modules/@electron-forge/cli/dist/electron-forge.js'), 'start', '--', `--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: ['ignore', log, log] });
      fs.closeSync(log);
      const exited = new Promise(resolve => child.once('exit', resolve));
      client = await connect(); const { js, send } = client;
      await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
      async function waitFor(expression, label, attempts = 250) {
        for (let i = 0; i < attempts; i++) { if (await js(expression)) return; await pause(100); }
        fs.writeFileSync(path.join(__dirname, '../.vite/dev-failure.png'), Buffer.from((await send('Page.captureScreenshot')).data, 'base64'));
        console.log(JSON.stringify({label, workspace: (await snapshot()).workspace, toolbar: await js("document.querySelector('.app-toolbar').textContent")}));
        throw new Error(`Timed out: ${label}`);
      }
      async function click(selector) {
        await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
      }
      const snapshot = async () => { const value = await js('window.reader.bootstrap()'); assert.equal(value.ok, true); return value.value; };
      await waitFor("!!document.querySelector('.tabs')", 'bootstrap');
      if (phase === 'write') {
        for (const view of ['library', 'settings']) {
          await click(`#${view}-toggle`); await waitFor(`!!document.querySelector('#panel-${view}:not([hidden])')`, view);
          await click(`#${view}-toggle`); await pause(100);
          assert.equal((await snapshot()).workspace.tabs.filter(tab => tab.kind === view).length, 1);
          await click(`[aria-label="Close tab: ${view === 'library' ? 'Biblioteka' : 'Ustawienia'}"]`).catch(async () => {
            await js(`document.getElementById('tab-${view}').nextElementSibling.click()`);
          });
          await waitFor(`!document.getElementById('tab-${view}')`, 'close app tab');
        }
        // Set UI English through Settings, then change appearance and locale in view.
        await click('#settings-toggle'); await waitFor("!!document.querySelector('.preferences select')", 'Settings');
        await js("(() => { const s=document.querySelectorAll('.preferences select')[0]; s.value='en'; s.dispatchEvent(new Event('change',{bubbles:true})); })()");
        await waitFor("document.documentElement.lang==='en'", 'English');
        await js("(() => { const s=document.querySelectorAll('.preferences select')[1]; s.value='dark'; s.dispatchEvent(new Event('change',{bubbles:true})); })()");
        await waitFor("document.documentElement.dataset.appearance==='dark'", 'Dark');
        async function acquire(url) {
          await click('[aria-controls="acquisition-form"]');
          await js(`(() => { const i=document.getElementById('source-url'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(url)}); i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
          await waitFor("!document.querySelector('.acquisition-bar button').disabled", 'URL'); await click('.acquisition-bar button');
          await waitFor("!document.getElementById('source-url') || !!document.querySelector('[role=alert]')", 'live acquisition', 2000);
          assert.equal(await js("!!document.querySelector('[role=alert]')"), false, 'Live acquisition failed');
          const current = await snapshot(); return current.workspace.tabs.find(tab => tab.id === current.workspace.activeTabId).itemId;
        }
        const videoId = await acquire(process.env.YOUTUBE_COMMENTS_LIVE_VIDEO_URL || 'https://www.youtube.com/watch?v=IFPKfypw2CQ');
        let state = await snapshot(); assert.ok(state.comments[videoId].length);
        await click('[role=tabpanel]:not([hidden]) input[type=checkbox]');
        await waitFor("!document.querySelector('input[type=checkbox]:disabled')", 'seen write');
        const seenId = (await snapshot()).comments[videoId].find(comment => comment.seen).id;
        await click('[role=tabpanel]:not([hidden]) .item-actions button');
        await waitFor("!document.querySelector('.acquisition-status')", 'live refresh', 2000);
        state = await snapshot(); assert.equal(state.comments[videoId].find(comment => comment.id === seenId).seen, true);
        assert.equal(await js("!!document.querySelector('[role=alert]')"), false);
        await click('#library-toggle'); await waitFor("!!document.querySelector('#panel-library:not([hidden])')", 'Library');
        const active = (await snapshot()).workspace.activeTabId;
        const start = await js("(() => {const r=document.getElementById('tab-settings').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
        const target = await js("document.querySelector('.tabs').getBoundingClientRect().left+3");
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target, y: start.y, button: 'left' }); await pause(100);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target, y: start.y, button: 'left', clickCount: 1 });
        await waitFor("document.querySelector('.tab').dataset.tabId==='settings' && !document.querySelector('[role=tab]:disabled')", 'native drag');
        assert.equal((await snapshot()).workspace.activeTabId, active);
        await js(`document.getElementById(${JSON.stringify('tab-discussion:' + videoId)}).nextElementSibling.click()`);
        await waitFor(`!document.getElementById(${JSON.stringify('tab-discussion:' + videoId)})`, 'close video');
        await js("document.querySelectorAll('.library-entry')[2].querySelector('button').click()");
        await waitFor(`document.querySelector('[role=tabpanel]:not([hidden])').id===${JSON.stringify('panel-' + videoId)}`, 'Library reopen');
        // Layout-only screenshots replace all public text/avatars in the DOM, never storage.
        await js("document.querySelectorAll('.comment-text').forEach((e,i)=>e.textContent=i%2?'Representative reply with multiline text.\\nPolski tekst: Zażółć gęślą jaźń.':'A representative comment in its containing discussion.'); document.querySelectorAll('.comment-byline strong,.item-meta strong,.tab-title,h1').forEach(e=>e.textContent='Example discussion / author'); document.querySelectorAll('.comment-byline .muted,.item-meta span,.item-description').forEach(e=>e.textContent=''); document.querySelectorAll('.avatar img').forEach(e=>e.dispatchEvent(new Event('error')))");
        await pause(150);
        let screenshot = await send('Page.captureScreenshot'); fs.writeFileSync(path.join(root, 'workspace-tree-dark.png'), Buffer.from(screenshot.data, 'base64'));
        await js("document.querySelector('[role=tabpanel]:not([hidden]) .comment-branch[data-depth=\"3\"]')?.scrollIntoView({block:'center'})"); await pause(150);
        screenshot = await send('Page.captureScreenshot'); fs.writeFileSync(path.join(root, 'workspace-tree-deep.png'), Buffer.from(screenshot.data, 'base64'));
        await click('#settings-toggle'); await waitFor("!!document.querySelector('#panel-settings:not([hidden])')", 'Settings again');
        await js("(() => {const s=document.querySelectorAll('.preferences select')[1];s.value='light';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
        await waitFor("document.documentElement.dataset.appearance==='light'", 'Light');
        await js(`document.getElementById(${JSON.stringify('tab-discussion:' + videoId)}).click()`); await pause(150);
        screenshot = await send('Page.captureScreenshot'); fs.writeFileSync(path.join(root, 'workspace-tree-light.png'), Buffer.from(screenshot.data, 'base64'));
        // An optional second source is acquired, refreshed, then explicitly removed.
        if (process.env.YOUTUBE_COMMENTS_LIVE_POST_URL) {
          const postId = await acquire(process.env.YOUTUBE_COMMENTS_LIVE_POST_URL);
          await click('[role=tabpanel]:not([hidden]) .item-actions button'); await waitFor("!document.querySelector('.acquisition-status')", 'Community refresh', 2000);
          assert.equal(await js("!!document.querySelector('[role=alert]')"), false);
          await click('#library-toggle'); await waitFor("!!document.querySelector('#panel-library:not([hidden])')", 'remove view');
          const rowIndex = (await snapshot()).items.findIndex(item => item.id === postId);
          await click(`.library-entry:nth-child(${rowIndex + 1}) .destructive`);
          await waitFor("!!document.querySelector('dialog[open]')", 'confirmation'); await click('dialog .dialog-actions button');
          await waitFor("!document.querySelector('dialog')", 'cancel');
          await click(`.library-entry:nth-child(${rowIndex + 1}) .destructive`); await waitFor("!!document.querySelector('dialog[open]')", 'confirm again');
          await click('dialog .destructive'); await waitFor("!document.querySelector('dialog')", 'remove');
          state = await snapshot(); assert.equal(state.items.some(item => item.id === postId), false); assert.ok(state.items.some(item => item.id === videoId));
        }
        await js(`document.getElementById(${JSON.stringify('tab-discussion:' + videoId)}).click()`); await pause(150);
        saved = await snapshot();
        console.log(JSON.stringify({ phase, comments: saved.comments[videoId].length, maxDepth: await js("Math.max(...Array.from(document.querySelectorAll('#panel-' + " + JSON.stringify(videoId) + " + ' .comment-branch'),e=>Number(e.dataset.depth)))"), tabs: saved.workspace.tabs.map(tab => tab.kind), nativeDrag: true, realRefresh: true }));
      } else {
        assert.deepEqual(await snapshot(), saved);
        console.log(JSON.stringify({ phase, mixedOrderRestored: true, activeRestored: true, preferencesRestored: true, removalPreserved: true }));
      }
      await send('Browser.close').catch(() => undefined); client.socket.close(); client = undefined;
      await Promise.race([exited, pause(10000).then(() => { throw new Error('Forge did not exit'); })]); child = undefined;
    }
  } finally {
    client?.socket.close();
    if (child) {
      const { execFileSync } = require('node:child_process');
      try { execFileSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* Already exited. */ }
      await pause(500);
    }
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-workspace-dev-')) throw new Error('Unsafe cleanup');
    for (const name of ['workspace-tree-dark.png', 'workspace-tree-light.png', 'workspace-tree-deep.png']) {
      const file = path.join(root, name);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(__dirname, '../.vite', name));
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

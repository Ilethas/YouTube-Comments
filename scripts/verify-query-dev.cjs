// Optional development UI check on a consistent disposable backup of existing data.
// No raw public text is logged or committed. Main still owns the copied SQLite file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync, backup } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 9348;
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-query-dev-'));
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
    async function waitFor(expression, label, attempts = 150) {
      for (let i = 0; i < attempts; i++) { if (await js(expression)) return; await pause(50); }
      throw new Error(`Timed out: ${label}`);
    }
    const snapshot = async () => { const result = await js('window.reader.bootstrap()'); assert.equal(result.ok, true); return result.value; };
    const panel = "document.querySelector('[role=tabpanel]:not([hidden])')";
    await waitFor("!!document.querySelector('.tabs')", 'bootstrap');
    await js("document.getElementById('settings-toggle').click()");
    await waitFor("!!document.querySelector('#panel-settings:not([hidden])')", 'Settings');
    await js("(() => {const s=document.querySelector('.preferences select');s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.documentElement.lang==='en'", 'English');
    let state = await snapshot();
    const video = state.items.find(item => item.kind === 'video' && item.sourceId === 'IFPKfypw2CQ');
    assert.ok(video, 'Previously verified 154-comment video required');
    await js(`window.reader.openStoredItem({itemId:${JSON.stringify(video.id)}})`);
    // Workspace state belongs to React; use the Library Open/Activate control.
    await js("document.getElementById('library-toggle').click()");
    await waitFor("!!document.querySelector('#panel-library:not([hidden])')", 'Library');
    const videoIndex = state.items.findIndex(item => item.id === video.id);
    await js(`document.querySelectorAll('.library-entry')[${videoIndex}].querySelector('button').click()`);
    await waitFor(`${panel}.id===${JSON.stringify('panel-' + video.id)}`, 'video view');
    const originalCount = state.comments[video.id].length;
    async function draft(text, fields = ['content'], seen = 'all', regex = false) {
      await js(`(() => {const p=${panel},input=p.querySelector('.query-search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));
        p.querySelector('.query-fields').open=true;
        const fields=${JSON.stringify(fields)}; ['content','author','replied-to-author'].forEach((name,i)=>{const checkbox=p.querySelectorAll('.query-fields input')[i];if(checkbox.checked!==fields.includes(name))checkbox.click();});
        const select=p.querySelector('.query-controls select');select.value=${JSON.stringify(seen)};select.dispatchEvent(new Event('change',{bubbles:true}));
        const toggle=p.querySelectorAll('.query-controls button[type=button]')[1];if((toggle.getAttribute('aria-pressed')==='true')!==${regex})toggle.click();})()`);
    }
    async function apply() {
      await js(`${panel}.querySelector('.query-controls button[type=submit]').click()`);
      await waitFor(`!${panel}.querySelector('.query-status').textContent.includes('Evaluating')`, 'worker Apply');
    }
    const matches = () => js(`Array.from(${panel}.querySelectorAll('[data-view-role=match]'),e=>e.parentElement.parentElement.dataset.commentId)`);
    const visible = () => js(`Array.from(${panel}.querySelectorAll('.comment-branch'),e=>e.dataset.commentId)`);
    const author = state.comments[video.id].find(row => row.author?.displayName)?.author.displayName;
    await draft(author, ['author']); await apply();
    assert.deepEqual(new Set(await matches()), new Set(state.comments[video.id].filter(row => [row.author?.displayName,row.author?.handle].some(text => text?.normalize('NFC').toLowerCase().includes(author.normalize('NFC').toLowerCase()))).map(row=>row.id)));
    const reply = state.comments[video.id].find(row => row.relationshipStatus === 'resolved' && row.directParentId && state.comments[video.id].find(parent=>parent.id===row.directParentId)?.author?.displayName);
    assert.ok(reply, 'Known direct video reply required');
    const parentAuthor = state.comments[video.id].find(row=>row.id===reply.directParentId).author.displayName;
    await draft(parentAuthor, ['replied-to-author']); await apply(); assert.ok((await matches()).includes(reply.id));
    const content = state.comments[video.id].find(row => row.text.length > 12).text.slice(0,12);
    await draft(content); await apply(); assert.ok((await matches()).length);
    await draft(content, ['content'], 'unseen'); await apply();
    assert.ok((await matches()).every(id => !state.comments[video.id].find(row=>row.id===id).seen));
    await draft('', ['content'], 'unseen'); await apply();
    let previousMatches = await matches(), previousVisible = await visible();
    assert.ok(previousMatches.length);
    const target = previousMatches[0];
    await js(`document.getElementById('comment-'+encodeURIComponent(${JSON.stringify(target)})).querySelector('input').click()`);
    await waitFor(`document.getElementById('comment-'+encodeURIComponent(${JSON.stringify(target)})).querySelector('input').checked && !document.querySelector('.seen-control input:disabled')`, 'seen saved');
    assert.deepEqual(await matches(), previousMatches); assert.deepEqual(await visible(), previousVisible);
    assert.equal(await js(`${panel}.querySelector('.query-status').textContent.includes('Seen changes saved')`), true);
    await apply(); assert.equal((await matches()).includes(target), false);
    await draft('\\p{L}+', ['content'], 'all', true); await apply(); assert.ok((await matches()).length);
    previousMatches = await matches(); previousVisible = await visible();
    await draft('[', ['content'], 'all', true); await apply();
    assert.equal(await js(`${panel}.querySelector('.query-error').textContent.includes('Invalid regular expression')`), true);
    assert.deepEqual(await matches(), previousMatches); assert.deepEqual(await visible(), previousVisible);
    await draft('', ['content'], 'unseen'); await apply();
    const beforeNavigation = await snapshot();
    for (const key of [{key:'F3'}, {key:'F3',shiftKey:true}]) await js(`${panel}.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({...key,bubbles:true,cancelable:true})}))`);
    assert.equal(await js(`!!${panel}.querySelector('[data-selected=true]')`), true);
    for (const direction of ['Next unseen','Previous unseen']) await js(`Array.from(${panel}.querySelectorAll('.query-navigation button')).find(e=>e.textContent===${JSON.stringify(direction)}).click()`);
    assert.deepEqual((await snapshot()).comments, beforeNavigation.comments);
    // Switch discussion: independent draft/applied state, including Community evidence.
    await draft('video draft');
    state = await snapshot();
    let post = state.items.find(item => item.kind === 'post' && item.removable);
    if (!post && process.env.YOUTUBE_COMMENTS_LIVE_POST_URL) {
      await js("document.querySelector('[aria-controls=acquisition-form]').click()");
      await js(`(() => {const input=document.getElementById('source-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(process.env.YOUTUBE_COMMENTS_LIVE_POST_URL)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await js("document.querySelector('.acquisition-bar button').click()");
      await waitFor("!document.getElementById('source-url') || !!document.querySelector('.save-error[role=alert]')", 'Community acquisition', 3000);
      state=await snapshot();post=state.items.find(item=>item.kind==='post'&&item.removable);
      assert.ok(post, 'Community acquisition failed');
    }
    let communityChecked = false;
    if (post) {
      await js("document.getElementById('library-toggle').click()"); await waitFor("!!document.querySelector('#panel-library:not([hidden])')", 'post Library');
      const postIndex = state.items.findIndex(item=>item.id===post.id);
      await js(`document.querySelectorAll('.library-entry')[${postIndex}].querySelector('button').click()`);
      await waitFor(`${panel}.id===${JSON.stringify('panel-'+post.id)}`, 'Community');
      assert.equal(await js(`${panel}.querySelector('.query-search input').value`), '');
      assert.ok(state.comments[post.id].some(row=>row.relationship?.kind==='thread-containment'));
      await draft('.', ['replied-to-author'], 'all', true); await apply();
      assert.equal((await matches()).length, 0); communityChecked = true;
    }
    await js(`document.getElementById(${JSON.stringify('tab-discussion:'+video.id)}).click()`);
    await waitFor(`${panel}.id===${JSON.stringify('panel-'+video.id)}`, 'return video');
    assert.equal(await js(`${panel}.querySelector('.query-search input').value`), 'video draft');
    const beforeRefresh = await visible();
    await js(`${panel}.querySelector('.item-actions button').click()`);
    await waitFor("!document.querySelector('.acquisition-status')", 'Refresh', 3000);
    await waitFor(`!${panel}.querySelector('.query-status').textContent.includes('Evaluating')`, 'Refresh reapply');
    const refreshError = await js("document.querySelector('.save-error[role=alert]')?.textContent");
    if (refreshError) { assert.deepEqual(await visible(), beforeRefresh); }
    else {
      state = await snapshot(); assert.ok(state.comments[video.id].find(row=>row.id===target).seen);
      assert.deepEqual(new Set(await matches()),new Set(state.comments[video.id].filter(row=>!row.seen).map(row=>row.id)));
      assert.equal(await js(`${panel}.querySelector('.query-search input').value`), 'video draft');
      assert.equal(await js(`${panel}.querySelector('.query-status').textContent.includes('Draft criteria')`), true);
      assert.equal(await js(`${panel}.querySelector('.query-status').textContent.includes('Seen changes saved')`), false);
    }
    // Sanitized layout evidence remains an ignored local artifact.
    await draft(''); await apply();
    await js(`${panel}.querySelector('.query-fields').open=false; document.documentElement.dataset.appearance='light'`);
    await js("document.querySelectorAll('.comment-text').forEach((e,i)=>e.textContent=i%2?'A representative multiline reply.\\nZażółć gęślą jaźń.':'A representative comment.');document.querySelectorAll('.comment-byline strong,.item-meta strong,.tab-title,h1').forEach(e=>e.textContent='Example discussion / author');document.querySelectorAll('.comment-byline .muted,.item-meta span,.item-description').forEach(e=>e.textContent='');document.querySelectorAll('.avatar img').forEach(e=>e.dispatchEvent(new Event('error')))");
    await js(`${panel}.scrollTop=0`); await pause(100);
    fs.writeFileSync(path.join(__dirname,'../.vite/query-dev-light.png'),Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
    await js("document.documentElement.dataset.appearance='dark'"); await pause(100);
    fs.writeFileSync(path.join(__dirname,'../.vite/query-dev-dark.png'),Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
    console.log(JSON.stringify({ developmentQueryCheck:'PASS', originalComments:originalCount, content:true, author:true, directParentAuthor:true, unseen:true, combined:true, stableSeen:true, regex:true, navigation:true, independentTabs:true, communityChecked, liveRefresh:!refreshError, failedRefreshPreserved:!!refreshError }));
    await send('Browser.close').catch(()=>{}); client.socket.close(); client=undefined;
    await exited; child=undefined;
  } finally {
    if (client) { await client.send('Browser.close').catch(()=>{}); client.socket.close(); }
    if (child) { child.kill(); await exited; }
    if (path.dirname(root)!==os.tmpdir() || !path.basename(root).startsWith('reader-query-dev-')) throw new Error('Unsafe cleanup');
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});

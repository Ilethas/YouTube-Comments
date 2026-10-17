// Offline built-entry restart/layout checks. Only a newly owned temporary profile
// is seeded/modified. No production hooks or renderer filesystem capability.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const entry = path.join(__dirname, '../.vite/build/main.js');
const now = Date.parse('2026-10-14T12:00:00Z');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const defaultQuery = { text: '', fields: ['content'], mode: 'text', caseSensitive: false, seen: 'all', publication: { kind: 'all' }, discovery: 'all' };
const databaseFile = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');
function views(db) {
  return Object.fromEntries(db.prepare('SELECT * FROM discussion_view_state').all().map(row => [row.item_id, {
    draft: JSON.parse(row.draft_query_json), applied: JSON.parse(row.applied_query_json), sort: row.sort,
    anchor: { commentId: row.anchor_comment_id, offset: row.anchor_offset }, selected: row.selected_comment_id,
  }]));
}

function seedGenerated(root) {
  const db = new DatabaseSync(databaseFile(root)); db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
  try {
    const itemTemplate = db.prepare("SELECT * FROM content_items WHERE id='video-demo'").get();
    const commentTemplate = db.prepare("SELECT * FROM comments WHERE id='v1'").get();
    const attemptTemplate = db.prepare('SELECT * FROM extraction_attempts WHERE id=?').get(itemTemplate.baseline_attempt_id);
    const insert = (table, template) => {
      const keys = Object.keys(template); const statement = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`);
      return row => statement.run(...keys.map(key => row[key]));
    };
    const insertItem = insert('content_items', itemTemplate), insertComment = insert('comments', commentTemplate), insertAttempt = insert('extraction_attempts', attemptTemplate);
    const state = db.prepare('INSERT INTO comment_state VALUES (?,0,0)');
    const tab = db.prepare("INSERT INTO workspace_tabs VALUES (?,'discussion',?,?)");
    for (const [position, count] of [10000, 50000].entries()) {
      const itemId = `restoration-${count}`, attempt = `${itemId}-baseline`, itemRemote = JSON.parse(itemTemplate.remote_json);
      itemRemote.sourceId = itemId; itemRemote.title = { status: 'observed', value: `Restoration ${count}` };
      insertAttempt({ ...attemptTemplate, id: attempt, item_id: itemId, source_id: itemId, backend: 'restoration-fixture', attempt_order: 0 });
      insertItem({ ...itemTemplate, id: itemId, source_id: itemId, title: `Restoration ${count}`, position: position + 2,
        baseline_discovery_id: attempt, baseline_attempt_id: attempt, remote_json: JSON.stringify(itemRemote) });
      for (let i = 0; i < count; i++) {
        const id = `${itemId}-${i}`, root = count === 10000 ? i : Math.floor(i / 20) * 20;
        const parent = root === i ? null : `${itemId}-${root}`;
        const publishedAt = new Date(now - 3600000 + i * 20).toISOString();
        const text = `camera ${i}: ${'Variable height fixture. Zażółć gęślą jaźń.\n'.repeat(1 + i % 5)}`;
        const remote = JSON.parse(commentTemplate.remote_json);
        remote.sourceId = id; remote.text = { status: 'observed', value: text };
        remote.relationship = parent ? { kind: 'direct-parent', parentSourceId: parent } : { kind: 'top-level' };
        remote.publication.instant = { status: 'observed', value: publishedAt }; remote.likeCount = { status: 'observed', value: i % 19 };
        insertComment({ ...commentTemplate, id, item_id: itemId, parent_id: parent, position: i, source_comment_id: id, text,
          published_at: publishedAt, like_count: i % 19, remote_json: JSON.stringify(remote),
          first_discovery_id: attempt, first_attempt_id: attempt, last_attempt_id: attempt });
        state.run(id);
      }
      tab.run(`discussion:${itemId}`, itemId, position + 2);
    }
    db.exec("INSERT INTO workspace_tabs VALUES ('library','library',NULL,4); UPDATE workspace SET active_tab_id='library',revision=revision+1; UPDATE preferences SET locale='en',appearance='light'; COMMIT");
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}

async function verify(window, root, phase) {
  // Chromium needs an actual painted surface for measured anchor RAF/capture.
  // Show the disposable window without taking keyboard focus.
  window.showInactive();
  const contents = window.webContents, js = async code => {
    try { return await contents.executeJavaScript(code); }
    catch (error) { console.error('View smoke expression failed:', code); throw error; }
  };
  const db = new DatabaseSync(databaseFile(root), { readOnly: true });
  const checkpoint = path.join(root, 'views.json');
  const panel = "document.querySelector('[role=tabpanel]:not([hidden])')";
  const query = `${panel}.querySelector('.query-controls')`;
  async function wait(expression, label) {
    for (let i = 0; i < 400; i++) { if (await js(expression)) return; await pause(25); }
    throw new Error(`Timed out: ${label}`);
  }
  async function control(selector, value) {
    await js(`(() => {const input=${panel}.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input',{bubbles:true}));})()`);
  }
  async function activate(id) {
    await js(`document.getElementById(${JSON.stringify('tab-discussion:' + id)}).click()`);
    await wait(`${panel}.id===${JSON.stringify('panel-' + id)} && ${query} && !document.querySelector('.tabs button:disabled')`, 'activate/reconstruct');
  }
  async function library() {
    await js("document.getElementById('library-toggle').click()");
    await wait(`${panel}.id==='panel-library' && !document.querySelector('.tabs button:disabled')`, 'Library');
  }
  async function open(count) {
    await library();
    await js(`Array.from(document.querySelectorAll('.library-entry')).find(row=>row.textContent.includes('Restoration ${count}')).querySelector('button').click()`);
    await wait(`${panel}.id==='panel-restoration-${count}' && ${query} && !document.querySelector('.tabs button:disabled')`, 'Library reopen');
  }
  async function apply() {
    await js(`${query}.requestSubmit()`);
    await wait(`!${panel}.querySelector('.query-status').textContent.includes('Evaluating')`, 'Apply');
    await pause(100);
  }
  async function settle() { await pause(500); await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); }
  async function distant() {
    await js(`(() => {const ruler=${panel}.querySelector('.discussion-ruler'),r=ruler.getBoundingClientRect();
      ruler.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+8,clientY:r.top+r.height*.83}));})()`);
    await wait(`${panel}.querySelector('[data-selected=true]') !== null`, 'ruler navigation');
    await settle();
    await js(`${panel}.scrollTop+=31; ${panel}.dispatchEvent(new Event('scroll'))`);
    await settle();
  }
  async function assertView(id, expected, count) {
    await wait(`${query} !== null`, 'saved view ready');
    assert.equal(await js(`${panel}.querySelector('.query-search input').value`), expected.draft.text);
    assert.equal(await js(`${panel}.querySelector('.discussion-sort select').value`), expected.sort);
    const geometry = await js(`(() => {const panel=${panel},row=panel.querySelector('[data-comment-id="${expected.anchor.commentId}"]');
      return {rows:panel.querySelectorAll('article.comment').length,rulerNodes:panel.querySelector('.discussion-ruler').querySelectorAll('*').length,
        selected:panel.querySelector('[data-selected=true]')?.id,focus:document.activeElement?.matches('article.comment'),
        offset:row ? panel.getBoundingClientRect().top-row.getBoundingClientRect().top : null,scroll:panel.scrollTop};})()`);
    assert.ok(geometry.rows < 50); assert.ok(geometry.rulerNodes < 10); assert.equal(geometry.focus, false, 'Restored selection never takes browser focus');
    assert.equal(geometry.selected, `comment-${expected.selected}`); assert.ok(geometry.scroll > 100000);
    assert.ok(geometry.offset !== null && Math.abs(geometry.offset - expected.anchor.offset) < 2, `Anchor offset: ${JSON.stringify(geometry)} vs ${expected.anchor.offset}`);
    assert.equal(await js(`${panel}.querySelector('.discussion-ruler').dataset.matchCount`), String(count));
    return geometry;
  }
  try {
    await wait(`${panel} !== null`, 'bootstrap');
    assert.equal(await js('Date.now()'), now + (phase === 'relative' ? 2 * 86400000 : 0), 'Restart evaluation clock was injected before application startup');
    if (phase === 'seed') return;
    if (phase === 'write') {
      assert.equal(await js('document.querySelectorAll("article.comment").length'), 0);
      await open(10000); await control('[name=seen]', 'unseen'); await apply();
      await control('.discussion-sort select', 'newest'); await distant();
      const marked = await js(`(() => {const article=Array.from(${panel}.querySelectorAll('article.comment')).find(row=>row.dataset.selected!=='true'); article.querySelector('.seen-control input').click(); return article.id.slice(8);})()`);
      await wait(`!${panel}.querySelector('.seen-control input:disabled')`, 'seen saved');
      await control('.query-search input', 'microphone'); await settle();
      assert.equal(await js(`${panel}.querySelector('.discussion-ruler').dataset.matchCount`), '10000', 'Seen changes leave in-session applied view stale');
      await open(50000); await control('.query-search input', 'camera'); await control('[name=publication-preset]', 'last-24-hours'); await apply();
      await control('.discussion-sort select', 'most-liked'); await distant();
      const snapshot = await js('window.reader.bootstrap()'); assert.equal(snapshot.ok, true);
      fs.writeFileSync(checkpoint, JSON.stringify({ views: views(db), workspace: snapshot.value.workspace, marked }));
    } else if (phase === 'read') {
      const expected = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
      await wait(`${query} !== null`, 'active startup reconstruction');
      const startupReadyMs = await js('performance.now()-window.__viewSmokeStart'); await settle();
      assert.deepEqual((await js('window.reader.bootstrap()')).value.workspace, expected.workspace);
      const started = Date.now(), large = await assertView('restoration-50000', expected.views['restoration-50000'], 50000);
      fs.writeFileSync(path.join(__dirname, '../.vite/view-restoration-en-light.png'), (await contents.capturePage()).toPNG());
      await activate('restoration-10000'); await settle();
      const small = await assertView('restoration-10000', expected.views['restoration-10000'], 9999);
      assert.equal(await js(`${panel}.querySelector('.query-status').textContent.includes('Seen changes saved')`), false);
      assert.equal(await js(`document.getElementById('comment-${expected.marked}') !== null`), false, 'Fresh flat Unseen result removes the durable seen row');
      const selected = expected.views['restoration-10000'].selected, index = Number(selected.split('-').at(-1));
      await js(`${panel}.dispatchEvent(new KeyboardEvent('keydown',{key:'F3',bubbles:true}))`);
      await wait(`${panel}.querySelector('[data-selected=true]')?.id==='comment-restoration-10000-${index - 1}'`, 'F3 continues in restored Newest order');
      await settle();
      await js("document.getElementById('tab-discussion:restoration-10000').nextElementSibling.click()");
      await wait("!document.getElementById('tab-discussion:restoration-10000')", 'close'); await library();
      fs.writeFileSync(checkpoint, JSON.stringify({ ...expected, views: views(db) }));
      console.log(JSON.stringify({ restoration: { startupReadyMs, small, large, activationAndChecksMs: Date.now() - started } }));
    } else if (phase === 'library' || phase === 'reopen') {
      assert.equal(await js(`${panel}.id`), 'panel-library'); assert.equal(await js('document.querySelectorAll("article.comment").length'), 0);
      assert.deepEqual(await js('window.__readerWork'), {}, 'Hidden discussions do not mount or reconstruct');
      if (phase === 'library') {
        await js("document.getElementById('settings-toggle').click()"); await wait("document.querySelector('.preferences select') !== null", 'Settings');
        await control('.preferences label:first-child select', 'pl'); await control('.preferences label:nth-child(2) select', 'dark');
        await wait("document.documentElement.lang==='pl' && document.documentElement.dataset.appearance==='dark'", 'Polish/dark'); await library();
      } else {
        assert.equal(await js('document.documentElement.lang'), 'pl'); assert.equal(await js('document.documentElement.dataset.appearance'), 'dark');
        await open(10000); await settle();
        const expected = JSON.parse(fs.readFileSync(checkpoint, 'utf8')).views['restoration-10000']; await assertView('restoration-10000', expected, 9999);
        fs.writeFileSync(path.join(__dirname, '../.vite/view-restoration-pl-dark.png'), (await contents.capturePage()).toPNG());
        await library();
        await js("Array.from(document.querySelectorAll('.library-entry')).find(row=>row.textContent.includes('Restoration 50000')).querySelector('.destructive').click()");
        await wait("document.querySelector('dialog[open]') !== null", 'removal confirmation');
        await js("document.querySelector('dialog .dialog-actions button:last-child').click()");
        await wait("!document.querySelector('dialog')", 'removed');
        assert.equal(views(db)['restoration-50000'], undefined); assert.equal(db.prepare("SELECT count(*) AS n FROM comments WHERE item_id='restoration-50000'").get().n, 0);
      }
    } else if (phase === 'relative') {
      await wait(`${query} !== null`, 'rolling restore'); await settle();
      assert.equal(await js(`${panel}.querySelector('.discussion-ruler').dataset.matchCount`), '0');
      assert.equal(await js(`${panel}.scrollTop`), 0);
      assert.equal(views(db)['restoration-10000'].applied.publication.kind, 'last-24-hours');
    } else if (phase === 'failure') {
      await wait(`${query} !== null`, 'fallback');
      assert.equal(await js(`${panel}.querySelector('.query-search input').value`), '[');
      assert.ok(await js(`${panel}.querySelector('[role=alert]') !== null`));
      assert.ok(await js(`${panel}.querySelectorAll('article.comment').length < 50`));
      assert.equal(db.prepare("SELECT count(*) AS n FROM comments WHERE item_id='restoration-10000'").get().n, 10000);
      await activate('post-demo'); assert.equal(await js(`${panel}.querySelector('[role=alert]') !== null`), false);
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    console.log(`View restoration smoke PASS ${phase}`);
  } finally { db.close(); }
}

if (process.versions.electron && process.type === 'browser') {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app } = require('electron'), root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.VIEW_SMOKE_PHASE;
  const watchdog = setTimeout(() => app.exit(1), 120000); let failed = false;
  app.on('browser-window-created', (_event, window) => {
    window.hide(); const contents = window.webContents; contents.setBackgroundThrottling(false);
    const load = contents.loadURL.bind(contents);
    contents.loadURL = async (...args) => {
      // Create the renderer on a blank page first, then register the clock script
      // before the real file navigation. No application code runs on this page.
      await load('about:blank');
      contents.debugger.attach('1.3');
      await contents.debugger.sendCommand('Page.enable');
      await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `Date.now=()=>${now + (phase === 'relative' ? 2 * 86400000 : 0)};window.__readerWork={};window.__viewSmokeStart=performance.now();` });
      await contents.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Warsaw' });
      return load(...args);
    };
    contents.on('preload-error', (_event, _file, error) => { failed = true; console.error(error); });
    contents.on('console-message', event => { if (event.level === 'error') { failed = true; console.error(event.message); } });
    contents.on('did-finish-load', () => {
      if (contents.getURL() === 'about:blank') return;
      void verify(window, root, phase).then(() => {
      assert.equal(failed, false); clearTimeout(watchdog); contents.debugger.detach(); app.quit();
      }).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); });
    });
  });
  require(entry);
} else {
  (async () => {
    assert.ok(fs.existsSync(entry), 'Build Forge bundles first');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-view-electron-'));
    try {
      for (const phase of ['seed', 'write', 'read', 'library', 'reopen', 'relative', 'failure']) {
        console.log(`View restoration smoke starting ${phase}`);
        if (phase === 'write') seedGenerated(root);
        if (phase === 'relative' || phase === 'failure') {
          const db = new DatabaseSync(databaseFile(root));
          try {
            const query = phase === 'relative' ? { ...defaultQuery, publication: { kind: 'last-24-hours' } } : { ...defaultQuery, mode: 'regex', text: '[' };
            db.prepare("UPDATE discussion_view_state SET applied_query_json=?,draft_query_json=?,anchor_comment_id=NULL,anchor_offset=0,selected_comment_id=NULL WHERE item_id='restoration-10000'").run(JSON.stringify(query), JSON.stringify(query));
            db.exec("UPDATE workspace SET active_tab_id='discussion:restoration-10000',revision=revision+1");
            if (phase === 'failure') db.prepare('INSERT INTO discussion_view_state VALUES (?,?,?,?,NULL,0,NULL)').run('post-demo', '{broken', JSON.stringify(defaultQuery), 'original');
          } finally { db.close(); }
        }
        const environment = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, VIEW_SMOKE_PHASE: phase };
        delete environment.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename], { env: environment, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`))); });
      }
    } finally {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-view-electron-')) throw new Error('Unsafe cleanup');
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

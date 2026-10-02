// Focused verification of the real built entry points. Run after Forge builds;
// this script is never shipped as the application entry or exposed to renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const entry = path.join(__dirname, '../.vite/build/main.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

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
    await js(`(() => { const select = document.querySelectorAll('.preferences select')[${index}];
      select.value = '${value}'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await waitFor(`document.querySelectorAll('.preferences select')[${index}].value === '${value}'
      && !document.querySelector('.preferences select:disabled')`, `preference ${value}`);
  }

  await waitFor("document.querySelectorAll('input[type=checkbox]').length === 24", 'bootstrap');
  assert.deepEqual(await js('Object.keys(window.reader).sort()'), ['bootstrap', 'toggleSeen', 'updatePreferences']);
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
    assert.equal(original.items.length, 2);
    assert.equal(original.preferences.appearance, 'system');
    await preference(0, 'en');
    await js("document.querySelectorAll('#panel-video-demo input')[2].click()");
    await waitFor("document.querySelectorAll('#panel-video-demo input')[2].checked && !document.querySelector('input:disabled')", 'ordinary click');
    let state = await snapshot();
    assert.deepEqual(state.comments['video-demo'].map(comment => comment.seen),
      original.comments['video-demo'].map(comment => comment.id === 'v3' ? !comment.seen : comment.seen));
    await js("document.querySelectorAll('#panel-video-demo input')[1].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))");
    await waitFor("!document.querySelectorAll('#panel-video-demo input')[1].checked && !document.querySelector('input:disabled')", 'Ctrl click');
    state = await snapshot();
    assert.deepEqual(state.comments['video-demo'].map(comment => comment.seen),
      original.comments['video-demo'].map(comment => ['v2', 'v3', 'v4'].includes(comment.id) ? false : comment.seen));
    assert.deepEqual(state.comments['post-demo'], original.comments['post-demo']);
    // An ordinary edit outside the subtree must also survive the real restart.
    await js("document.querySelectorAll('#panel-video-demo input')[5].click()");
    await waitFor("document.querySelectorAll('#panel-video-demo input')[5].checked && !document.querySelector('input:disabled')", 'independent ordinary click');
    await js("document.querySelectorAll('[role=tab]')[1].click()");
    assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden])').id"), 'panel-post-demo');
    await js("document.querySelectorAll('[role=tab]')[0].click()");
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
    fs.writeFileSync(checkpoint, JSON.stringify(state));
  } else {
    const saved = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
    assert.deepEqual(original, saved);
    assert.equal(await js('document.documentElement.lang'), saved.preferences.locale);
    assert.equal(await js('document.documentElement.dataset.appearance'), saved.preferences.appearance);
    // Check that the persisted states are actually reflected in the UI.
    assert.deepEqual(await js("Array.from(document.querySelectorAll('#panel-video-demo input'), input => input.checked)"),
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
      for (const phase of ['write', 'read', 'readsystem']) {
        const environment = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: directory, YOUTUBE_COMMENTS_SMOKE_PHASE: phase };
        delete environment.ELECTRON_RUN_AS_NODE;
        const child = spawn(require('electron'), [__filename], { env: environment, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`)));
        });
      }
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(path.join(directory, 'youtube-comments-development', 'reader.sqlite'), { readOnly: true });
      try {
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
        assert.equal(db.prepare('SELECT count(*) AS count FROM comments').get().count, 24);
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

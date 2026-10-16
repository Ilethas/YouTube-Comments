// Real built-main/preload/renderer checks using only an owned disposable profile.
// Native dialogs and relaunch are controlled here, never through shipped hooks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const entry = path.join(__dirname, '../.vite/build/main.js');
const database = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const processStarted = performance.now();
function data(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map(row => ({ ...row }))]));
  } finally { db.close(); }
}
if (process.versions.electron && process.type === 'browser') {
  const { app, dialog } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT, phase = process.env.BACKUP_SMOKE_PHASE;
  const snapshot = path.join(root, 'snapshot.sqlite'), checkpoint = path.join(root, 'snapshot.json');
  let confirmation = true, saveCancelled = false, openSource = snapshot;
  dialog.showSaveDialog = async (_window, options) => {
    assert.match(options.defaultPath, /^youtube-comments-backup-.*\.sqlite$/);
    return { canceled: saveCancelled, filePath: snapshot };
  };
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openSource] });
  dialog.showMessageBox = async (_window, options) => {
    if (options.buttons?.length === 2) {
      assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0);
      assert.match(options.message, /replace|zastąpi/);
      return { response: confirmation ? 1 : 0 };
    }
    return { response: 0 };
  };
  dialog.showErrorBox = (_title, message) => { console.error(message); app.exit(1); };
  // The orchestrator launches the next real process once this process exits.
  app.relaunch = () => fs.writeFileSync(path.join(root, 'relaunch'), 'requested');
  const crashAt = phase.startsWith('crash-') ? phase.slice(6) : undefined;
  if (crashAt) {
    const rename = fsp.rename;
    fsp.rename = async (from, to) => {
      await rename(from, to);
      const hit = crashAt === 'previous' ? path.basename(to) === 'previous.sqlite'
        : path.basename(from) === 'candidate.sqlite' && to === database(root);
      if (hit) { fs.writeFileSync(path.join(root, 'crash-hit'), crashAt); app.exit(73); await new Promise(() => undefined); }
    };
  }
  const watchdog = setTimeout(() => app.exit(1), 180000);
  app.on('browser-window-created', (_event, window) => {
    window.hide(); window.webContents.setBackgroundThrottling(false);
    window.webContents.on('did-finish-load', () => {
      if (!window.webContents.getURL().startsWith('file:')) return;
      void verify(window).catch(error => { console.error(error); app.exit(1); });
    });
  });
  async function verify(window) {
    const js = code => window.webContents.executeJavaScript(code);
    async function wait(expression) {
      for (let i = 0; i < 2400; i++) { if (await js(expression)) return; await pause(25); }
      throw new Error(`Timed out ${expression}`);
    }
    await wait("document.querySelector('.app-shell') !== null");
    console.log(`Backup Electron ${phase} startup ready: ${(performance.now() - processStarted).toFixed(1)} ms`);
    const invoke = async (name, payload) => {
      const result = await js(`window.reader.${name}(${payload === undefined ? '' : JSON.stringify(payload)})`);
      assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
    };
    // Keep the real complete main -> renderer IPC, but do not clone 60k comments
    // again across executeJavaScript just to inspect a handful of metadata fields.
    const metadata = async () => {
      const result = await js('window.reader.bootstrap().then(r=>r.ok?{ok:true,value:{items:r.value.items,preferences:r.value.preferences,discussionViews:r.value.discussionViews,seenUndo:r.value.seenUndo,workspace:r.value.workspace}}:r)');
      assert.equal(result.ok, true); return result.value;
    };
    const remove = async itemId => {
      const result = await js(`window.reader.removeLibraryItem(${JSON.stringify({ itemId })}).then(r=>r.ok?{ok:true}:r)`);
      assert.equal(result.ok, true);
    };
    if (phase === 'seed') {
      assert.equal(typeof require('node:sqlite').backup, 'function');
      console.log(`Backup runtime: Electron ${process.versions.electron}, Node ${process.versions.node}, SQLite ${process.versions.sqlite}`);
      await invoke('setDiscussionCollapse', { itemId: 'video-demo', kind: 'all', collapsed: phase === 'seed' });
      if (phase === 'seed') await invoke('setDiscussionCollapse', { itemId: 'video-demo', kind: 'comments', ids: ['v1'], collapsed: false });
      await invoke('toggleSeen', { itemId: 'video-demo', commentId: 'v1', subtree: false });
      await invoke('bulkSeen', { itemId: 'post-demo', seen: true, target: { kind: 'all' } });
      await invoke('openSettings'); await invoke('moveTab', { tabId: 'settings', toIndex: 0 });
      const query = { text: '', fields: ['content'], mode: 'text', caseSensitive: false, seen: 'all', publication: { kind: 'all' }, discovery: 'all' };
      await invoke('saveDiscussionView', { itemId: 'video-demo', draft: { ...query, text: 'different draft' }, applied: query, sort: 'newest', anchor: { commentId: 'v5', offset: 15 }, selected: 'v2' });
      await invoke('updatePreferences', { locale: 'pl' }); await invoke('updatePreferences', { appearance: 'dark' });
      // Main-only test fixture, no renderer path/write capability.
      const db = new DatabaseSync(database(root));
      db.prepare('INSERT INTO helper_settings VALUES (?,?)').run('yt-dlp', 'C:\\test-only\\yt-dlp.exe'); db.close();
    } else if (phase === 'backup') {
      await js("document.getElementById('settings-toggle').click()");
      await wait("document.querySelector('#panel-settings:not([hidden]) .data-backups') !== null");
      saveCancelled = true;
      assert.equal((await invoke('createBackup')).status, 'cancelled'); saveCancelled = false;
      // Exercise the actual Settings flow, including renderer view/seen flushing.
      const begin = performance.now();
      await js("document.querySelector('.data-backups button').click()");
      await wait("document.querySelector('.data-backups > [role=status]')?.textContent.includes('snapshot.sqlite')");
      const operationMs = performance.now() - begin;
      assert.equal(await js("document.querySelector('dialog[open]')===null"), true);
      fs.writeFileSync(checkpoint, JSON.stringify(data(snapshot)));
      assert.deepEqual(data(database(root)), data(snapshot));
      console.log('Backup smoke PASS Settings + verified complete snapshot');
      console.log(`Backup Settings operation: ${operationMs.toFixed(1)} ms`);
    } else if (phase === 'restore' || crashAt) {
      const original = JSON.parse(fs.readFileSync(checkpoint));
      await invoke('setDiscussionCollapse', { itemId: 'video-demo', kind: 'all', collapsed: phase === 'seed' });
      if (phase === 'seed') await invoke('setDiscussionCollapse', { itemId: 'video-demo', kind: 'comments', ids: ['v1'], collapsed: false });
      await invoke('toggleSeen', { itemId: 'video-demo', commentId: 'v1', subtree: false });
      await invoke('undoSeen', { itemId: 'post-demo' }); await invoke('closeTab', { tabId: 'discussion:post-demo' });
      await invoke('updatePreferences', { appearance: 'light' });
      const state = await metadata(), removable = state.items.find(item => item.removable);
      if (removable) await remove(removable.id);
      fs.writeFileSync(path.join(root, 'previous.json'), JSON.stringify(data(database(root))));
      confirmation = false; const before = data(database(root));
      assert.equal((await invoke('restoreBackup')).status, 'cancelled'); assert.deepEqual(data(database(root)), before);
      confirmation = true;
      fs.writeFileSync(path.join(root, 'bad.sqlite'), 'not SQLite'); openSource = path.join(root, 'bad.sqlite');
      const invalid = await js('window.reader.restoreBackup()'); assert.equal(invalid.error.code, 'INVALID_BACKUP');
      assert.deepEqual(data(database(root)), before); openSource = snapshot;
      const begin = performance.now();
      await invoke('restoreBackup');
      const operationMs = performance.now() - begin;
      if (!crashAt) {
        assert.deepEqual(data(database(root)), original);
        const directories = fs.readdirSync(path.join(path.dirname(database(root)), 'recovery')).map(name => path.join(path.dirname(database(root)), 'recovery', name));
        const safety = directories.filter(dir => fs.existsSync(path.join(dir, 'safety.sqlite'))).map(dir => path.join(dir, 'safety.sqlite'));
        assert.equal(safety.length, 1); assert.deepEqual(data(safety[0]), before);
        console.log('Restore smoke PASS offline replacement + safety snapshot');
        console.log(`Restore confirmed operation (preflight + safety + install/reopen): ${operationMs.toFixed(1)} ms`);
      }
      clearTimeout(watchdog); return; // Application quits through its real lifecycle.
    } else if (phase === 'verify' || phase === 'verify-recovery') {
      const expected = JSON.parse(fs.readFileSync(path.join(root, phase === 'verify' ? 'snapshot.json' : 'previous.json')));
      assert.deepEqual(data(database(root)), expected);
      const boot = await metadata();
      assert.equal(boot.preferences.locale, 'pl');
      assert.equal(boot.discussionViews['video-demo'].draft.text, 'different draft');
      assert.equal(boot.discussionViews['video-demo'].sort, 'newest');
      assert.equal((await invoke('getHelperStatus', { kind: 'yt-dlp' })).path, 'C:\\test-only\\yt-dlp.exe');
      const recovery = path.join(path.dirname(database(root)), 'recovery');
      const safety = fs.readdirSync(recovery).map(name => path.join(recovery, name, 'safety.sqlite')).filter(fs.existsSync);
      assert.ok(safety.length); safety.forEach(data);
      if (phase === 'verify') assert.ok(fs.existsSync(path.join(root, 'relaunch')));
      if (phase === 'verify') {
        assert.ok(boot.seenUndo['post-demo']); await invoke('undoSeen', { itemId: 'post-demo' });
        const removable = boot.items.find(item => item.removable);
        assert.ok(removable); await remove(removable.id);
      }
      console.log(`Backup smoke PASS ${phase}: fresh process exact table round trip`);
    }
    clearTimeout(watchdog); app.quit();
  }
  require(entry);
} else {
  (async () => {
    assert.ok(fs.existsSync(entry), 'Build Forge entries first');
    for (const scenario of ['roundtrip', 'previous', 'candidate']) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-backup-electron-'));
      try {
        const phases = ['seed', 'backup', scenario === 'roundtrip' ? 'restore' : `crash-${scenario}`, scenario === 'roundtrip' ? 'verify' : 'verify-recovery'];
        for (const phase of phases) {
          if (phase === 'backup') {
            // Bundle only test-side fixture services into the owned temp root.
            // This seeds two real-source adapter fixtures alongside synthetic
            // discussions without a network call or shipped test capability.
            const toolsFile = path.join(root, 'fixture-tools.cjs');
            require('esbuild').buildSync({ stdin: { contents: `export {ReaderRepository} from ${JSON.stringify(path.join(__dirname, '../src/main/persistence/reader-repository.ts'))};export {normalizeYtDlp} from ${JSON.stringify(path.join(__dirname, '../src/main/extractors/yt-dlp.ts'))};export {normalizeCommunityArchive} from ${JSON.stringify(path.join(__dirname, '../src/main/extractors/community.ts'))};`, resolveDir: path.join(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: toolsFile });
            const tools = require(toolsFile), repository = tools.ReaderRepository.open(database(root));
            try {
              for (const name of ['yt-nested-a', 'community-thread-a']) {
                const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, `../src/main/extractors/__fixtures__/${name}.json`), 'utf8'));
                const normalized = (name.startsWith('yt-') ? tools.normalizeYtDlp : tools.normalizeCommunityArchive)(JSON.stringify(fixture.raw), fixture.context);
                const attempt = repository.ingest(normalized, undefined, true);
                repository.bulkSeen({ itemId: attempt.itemId, seen: true, target: { kind: 'all' } });
              }
              if (scenario === 'roundtrip') {
                const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
                for (const count of [10000, 50000]) {
                  const generated = { ...fixture.raw, id: `Backup${count}`, title: `Backup ${count}`, comments: Array.from({ length: count }, (_, i) => ({
                    id: `large-${count}-${i}`, parent: i % 20 ? `large-${count}-${Math.floor(i / 20) * 20}` : 'root',
                    text: `Generated ${i}: ${'Zażółć gęślą jaźń. '.repeat(12)}`, timestamp: 1790856000,
                  })) };
                  const attempt = repository.ingest(tools.normalizeYtDlp(JSON.stringify(generated), fixture.context), undefined, true);
                  repository.bulkSeen({ itemId: attempt.itemId, seen: true, target: { kind: 'all' } });
                }
              }
              repository.changeWorkspace('openSettings');
            } finally { repository.close(); }
          }
          const environment = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, BACKUP_SMOKE_PHASE: phase };
          delete environment.ELECTRON_RUN_AS_NODE; delete environment.YOUTUBE_COMMENTS_YTDLP_EXE; delete environment.YOUTUBE_COMMENTS_POST_ARCHIVER_EXE;
          const begin = performance.now();
          const child = spawn(require('electron'), [__filename], { env: environment, stdio: 'inherit', windowsHide: true });
          await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === (phase.startsWith('crash-') ? 73 : 0) ? resolve() : reject(new Error(`${phase} exited ${code}`))); });
          console.log(`Backup Electron ${scenario}/${phase}: ${(performance.now() - begin).toFixed(1)} ms`);
        }
      } finally {
        if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-backup-electron-')) throw new Error('Unsafe cleanup');
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

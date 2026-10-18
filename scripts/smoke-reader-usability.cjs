const { viewId } = require('./window-view-fixtures.cjs');
// Built-entry demo deletion/seed/restore checks. Every profile belongs to this
// harness; no installer, real account profile, helper or live source is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const database = (root, production = false) => path.join(root, production ? 'youtube-comments-production' : 'youtube-comments-development', 'reader.sqlite');

if (process.versions.electron) {
  require('./thumbnail-fixture-network.cjs').installThumbnailNetwork();
  const { app } = require('electron');
  const root = process.env.USABILITY_ROOT, phase = process.env.USABILITY_PHASE;
  const production = phase.startsWith('production');
  if (production) {
    // Harness-only production startup in a disposable appData root. The shipped
    // entry still chooses its normal mode/path, with no new test bridge.
    Object.defineProperty(app, 'isPackaged', { value: true });
    app.setPath('appData', root);
  }
  const watchdog = setTimeout(() => app.exit(1), 90000);
  app.on('browser-window-created', (_event, window) => {
    window.hide(); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => verify(window).then(() => {
      clearTimeout(watchdog); app.quit();
    }).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); }));
  });
  async function verify(window) {
    const js = code => window.webContents.executeJavaScript(code);
    async function wait(expression) {
      for (let index = 0; index < 1200; index++) { if (await js(expression)) return; await pause(25); }
      throw new Error(`Timed out: ${expression}`);
    }
    await wait("!!document.querySelector('.app-shell')");
    const boot = () => js('window.reader.bootstrap().then(r=>{if(!r.ok)throw Error(r.error.code);return JSON.parse(JSON.stringify(r.value))})');
    const before = await boot();
    if (['empty', 'production-fresh'].includes(phase)) {
      assert.equal(before.items.length, 0);
    } else if (phase === 'seed') {
      assert.equal(before.items.length, 2);
      assert.ok(before.items.every(item => item.isDemo && item.removable));
    } else {
      const preserved = JSON.parse(fs.readFileSync(path.join(root, 'preserved.json'), 'utf8'));
      const real = before.items.find(item => !item.isDemo);
      assert.deepEqual(real, preserved.item);
      assert.deepEqual(before.comments[real.id], preserved.comments);
      assert.deepEqual(before.seenUndo[real.id], preserved.undo);
      assert.deepEqual(before.discussionViews[viewId(before,real.id)], preserved.view);
      assert.deepEqual(before.discussionCollapse[viewId(before,real.id)], preserved.collapse);
      if (phase === 'delete' || phase === 'production-restored') {
        assert.equal(before.items.filter(item => item.isDemo).length, 2);
        await js("document.getElementById('library-toggle').click()");
        await wait("!!document.querySelector('#panel-library:not([hidden]) .library-entry')");
        const remove = "Array.from(document.querySelectorAll('.library-entry')).find(e=>e.querySelector('h2').textContent==='A quieter desk, built one detail at a time').querySelector('.destructive')";
        assert.equal(await js("document.querySelectorAll('#panel-library .demo-label').length"), 2);
        await js(`${remove}.click()`); await wait("!!document.querySelector('dialog[open]')");
        assert.equal(await js("document.activeElement===document.querySelector('dialog .dialog-actions button')"), true);
        await js("document.querySelector('dialog .dialog-actions button').click()");
        assert.equal((await boot()).items.length, 3, 'Cancel keeps both demos and the real discussion');
        await js(`${remove}.click()`); await js("document.querySelector('dialog .destructive').click()");
        await wait("!document.querySelector('dialog') && document.querySelectorAll('.library-entry').length===2");
        const after = await boot();
        assert.ok(!after.items.some(item => item.id === 'video-demo'));
        assert.deepEqual(after.comments[real.id], preserved.comments);
        assert.deepEqual(after.seenUndo[real.id], preserved.undo);
      } else {
        assert.ok(!before.items.some(item => item.id === 'video-demo'), 'Restart must not reseed deleted demos');
        if (phase === 'restart') {
          for (const item of before.items) assert.ok(await js(`window.reader.removeLibraryItem({itemId:${JSON.stringify(item.id)}}).then(r=>r.ok)`));
          assert.equal((await boot()).items.length, 0);
        }
      }
    }
    const db = new DatabaseSync(database(root, production), { readOnly: true });
    try { assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); }
    finally { db.close(); }
    console.log(`Reader usability Electron PASS ${phase}: isolated ${production ? 'production' : 'development'} startup/deletion/FK integrity`);
  }
  require(path.resolve(__dirname, '../.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-usability-electron-'));
    try {
      async function run(phase, production = false) {
        const env = { ...process.env, USABILITY_ROOT: root, USABILITY_PHASE: phase };
        for (const key of ['ELECTRON_RUN_AS_NODE', 'YOUTUBE_COMMENTS_DEMO_ROOT', 'YOUTUBE_COMMENTS_YTDLP_EXE', 'YOUTUBE_COMMENTS_POST_ARCHIVER_EXE']) delete env[key];
        if (!production) env.YOUTUBE_COMMENTS_DEMO_ROOT = root;
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`))); });
      }
      await run('seed');
      const bundle = path.join(root, 'tools.cjs');
      require('esbuild').buildSync({ stdin: { contents: `export {ReaderRepository} from './src/main/persistence/reader-repository'; export {normalizeYtDlp} from './src/main/extractors/yt-dlp'; export {defaultQuery} from './src/domain/discussion-query';`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
      const { ReaderRepository, normalizeYtDlp, defaultQuery } = require(bundle), repo = ReaderRepository.open(database(root));
      const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/main/extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
      const itemId = repo.ingest(normalizeYtDlp(JSON.stringify(fixture.raw), fixture.context), undefined, true).itemId;
      repo.bulkSeen({ itemId, seen: true, target: { kind: 'all' } });
      repo.setDiscussionCollapse({ viewId: viewId(repo.bootstrap(['en']),itemId), expectedRevision: 0, kind: 'all', collapsed: true });
      repo.saveDiscussionView({ viewId: viewId(repo.bootstrap(['en']),itemId), expectedRevision: 0, draft: defaultQuery, applied: defaultQuery, sort: 'original', anchor: { commentId: null, offset: 0 }, selected: null });
      const state = repo.bootstrap(['en']);
      fs.writeFileSync(path.join(root, 'preserved.json'), JSON.stringify({ item: state.items.find(item => item.id === itemId), comments: state.comments[itemId], undo: state.seenUndo[itemId], view: state.discussionViews[viewId(state,itemId)], collapse: state.discussionCollapse[viewId(state,itemId)] }));
      const backup = path.join(root, 'development-backup.sqlite'); await repo.createBackup(backup); repo.close();
      await run('delete'); await run('restart'); await run('empty');
      await run('production-fresh', true);
      // Both connections/processes are closed; this is a verified SQLite backup,
      // never an open live file. Actual restore/recovery is covered separately.
      fs.copyFileSync(backup, database(root, true));
      await run('production-restored', true); await run('production-restart', true);
    } finally {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-usability-electron-')) throw new Error('Unsafe cleanup');
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

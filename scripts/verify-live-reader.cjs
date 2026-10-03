// Optional anonymous live verification of real built entries. Not part of npm test.
// Configure both helper overrides in the launching process. Owns a disposable profile.
// Logs counts/issue patterns only; never dumps public comment text or backend output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.versions.electron && process.type === 'browser') {
  const { app } = require('electron');
  const root = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  const phase = process.env.YOUTUBE_COMMENTS_LIVE_PHASE;
  const checkpoint = path.join(root, 'live-checkpoint.json');
  const watchdog = setTimeout(() => { console.error('Live verification timed out'); app.exit(1); }, 240000);
  app.on('browser-window-created', (_event, window) => {
    window.hide();
    window.setSize(1680, 900);
    window.webContents.once('did-finish-load', async () => {
      const js = code => window.webContents.executeJavaScript(code);
      const snapshot = async () => {
        const result = await js('window.reader.bootstrap()');
        assert.equal(result.ok, true);
        return result.value;
      };
      async function waitFor(code, label, attempts = 200) {
        for (let i = 0; i < attempts; i++) { if (await js(code)) return; await pause(50); }
        throw new Error(`Timed out: ${label}`);
      }
      async function acquire(url) {
        await js("document.querySelector('[aria-controls=acquisition-form]').click()");
        await js(`(() => { const input = document.querySelector('#source-url');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(url)});
          input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
        await waitFor("!document.querySelector('.acquisition-bar button').disabled", 'URL input');
        await js("document.querySelector('.acquisition-bar button').click()");
        await waitFor("document.querySelector('#source-url') === null || document.querySelector('[role=alert]')", 'live acquisition', 4000);
        assert.equal(await js("document.querySelector('[role=alert]') === null"), true, 'Live acquisition failed');
        return snapshot();
      }
      try {
        await waitFor("document.querySelector('.tabs') !== null", 'bootstrap');
        let state = await snapshot();
        if (phase === 'write') {
          state = await acquire(process.env.YOUTUBE_COMMENTS_LIVE_VIDEO_URL);
          const videoId = state.workspace.activeItemId;
          assert.ok(state.comments[videoId].length > 0);
          const y = await js("document.querySelector('[role=tabpanel]:not([hidden]) .comment').getBoundingClientRect().top");
          assert.ok(y < 360, 'Comments start too low in the viewport');
          await waitFor("Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) .avatar img')).some(img => img.complete && img.naturalWidth > 0)", 'real avatar load');
          const avatars = state.comments[videoId].filter(comment => comment.author?.avatarUrl).length;
          await js("document.querySelector('[role=tabpanel]:not([hidden]) input[type=checkbox]').click()");
          await waitFor("!document.querySelector('input[type=checkbox]:disabled')", 'seen save');
          state = await snapshot();
          const seenId = state.comments[videoId].find(comment => comment.seen).id;
          const avatarBefore = state.comments[videoId].find(comment => comment.id === seenId).author?.avatarUrl;
          await js("document.querySelector('[role=tabpanel]:not([hidden]) .description-block button').click()");
          await waitFor("document.querySelector('[role=tabpanel]:not([hidden]) .description-block button').getAttribute('aria-expanded') === 'true'", 'description expand');
          await js("document.querySelector('[role=tabpanel]:not([hidden]) .description-block button').click()");
          await waitFor("document.querySelector('[role=tabpanel]:not([hidden]) .description-block button').getAttribute('aria-expanded') === 'false'", 'description collapse');
          await js("document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').click()");
          await waitFor("!document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').disabled && !document.querySelector('.acquisition-status')", 'live refresh', 4000);
          assert.equal(await js("document.querySelector('[role=alert]') === null"), true);
          state = await snapshot();
          assert.equal(state.workspace.activeItemId, videoId);
          assert.equal(state.comments[videoId].find(comment => comment.id === seenId).seen, true);
          assert.equal(state.comments[videoId].find(comment => comment.id === seenId).author?.avatarUrl, avatarBefore);
          // Sanitize visible source text before a local layout-only screenshot.
          await js(String.raw`(() => {
            document.querySelector('[role=tabpanel]:not([hidden]) h1').textContent = 'A public discussion — compact reader verification';
            document.querySelectorAll('.comment-text').forEach((node, index) => { node.textContent = index % 3 ? 'Representative discussion text. Reading and marking remain explicit.' : 'A longer representative comment with multiple lines.\nA reply keeps its thread indentation and compact metadata.'; });
            document.querySelectorAll('.comment-byline strong, .item-meta strong, .tab-title').forEach(node => { node.textContent = 'Example author / discussion'; });
            document.querySelectorAll('.comment-byline .muted, .item-meta span').forEach(node => { node.textContent = ''; });
            document.querySelectorAll('.item-description').forEach(node => { node.textContent = 'A long description remains stored in full. This compact preview has an explicit expansion control.\nAdditional source description lines are hidden until requested.'; });
          })()`);
          await pause(150); // Let the compositor paint the sanitized layout before capture.
          const screen = await window.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '../.vite/live-layout.png'), screen.toPNG());
          // Force image failure in the actual renderer, without changing persisted evidence.
          await js("document.querySelector('[role=tabpanel]:not([hidden]) .avatar img').dispatchEvent(new Event('error'))");
          await waitFor("document.querySelector('[role=tabpanel]:not([hidden]) .avatar').querySelector('img') === null", 'avatar fallback');
          let postId;
          if (process.env.YOUTUBE_COMMENTS_LIVE_POST_URL) {
            state = await acquire(process.env.YOUTUBE_COMMENTS_LIVE_POST_URL);
            postId = state.workspace.activeItemId;
            assert.ok(state.comments[postId].length > 0);
            await waitFor("Array.from(document.querySelectorAll('[role=tabpanel]:not([hidden]) .avatar img')).some(img => img.complete && img.naturalWidth > 0)", 'Community avatar load');
            await js("document.querySelector('[role=tabpanel]:not([hidden]) input[type=checkbox]').click()");
            await waitFor("!document.querySelector('input[type=checkbox]:disabled')", 'Community seen save');
            state = await snapshot();
            const postSeenId = state.comments[postId].find(comment => comment.seen).id;
            await js("document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').click()");
            await waitFor("!document.querySelector('[role=tabpanel]:not([hidden]) .item-actions button').disabled && !document.querySelector('.acquisition-status')", 'Community refresh', 4000);
            assert.equal(await js("document.querySelector('[role=alert]') === null"), true);
            state = await snapshot();
            assert.equal(state.workspace.activeItemId, postId);
            assert.equal(state.comments[postId].find(comment => comment.id === postSeenId).seen, true);
            console.log(JSON.stringify({ phase, source: 'Community', comments: state.comments[postId].length,
              avatars: state.comments[postId].filter(comment => comment.author?.avatarUrl).length }));
          }
          await js(`document.getElementById('tab-${videoId}').nextElementSibling.click()`);
          await waitFor(`document.getElementById('tab-${videoId}') === null`, 'close stored video');
          await js("document.querySelector('#library-toggle').click()");
          await js("document.querySelectorAll('.library-panel button')[2].click()");
          await waitFor(`document.querySelector('[role=tabpanel]:not([hidden])').id === 'panel-${videoId}'`, 'reopen Library video');
          state = await snapshot();
          assert.equal(state.comments[videoId].find(comment => comment.id === seenId).seen, true);
          if (postId) {
            await js(`document.getElementById('tab-${postId}').nextElementSibling.click()`);
            await waitFor(`document.getElementById('tab-${postId}') === null`, 'close Community');
          }
          state = await snapshot();
          fs.writeFileSync(checkpoint, JSON.stringify({ workspace: state.workspace, itemIds: state.items.map(item => item.id), seenId, videoId, postId }));
          console.log(JSON.stringify({ phase, source: 'video', comments: state.comments[videoId].length, avatars, firstCommentY: y, width: 1680, height: 900 }));
        } else {
          const saved = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
          assert.deepEqual(state.workspace, saved.workspace);
          assert.deepEqual(state.items.map(item => item.id), saved.itemIds);
          assert.equal(state.comments[saved.videoId].find(comment => comment.id === saved.seenId).seen, true);
          assert.equal(await js("document.querySelector('[role=tabpanel]:not([hidden])').id"), `panel-${saved.videoId}`);
          if (saved.postId) assert.equal(await js(`document.getElementById('tab-${saved.postId}') === null`), true);
          await js("document.querySelector('#library-toggle').click()");
          assert.equal(await js("document.querySelectorAll('.library-panel button').length"), state.items.length);
          console.log(JSON.stringify({ phase, restoredTabs: state.workspace.openItemIds.length, storedItems: state.items.length, seenRestored: true }));
        }
        clearTimeout(watchdog); app.quit();
      } catch (error) { console.error(error); clearTimeout(watchdog); app.exit(1); }
    });
  });
  require('../.vite/build/main.js');
} else {
  async function run() {
    assert.ok(process.env.YOUTUBE_COMMENTS_YTDLP_EXE, 'Explicit yt-dlp override required');
    assert.ok(process.env.YOUTUBE_COMMENTS_LIVE_VIDEO_URL, 'Explicit public video URL required');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-live-verification-'));
    try {
      for (const phase of ['write', 'restart']) {
        const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, YOUTUBE_COMMENTS_LIVE_PHASE: phase };
        delete env.ELECTRON_RUN_AS_NODE;
        // Inherit the owner's PATH unchanged; no Python Scripts directory is added.
        const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
        await new Promise((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`)));
        });
      }
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(path.join(root, 'youtube-comments-development', 'reader.sqlite'), { readOnly: true });
      try {
        for (const row of db.prepare("SELECT backend, details FROM extraction_attempts WHERE backend <> 'synthetic-demo' ORDER BY rowid").all()) {
          const d = JSON.parse(row.details), patterns = {};
          for (const issue of d.issues) { const key = `${issue.code} ${issue.location.replace(/\[\d+\]/g, '[*]')}`; patterns[key] = (patterns[key] ?? 0) + 1; }
          console.log(JSON.stringify({ backend: row.backend, coverage: d.coverage.kind, warnings: d.issues.length, patterns }));
        }
      } finally { db.close(); }
    } finally {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-live-verification-')) throw new Error('Unsafe cleanup');
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
  run().catch(error => { console.error(error); process.exitCode = 1; });
}

// Real built-entry Electron screenshots. No production profile, live helpers,
// remote requests, DOM text replacement, or test behavior in application code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'docs/screenshots');

if (process.versions.electron) {
  const { app, session, nativeImage } = require('electron');
  const fixture = JSON.parse(fs.readFileSync(path.join(process.env.YOUTUBE_COMMENTS_DEMO_ROOT, 'capture.json')));
  const watchdog = setTimeout(() => app.exit(1), 60000);
  // These fixture URLs are evidence for invented demo avatars. Serve original
  // geometric portraits offline; cancel every other HTTPS request.
  app.on('ready', () => {
    session.defaultSession.protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.hostname !== 'avatars.example.invalid') return new Response(null, { status: 404 });
      const index = Number(url.pathname.slice(1)) || 0;
      const colors = [[74, 113, 139], [137, 94, 73], [90, 124, 91], [126, 99, 145], [174, 116, 63]];
      const color = colors[index % colors.length], bytes = Buffer.alloc(48 * 48 * 4);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        const portrait = Math.hypot(x - 24, y - 18) < 8 || Math.hypot((x - 24) / 1.2, y - 43) < 16;
        const rgb = portrait ? [245, 225, 197] : color, offset = (y * 48 + x) * 4;
        // Electron bitmap buffers are BGRA on Windows.
        bytes.set([rgb[2], rgb[1], rgb[0], 255], offset);
      }
      return new Response(nativeImage.createFromBitmap(bytes, { width: 48, height: 48 }).toPNG(),
        { headers: { 'Content-Type': 'image/png' } });
    });
  });
  app.on('browser-window-created', (_event, window) => {
    window.setContentSize(1360, 960); window.webContents.setBackgroundThrottling(false);
    window.webContents.once('did-finish-load', () => capture(window).then(() => {
      clearTimeout(watchdog); app.quit();
    }).catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1); }));
  });
  async function capture(window) {
    const contents = window.webContents, js = async code => {
      try { return await contents.executeJavaScript(code); }
      catch { throw new Error(`Screenshot expression failed: ${code}`); }
    };
    const panel = "document.querySelector('[role=tabpanel]:not([hidden])')";
    async function wait(code) {
      for (let i = 0; i < 400; i++) { if (await js(code)) return; await pause(40); }
      throw new Error(`Capture timed out: ${code}`);
    }
    const click = label => js(`Array.from(${panel}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
    async function control(selector, value) {
      await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`);
      await pause(100);
    }
    async function save(name, height) {
      window.setContentSize(1360, height);
      await js('document.activeElement?.blur()');
      contents.sendInputEvent({ type: 'mouseMove', x: 1355, y: 955 });
      await pause(350);
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.equal(await js("!!document.querySelector('dialog[open], .query-error')"), false);
      const image = await contents.capturePage(); assert.equal(image.isEmpty(), false);
      assert.deepEqual(image.getSize(), { width: 1360, height });
      const file = path.join(output, name); fs.writeFileSync(file, image.toPNG());
      console.log(`Captured ${name}: ${fs.statSync(file).size} bytes`);
    }
    await wait(`!!${panel}?.querySelector('.virtual-reader')`);
    await wait(`Array.from(${panel}.querySelectorAll('.avatar img')).filter(e=>e.complete&&e.naturalWidth>0).length>=5`);
    assert.match(await js('location.href'), /\.vite\/renderer/);
    assert.equal(await js('typeof require'), 'undefined');
    await save('reader-light.png', 1000);

    await js("document.getElementById('settings-toggle').click()");
    await wait("!!document.querySelector('#panel-settings:not([hidden])')");
    // Selects are nested in labels: use their parent block's stable order.
    await js("(()=>{const e=document.querySelectorAll('.preferences select')[1];e.value='dark';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await js(`document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)}).click()`);
    await wait(`!!${panel}?.querySelector('.virtual-reader')`);
    await control('[role=tabpanel]:not([hidden]) .query-search input', 'audio');
    await control('[role=tabpanel]:not([hidden]) select[name=seen]', 'unseen');
    await js(`${panel}.querySelector('.query-controls').requestSubmit()`);
    await wait(`${panel}.querySelector('.applied-counts')?.textContent.includes('matching') && !${panel}.querySelector('.query-status').textContent.includes('Evaluating')`);
    await wait("document.documentElement.dataset.appearance==='dark'");
    await save('search-dark.png', 880);

    await control('[role=tabpanel]:not([hidden]) .query-search input', '');
    await control('[role=tabpanel]:not([hidden]) select[name=seen]', 'all');
    await js(`${panel}.querySelector('.query-controls').requestSubmit()`);
    await wait(`!${panel}.querySelector('.applied-counts')`);
    await js("document.getElementById('settings-toggle').click()");
    await wait("!!document.querySelector('#panel-settings:not([hidden])')");
    await js("(()=>{const e=document.querySelectorAll('.preferences select')[1];e.value='light';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await js(`document.getElementById(${JSON.stringify('tab-discussion:' + fixture.itemId)}).click()`);
    await wait(`!!${panel}?.querySelector('.virtual-reader')`);
    await click('Select comments');
    await js(`${panel}.querySelector('.reply-toggle').click()`);
    await pause(250);
    await js(`Array.from(${panel}.querySelectorAll('.selection-circle')).slice(0,3).forEach(e=>e.click())`);
    await wait(`${panel}.querySelectorAll('[data-bulk-selected=true]').length===3`);
    await save('collapse-selection-light.png', 920);

    await js("document.getElementById('library-toggle').click()");
    await wait("!!document.querySelector('#panel-library:not([hidden])')");
    await save('library-light.png', 680);
    fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify({
      source: 'Actual Electron window loading the Forge-built main/preload/renderer',
      electron: process.versions.electron, viewportWidth: 1360,
      data: 'Invented demo discussions in an owned disposable SQLite profile; offline geometric avatars',
      files: ['reader-light.png', 'search-dark.png', 'collapse-selection-light.png', 'library-light.png'],
    }, null, 2) + '\n');
  }
  require(path.join(project, '.vite/build/main.js'));
} else {
  (async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-readme-'));
    try {
      const bundle = path.join(root, 'tools.cjs');
      require('esbuild').buildSync({ stdin: { contents: `export {ReaderRepository} from './src/main/persistence/reader-repository'; export {normalizeYtDlp} from './src/main/extractors/yt-dlp';`, resolveDir: project, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
      const { ReaderRepository, normalizeYtDlp } = require(bundle);
      const repo = ReaderRepository.open(path.join(root, 'youtube-comments-development/reader.sqlite'));
      try {
        const template = JSON.parse(fs.readFileSync(path.join(project, 'src/main/extractors/__fixtures__/yt-nested-a.json')));
        const names = ['Maya', 'Oliver', 'Nina', 'Theo', 'Sam'];
        const threads = [
          ['The small desk workshop', 'That overhead view makes the wiring much easier to follow. Is the microphone connected directly to the camera?',
            'I record the audio separately and line it up with a clap at the start. The camera mic is just a reference.',
            'Thanks! I tried the same setup this weekend. Moving the mic away from the desk made the biggest difference.',
            'A folded towel under the stand helps with keyboard noise too.'],
          ['Lighting a small room', 'The side-by-side lighting comparison was helpful. I had been putting my lamp much too close to the wall.',
            'Bouncing it off the ceiling works well here. The room is only about three metres wide.',
            'Would a warmer bulb change the colour of the wood on camera?',
            'You can set a fixed white balance. I used 4500 K for this recording.'],
          ['A question about the audio', 'There is a little hum around 06:20. Is that from the power supply or the room?',
            'Good catch. It was the old desk lamp; I replaced its power supply after filming.',
            'I could only hear it with headphones. The explanation was still easy to follow.',
            'The audio in the later section sounds much cleaner.'],
          ['Keeping the setup simple', 'I like seeing a project made with ordinary tools. A useful reminder that I do not need to replace everything before starting.',
            'The oldest tool on this desk is also the one I reach for most often.',
            'Same here. I would be interested in a follow-up after a few months of use.',
            'I will keep notes as things wear in. Thanks for watching.'],
          ['Measurements and materials', 'Could you share the dimensions of the shelf? I am working with a similarly narrow desk.',
            'It is 90 cm wide and 22 cm deep. Leave some space behind it for cables.',
            'That gives me enough room for the speakers. Thank you!',
            'I used leftover plywood and rounded the front edge with sandpaper.'],
        ];
        const comments = threads.flatMap((thread, t) => thread.slice(1).map((text, r) => ({
          id: `UgxReadme${t}${r}`, parent: r ? `UgxReadme${t}${r === 2 ? 1 : 0}` : 'root', text,
          author: r === 1 ? 'Desk Notes' : names[(t + r) % names.length],
          author_id: r === 1 ? 'UCReadmeCreator' : `UCReadmePerson${(t + r) % names.length}`,
          author_url: `https://www.youtube.com/@demo-${r === 1 ? 'desk-notes' : names[(t + r) % names.length].toLowerCase()}`,
          author_thumbnail: `https://avatars.example.invalid/${r === 1 ? 5 : (t + r) % names.length}`,
          author_is_uploader: r === 1, like_count: [28, 12, 5, 3][r] + t,
          timestamp: 1791882000 + t * 3600 + r * 1200, is_pinned: t === 0 && r === 0,
        })));
        const raw = { id: 'ReadmeDemo1', title: 'A small desk workshop — demo discussion',
          description: 'A weekend project: a simple shelf, better lighting, and a quieter recording setup.\nInvented comments and people for the application screenshots.',
          channel: 'Desk Notes', channel_id: 'UCReadmeCreator', channel_url: 'https://www.youtube.com/@demo-desk-notes',
          comments: comments.slice(0, -2), comment_count: 20 };
        const itemId = repo.ingest(normalizeYtDlp(JSON.stringify(raw), template.context), undefined, true).itemId;
        repo.ingest(normalizeYtDlp(JSON.stringify({ ...raw, comments }), template.context));
        for (const row of repo.bootstrap(['en']).comments[itemId].filter((_, i) => [0, 1, 4, 5, 6, 12].includes(i)))
          repo.toggleSeen({ itemId, commentId: row.id, subtree: false, seen: !row.seen });
        for (const [id, title, count] of [['ReadmeDemo2', 'Building a bookshelf — demo discussion', 12], ['ReadmeDemo3', 'A walk through the old town — demo discussion', 8], ['ReadmeDemo4', 'Recording room sound — demo discussion', 16]]) {
          repo.ingest(normalizeYtDlp(JSON.stringify({ ...raw, id, title, comments: comments.slice(0, count) }), template.context));
        }
        repo.changeWorkspace('openLibrary'); repo.changeWorkspace('openSettings'); repo.changeWorkspace('openStoredItem', itemId);
        repo.updatePreferences({ locale: 'en' }, ['en']); repo.updatePreferences({ appearance: 'light' }, ['en']);
        fs.writeFileSync(path.join(root, 'capture.json'), JSON.stringify({ itemId }));
      } finally { repo.close(); }
      fs.mkdirSync(output, { recursive: true });
      // No helper status/path is captured; explicit empty overrides prevent probes
      // from discovering machine-specific tools if Settings is briefly opened.
      const env = { ...process.env, YOUTUBE_COMMENTS_DEMO_ROOT: root, YOUTUBE_COMMENTS_YTDLP_EXE: '', YOUTUBE_COMMENTS_POST_ARCHIVER_EXE: '' };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Screenshot Electron exited ${code}`))); });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

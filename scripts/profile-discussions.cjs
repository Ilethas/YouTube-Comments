// Offline real-Chromium profiling, no timings are CI pass thresholds.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
if (process.argv.includes('--child')) {
  const { app, BrowserWindow, session } = require('electron');
  app.setPath('userData', process.env.READER_PERF_ROOT);
  app.whenReady().then(async () => {
    // Deterministic offline avatars exercise failure/fallback without live network.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_request, callback) => callback({ cancel: true }));
    const window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    const observations = [];
    const report = value => { observations.push(value); console.log(JSON.stringify(value)); };
    try {
      await window.loadFile(path.join(__dirname, '../.vite/performance/scripts/profile-reader.html'));
      window.showInactive();
      window.webContents.debugger.attach('1.3');
      for (const count of [1000, 10000, ...(process.argv.includes('--50k') ? [50000] : [])]) {
        for (const shape of ['flat', 'shallow', 'mixed']) {
          const initial = await js(`profile.load({count:${count},shape:'${shape}',newIndexes:[${count - 1}]})`);
          initial.heapUsedMB = Math.round((await window.webContents.debugger.sendCommand('Runtime.getHeapUsage')).usedSize / 1024 / 1024);
          const toggle = await js('profile.toggle()'), switchPanel = await js('profile.switch()');
          const scroll = await js('profile.scroll(.75)');
          const rulerNavigation = await js('profile.rulerNavigate()');
          const navigation = await js('profile.navigate()');
          const apply = await js('profile.apply()');
          const filteredNavigation = await js('profile.navigate()');
          const refresh = await js("profile.apply('',true)");
          report({ count, shape, initial, toggle, switchPanel, scroll, rulerNavigation, navigation, apply, filteredNavigation, refresh });
          assert.equal(rulerNavigation.selected, `generated-${count - 1}`);
          assert.equal(rulerNavigation.exactSelectedVisible, true, 'Ruler reveals distant unmounted NEW target');
          assert.ok(initial.rulerNodes < 10 && initial.rulerBuckets <= 300, 'Ruler DOM/pixel bands stay bounded');
          assert.equal(navigation.exactSelectedVisible, true, 'Far last-row target is actually visible');
          assert.equal(filteredNavigation.exactSelectedVisible, true, 'Filtered target is actually visible');
          assert.ok(initial.rows < 100, 'Large DOM remains bounded in this viewport');
        }
      }
      const deep = await js("profile.load({count:10000,shape:'chain',roots:100,maxDepth:60,textLength:100})");
      const navigation = await js('profile.navigate()');
      assert.equal(navigation.exactSelectedVisible, true);
      report({ deepProbe: { initial: deep, navigation } });
      fs.writeFileSync(path.join(__dirname, '../.vite/performance-deep.png'), (await window.webContents.capturePage()).toPNG());
      const semantics = await js('profile.rulerSemanticCheck()');
      assert.equal(semantics.rawHitContext, true);
      report({ rulerSemantics: semantics });
      await js("document.documentElement.dataset.appearance='light'");
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(__dirname, '../.vite/performance-ruler-overlap-light.png'), (await window.webContents.capturePage()).toPNG());
      await js("document.documentElement.dataset.appearance='dark';profile.locale('pl')");
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(__dirname, '../.vite/performance-ruler-overlap-dark.png'), (await window.webContents.capturePage()).toPNG());
      if (process.argv.includes('--real')) {
        const data = JSON.parse(fs.readFileSync(path.join(process.env.READER_PERF_ROOT, 'real.json'), 'utf8'));
        const initial = await js(`profile.load(${JSON.stringify(data)})`);
        const check = await js('profile.realCheck()');
        assert.equal(check.exactTargetVisible, true);
        const rulerNavigation = await js("profile.rulerNavigate('unseen')"), rulerReflow = await js('profile.rulerReflowCheck()');
        assert.equal(rulerNavigation.exactSelectedVisible, true, 'Real ruler click reveals an actual unseen comment');
        report({ realRegression: { initial, check, rulerNavigation, rulerReflow } });
        await js("document.documentElement.dataset.appearance='light';profile.sanitize()");
        fs.writeFileSync(path.join(__dirname, '../.vite/performance-real-light.png'), (await window.webContents.capturePage()).toPNG());
        await js("document.documentElement.dataset.appearance='dark';profile.locale('pl')");
        await js('profile.sanitize()');
        await js('profile.scroll(.25)');
        const geometry = await js('profile.layout()');
        report({ realReflow: geometry });
        assert.ok(geometry.largestGap < 1 && geometry.largestOverlap < 1, 'Measured real rows stay contiguous after locale reflow');
        fs.writeFileSync(path.join(__dirname, '../.vite/performance-real-dark.png'), (await window.webContents.capturePage()).toPNG());
      }
      fs.writeFileSync(path.join(__dirname, '../.vite/performance-results.json'), JSON.stringify(observations, null, 2));
    } finally { if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach(); app.quit(); }
  }).catch(error => { console.error(error); app.exit(1); });
} else {
  (async () => {
    const { build } = await import('vite');
    await build({ configFile: false, base: './', define: { 'process.env.NODE_ENV': JSON.stringify('development') }, build: {
      outDir: '.vite/performance', rollupOptions: { input: 'scripts/profile-reader.html' }, minify: false } });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-performance-'));
    try {
      if (process.argv.includes('--real')) {
        const { DatabaseSync, backup } = require('node:sqlite');
        const source = process.env.YOUTUBE_COMMENTS_QUERY_DATABASE || path.join(process.env.APPDATA, 'youtube-comments-development', 'reader.sqlite');
        const original = new DatabaseSync(source, { readOnly: true });
        const destination = path.join(root, 'reader.sqlite');
        try { await backup(original, destination); } finally { original.close(); }
        await require('esbuild').build({ entryPoints: ['src/main/persistence/reader-repository.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: '.vite/perf-repository.cjs' });
        const repository = require('../.vite/perf-repository.cjs').ReaderRepository.open(destination);
        try {
          const state = repository.bootstrap(['en']), item = state.items.find(item => item.sourceId === 'IFPKfypw2CQ');
          assert.ok(item, 'Existing ~154-comment video is required for --real');
          fs.writeFileSync(path.join(root, 'real.json'), JSON.stringify({ item, comments: state.comments[item.id] }));
        } finally { repository.close(); }
      }
      const env = { ...process.env, READER_PERF_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [__filename, '--child', ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
      process.exitCode = await new Promise(resolve => child.once('exit', resolve));
    } finally {
      if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-performance-')) throw new Error('Unsafe profile cleanup');
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

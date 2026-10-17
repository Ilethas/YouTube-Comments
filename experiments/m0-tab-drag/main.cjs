'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomBytes } = require('node:crypto');
const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const { Experiment, authorized, validRequest, candidatesAt, contains, slotAt } = require('./model.cjs');

// Fail closed before readiness. Never resolve/import the reader entry or profile.
const suppliedRoot = process.env.YOUTUBE_COMMENTS_M0_ROOT;
if (!suppliedRoot) throw new Error('Use node experiments/m0-tab-drag/launch.cjs');
const root = fs.realpathSync(suppliedRoot);
if (path.dirname(root) !== fs.realpathSync(os.tmpdir()) || !path.basename(root).startsWith('youtube-comments-m0-') ||
    JSON.parse(fs.readFileSync(path.join(root, 'm0-owned.json'), 'utf8')).purpose !== 'M0 fake tab experiment') {
  throw new Error('Not an owned disposable M0 directory');
}
for (const name of ['app-data', 'chromium', 'session', 'logs', 'crashes']) fs.mkdirSync(path.join(root, name));
app.setName('YouTube Comments M0 experiment');
app.setPath('appData', path.join(root, 'app-data'));
app.setPath('userData', path.join(root, 'chromium'));
app.setPath('sessionData', path.join(root, 'session'));
app.setPath('crashDumps', path.join(root, 'crashes'));
app.setAppLogsPath(path.join(root, 'logs'));
const smoke = process.argv.includes('--smoke');
const html = path.join(__dirname, 'index.html');
const expectedURL = pathToFileURL(html).href;
const records = new Map();
const tail = [];
const STARTUP_TIMEOUT_MS = 10_000;
let sequence = 0, model, previousCursor = '', previousCandidate = '';
const started = process.hrtime.bigint();
function log(data) {
  // Fixed event vocabulary, fake IDs and numeric evidence only; no OS payload text.
  const entry = { seq: ++sequence, ms: Number(process.hrtime.bigint() - started) / 1e6,
    dragId: model?.active?.dragId ?? null, ...data };
  if (sequence <= 100_000) fs.appendFileSync(path.join(root, 'events.ndjson'), JSON.stringify(entry) + '\n');
  else if (sequence === 100_001) fs.appendFileSync(path.join(root, 'events.ndjson'), '{"type":"log-cap-reached-relaunch-required"}\n');
  tail.push(entry); if (tail.length > 35) tail.shift();
}
function windows() {
  return [...records.values()].filter(r => !r.closed).map(r => {
    const bounds = r.window.getContentBounds();
    const fresh = r.layout && r.layout.contentSize.width === bounds.width && r.layout.contentSize.height === bounds.height &&
      r.layout.zoom === r.contents.getZoomFactor();
    return { id: r.id, bounds, visible: r.window.isVisible(), minimized: r.window.isMinimized(), layout: fresh ? r.layout : null };
  });
}
function state(r) {
  return { ...model.snapshot(), ownId: r.id, evidenceFile: path.join(root, 'events.ndjson'),
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, os: os.release() },
    nativeWindows: Object.fromEntries([...records.values()].map(record => [record.id, nativeState(record)])), tail };
}
/** Main-owned observations; never call native getters on a destroyed window. */
function nativeState(r) {
  const destroyed = r.window.isDestroyed();
  const bounds = destroyed ? null : r.window.getBounds();
  const display = bounds ? screen.getDisplayMatching(bounds) : null;
  return { isDestroyed: destroyed, isVisible: !destroyed && r.window.isVisible(),
    isMinimized: !destroyed && r.window.isMinimized(), isFocused: !destroyed && r.window.isFocused(),
    getBounds: bounds, getContentBounds: destroyed ? null : r.window.getContentBounds(),
    rendererReady: !destroyed && !r.contents.isDestroyed() && r.pageLoaded && !!r.layout && !r.processGone,
    renderer: { domReady: r.domReady, pageLoaded: r.pageLoaded, layoutReady: !!r.layout,
      readyToShow: r.readyToShow, processGone: r.processGone,
      isLoadingMainFrame: r.contents.isDestroyed() ? null : r.contents.isLoadingMainFrame() },
    currentDisplay: display && { id: display.id, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor } };
}
function nativeEvidence(type, r, extra = {}) {
  log({ type, window: r.id, ...extra, nativeState: nativeState(r) });
}
function broadcast() {
  for (const r of records.values()) if (!r.closed && !r.contents.isDestroyed()) r.contents.send('m0:state', state(r));
}
function cursorEvidence() {
  const dip = screen.getCursorScreenPoint();
  const physical = screen.dipToScreenPoint(dip);
  return { dip, physical, roundtripDip: screen.screenToDipPoint(physical), displayId: screen.getDisplayNearestPoint(dip).id };
}
function displayEvidence(type) {
  log({ type, displays: screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })) });
}

function dispatch(r, request) {
  if (!validRequest(request)) return { ok: false, error: 'INVALID_REQUEST' };
  const q = request;
  let result = true;
  switch (q.kind) {
    case 'snapshot': return { ok: true, value: state(r) };
    case 'show-a': {
      const target = records.get('A');
      if (!target || !nativeState(target).rendererReady) return { ok: false, error: 'WINDOW_A_UNAVAILABLE' };
      if (model.active) return { ok: false, error: 'DRAG_ACTIVE' };
      nativeEvidence('window-show-request', target, { source: r.id, reason: 'diagnostic-show-a', method: 'restore/show/focus' });
      if (target.window.isMinimized()) target.window.restore();
      target.window.show(); target.window.focus();
      nativeEvidence('window-snapshot', target, { reason: 'after-diagnostic-show-a' });
      break;
    }
    case 'reset':
      if ([...records.values()].some(x => x.closed)) return { ok: false, error: 'RELAUNCH_FOR_TWO_WINDOWS' };
      model.reset(); log({ type: 'reset' }); break;
    case 'mode': model.endAny('mode-change-cancelled'); model.mode = q.mode; log({ type: 'mode', mode: q.mode }); break;
    case 'schedule': {
      const target = q.action === 'close-self' ? r : [...records.values()].find(x => x.id !== r.id && !x.closed);
      if (!target || target.closed || r.scheduled) return { ok: false, error: 'UNAVAILABLE_OR_ALREADY_SCHEDULED' };
      log({ type: 'scheduled-window-action', source: r.id, target: target.id, action: q.action, delayMs: 3000 });
      r.scheduled = setTimeout(() => {
        r.scheduled = null;
        if (target.closed) return;
        log({ type: 'fired-window-action', target: target.id, action: q.action });
        if (q.action === 'minimize-peer') target.window.minimize(); else target.window.close();
      }, 3000);
      r.scheduled.unref(); break;
    }
    case 'prepare': result = model.prepare(r.id, q.tab); log({ type: 'prepared', source: r.id, accepted: !!result }); break;
    case 'start': result = model.start(r.id, q.token, q.distance); break;
    case 'release': {
      const evidence = cursorEvidence(), candidates = candidatesAt(windows(), evidence.dip);
      log({ type: 'release-evidence', source: r.id, button: q.button, buttons: q.buttons, trusted: q.trusted, ...evidence, candidates });
      result = model.release(r.id, q.token, q, candidates); break;
    }
    case 'drop': {
      // Recipient and local strip come from authenticated sender; no target ID IPC.
      const layout = windows().find(w => w.id === r.id)?.layout;
      const eligible = r.window.isVisible() && !r.window.isMinimized() && layout &&
        contains(layout.rect, q.local) && slotAt(layout.mids, q.local.x) === q.slot;
      log({ type: 'drop-evidence', target: r.id, slot: q.slot, local: q.local, trusted: q.trusted, eligible: !!eligible, ...cursorEvidence() });
      result = !!eligible && model.drop(r.id, q.token, q.slot); break;
    }
    case 'end': {
      if (model.active?.mode === 'vscode' && q.reason.startsWith('dragend-')) {
        const cursor = cursorEvidence();
        const focused = [...records.values()].find(record => !record.closed && record.window.isFocused());
        const focusedWindowContainsCursor = !!focused && focused.window.isVisible() && contains(focused.window.getBounds(), cursor.dip);
        // DIP/native bounds are deliberately used instead of mixing DOM screen
        // coordinates with main cursor coordinates. Rectangles are hints only.
        const eligibleWindowRects = [...records.values()].filter(record => !record.closed &&
          record.window.isVisible() && !record.window.isMinimized() && contains(record.window.getBounds(), cursor.dip)).map(record => record.id);
        result = model.finishVscode(r.id, q.token, { cursor, focusedWindowContainsCursor,
          focusedWindow: focused?.id ?? null, eligibleWindowRects, terminal: q.reason });
      } else result = model.end(r.id, q.token, q.reason);
      break;
    }
    case 'track-drag': {
      result = model.trackDrag(r.id, q.dragId, q.event);
      log({ type: 'vscode-track-evidence', window: r.id, dragId: q.dragId, event: q.event,
        local: q.local, trusted: q.trusted, accepted: result });
      break;
    }
    case 'layout':
      // Actual zoom belongs to main. Reject renderer claims which disagree.
      if (Math.abs(q.zoom - r.contents.getZoomFactor()) > 0.001) return { ok: false, error: 'ZOOM_MISMATCH' };
      r.layout = { rect: q.rect, mids: q.mids, zoom: q.zoom,
        contentSize: { width: r.window.getContentBounds().width, height: r.window.getContentBounds().height } };
      log({ type: 'layout', window: r.id, rect: q.rect, mids: q.mids, zoom: q.zoom, dpr: q.dpr, bounds: r.window.getContentBounds() });
      r.checkReady(); break;
    case 'signal':
      log({ ...q, kind: undefined, type: `dom-${q.type}`, window: r.id });
      // Retain blur evidence rather than pretending an outside Escape is visible.
      if (['blur', 'visibility-hidden'].includes(q.type)) model.interrupt(r.id);
      if (q.type === 'keydown-escape' && model.active?.mode === 'vscode') model.endAny('cancelled-dom-escape');
      break;
  }
  broadcast(); return { ok: true, value: result };
}

function createWindow(id, offset) {
  const work = screen.getPrimaryDisplay().workArea;
  const width = Math.min(690, work.width), height = Math.min(740, work.height);
  const window = new BrowserWindow({ title: `M0 fake tabs — ${id}`, width, height,
    minWidth: Math.min(560, width), minHeight: Math.min(520, height),
    x: work.x + Math.min(offset, work.width - width), y: work.y + Math.min(offset / 3, work.height - height),
    show: false, backgroundColor: '#17212d', webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      webviewTag: false, backgroundThrottling: false, partition: 'm0-ephemeral' } });
  const r = { id, window, contents: window.webContents, closed: false, layout: null,
    domReady: false, pageLoaded: false, readyToShow: false, processGone: false };
  records.set(id, r);
  let resolveReady, rejectReady, settled = false;
  r.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const deadline = setTimeout(() => failReady('timeout'), STARTUP_TIMEOUT_MS);
  function failReady(reason) {
    if (settled) return;
    settled = true; clearTimeout(deadline);
    nativeEvidence('window-startup-failed', r, { reason });
    rejectReady(new Error(`M0 window ${id} startup failed: ${reason}`));
  }
  r.checkReady = () => {
    if (settled || !nativeState(r).rendererReady) return;
    settled = true; clearTimeout(deadline);
    nativeEvidence('window-renderer-ready', r); resolveReady(r);
  };
  // Hidden construction captures initial state; all show/hide and readiness
  // listeners are attached before loading, setMenu or any explicit show call.
  for (const type of ['blur', 'focus', 'minimize', 'restore', 'hide', 'show', 'move', 'resize']) window.on(type, () => {
    nativeEvidence(`window-${type}`, r);
    if (type === 'blur') model.interrupt(id);
    if (type === 'minimize' || type === 'hide') model.endAny(`window-${id}-${type}-cancelled`);
    broadcast();
  });
  window.once('ready-to-show', () => {
    r.readyToShow = true; nativeEvidence('window-ready-to-show', r); broadcast();
  });
  r.contents.on('dom-ready', () => { r.domReady = true; nativeEvidence('window-dom-ready', r); });
  r.contents.on('did-finish-load', () => {
    r.pageLoaded = true; nativeEvidence('window-did-finish-load', r); r.checkReady(); broadcast();
  });
  r.contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame) { nativeEvidence('window-did-fail-load', r, { code }); failReady('main-frame-load-failed'); }
  });
  r.contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  r.contents.on('will-navigate', event => event.preventDefault());
  r.contents.on('will-redirect', event => event.preventDefault());
  r.contents.on('will-attach-webview', event => event.preventDefault());
  r.contents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape' || input.key === 'Alt' || input.key === 'Tab') {
      log({ type: 'main-key', window: id, key: input.key, phase: input.type });
      if (input.key === 'Escape' && input.type === 'keyDown' && model.active) {
        // May reach a different app window than source. Never claim global keys.
        model.endAny('cancelled-main-escape'); broadcast();
      }
    }
  });
  r.contents.on('before-mouse-event', (_event, mouse) => {
    if (mouse.type !== 'mouseMove' && model.active) {
      log({ type: 'main-mouse', window: id, phase: mouse.type, button: mouse.button, x: mouse.x, y: mouse.y });
    }
  });
  r.contents.on('render-process-gone', (_event, details) => {
    r.processGone = true;
    model.endAny(`renderer-${id}-gone-cancelled`); nativeEvidence('renderer-gone', r, { reason: details.reason });
    failReady('renderer-gone'); broadcast();
  });
  window.on('closed', () => {
    r.closed = true; model.close(id); nativeEvidence('window-closed', r); failReady('closed-before-ready'); broadcast();
  });
  nativeEvidence('window-created', r, { requestedShow: false });
  window.setMenu(null);
  // did-finish-load plus the authenticated first layout is the readiness gate.
  // ready-to-show is diagnostic only: waiting for first paint cannot hang startup.
  window.loadURL(expectedURL).catch(() => failReady('load-rejected'));
  return r;
}

app.whenReady().then(async () => {
  model = new Experiment({ issueToken: () => randomBytes(24).toString('hex'), emit: log });
  const isolatedSession = session.fromPartition('m0-ephemeral');
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  const allowedURLs = ['index.html', 'renderer.js', 'style.css'].map(file => pathToFileURL(path.join(__dirname, file)).href);
  isolatedSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedURLs.includes(details.url) }));
  isolatedSession.on('will-download', event => event.preventDefault());
  log({ type: 'runtime', dateUTC: new Date().toISOString(), platform: process.platform, arch: process.arch,
    electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    os: os.release(), smoke, evidenceClass: smoke ? 'automated-synthetic-only' : 'owner-manual-session-unclassified' });
  displayEvidence('displays-initial');
  for (const type of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(type, () => {
    model.endAny('display-change-cancelled'); displayEvidence(type); broadcast();
  });
  ipcMain.handle('m0:request', (event, ...args) => {
    const r = [...records.values()].find(x => x.contents === event.sender);
    if (!authorized(event, r, expectedURL)) return { ok: false, error: 'FORBIDDEN' };
    if (args.length !== 1) return { ok: false, error: 'INVALID_REQUEST' };
    return dispatch(r, args[0]);
  });
  const a = createWindow('A', 0), b = createWindow('B', 705);
  await Promise.all([a.ready, b.ready]);
  for (const r of [a, b]) {
    if (!nativeState(r).rendererReady) throw new Error(`M0 window ${r.id} unavailable before show`);
  }
  nativeEvidence('window-show-request', a, { reason: 'startup', method: 'showInactive' });
  a.window.showInactive();
  nativeEvidence('window-snapshot', a, { reason: 'after-startup-show' });
  nativeEvidence('window-show-request', b, { reason: 'startup', method: 'show/focus' });
  b.window.show(); b.window.focus();
  nativeEvidence('window-snapshot', b, { reason: 'after-startup-show' });
  log({ type: 'startup-windows-shown', nativeWindows: { A: nativeState(a), B: nativeState(b) } });
  setTimeout(() => {
    for (const r of records.values()) nativeEvidence('window-snapshot', r, { reason: 'startup-settled' });
    broadcast();
  }, 250).unref();
  broadcast();
  const timer = setInterval(() => {
    if (!model.active) return;
    model.current('');
    if (!model.active) { broadcast(); return; }
    const evidence = cursorEvidence(), candidates = candidatesAt(windows(), evidence.dip);
    const cursor = JSON.stringify(evidence.dip), candidate = JSON.stringify(candidates);
    if (cursor !== previousCursor || candidate !== previousCandidate) {
      log({ type: 'cursor-sample-not-button-state', ...evidence, candidates });
      previousCursor = cursor; previousCandidate = candidate; broadcast();
    }
  }, 100);
  app.on('before-quit', () => clearInterval(timer));
  if (smoke) {
    await require('./smoke.cjs').run({ app, records, model, dispatch, log, a, b, root, expectedURL });
  }
}).catch(error => {
  for (const r of records.values()) nativeEvidence('window-snapshot', r, { reason: 'startup-or-smoke-failed' });
  console.error(error); app.exit(1);
});
app.on('window-all-closed', () => app.quit());
if (smoke) setTimeout(() => { console.error('M0 smoke timeout'); app.exit(1); }, 30_000).unref();

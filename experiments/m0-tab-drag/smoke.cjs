'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const { MIME } = require('./model.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let n = 0; n < 200; n++) { if (await predicate()) return; await pause(30); }
  throw new Error(`M0 smoke timeout: ${label}`);
}
/** Real sandbox/preload/DOM wiring, with explicitly SYNTHETIC HTML drag events. */
exports.run = async ({ app, records, model, log, a, b, root, expectedURL }) => {
  const js = (r, code) => r.contents.executeJavaScript(code);
  const evidence = () => fs.readFileSync(path.join(root, 'events.ndjson'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  // Assert the shared startup path BEFORE the smoke can repair visibility itself.
  await until(() => [a, b].every(r => !r.window.isDestroyed() && r.window.isVisible()), 'both startup windows visible');
  const startup = evidence();
  for (const r of [a, b]) {
    assert.equal(r.window.getParentWindow(), null, 'independent native windows');
    assert.equal(r.contents.isDestroyed(), false);
    assert.equal(r.contents.isLoadingMainFrame(), false);
    assert.equal(r.contents.getURL(), expectedURL);
    assert.equal(r.pageLoaded, true); assert.equal(r.domReady, true); assert.ok(r.layout);
    const created = startup.find(e => e.type === 'window-created' && e.window === r.id);
    const show = startup.find(e => e.type === 'window-show' && e.window === r.id);
    const ready = startup.find(e => e.type === 'window-renderer-ready' && e.window === r.id);
    assert.ok(created && ready && show);
    assert.equal(created.nativeState.isVisible, false, 'construction is hidden and explicitly recorded');
    assert.equal(created.nativeState.isDestroyed, false);
    assert.ok(created.seq < ready.seq && ready.seq < show.seq, 'listeners precede load and explicit show');
    assert.equal(show.nativeState.isVisible, true);
  }
  const requests = startup.filter(e => e.type === 'window-show-request' && e.reason === 'startup');
  assert.deepEqual(requests.map(e => [e.window, e.method]), [['A', 'showInactive'], ['B', 'show/focus']]);
  const snapshot = await js(b, 'window.m0.snapshot()');
  for (const r of [a, b]) {
    const native = snapshot.value.nativeWindows[r.id];
    assert.equal(native.isVisible, true); assert.equal(native.isDestroyed, false);
    assert.equal(native.isMinimized, false); assert.equal(native.rendererReady, true);
    assert.equal(typeof native.isFocused, 'boolean');
    assert.deepEqual(native.getBounds, r.window.getBounds());
    assert.deepEqual(native.getContentBounds, r.window.getContentBounds());
    assert.equal(native.currentDisplay.id, screen.getDisplayMatching(r.window.getBounds()).id);
  }
  for (const r of [a, b]) {
    const prefs = r.contents.getLastWebPreferences();
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    assert.equal(await js(r, 'typeof require'), 'undefined');
    assert.equal(await js(r, 'typeof process'), 'undefined');
    assert.equal(await js(r, 'typeof window.reader'), 'undefined');
    await until(() => js(r, 'document.querySelectorAll("#strip button").length === 3'), 'three fake tabs');
    assert.deepEqual(await js(r, 'window.m0.prepare("discussion:real")'), { ok: false, error: 'INVALID_REQUEST' });
  }
  // Exercise the actual diagnostic DOM control -> narrow bridge -> main-owned A.
  a.window.hide();
  await until(() => !a.window.isVisible(), 'A hidden for recovery-control test');
  await js(b, 'document.getElementById("show-a").click()');
  await until(() => a.window.isVisible() && a.window.isFocused(), 'diagnostic control shows/focuses A');
  a.window.minimize();
  await until(() => a.window.isMinimized(), 'A minimized for recovery-control test');
  assert.equal((await js(b, 'window.m0.showWindowA()')).ok, true);
  await until(() => a.window.isVisible() && !a.window.isMinimized(), 'diagnostic control restores A');
  assert.equal(app.getPath('userData'), path.join(root, 'chromium'));
  assert.equal(app.getPath('sessionData'), path.join(root, 'session'));
  await until(() => a.layout && b.layout, 'strip layouts');
  await js(a, 'window.m0.mode("html")');
  await until(() => js(a, 'document.querySelector("#strip button").draggable'), 'HTML mode rendering');
  const start = async () => {
    await js(a, `document.querySelector('#strip button').dispatchEvent(new PointerEvent('pointerdown',
      { bubbles:true, pointerId:42, pointerType:'mouse', button:0, buttons:1, clientX:30, clientY:200 }))`);
    await until(() => js(a, '!!gesture?.token'), 'prepared token before synchronous dragstart');
    const types = await js(a, `(() => {const dt=new DataTransfer(); document.querySelector('#strip button').dispatchEvent(
      new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt})); return [...dt.types];})()`);
    assert.deepEqual(types, [MIME]);
    await until(() => model.active?.stage === 'dragging', 'main started');
    return model.active.token;
  };
  const value = await start();
  assert.deepEqual(await js(b, 'window.m0.showWindowA()'), { ok: false, error: 'DRAG_ACTIVE' });
  const local = { x: b.layout.rect.x + 4, y: b.layout.rect.y + 4 };
  await js(b, `(() => {const dt=new DataTransfer();dt.setData(${JSON.stringify(MIME)},${JSON.stringify(value)});
    document.getElementById('strip').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,
      dataTransfer:dt,clientX:${local.x},clientY:${local.y}}));})()`);
  await until(() => model.windows.get('B').tabs.includes('A-1'), 'synthetic cross-window drop through IPC');
  assert.deepEqual(model.windows.get('B').tabs, ['A-1', 'B-1', 'B-2', 'B-3']);
  assert.equal(model.active, null);
  assert.equal((await js(b, `window.m0.drop(${JSON.stringify(value)},0,${JSON.stringify(local)},false)`)).value, false);
  // Native data-store mutability/OS cancellation is NOT exercised by these events.
  await js(a, `document.getElementById('strip').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:new DataTransfer()}))`);
  await js(a, 'window.m0.reset()');
  await until(() => js(a, 'document.querySelectorAll("#strip button").length === 3'), 'reset');
  await start();
  await js(a, `document.getElementById('strip').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:new DataTransfer()}))`);
  await until(() => model.active === null, 'ambiguous none termination');
  assert.deepEqual(model.windows.get('A').tabs, ['A-1', 'A-2', 'A-3']);
  assert.equal(BrowserWindow.getAllWindows().length, 2, 'none did not create a phantom window');
  // Test Chromium pointer routing using injected input and an explicitly STUBBED
  // cursor. Even isTrusted=true here is automation, never OS mouse evidence.
  b.window.hide(); a.window.focus();
  await js(a, 'window.m0.mode("pointer")');
  await until(() => js(a, '!document.querySelector("#strip button").draggable'), 'pointer mode rendering');
  const geometry = await js(a, `(() => {const b=document.querySelector('#strip button').getBoundingClientRect(),
    r=document.getElementById('strip').getBoundingClientRect();return {x:Math.round(b.x+b.width/2),
      y:Math.round(b.y+b.height/2),endX:Math.floor(r.right-5),endY:Math.round(r.y+r.height/2)};})()`);
  const originalCursor = screen.getCursorScreenPoint;
  const bounds = a.window.getContentBounds();
  log({ type: 'automation-cursor-stub-begin', evidenceClass: 'automated-synthetic-only' });
  screen.getCursorScreenPoint = () => ({ x: bounds.x + geometry.endX, y: bounds.y + geometry.endY });
  try {
    a.contents.sendInputEvent({ type: 'mouseDown', x: geometry.x, y: geometry.y, button: 'left', clickCount: 1 });
    await until(() => model.active?.stage === 'prepared', 'injected pointer preparation');
    a.contents.sendInputEvent({ type: 'mouseMove', x: geometry.endX, y: geometry.endY, modifiers: ['leftButtonDown'] });
    await until(() => model.active?.stage === 'dragging', 'injected pointer captured and threshold crossed');
    a.contents.sendInputEvent({ type: 'mouseUp', x: geometry.endX, y: geometry.endY, button: 'left', clickCount: 1 });
    await until(() => model.active === null, 'injected pointer release');
    assert.deepEqual(model.windows.get('A').tabs, ['A-2', 'A-3', 'A-1']);
    assert.ok(fs.readFileSync(path.join(root, 'events.ndjson'), 'utf8').includes('dom-gotpointercapture'));
  } finally {
    screen.getCursorScreenPoint = originalCursor;
    log({ type: 'automation-cursor-stub-end', evidenceClass: 'automated-synthetic-only' });
  }
  b.window.showInactive();
  await js(a, 'window.m0.reset()');
  await js(a, 'window.m0.mode("html")');
  await until(() => js(a, 'document.querySelector("#strip button").draggable'), 'HTML mode after pointer routing');
  // Popup opening is denied; exact sender/frame/document logic has unit coverage.
  assert.equal(await js(a, `window.open('https://example.invalid') === null`), true);
  const count = records.size;
  assert.equal(count, 2);
  await require('./vscode-smoke.cjs').run({ a, b, model, log, js, until, evidence, start });
  await start();
  assert.equal((await js(a, 'window.m0.closePeerLater()')).ok, true);
  assert.equal((await js(a, 'window.m0.closeSelfLater()')).ok, false, 'only one timer per initiating window');
  await until(() => b.closed, 'timed target close');
  assert.equal(model.active, null); assert.deepEqual(model.windows.get('A').tabs, ['A-1', 'A-2', 'A-3']);
  assert.ok(fs.readFileSync(path.join(root, 'events.ndjson'), 'utf8').includes('"trusted":false'));
  log({ type: 'smoke-pass', evidenceClass: 'automated-synthetic-only', checks: 'two alive/loaded/visible independent sandboxed windows from shared startup; native diagnostics and show-A recovery; isolated paths; narrow bridge; synthetic token drop/replay/none; injected pointer capture/reorder with stub cursor; target close', osTaskSwitcherVerified: false });
  console.log('M0 AUTOMATED SMOKE PASS — synthetic events only; no native drag behavior verified.');
  app.quit();
};

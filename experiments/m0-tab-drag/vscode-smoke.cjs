'use strict';
const assert = require('node:assert/strict');
const { screen } = require('electron');
const { MIME } = require('./model.cjs');

/** Synthetic DOM/IPC exercise only. Native HTML/OLE drag, keyboard ownership,
 * desktop/external hit testing and DPI are explicitly NOT certified here.
 */
exports.run = async ({ a, b, model, log, js, until, evidence, start }) => {
  const reset = async () => {
    await js(a, `document.getElementById('strip').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:new DataTransfer()}))`);
    await js(a, 'window.m0.reset()');
    await until(() => js(a, 'document.querySelectorAll("#strip button").length===3'), 'M0.5 reset');
  };
  await js(a, 'window.m0.mode("vscode")');
  await until(() => js(a, 'document.getElementById("mode").value==="vscode"'), 'VS Code-inspired mode');
  assert.equal(await js(a, 'document.getElementById("vscode-warning").hidden'), false);
  const track = (r, type, token) => js(r, `(() => {const dt=new DataTransfer();dt.setData(${JSON.stringify(MIME)},${JSON.stringify(token)});
    document.body.dispatchEvent(new DragEvent(${JSON.stringify(type)},{bubbles:true,dataTransfer:dt,clientX:10,clientY:10}));})()`);
  let value = await start(); const dragId = model.active.dragId;
  await track(b, 'dragover', value);
  await until(() => model.active?.overWindows.has('B'), 'authenticated peer window capture tracking');
  assert.equal((await js(b, `window.m0.trackDrag(${dragId-1},"over",{x:10,y:10},false)`)).value, false);
  const local = { x: b.layout.rect.x + 4, y: b.layout.rect.y + 4 };
  await js(b, `(() => {const dt=new DataTransfer();dt.setData(${JSON.stringify(MIME)},${JSON.stringify(value)});
    document.getElementById('strip').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,
      dataTransfer:dt,clientX:${local.x},clientY:${local.y}}));})()`);
  await until(() => model.windows.get('B').tabs.includes('A-1'), 'M0.5 explicit HTML attachment');
  assert.equal(model.active, null);
  assert.equal(evidence().filter(e => e.dragId === dragId && e.classification === 'APPLICATION_DROP_COMMITTED').length, 1);
  assert.equal((await js(b, `window.m0.drop(${JSON.stringify(value)},0,${JSON.stringify(local)},false)`)).value, false);
  await reset();

  const originalCursor = screen.getCursorScreenPoint;
  log({ type: 'automation-cursor-stub-begin', purpose: 'vscode-guard-assessment', evidenceClass: 'automated-synthetic-only' });
  screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 });
  try {
    value = await start(); const outsideId = model.active.dragId;
    await track(a, 'dragover', value); await track(a, 'dragleave', value);
    await until(() => model.active?.upstreamDraggedOver === false, 'M0.5 leave tracking');
    await js(a, `document.getElementById('strip').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:new DataTransfer()}))`);
    await until(() => model.active === null, 'M0.5 ambiguous end classification');
    const verdict = evidence().find(e => e.type === 'vscode-detach-assessment' && e.dragId === outsideId);
    assert.ok(verdict); assert.equal(verdict.upstreamWouldOpen, true); assert.equal(verdict.desktopReleaseProven, false);
    assert.equal(verdict.action, 'preserve-source-no-window');
    assert.deepEqual(model.windows.get('A').tabs, ['A-1', 'A-2', 'A-3']);
    assert.equal(model.windows.size, 2);

    value = await start(); const cancelledId = model.active.dragId;
    await js(a, `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await until(() => model.active === null, 'M0.5 observed synthetic Escape');
    assert.ok(evidence().some(e => e.dragId === cancelledId && e.classification === 'CANCELLED_ESCAPE_OBSERVED'));
    assert.equal((await js(a, `window.m0.end(${JSON.stringify(value)},"dragend-none")`)).value, false);
    assert.equal(evidence().some(e => e.type === 'vscode-detach-assessment' && e.dragId === cancelledId), false);

    await start(); const minimizedId = model.active.dragId;
    b.window.minimize(); await until(() => model.active === null, 'M0.5 target minimize cancels');
    assert.ok(evidence().some(e => e.dragId === minimizedId && e.outcome === 'window-B-minimize-cancelled'));
    b.window.restore(); b.window.showInactive();
  } finally {
    screen.getCursorScreenPoint = originalCursor;
    log({ type: 'automation-cursor-stub-end', purpose: 'vscode-guard-assessment', evidenceClass: 'automated-synthetic-only' });
  }
  await reset(); await js(a, 'window.m0.mode("html")');
  log({ type: 'vscode-smoke-pass', evidenceClass: 'automated-synthetic-only', nativeInputVerified: false });
};

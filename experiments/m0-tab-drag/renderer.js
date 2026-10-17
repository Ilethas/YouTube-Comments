'use strict';
// Harness-only DOM. Native OS behavior must be observed by the owner, not inferred
// from synthetic events, isTrusted, or successful bridge invocations.
const MIME = 'application/x-youtube-comments-m0-tab';
const api = window.m0;
const strip = document.getElementById('strip');
const mode = document.getElementById('mode');
let state, gesture, rendered = '', lastMove = 0;
const okay = promise => promise.catch(error => { document.getElementById('status').textContent = `Harness error: ${error.message}`; });
function signal(type, event, detail = '') {
  okay(api.signal(type, { x: event?.clientX ?? 0, y: event?.clientY ?? 0 },
    { x: event?.screenX ?? 0, y: event?.screenY ?? 0 }, event?.button ?? -1,
    event?.buttons ?? 0, event?.isTrusted ?? false, detail));
}
function layout() {
  if (!state) return;
  const r = strip.getBoundingClientRect();
  const mids = [...strip.children].map(child => { const b = child.getBoundingClientRect(); return b.left + b.width / 2; });
  // No zoom UI in this harness; actual factor is checked by main.
  okay(api.layout({ x: r.x, y: r.y, width: r.width, height: r.height }, mids, 1, devicePixelRatio));
}
function render(next) {
  state = next;
  const tabs = next.windows[next.ownId]?.tabs ?? [];
  const key = JSON.stringify([tabs, next.mode]);
  mode.value = next.mode;
  document.getElementById('title').textContent = `M0 fake tabs — Window ${next.ownId}`;
  document.getElementById('runtime').textContent = JSON.stringify(next.runtime);
  document.getElementById('evidence').textContent = next.evidenceFile;
  document.getElementById('native-windows').textContent = JSON.stringify(next.nativeWindows, null, 2);
  const outcome = [...next.tail].reverse().find(e => e.type === 'outcome');
  document.getElementById('status').textContent = `Active: ${JSON.stringify(next.active)} | Last outcome: ${outcome?.outcome ?? 'none'}`;
  document.getElementById('log').textContent = next.tail.map(e => JSON.stringify(e)).join('\n');
  strip.dataset.dragging = String(next.active?.stage === 'dragging');
  // Keep the source node mounted during the OS HTML drag loop.
  if (key !== rendered && !(gesture?.mode === 'html' && gesture.starting)) {
    rendered = key;
    strip.replaceChildren(...tabs.map(tab => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = tab; button.dataset.tab = tab; button.draggable = next.mode === 'html';
      return button;
    }));
    requestAnimationFrame(layout);
  }
}
function endGesture(reason) {
  const g = gesture; gesture = null;
  if (!g) return;
  if (g.token) okay(api.end(g.token, reason));
  if (strip.hasPointerCapture(g.id)) strip.releasePointerCapture(g.id);
  if (state) render(state);
}
mode.addEventListener('change', () => { endGesture('escape'); okay(api.mode(mode.value)); });
document.getElementById('reset').addEventListener('click', () => { endGesture('escape'); okay(api.reset()); });
document.getElementById('show-a').addEventListener('click', () => okay(api.showWindowA().then(reply => {
  if (!reply.ok) document.getElementById('status').textContent = `Show Window A: ${reply.error}`;
})));
document.getElementById('lose').addEventListener('click', () => setTimeout(() => {
  if (gesture && strip.hasPointerCapture(gesture.id)) strip.releasePointerCapture(gesture.id);
}, 3000));
document.getElementById('close-self').addEventListener('click', () => okay(api.closeSelfLater()));
document.getElementById('close-peer').addEventListener('click', () => okay(api.closePeerLater()));
document.getElementById('minimize-peer').addEventListener('click', () => okay(api.minimizePeerLater()));
strip.addEventListener('pointerdown', event => {
  signal('pointerdown', event, event.pointerType || 'unknown');
  const button = event.target.closest('[data-tab]');
  if (event.button !== 0 || event.buttons !== 1 || event.pointerType !== 'mouse') {
    signal('secondary-button', event, event.pointerType || 'unknown'); endGesture('buttons-lost'); return;
  }
  if (!button) return;
  endGesture('escape');
  layout();
  const g = gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: state.mode, token: null, starting: null };
  if (g.mode === 'pointer') {
    event.preventDefault();
    strip.setPointerCapture(event.pointerId);
  }
  g.ready = api.prepare(button.dataset.tab).then(reply => {
    if (!reply.ok || !reply.value) return;
    if (gesture !== g) { okay(api.end(reply.value, 'start-not-ready')); return; }
    g.token = reply.value;
  });
  okay(g.ready);
});
strip.addEventListener('pointermove', event => {
  const g = gesture;
  if (!g || g.mode !== 'pointer') return;
  if (performance.now() - lastMove > 50) { signal('pointermove', event, event.pointerType || 'unknown'); lastMove = performance.now(); }
  if (event.buttons !== 1) { endGesture('buttons-lost'); return; }
  const distance = Math.hypot(event.clientX - g.x, event.clientY - g.y);
  if (distance >= 6 && !g.starting) g.starting = g.ready.then(() => {
    if (gesture === g && g.token) return api.start(g.token, distance);
  });
});
strip.addEventListener('pointerup', event => {
  signal('pointerup', event, event.pointerType || 'unknown');
  const g = gesture;
  if (!g) return;
  if (g.mode === 'html') { if (!g.starting) endGesture('buttons-lost'); return; }
  g.releasing = true;
  // Preserve request order if release beats asynchronous token preparation.
  okay((g.starting || g.ready).then(() => {
    if (gesture === g && g.token) return api.release(g.token, event.button, event.buttons, event.isTrusted);
  }).finally(() => {
    if (gesture === g) gesture = null;
    if (strip.hasPointerCapture(g.id)) strip.releasePointerCapture(g.id);
  }));
});
for (const type of ['gotpointercapture', 'lostpointercapture', 'pointercancel']) strip.addEventListener(type, event => {
  signal(type, event, event.pointerType || 'unknown');
  if (gesture?.mode === 'pointer' && type !== 'gotpointercapture' &&
      !(type === 'lostpointercapture' && gesture.releasing)) endGesture(type);
});
strip.addEventListener('dragstart', event => {
  signal('dragstart', event);
  const g = gesture;
  if (!g || g.mode !== 'html' || !g.token || !event.target.closest('[data-tab]')) {
    event.preventDefault(); endGesture('start-not-ready'); return;
  }
  // DataTransfer must be populated synchronously. Never await inside dragstart.
  event.dataTransfer.clearData();
  event.dataTransfer.setData(MIME, g.token);
  event.dataTransfer.effectAllowed = 'move';
  g.starting = api.start(g.token, 0); okay(g.starting);
});
for (const type of ['dragenter', 'dragover', 'dragleave']) strip.addEventListener(type, event => {
  if (state.mode !== 'html' || !event.dataTransfer.types.includes(MIME)) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'move';
  if (type !== 'dragover' || performance.now() - lastMove > 100) {
    signal(type, event, event.dataTransfer.dropEffect); lastMove = performance.now();
  }
});
strip.addEventListener('drop', event => {
  if (state.mode !== 'html' || !event.dataTransfer.types.includes(MIME)) return;
  event.preventDefault(); signal('drop', event, event.dataTransfer.dropEffect);
  const value = event.dataTransfer.getData(MIME);
  const mids = [...strip.children].map(child => { const r = child.getBoundingClientRect(); return r.left + r.width / 2; });
  let slot = mids.findIndex(mid => event.clientX < mid); if (slot < 0) slot = mids.length;
  okay(api.drop(value, slot, { x: event.clientX, y: event.clientY }, event.isTrusted));
});
strip.addEventListener('dragend', event => {
  signal('dragend', event, event.dataTransfer.dropEffect);
  endGesture(event.dataTransfer.dropEffect === 'none' ? 'dragend-none' : 'dragend-move');
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { signal('keydown-escape', event); endGesture('escape'); }
});
for (const type of ['blur', 'focus', 'pagehide']) window.addEventListener(type, event => {
  signal(type, event);
  if (type === 'pagehide') endGesture('pagehide');
});
document.addEventListener('visibilitychange', event => signal(document.hidden ? 'visibility-hidden' : 'visibility-visible', event));
new ResizeObserver(layout).observe(strip);
window.addEventListener('resize', layout);
api.subscribe(render);
okay(api.snapshot().then(reply => { if (reply.ok) render(reply.value); }));

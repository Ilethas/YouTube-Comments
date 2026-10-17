'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Experiment, TTL, validRequest, authorized, toDipRect, candidatesAt, slotAt } = require('./model.cjs');
function fixture(mode = 'pointer') {
  let time = 0, counter = 0;
  const events = [];
  const m = new Experiment({ now: () => time, issueToken: () => (++counter).toString(16).padStart(48, '0'), emit: e => events.push(e) });
  m.mode = mode;
  const prepare = () => m.prepare('A', 'A-1');
  const begin = () => { const t = prepare(); assert.equal(m.start('A', t, 7), true); return t; };
  return { m, events, prepare, begin, advance: n => { time += n; } };
}
const release = { button: 0, buttons: 0, trusted: false };
test('threshold, primary release and reorder indexes preserve exactly six fake tabs', () => {
  const { m, prepare } = fixture(); const t = prepare();
  assert.equal(m.start('A', t, 5.99), false);
  assert.equal(m.start('A', t, 6), true);
  assert.equal(m.release('A', t, release, [{ id: 'A', slot: 3 }]), true);
  assert.deepEqual(m.windows.get('A').tabs, ['A-2', 'A-3', 'A-1']);
  assert.equal(new Set([...m.windows.values()].flatMap(w => w.tabs)).size, 6);
  assert.equal(m.release('A', t, release, [{ id: 'B', slot: 0 }]), false);
});
test('backward reorder and same-position insertion do not lose a tab', () => {
  const { m } = fixture(); const t = m.prepare('A', 'A-3'); m.start('A', t, 7);
  m.release('A', t, release, [{ id: 'A', slot: 0 }]);
  assert.deepEqual(m.windows.get('A').tabs, ['A-3', 'A-1', 'A-2']);
  const next = m.prepare('A', 'A-1'); m.start('A', next, 7);
  m.release('A', next, release, [{ id: 'A', slot: 2 }]);
  assert.deepEqual(m.windows.get('A').tabs, ['A-3', 'A-1', 'A-2']);
});
test('pointer transfer is explicitly geometry-only and single consumption', () => {
  const { m, begin, events } = fixture(); const t = begin();
  assert.equal(m.release('A', t, release, [{ id: 'B', slot: 1 }]), true);
  assert.deepEqual(m.windows.get('B').tabs, ['B-1', 'A-1', 'B-2', 'B-3']);
  assert.match(events.at(-1).outcome, /unverified-occlusion/);
  assert.equal(m.drop('B', t, 0), false);
});
test('outside release never infers desktop or opens/moves anything', () => {
  const { m, begin, events } = fixture(); const before = JSON.stringify(m.snapshot().windows);
  assert.equal(m.release('A', begin(), release, []), false);
  assert.equal(JSON.stringify(m.snapshot().windows), before);
  assert.equal(events.at(-1).outcome, 'outside-release-observed-destination-unknown');
});
test('no movement from overlapping window bounds or release after focus loss', () => {
  for (const interrupted of [false, true]) {
    const { m, begin } = fixture(); const t = begin(); const before = JSON.stringify(m.snapshot().windows);
    if (interrupted) m.interrupt('A');
    assert.equal(m.release('A', t, release, interrupted ? [{ id: 'B', slot: 0 }] : [{ id: 'A', slot: 0 }, { id: 'B', slot: 0 }]), false);
    assert.equal(JSON.stringify(m.snapshot().windows), before);
  }
});
test('right/middle release or chord cancels and cannot later release', () => {
  for (const evidence of [{ button: 1, buttons: 0 }, { button: 2, buttons: 0 }, { button: 0, buttons: 2 }]) {
    const { m, begin } = fixture(); const t = begin();
    assert.equal(m.release('A', t, evidence, [{ id: 'B', slot: 0 }]), false);
    assert.equal(m.active, null); assert.equal(m.windows.get('A').tabs.length, 3);
  }
});
for (const reason of ['escape', 'pointercancel', 'lostpointercapture', 'buttons-lost', 'pagehide', 'dragend-none', 'dragend-move']) {
  test(`${reason} preserves placement; dragend never stands for desktop release`, () => {
    const { m, begin, events } = fixture(reason.startsWith('dragend') ? 'html' : 'pointer'); const t = begin();
    assert.equal(m.end('A', t, reason), true);
    assert.equal(m.windows.get('A').tabs.length, 3);
    assert.equal(m.drop('B', t, 0), false);
    if (reason.startsWith('dragend')) assert.match(events.at(-1).outcome, /ambiguous/);
  });
}
test('HTML target drop commits once; late dragend cannot undo a committed drop', () => {
  const { m, begin } = fixture('html'); const t = begin();
  m.interrupt('A'); // native drop is independently delivered to a target
  assert.equal(m.drop('B', t, 2), true);
  assert.equal(m.end('A', t, 'dragend-none'), false);
  assert.equal(m.drop('B', t, 0), false);
  assert.deepEqual(m.windows.get('B').tabs, ['B-1', 'B-2', 'A-1', 'B-3']);
});
test('HTML in-strip reorder uses the same insertion rules', () => {
  const { m, begin } = fixture('html'); const t = begin();
  assert.equal(m.drop('A', t, 3), true);
  assert.deepEqual(m.windows.get('A').tabs, ['A-2', 'A-3', 'A-1']);
});
test('unprepared, forged, superseded, expired and wrong-source tokens reject', () => {
  const { m, prepare, advance } = fixture('html');
  assert.equal(m.prepare('B', 'A-1'), null);
  const old = prepare(), t = prepare();
  assert.equal(m.start('A', old, 7), false);
  assert.equal(m.start('B', t, 7), false);
  assert.equal(m.drop('B', t, 0), false); // only prepared, not started
  assert.equal(m.start('A', t, 7), true);
  assert.equal(m.prepare('B', 'B-1'), null); // active gesture cannot be stolen
  assert.equal(m.drop('B', 'f'.repeat(48), 0), false);
  advance(TTL);
  assert.equal(m.drop('B', t, 0), false);
  assert.equal(m.active, null);
});
test('invalid target slot and stale source topology cannot alter placement', () => {
  const { m, begin } = fixture('html'); const t = begin();
  assert.equal(m.drop('B', t, 4), false);
  assert.equal(m.drop('B', t, -1), false);
  assert.equal(m.drop('B', t, NaN), false);
  assert.equal(m.drop('missing', t, 0), false);
  m.windows.get('A').revision++;
  assert.equal(m.drop('B', t, 0), false);
  assert.equal(m.windows.get('A').tabs.length, 3);
});
test('closing either participant invalidates active token', () => {
  for (const id of ['A', 'B']) {
    const { m, begin } = fixture('html'); const t = begin(); m.close(id);
    assert.equal(m.active, null); assert.equal(m.drop('B', t, 0), false);
  }
});
test('CSS to DIP handles negative origins and zoom without global display scaling', () => {
  const r = toDipRect({ x: -1920, y: -200 }, { x: 10, y: 20, width: 100, height: 40 }, 1.25);
  assert.deepEqual(r, { x: -1907.5, y: -175, width: 125, height: 50 });
  assert.equal(slotAt([20, 40, 60], 40), 2); assert.equal(slotAt([], 100), 0);
});
test('minimized/hidden windows excluded; overlapping windows remain ambiguous; far edge exclusive', () => {
  const w = { id: 'B', visible: true, minimized: false, bounds: { x: -100, y: 0 },
    layout: { rect: { x: 0, y: 0, width: 100, height: 40 }, mids: [20, 60], zoom: 1 } };
  assert.deepEqual(candidatesAt([w], { x: -65, y: 10 }), [{ id: 'B', slot: 1 }]);
  assert.deepEqual(candidatesAt([{ ...w, minimized: true }, { ...w, visible: false }], { x: -65, y: 10 }), []);
  assert.equal(candidatesAt([w, { ...w, id: 'A' }], { x: -65, y: 10 }).length, 2);
  assert.deepEqual(candidatesAt([w], { x: 0, y: 10 }), []);
});
test('sender, exact frame, exact document and liveness all required', () => {
  const frame = { url: 'file:///experiment/index.html' }, contents = { mainFrame: null }; contents.mainFrame = frame;
  const r = { contents, closed: false }, e = { sender: contents, senderFrame: frame };
  assert.equal(authorized(e, r, frame.url), true);
  for (const [event, record, url] of [[{ ...e, sender: {} }, r, frame.url],
    [{ ...e, senderFrame: { url: frame.url } }, r, frame.url], [e, { ...r, closed: true }, frame.url],
    [e, r, frame.url + '?other'], [e, null, frame.url]]) assert.equal(authorized(event, record, url), false);
});
test('wire validator rejects extra capabilities and malformed/big coordinates, slots and tokens', () => {
  const good = [ { kind: 'snapshot' }, { kind: 'prepare', tab: 'A-1' },
    { kind: 'start', token: '1'.repeat(48), distance: 6 },
    { kind: 'drop', token: '1'.repeat(48), slot: 0, local: { x: 1, y: 1 }, trusted: false },
    { kind: 'layout', rect: { x: 0, y: 1, width: 100, height: 40 }, mids: [20, 50], zoom: 1, dpr: 1.5 },
    { kind: 'schedule', action: 'close-peer' }, { kind: 'show-a' } ];
  for (const request of good) { assert.equal(validRequest(request), true); assert.equal(validRequest({ ...request, path: 'forbidden' }), false); }
  for (const request of [null, [], { kind: 'shell' }, { kind: 'prepare', tab: 'discussion:real' },
    { ...good[2], token: 'forged' }, { ...good[2], distance: NaN }, { ...good[3], slot: -1 },
    { ...good[3], local: { x: Infinity, y: 0 } }, { ...good[4], mids: [50, 20] }, { ...good[4], zoom: 0 },
    { ...good[4], rect: { x: -1, y: 0, width: 100, height: 40 } },
    { kind: 'schedule', action: 'close-arbitrary' }, { kind: 'schedule', action: 'close-peer', windowId: 42 },
    { kind: 'show-a', windowId: 'B' }]) assert.equal(validRequest(request), false);
});

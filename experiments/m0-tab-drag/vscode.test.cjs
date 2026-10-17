'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Experiment, TTL, validRequest } = require('./model.cjs');
function fixture() {
  let time = 0, n = 0;
  const events = [];
  const m = new Experiment({ now: () => time, issueToken: () => (++n).toString(16).padStart(48, '0'), emit: e => events.push(e) });
  m.mode = 'vscode';
  const begin = (source = 'A', tab = 'A-1') => {
    const token = m.prepare(source, tab); assert.ok(token); assert.equal(m.start(source, token, 0), true);
    return { token, dragId: m.active.dragId };
  };
  return { m, events, begin, advance: ms => { time += ms; } };
}
const outside = { cursor: { dip: { x: -100, y: 20 } }, focusedWindowContainsCursor: false,
  focusedWindow: null, eligibleWindowRects: [], terminal: 'dragend-none' };
test('the third mode and correlation-only tracking messages are exact and bounded', () => {
  assert.equal(validRequest({ kind: 'mode', mode: 'vscode' }), true);
  const q = { kind: 'track-drag', dragId: 1, event: 'over', local: { x: 10, y: 10 }, trusted: false };
  assert.equal(validRequest(q), true);
  for (const bad of [{ ...q, windowId: 'B' }, { ...q, token: '1'.repeat(48) }, { ...q, dragId: 0 },
    { ...q, dragId: NaN }, { ...q, event: 'detach' }, { ...q, local: { x: Infinity, y: 0 } }]) assert.equal(validRequest(bad), false);
});
test('reorder and explicit cross-window HTML attachment consume exactly once', () => {
  const { m, begin, events } = fixture(); let g = begin();
  assert.equal(m.drop('A', g.token, 3), true);
  assert.deepEqual(m.windows.get('A').tabs, ['A-2', 'A-3', 'A-1']);
  assert.equal(m.finishVscode('A', g.token, outside), false);
  g = begin(); assert.equal(m.trackDrag('B', g.dragId, 'over'), true);
  assert.equal(m.drop('B', g.token, 1), true);
  assert.equal(events.at(-1).classification, 'APPLICATION_DROP_COMMITTED');
  assert.equal(m.drop('B', g.token, 0), false);
  assert.equal(new Set([...m.windows.values()].flatMap(w => w.tabs)).size, 6);
});
test('hover, even with a correct dragId, never authorizes transfer', () => {
  const { m, begin } = fixture(); const g = begin();
  assert.equal(m.trackDrag('B', g.dragId, 'over'), true);
  assert.equal(m.drop('B', 'f'.repeat(48), 0), false);
  assert.equal(m.windows.get('A').tabs.length, 3);
  assert.equal(m.trackDrag('foreign', g.dragId, 'over'), false);
});
test('per-window hints expose last-global-boolean disagreement and child leave risks', () => {
  const { m, begin, events } = fixture(); const g = begin();
  m.trackDrag('A', g.dragId, 'over'); m.trackDrag('B', g.dragId, 'over'); m.trackDrag('A', g.dragId, 'leave');
  assert.deepEqual(m.snapshot().active.overWindows, ['B']);
  assert.equal(m.snapshot().active.upstreamDraggedOver, false);
  m.finishVscode('A', g.token, outside);
  assert.equal(events.at(-2).upstreamWouldOpen, true);
  assert.equal(events.at(-2).desktopReleaseProven, false);
});
test('tracked app hover and focused-window containment suppress upstream candidate', () => {
  for (const tracked of [true, false]) {
    const { m, begin, events } = fixture(); const g = begin();
    if (tracked) m.trackDrag('B', g.dragId, 'over');
    m.finishVscode('A', g.token, { ...outside, focusedWindowContainsCursor: !tracked });
    assert.equal(events.at(-2).upstreamWouldOpen, false);
    assert.equal(events.at(-1).classification, 'WORKBENCH_GUARD_SUPPRESSES_CANDIDATE');
  }
});
test('desktop release, unseen Escape, external surface and taskbar can have identical observations', () => {
  const results = [];
  // Labels are test ground truth ONLY, never supplied to the detector.
  for (const groundTruth of ['desktop-release', 'unobserved-escape', 'notepad', 'taskbar']) {
    const { m, begin, events } = fixture(); const before = JSON.stringify(m.snapshot().windows); const g = begin();
    m.trackDrag('A', g.dragId, 'over'); m.trackDrag('A', g.dragId, 'leave');
    assert.equal(m.finishVscode('A', g.token, outside), true, groundTruth);
    assert.equal(JSON.stringify(m.snapshot().windows), before);
    assert.equal(m.windows.size, 2);
    const verdict = events.at(-2);
    assert.equal(verdict.upstreamWouldOpen, true); assert.equal(verdict.desktopReleaseProven, false);
    assert.equal(verdict.externalDestination, 'unknown'); assert.equal(verdict.action, 'preserve-source-no-window');
    results.push(verdict.classification);
  }
  assert.equal(new Set(results).size, 1);
});
test('external move effect, no effect, negative coordinates and rectangle hints never prove release', () => {
  for (const terminal of ['dragend-none', 'dragend-move']) {
    const { m, begin, events } = fixture(); const g = begin();
    m.finishVscode('A', g.token, { ...outside, terminal, eligibleWindowRects: ['B'] });
    assert.equal(events.at(-2).upstreamWouldOpen, true);
    assert.equal(m.windows.get('B').tabs.length, 3);
  }
});
test('focus loss is explicit uncertainty, not implicit Escape or positive release', () => {
  const { m, begin, events } = fixture(); const g = begin(); m.interrupt('A');
  m.finishVscode('A', g.token, outside);
  assert.equal(events.at(-1).classification, 'AMBIGUOUS_OUTSIDE_AFTER_FOCUS_LOSS');
});
test('observed Escape and participant lifecycle invalidate terminal replay', () => {
  const cleanup = fixture(), prepared = cleanup.begin();
  cleanup.m.end('A', prepared.token, 'escape');
  assert.equal(cleanup.events.at(-1).classification, 'CANCELLED_OR_AMBIGUOUS_NO_TRANSFER',
    'legacy cleanup reason is not a delivered Escape key');
  for (const reason of ['cancelled-main-escape', 'window-B-minimize-cancelled', 'display-change-cancelled']) {
    const { m, begin, events } = fixture(); const g = begin(); m.endAny(reason);
    assert.equal(m.finishVscode('A', g.token, outside), false);
    assert.equal(m.drop('B', g.token, 0), false);
    if (reason.includes('escape')) assert.equal(events.at(-1).classification, 'CANCELLED_ESCAPE_OBSERVED');
  }
  for (const id of ['A', 'B']) {
    const { m, begin } = fixture(); const g = begin(); m.close(id);
    assert.equal(m.finishVscode('A', g.token, outside), false);
  }
});
test('expired and stale/forged sender generations cannot contaminate a new drag', () => {
  const { m, begin, advance } = fixture(); const old = begin();
  advance(TTL); assert.equal(m.finishVscode('A', old.token, outside), false);
  const next = begin(); assert.notEqual(next.dragId, old.dragId);
  assert.equal(m.trackDrag('B', old.dragId, 'over'), false);
  assert.equal(m.finishVscode('B', next.token, outside), false);
  assert.equal(m.finishVscode('A', old.token, outside), false);
  assert.equal(m.active.dragId, next.dragId);
  m.reset(); const reset = begin(); assert.notEqual(reset.dragId, next.dragId);
  assert.equal(m.trackDrag('B', next.dragId, 'over'), false);
});

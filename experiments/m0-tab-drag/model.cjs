'use strict';

// Deliberately independent of Electron and every production module.
const TOKEN = /^[a-f0-9]{48}$/;
const MIME = 'application/x-youtube-comments-m0-tab';
const THRESHOLD = 6;
const TTL = 120_000;
const finite = n => Number.isFinite(n) && Math.abs(n) <= 1_000_000;
const exact = (o, keys) => o && Object.getPrototypeOf(o) === Object.prototype &&
  Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const token = s => typeof s === 'string' && TOKEN.test(s);
const point = o => exact(o, ['x', 'y']) && finite(o.x) && finite(o.y);
const rect = o => exact(o, ['x', 'y', 'width', 'height']) &&
  Object.values(o).every(finite) && o.x >= 0 && o.y >= 0 && o.width > 0 && o.height > 0;
const index = n => Number.isInteger(n) && n >= 0 && n <= 20;
const reasons = ['escape', 'pointercancel', 'lostpointercapture', 'buttons-lost',
  'pagehide', 'dragend-none', 'dragend-move', 'start-not-ready'];
const signals = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
  'gotpointercapture', 'lostpointercapture', 'keydown-escape', 'blur', 'focus',
  'visibility-hidden', 'visibility-visible', 'pagehide', 'dragstart', 'dragenter',
  'dragover', 'dragleave', 'drop', 'dragend', 'secondary-button'];

/** Exact bounded harness-only messages. No paths, URLs, channels or window IDs. */
function validRequest(r) {
  if (!r || typeof r !== 'object') return false;
  switch (r.kind) {
    case 'snapshot': case 'reset': case 'show-a': return exact(r, ['kind']);
    case 'mode': return exact(r, ['kind', 'mode']) && ['pointer', 'html'].includes(r.mode);
    case 'schedule': return exact(r, ['kind', 'action']) && ['close-self', 'close-peer', 'minimize-peer'].includes(r.action);
    case 'prepare': return exact(r, ['kind', 'tab']) && typeof r.tab === 'string' && /^[AB]-[1-3]$/.test(r.tab);
    case 'start': return exact(r, ['kind', 'token', 'distance']) && token(r.token) && finite(r.distance) && r.distance >= 0;
    case 'release': return exact(r, ['kind', 'token', 'button', 'buttons', 'trusted']) && token(r.token) &&
      Number.isInteger(r.button) && r.button >= 0 && r.button <= 4 && Number.isInteger(r.buttons) && r.buttons >= 0 && r.buttons <= 31 && typeof r.trusted === 'boolean';
    case 'drop': return exact(r, ['kind', 'token', 'slot', 'local', 'trusted']) && token(r.token) && index(r.slot) && point(r.local) && typeof r.trusted === 'boolean';
    case 'end': return exact(r, ['kind', 'token', 'reason']) && token(r.token) && reasons.includes(r.reason);
    case 'layout': return exact(r, ['kind', 'rect', 'mids', 'zoom', 'dpr']) && rect(r.rect) &&
      Array.isArray(r.mids) && r.mids.length <= 6 && r.mids.every(finite) &&
      r.mids.every((x, i) => x >= r.rect.x && x <= r.rect.x + r.rect.width && (!i || x > r.mids[i - 1])) &&
      Number.isFinite(r.zoom) && r.zoom >= 0.25 && r.zoom <= 5 && Number.isFinite(r.dpr) && r.dpr > 0 && r.dpr <= 10;
    case 'signal': return exact(r, ['kind', 'type', 'local', 'screen', 'button', 'buttons', 'trusted', 'detail']) &&
      signals.includes(r.type) && point(r.local) && point(r.screen) && Number.isInteger(r.button) && r.button >= -1 && r.button <= 4 &&
      Number.isInteger(r.buttons) && r.buttons >= 0 && r.buttons <= 31 && typeof r.trusted === 'boolean' &&
      ['mouse', 'pen', 'touch', 'unknown', 'none', 'move', 'copy', 'link', ''].includes(r.detail);
    default: return false;
  }
}

function authorized(event, record, expectedURL) {
  return !!record && !record.closed && event.sender === record.contents &&
    event.senderFrame === record.contents.mainFrame && event.senderFrame.url === expectedURL;
}
function contains(r, p) {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height;
}
/** Browser content bounds are DIP; DOM rectangles are CSS px at the measured zoom. */
function toDipRect(bounds, r, zoom) {
  return { x: bounds.x + r.x * zoom, y: bounds.y + r.y * zoom,
    width: r.width * zoom, height: r.height * zoom };
}
function slotAt(mids, localX) {
  const found = mids.findIndex(x => localX < x);
  return found < 0 ? mids.length : found;
}
/** Geometry is a candidate, NEVER evidence of OS z-order or a desktop destination. */
function candidatesAt(windows, cursor) {
  return windows.filter(w => w.visible && !w.minimized && w.layout &&
    contains(toDipRect(w.bounds, w.layout.rect, w.layout.zoom), cursor)).map(w => ({
      id: w.id, slot: slotAt(w.layout.mids, (cursor.x - w.bounds.x) / w.layout.zoom),
    }));
}

/** In-memory fake placement only. Ambiguous terminal evidence never moves a tab. */
class Experiment {
  constructor({ now = Date.now, issueToken, emit = () => {} }) {
    this.now = now; this.issueToken = issueToken; this.emit = emit;
    this.mode = 'pointer'; this.active = null; this.reset();
  }
  reset() {
    this.endAny('reset');
    this.windows = new Map(['A', 'B'].map(id => [id, { tabs: [1, 2, 3].map(n => `${id}-${n}`), revision: 0 }]));
  }
  snapshot() {
    return { mode: this.mode, windows: Object.fromEntries(this.windows),
      active: this.active && { source: this.active.source, tab: this.active.tab, stage: this.active.stage, interrupted: this.active.interrupted } };
  }
  endAny(outcome) {
    if (this.active) this.emit({ type: 'outcome', outcome, source: this.active.source, tab: this.active.tab });
    this.active = null;
  }
  current(value) {
    if (this.active && this.now() >= this.active.expires) this.endAny('expired-ambiguous');
    return this.active && this.active.token === value ? this.active : null;
  }
  prepare(source, tab) {
    this.current('');
    if (this.active?.stage === 'dragging' || !this.windows.get(source)?.tabs.includes(tab)) return null;
    this.endAny('superseded-preparation');
    const value = this.issueToken();
    if (!token(value)) throw new Error('Invalid token factory');
    this.active = { token: value, source, tab, mode: this.mode, stage: 'prepared',
      sourceRevision: this.windows.get(source).revision, expires: this.now() + TTL, interrupted: false };
    return value;
  }
  start(source, value, distance) {
    const a = this.current(value);
    if (!a || a.source !== source || a.stage !== 'prepared' || (a.mode === 'pointer' && distance < THRESHOLD)) return false;
    a.stage = 'dragging'; this.emit({ type: 'started', source, mode: a.mode }); return true;
  }
  interrupt(source) {
    if (this.active?.source === source && this.active.stage === 'dragging') {
      this.active.interrupted = true;
      this.emit({ type: 'interrupted', source });
    }
  }
  move(a, target, slot, outcome) {
    const from = this.windows.get(a.source), to = this.windows.get(target);
    if (!index(slot) || !from || !to || from.revision !== a.sourceRevision || !from.tabs.includes(a.tab) || slot > to.tabs.length) return false;
    const oldIndex = from.tabs.indexOf(a.tab);
    from.tabs.splice(oldIndex, 1);
    const adjusted = from === to && slot > oldIndex ? slot - 1 : slot;
    to.tabs.splice(adjusted, 0, a.tab);
    from.revision++; if (to !== from) to.revision++;
    this.emit({ type: 'outcome', outcome, source: a.source, target, tab: a.tab, slot: adjusted });
    this.active = null; return true;
  }
  release(source, value, evidence, candidates) {
    const a = this.current(value);
    if (!a || a.source !== source || a.mode !== 'pointer') return false;
    if (a.stage !== 'dragging') { this.endAny('click-without-drag'); return false; }
    if (evidence.button !== 0 || evidence.buttons !== 0) { this.endAny('nonprimary-release-cancelled'); return false; }
    if (a.interrupted) { this.endAny('release-after-focus-loss-ambiguous'); return false; }
    if (candidates.length !== 1) {
      this.endAny(candidates.length ? 'overlapping-strips-ambiguous' : 'outside-release-observed-destination-unknown');
      return false;
    }
    const c = candidates[0];
    return this.move(a, c.id, c.slot, c.id === source ? 'pointer-reorder' : 'pointer-geometric-transfer-unverified-occlusion');
  }
  drop(target, value, slot) {
    const a = this.current(value);
    if (!a || a.mode !== 'html' || a.stage !== 'dragging') return false;
    // A Chromium drop is a distinct target-delivered signal. Source blur alone
    // does not invalidate it; terminal Escape/capture cancellation does.
    return this.move(a, target, slot, 'html-target-drop');
  }
  end(source, value, reason) {
    const a = this.current(value);
    if (!a || a.source !== source) return false;
    this.endAny(reason.startsWith('dragend-') ? 'html-ended-without-app-drop-ambiguous' : `cancelled-${reason}`);
    return true;
  }
  close(id) {
    // Any participant disappearing invalidates the small two-window experiment.
    this.endAny(`window-${id}-closed-cancelled`); this.windows.delete(id);
  }
}

module.exports = { Experiment, MIME, THRESHOLD, TTL, validRequest, authorized,
  contains, toDipRect, slotAt, candidatesAt };

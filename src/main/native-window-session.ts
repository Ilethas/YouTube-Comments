import { screen } from 'electron';
import type { BrowserWindow } from 'electron';
import { isWindowGeometry, restoreWindowGeometry } from '../domain/window-geometry';
import type { WindowDisplay, WindowGeometry } from '../domain/window-geometry';
import type { ReaderService } from './reader-service';
import type { WindowCoordinator } from './window-coordinator';

interface NativeState {
  window: BrowserWindow; revision: number; geometry?: WindowGeometry;
  dirty: boolean; ready: boolean; shown: boolean; restoringFullscreen?: boolean; timer?: ReturnType<typeof setTimeout>;
}
/** Main-owned native adapter. Pending events are memory only behind M3; final
 * checkpoints run before snapshots/Close/Quit, never after offline replacement. */
export class NativeWindowSession {
  private readonly states = new Map<string, NativeState>();
  private restoring?: { ids: readonly string[]; focus: string; onReady?: (window: BrowserWindow) => void };
  private focused?: string;
  private focusDirty = false;
  private quitting = false;
  private readonly provisional = new Map<string, import('./persistence/window-session').WindowSession>();
  constructor(private readonly service: ReaderService, private readonly windows: WindowCoordinator,
    private readonly creationFailed: (restoring: boolean) => void = () => undefined) {
    windows.setIdentityProvider(() => service.mutateNativeSession(store => {
      const previous = store.read(), id = store.allocate();
      this.provisional.set(id, previous); return id;
    }));
    windows.setNativeHooks({
      geometry: id => this.placement(id), created: (window, id) => {
        this.bind(window, id);
        // Publish live membership only AFTER native construction + registration.
        if (this.provisional.has(id)) service.mutateNativeSession(store => store.quit(windows.nativeWindows().map(w => w.windowId), this.focused));
      },
      failed: (id, restoring, asynchronous) => {
        this.states.delete(id);
        if (!restoring) service.abandonNativeWindow(id, this.provisional.get(id));
        this.provisional.delete(id);
        if (asynchronous) this.creationFailed(restoring);
      },
      beforeClose: id => {
        this.flush(true);
        if (!this.quitting) service.mutateNativeSession(store => store.closed(id), true);
      },
      cancelledClose: id => {
        if (!service.restarting && !this.quitting) service.mutateNativeSession(store => {
          const state = store.read();
          if (!state.windowIds.includes(id)) store.quit([...state.windowIds, id], this.focused, state.revision);
        }, true);
      },
      ready: (_window, id) => this.ready(id),
    });
    service.setNativeCheckpoint(() => this.flush(true));
    screen.on('display-added', () => this.reconcileDisplays());
    screen.on('display-removed', () => this.reconcileDisplays());
    screen.on('display-metrics-changed', () => this.reconcileDisplays());
  }
  private displays(): WindowDisplay[] {
    return screen.getAllDisplays().map(d => ({ id: String(d.id), workArea: d.workArea, scaleFactor: d.scaleFactor }));
  }
  private placement(id: string) {
    return restoreWindowGeometry(this.service.readNativeGeometry(id).geometry, this.displays(), String(screen.getPrimaryDisplay().id));
  }
  restore(onReady?: (window: BrowserWindow) => void): readonly BrowserWindow[] {
    const session = this.service.readNativeSession();
    this.restoring = { ids: session.windowIds, focus: session.lastFocusedId, onReady };
    this.focused = session.lastFocusedId;
    return session.windowIds.map(id => this.windows.createReaderWindow(id));
  }
  private bind(window: BrowserWindow, id: string): void {
    const saved = this.service.readNativeGeometry(id);
    const state: NativeState = { window, revision: saved.revision, geometry: saved.geometry ?? undefined, dirty: false, ready: false, shown: false };
    this.states.set(id, state);
    const change = () => { this.capture(state); this.schedule(state); };
    window.on('move', change); window.on('resize', change); window.on('maximize', change); window.on('unmaximize', change);
    window.on('enter-full-screen', () => { state.restoringFullscreen = false; change(); }); window.on('leave-full-screen', change); window.on('restore', change);
    window.on('focus', () => {
      if (!state.ready || this.restoring || this.quitting || this.service.restarting) return;
      this.focused = id; this.focusDirty = true; this.schedule(state);
    });
    window.once('closed', () => { clearTimeout(state.timer); this.states.delete(id); });
  }
  private capture(state: NativeState): void {
    if (!state.shown || this.service.restarting || this.quitting || state.window.isDestroyed()) return;
    const normal = state.window.getNormalBounds(), d = screen.getDisplayMatching(normal);
    // Electron reports isMaximized=false while a maximized Windows reader is
    // minimized. Preserve its last observed expanded intent, never the hidden state.
    const minimized = state.window.isMinimized(), previous = state.geometry;
    const geometry: WindowGeometry = { version: 1, normal,
      maximized: minimized && previous ? previous.maximized : state.window.isMaximized(),
      fullscreen: state.restoringFullscreen || (minimized && previous ? previous.fullscreen : state.window.isFullScreen()),
      display: { id: String(d.id), workArea: d.workArea, scaleFactor: d.scaleFactor } };
    if (!isWindowGeometry(geometry)) return;
    if (JSON.stringify(geometry) !== JSON.stringify(state.geometry)) { state.geometry = geometry; state.dirty = true; }
  }
  private schedule(state: NativeState): void {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      if (this.service.nativeWritesAllowed()) {
        try { this.flush(); } catch (error) { console.error('Native session save failed', error); }
      }
    }, 250);
  }
  flush(checkpoint = false): void {
    if (this.service.restarting || this.quitting) return;
    for (const [id, state] of this.states) {
      clearTimeout(state.timer); state.timer = undefined;
      this.capture(state);
      if (state.dirty && state.geometry) {
        const geometry = state.geometry;
        state.revision = this.service.mutateNativeSession(store => store.saveGeometry(id, geometry, state.revision), checkpoint);
        state.dirty = false;
      }
    }
    if (this.focusDirty && this.focused) {
      const focused = this.focused;
      if (this.service.readNativeSession().windowIds.includes(focused)) this.service.mutateNativeSession(store => store.focused(focused), checkpoint);
      this.focusDirty = false;
    }
  }
  /** Called after the M3 Quit drain, BEFORE shutdown or native destruction. */
  prepareQuit(): void {
    this.flush(true);
    this.service.mutateNativeSession(store => store.quit(this.windows.nativeWindows().map(w => w.windowId), this.focused), true);
    this.stop();
  }
  stop(): void { this.quitting = true; for (const state of this.states.values()) clearTimeout(state.timer); }
  private show(state: NativeState, id: string): void {
    const saved = this.placement(id);
    // Apply native state without a sequence of focus steals during startup.
    state.window.setFocusable(false);
    state.window.showInactive();
    if (saved.maximized) state.window.maximize();
    if (saved.fullscreen) { state.restoringFullscreen = true; state.window.setFullScreen(true); }
    state.window.setFocusable(true);
    state.shown = true;
    this.capture(state); this.schedule(state);
  }
  private ready(id: string): void {
    const state = this.states.get(id); if (!state || state.ready || this.service.restarting) return;
    state.ready = true;
    this.provisional.delete(id);
    if (this.restoring) {
      if (!this.restoring.ids.every(value => this.states.get(value)?.ready)) return;
      const ready = [...this.states].filter(([, value]) => value.ready);
      // A public New Window can finish while restored shells are still loading
      // (notably via the macOS application menu). Include it in the show batch.
      const requested = ready.filter(([value]) => !this.restoring?.ids.includes(value)).at(-1);
      const focus = requested?.[0] ?? this.restoring.focus;
      for (const [value, next] of ready) if (!next.shown) this.show(next, value);
      const onReady = this.restoring.onReady;
      this.restoring = undefined;
      const target = this.states.get(focus)?.window;
      if (target) { target.focus(); onReady?.(target); }
    } else { this.show(state, id); state.window.focus(); }
  }
  private reconcileDisplays(): void {
    if (this.service.restarting || this.quitting) return;
    for (const state of this.states.values()) {
      if (!state.ready || state.window.isDestroyed()) continue;
      this.capture(state);
      const safe = restoreWindowGeometry(state.geometry, this.displays(), String(screen.getPrimaryDisplay().id));
      state.window.setMinimumSize(safe.minWidth, safe.minHeight);
      if (!state.window.isMaximized() && !state.window.isFullScreen()
        && JSON.stringify(state.window.getNormalBounds()) !== JSON.stringify(safe.normal)) state.window.setBounds(safe.normal, false);
      this.capture(state); this.schedule(state);
    }
  }
}

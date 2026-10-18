import { sharedCommitChannel } from '../shared/reader-sync';
import type { SharedCommit } from '../shared/reader-sync';
import type { BrowserWindow, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { createApplicationWindow } from './application-window';
import type { ReaderCallerContext } from './caller-context';
import { acquisitionProgressChannel } from '../shared/acquisition';
import type { AcquisitionNotification } from '../shared/acquisition';
import { profileChannels } from '../shared/profile-operation';
import type { ProfileEvent } from '../shared/profile-operation';

interface WindowRecord {
  readonly windowId: string;
  readonly window: BrowserWindow;
  frame?: WebFrameMain;
  caller?: ReaderCallerContext;
  closing: boolean;
  finishing?: boolean;
}

/** Main-owned runtime identities, independent of Electron IDs and persistence.
 * Registration alone grants no authority: a trusted top-level document commit
 * issues a new lease. Removing a window never shuts down the shared service. */
export class WindowCoordinator {
  private readonly records = new Map<WebContents, WindowRecord>();
  private lifecycle?: { close: (caller: ReaderCallerContext) => void; reload: (caller: ReaderCallerContext) => void; lost: (caller: ReaderCallerContext) => void;
    restored: (caller: ReaderCallerContext) => void; canRecover: () => boolean };
  setLifecycle(value: NonNullable<WindowCoordinator['lifecycle']>): void { this.lifecycle = value; }

  constructor(private readonly documentUrl: string, private readonly preloadPath: string) {}

  createReaderWindow(): BrowserWindow {
    const window = createApplicationWindow(this.preloadPath);
    this.register(window);
    void window.loadURL(this.documentUrl);
    return window;
  }

  /** Main-only registration, before load. Replacing a registration invalidates
   * every prior captured context, even when the runtime window is reused. */
  register(window: BrowserWindow): void {
    const contents = window.webContents;
    this.unregister(window);
    const record: WindowRecord = { windowId: randomUUID(), window, closing: false };
    this.records.set(contents, record);
    const revoke = () => {
      const previous = record.caller; record.caller = undefined; record.frame = undefined;
      if (previous) this.lifecycle?.lost(previous);
    };
    const start = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (event.isMainFrame) revoke();
    };
    const commit = (_event: Electron.Event, url: string, _code: number, _status: string, isMainFrame: boolean) => {
      if (!isMainFrame) return;
      revoke();
      if (this.records.get(contents) !== record || record.closing || window.isDestroyed() || contents.isDestroyed()
        || url !== this.documentUrl || contents.mainFrame.url !== this.documentUrl) return;
      record.frame = contents.mainFrame;
      const caller: ReaderCallerContext = Object.freeze({ windowId: record.windowId, rendererLease: randomUUID(),
        isCurrent: () => this.live(record, caller) });
      record.caller = caller;
    };
    const inPage = (_event: Electron.Event, _url: string, isMainFrame: boolean) => { if (isMainFrame) revoke(); };
    const close = (event: Electron.Event) => {
      if (this.lifecycle && !record.finishing && record.caller && this.live(record, record.caller)) {
        event.preventDefault(); this.lifecycle.close(record.caller); return;
      }
      if (this.lifecycle) {
        record.closing = true;
        // A later native listener may still cancel this final close. Retain the
        // document capability until destruction, and restore usability on cancel.
        queueMicrotask(() => {
          if (event.defaultPrevented && !window.isDestroyed() && this.records.get(contents) === record) {
            record.closing = false; record.finishing = false;
            if (record.caller && this.live(record, record.caller)) this.lifecycle?.restored(record.caller);
          }
        });
        return;
      }
      record.closing = true; revoke();
    };
    const keyboard = (event: Electron.Event, input: Electron.Input) => {
      if (input.type === 'keyDown' && (input.key === 'F5' || (input.control || input.meta) && input.key.toLowerCase() === 'r') && record.caller && this.lifecycle) {
        event.preventDefault(); this.lifecycle.reload(record.caller);
      }
    };
    const remove = () => {
      revoke();
      if (this.records.get(contents) === record) this.records.delete(contents);
      contents.removeListener('did-start-navigation', start);
      contents.removeListener('did-frame-navigate', commit);
      contents.removeListener('did-navigate-in-page', inPage);
      contents.removeListener('render-process-gone', revoke);
      contents.removeListener('destroyed', remove);
      contents.removeListener('before-input-event', keyboard);
      window.removeListener('close', close);
      window.removeListener('closed', remove);
      this.cleanup.delete(record);
    };
    this.cleanup.set(record, remove);
    contents.on('did-start-navigation', start);
    contents.on('did-frame-navigate', commit);
    contents.on('did-navigate-in-page', inPage);
    contents.on('render-process-gone', revoke);
    contents.on('destroyed', remove);
    contents.on('before-input-event', keyboard);
    window.on('close', close);
    window.on('closed', remove);
  }

  private readonly cleanup = new Map<WindowRecord, () => void>();

  unregister(window: BrowserWindow): void {
    const record = this.records.get(window.webContents);
    if (record?.window === window) this.cleanup.get(record)?.();
  }

  private live(record: WindowRecord, caller: ReaderCallerContext): boolean {
    try {
      const contents = record.window.webContents, frame = record.frame;
      return this.records.get(contents) === record && record.caller === caller && !record.closing
        && !record.window.isDestroyed() && !contents.isDestroyed() && !!frame && !frame.isDestroyed() && !frame.detached
        && contents.mainFrame === frame && frame.url === this.documentUrl;
    } catch { return false; } // Electron frame access can throw during destruction.
  }

  /** Authenticate every invocation against main's current document incarnation.
   * A right URL in an unregistered WebContents or child frame grants nothing. */
  resolveCaller(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): ReaderCallerContext | undefined {
    try {
      const record = this.records.get(event.sender), caller = record?.caller;
      return record && caller && this.live(record, caller) && event.senderFrame === record.frame ? caller : undefined;
    } catch { return undefined; }
  }

  /** Resolve the captured origin only; never substitute a focused/surviving peer. */
  originWindow(caller?: ReaderCallerContext): BrowserWindow | undefined {
    if (!caller) return undefined;
    for (const record of this.records.values()) {
      if (record.caller === caller && this.live(record, caller)) return record.window;
    }
    return undefined;
  }
  participants(): readonly ReaderCallerContext[] {
    return [...this.records.values()].flatMap(record => record.caller && this.live(record, record.caller) ? [record.caller] : []);
  }
  sendProfileEvent(caller: ReaderCallerContext, event: ProfileEvent): void {
    try { this.originWindow(caller)?.webContents.send(profileChannels.event, event); } catch { /* Destruction may race a cancelled-close release. */ }
  }
  finishClose(caller: ReaderCallerContext): void {
    const window = this.originWindow(caller), record = window && this.records.get(window.webContents);
    if (!record) return;
    record.finishing = true; window?.close();
  }
  finishReload(caller: ReaderCallerContext): void { this.originWindow(caller)?.webContents.reload(); }
  requestReload(window: BrowserWindow): void {
    const record = this.records.get(window.webContents), caller = record?.caller;
    if (caller && caller.isCurrent()) this.lifecycle?.reload(caller);
    else if (record && !record.closing && !window.isDestroyed() && !window.webContents.isDestroyed() && this.lifecycle?.canRecover()) {
      // A crashed/revoked document has no recoverable memory to drain. Main's
      // menu can reconnect it from committed state, except behind a profile barrier.
      window.webContents.reload();
    }
  }
  /** Terminal shutdown/restart has already drained or fenced every renderer. */
  finishAll(): void { for (const record of this.records.values()) record.finishing = true; }

  /** Send only to current authenticated documents. A dead/throwing recipient
   * cannot interrupt delivery to peers or a committed repository mutation. */
  private fanout(channel: string, value: SharedCommit | AcquisitionNotification): void {
    for (const record of this.records.values()) {
      try {
        if (record.caller && this.live(record, record.caller)) record.window.webContents.send(channel, value);
      } catch { /* Destruction may race the final send. */ }
    }
  }
  sendSharedCommit(value: SharedCommit): void { this.fanout(sharedCommitChannel, value); }
  sendAcquisitionProgress(value: AcquisitionNotification): void { this.fanout(acquisitionProgressChannel, value); }

  get size(): number { return this.records.size; }
}

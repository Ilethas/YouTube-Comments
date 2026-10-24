import { downloadsChangedChannel } from '../shared/downloads';
import type { DownloadsSnapshot } from '../shared/downloads';
import { transferChannels } from '../shared/tab-transfer';
import type { TransferEvent } from '../shared/tab-transfer';
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
  shellReady?: boolean;
  provisional?: boolean;
  finishing?: boolean;
}
interface NativeWindowHooks {
  available?: (id: string) => boolean;
  geometry: (id: string) => Parameters<typeof createApplicationWindow>[1];
  created: (window: BrowserWindow, id: string, provisional?: boolean) => void;
  failed: (id: string, restoring: boolean, asynchronous?: boolean) => void;
  beforeClose: (id: string) => void;
  cancelledClose: (id: string) => void;
  ready: (window: BrowserWindow, id: string) => void;
}

/** Main-owned persistent window identities, independent of Electron native IDs.
 * Registration alone grants no authority: a trusted top-level document commit
 * issues a new lease. Removing a window never shuts down the shared service. */
export class WindowCoordinator {
  private readonly records = new Map<WebContents, WindowRecord>();
  private cancelDrag?: (caller: ReaderCallerContext) => boolean;
  setDragCancellation(cancel: (caller: ReaderCallerContext) => boolean): void { this.cancelDrag = cancel; }
  private lifecycle?: { close: (caller: ReaderCallerContext) => void; reload: (caller: ReaderCallerContext) => void; lost: (caller: ReaderCallerContext) => void;
    restored: (caller: ReaderCallerContext) => void; canRecover: () => boolean; closeUnavailable?: (window: BrowserWindow) => void };
  setLifecycle(value: NonNullable<WindowCoordinator['lifecycle']>): void { this.lifecycle = value; }

  constructor(private readonly documentUrl: string, private readonly preloadPath: string) {}

  private identityProvider: () => string = randomUUID;
  setIdentityProvider(provider: () => string): void { this.identityProvider = provider; }
  private native?: NativeWindowHooks;
  private readonly loading = new Set<Promise<void>>();
  setNativeHooks(hooks: NativeWindowHooks): void { this.native = hooks; }

  createReaderWindow(existingId?: string, provisional = false, geometry?: Parameters<typeof createApplicationWindow>[1]): BrowserWindow {
    const windowId = existingId ?? this.identityProvider();
    let window: BrowserWindow | undefined;
    try {
      window = createApplicationWindow(this.preloadPath, geometry ?? this.native?.geometry(windowId));
      this.register(window, windowId);
      const record = this.records.get(window.webContents); if (record) record.provisional = provisional;
      this.native?.created(window, windowId, provisional);
      const loading = window.loadURL(this.documentUrl);
      const task = loading?.catch(error => {
        if (window) { this.unregister(window); window.destroy(); }
        this.native?.failed(windowId, !!existingId, true);
        console.error('Reader document failed to load', error);
      });
      if (task) {
        this.loading.add(task);
        void task.then(() => this.loading.delete(task), error => { this.loading.delete(task); console.error('Reader creation compensation failed', error); });
      }
      return window;
    } catch (error) {
      if (window) { this.unregister(window); window.destroy(); }
      this.native?.failed(windowId, !!existingId);
      throw error;
    }
  }
  /** Quit captures ALL remaining natives, including a newly requested reader.
   * First settle document construction so failed provisional windows compensate
   * before shutdown. A hung load fails Quit rather than silently discarding it. */
  async settleCreation(deadlineMs = 15000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.allSettled([...this.loading]), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Reader creation unavailable')), deadlineMs);
      })]);
    } finally { clearTimeout(timer); }
  }

  /** Main-only registration, before load. Replacing a registration invalidates
   * every prior captured context, even when the runtime window is reused. */
  register(window: BrowserWindow, windowId?: string): void {
    const contents = window.webContents;
    windowId ??= this.records.get(contents)?.windowId ?? this.identityProvider();
    this.unregister(window);
    if ([...this.records.values()].some(record => record.windowId === windowId)) throw new Error('Persistent window already registered');
    const record: WindowRecord = { windowId, window, closing: false };
    this.records.set(contents, record);
    const revoke = () => {
      const previous = record.caller; record.caller = undefined; record.frame = undefined; record.shellReady = false;
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
      if (this.lifecycle && !record.finishing && (!record.caller || !this.live(record, record.caller)) && this.lifecycle.closeUnavailable) {
        event.preventDefault(); this.lifecycle.closeUnavailable(window); return;
      }
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
            this.native?.cancelledClose(record.windowId);
            if (record.caller && this.live(record, record.caller)) this.lifecycle?.restored(record.caller);
          }
        });
        return;
      }
      record.closing = true; revoke();
    };
    const keyboard = (event: Electron.Event, input: Electron.Input) => {
      // Native menu accelerators own window commands, once. IME composition
      // must not accidentally turn a composing chord into window destruction.
      if (input.isComposing && (input.control || input.meta) && !input.alt
        && (input.key.toLowerCase() === 'n' && !input.shift || ['w', 'q'].includes(input.key.toLowerCase()) && input.shift || input.meta && input.key.toLowerCase() === 'q')) {
        event.preventDefault(); return;
      }
      if (input.type === 'keyDown' && input.key === 'Escape' && record.caller && this.live(record, record.caller) && this.cancelDrag?.(record.caller)) event.preventDefault();
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
    this.native?.beforeClose(record.windowId);
    record.finishing = true; window?.close();
  }
  finishUnavailableClose(window: BrowserWindow): void {
    const record = this.records.get(window.webContents); if (!record) return;
    this.native?.beforeClose(record.windowId); record.finishing = true; window.close();
  }
  ready(caller: ReaderCallerContext): void {
    const window = this.originWindow(caller), record = window && this.records.get(window.webContents);
    if (record) record.shellReady = true;
    if (window) this.native?.ready(window, caller.windowId);
  }
  transferParticipants(includeProvisional = false): readonly ReaderCallerContext[] {
    return [...this.records.values()].flatMap(r => r.shellReady && (r.provisional ? includeProvisional : this.native?.available?.(r.windowId) !== false)
      && r.caller && this.live(r, r.caller) ? [r.caller] : []);
  }
  sendTransfer(caller: ReaderCallerContext, event: TransferEvent): void {
    const window = this.originWindow(caller); if (!window) throw new Error('Destination unavailable');
    window.webContents.send(transferChannels.event, event);
  }
  promoteTransfer(caller: ReaderCallerContext): void {
    const window = this.originWindow(caller), record = window && this.records.get(window.webContents);
    if (!window || !record) return;
    const wasProvisional = record.provisional;
    record.provisional = false; this.native?.ready(window, caller.windowId);
    if (window.isMinimized()) window.restore();
    if (!wasProvisional || !this.native) window.focus();
  }
  isTransferProvisional(id: string): boolean { return [...this.records.values()].some(r => r.windowId === id && r.provisional); }
  nativeWindows(): readonly { window: BrowserWindow; windowId: string }[] { return [...this.records.values()].map(r => ({ window: r.window, windowId: r.windowId })); }
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
  private fanout(channel: string, value: SharedCommit | AcquisitionNotification | DownloadsSnapshot): void {
    for (const record of this.records.values()) {
      try {
        if (record.caller && this.live(record, record.caller)) record.window.webContents.send(channel, value);
      } catch { /* Destruction may race the final send. */ }
    }
  }
  sendDownloads(value: DownloadsSnapshot): void { this.fanout(downloadsChangedChannel, value); }
  sendSharedCommit(value: SharedCommit): void { this.fanout(sharedCommitChannel, value); }
  sendAcquisitionProgress(value: AcquisitionNotification): void { this.fanout(acquisitionProgressChannel, value); }

  get size(): number { return this.records.size; }
}

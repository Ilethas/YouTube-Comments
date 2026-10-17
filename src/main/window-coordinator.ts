import type { BrowserWindow, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { createApplicationWindow } from './application-window';
import type { ReaderCallerContext } from './caller-context';
import { acquisitionProgressChannel } from '../shared/acquisition';
import type { AcquisitionNotification } from '../shared/acquisition';

interface WindowRecord {
  readonly windowId: string;
  readonly window: BrowserWindow;
  frame?: WebFrameMain;
  caller?: ReaderCallerContext;
  closing: boolean;
}

/** Main-owned runtime identities, independent of Electron IDs and persistence.
 * Registration alone grants no authority: a trusted top-level document commit
 * issues a new lease. Removing a window never shuts down the shared service. */
export class WindowCoordinator {
  private readonly records = new Map<WebContents, WindowRecord>();

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
    const revoke = () => { record.caller = undefined; record.frame = undefined; };
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
    const close = () => { record.closing = true; revoke(); };
    const remove = () => {
      revoke();
      if (this.records.get(contents) === record) this.records.delete(contents);
      contents.removeListener('did-start-navigation', start);
      contents.removeListener('did-frame-navigate', commit);
      contents.removeListener('did-navigate-in-page', inPage);
      contents.removeListener('render-process-gone', revoke);
      contents.removeListener('destroyed', remove);
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

  /** Existing single-window progress delivery; cross-window events belong to M2. */
  sendAcquisitionProgress(value: AcquisitionNotification): void {
    for (const record of this.records.values()) {
      if (record.caller && this.live(record, record.caller)) {
        record.window.webContents.send(acquisitionProgressChannel, value);
        return;
      }
    }
  }

  get size(): number { return this.records.size; }
}

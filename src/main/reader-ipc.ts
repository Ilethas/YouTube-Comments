import { TabTransferCoordinator } from './tab-transfer-coordinator';
import { transferChannels } from '../shared/tab-transfer';
import { ipcMain } from 'electron';
import type { WindowCoordinator } from './window-coordinator';
import { readerChannels } from '../shared/reader-api';
import type { ReaderOperation } from '../shared/reader-api';
import type { ReaderService } from './reader-service';
import { ProfileOperationCoordinator } from './profile-operation-coordinator';
import { profileChannels } from '../shared/profile-operation';

/** Register once for the application, independently of window creation. Every
 * invocation requires a registered top-level exact document and current lease. */
export function registerReaderIpc(service: ReaderService, windows: WindowCoordinator): ProfileOperationCoordinator | undefined {
  if (service.claimWindowIdentity) windows.setIdentityProvider(() => service.claimWindowIdentity(windows.size > 0));
  service.onSharedCommit?.(commit => windows.sendSharedCommit(commit));
  ipcMain.handle('reader:window-close', (event, ...args: unknown[]) => {
    const caller = windows.resolveCaller(event);
    if (!caller) return { ok: false, error: { code: 'FORBIDDEN' } };
    if (args.length) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    if (service.restarting) return { ok: false, error: { code: 'DATA_BUSY' } };
    windows.originWindow(caller)?.close(); return { ok: true, value: null };
  });
  ipcMain.handle('reader:window-ready', (event, ...args: unknown[]) => {
    const caller = windows.resolveCaller(event);
    if (!caller) return { ok: false, error: { code: 'FORBIDDEN' } };
    if (args.length) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    if (service.restarting) return { ok: false, error: { code: 'DATA_BUSY' } };
    windows.ready(caller); return { ok: true, value: null };
  });
  for (const operation of Object.keys(readerChannels) as ReaderOperation[]) {
    ipcMain.handle(readerChannels[operation], (event, ...args: unknown[]) => {
      const caller = windows.resolveCaller(event);
      if (!caller) return { ok: false, error: { code: 'FORBIDDEN' } };
      return service.dispatch(operation, args, caller);
    });
  }
  if (!service.attachLifecycle) return;
  const lifecycle = new ProfileOperationCoordinator(() => windows.participants(), (caller, event) => windows.sendProfileEvent(caller, event),
    () => service.profileStamp(), (caller, command) => service.drainCheckpoint(caller, command), 15000, (command, caller) => service.profileCheckpointAllowed(command, caller));
  service.attachLifecycle(lifecycle);
  let transfers: TabTransferCoordinator | undefined;
  const transferCoordinator = () => {
    if (transfers) return transfers;
    if (!service.transferRepository || service.storageFailure) return;
    transfers = new TabTransferCoordinator(service.transferRepository(), {
      eligible: provisional => windows.transferParticipants(provisional).filter(caller => service.transfersAllowed(caller)),
      send: (caller, event) => windows.sendTransfer(caller, event),
      focus: caller => windows.promoteTransfer(caller),
      exists: id => windows.nativeWindows().some(value => value.windowId === id && !value.window.isDestroyed()),
      create: () => {
        const window = windows.createReaderWindow(undefined, true);
        const id = windows.nativeWindows().find(value => value.window === window)?.windowId;
        if (!id) throw new Error('Window registration failed');
        return { windowId: id, dispose: () => {
          // Main-only destruction of an uncommitted hidden window bypasses Close,
          // never the last real reader, and never enrolls restore membership.
          service.abandonNativeWindow(id); windows.unregister(window); if (!window.isDestroyed()) window.destroy();
        } };
      },
    }, () => service.transfersAllowed());
    service.attachTransfers(transfers);
    return transfers;
  };
  lifecycle.onPreparing = () => transfers?.cancelAll();
  for (const action of ['destinations', 'begin', 'move', 'ready', 'cancel', 'adopted'] as const) {
      ipcMain.handle(transferChannels[action], (event, ...args: unknown[]) => {
        const caller = windows.resolveCaller(event);
        if (!caller) return { ok: false, error: { code: 'FORBIDDEN' } };
        if (service.restarting) return { ok: false, error: { code: 'DATA_BUSY' } };
        const transfers = transferCoordinator();
        if (!transfers) return { ok: false, error: { code: service.storageFailure ?? 'STORAGE_UNAVAILABLE' } };
        if (action === 'begin' && args.length === 1) return transfers.begin(caller, args[0]);
        if (action === 'adopted' && args.length === 1) return transfers.adopted(caller, args[0]);
        if (action === 'destinations' && !args.length) return { ok: true, value: transfers.destinations(caller) };
        if (action === 'move' && args.length === 1) return transfers.move(caller, args[0]);
        if (action === 'ready' && args.length === 1) return transfers.ready(caller, args[0]);
        if (action === 'cancel' && args.length === 1) return transfers.cancel(caller, args[0]);
        return { ok: false, error: { code: 'INVALID_REQUEST' } };
      });
    }
  for (const action of ['current', 'stage', 'submit', 'plan', 'command', 'ack', 'refuse', 'resume'] as const) {
    ipcMain.handle(profileChannels[action], (event, ...args: unknown[]) => {
      const caller = windows.resolveCaller(event);
      if (!caller) return { ok: false, error: { code: 'FORBIDDEN' } };
      if (action === 'current' && !args.length) return { ok: true, value: lifecycle.current() };
      if (action === 'stage' && args.length === 1) return lifecycle.stage(caller, args[0]);
      if (action === 'submit' && args.length === 1) return lifecycle.submit(caller, args[0]);
      if (action === 'plan' && args.length === 2) return lifecycle.plan(caller, args[0], args[1]);
      if (action === 'command' && args.length === 3) return lifecycle.command(caller, args[0], args[1], args[2]);
      if (action === 'ack' && args.length === 2) return lifecycle.ack(caller, args[0], args[1]);
      if (action === 'refuse' && args.length === 1) return lifecycle.refuse(caller, args[0]);
      if (action === 'resume' && args.length === 1) return lifecycle.resume(caller, args[0]);
      return { ok: false, error: { code: 'INVALID_REQUEST' } };
    });
  }
  const pending = new Map<string, Promise<void>>();
  const intentional = (caller: import('./caller-context').ReaderCallerContext | undefined, kind: 'close' | 'reload', unavailable?: import('electron').BrowserWindow) => {
    const key = caller?.windowId ?? windows.nativeWindows().find(w => w.window === unavailable)?.windowId;
    if (!key || pending.has(key) || service.restarting) return;
    const task = lifecycle.scheduleIntentional(async () => {
      let ownedId: string | undefined;
      try {
        if (lifecycle.busy) lifecycle.cancelPreparation();
        await service.settleDataOperation();
        if (caller && !caller.isCurrent() || unavailable?.isDestroyed() || service.restarting) return;
        await lifecycle.released();
        const previous = lifecycle.current()?.operationId, drained = lifecycle.begin(kind);
        if (lifecycle.current()?.operationId !== previous) ownedId = lifecycle.current()?.operationId;
        await drained; service.flushNativeCheckpoint(); lifecycle.executePhase();
        // Finish once; the initial native close left the context fully authorized.
        lifecycle.accept();
        if (unavailable) windows.finishUnavailableClose(unavailable);
        else if (caller) { if (kind === 'close') windows.finishClose(caller); else windows.finishReload(caller); }
      } catch { if (ownedId) lifecycle.release(true, ownedId); /* Keep failed native saves dirty and the window usable. */ }
      finally { if (ownedId) lifecycle.release(false, ownedId); }
    }).finally(() => { pending.delete(key); });
    pending.set(key, task);
  };
  windows.setLifecycle({ close: caller => intentional(caller, 'close'), reload: caller => intentional(caller, 'reload'), lost: caller => lifecycle.lost(caller),
    restored: caller => { const event = lifecycle.current(); if (event) windows.sendProfileEvent(caller, event); },
    canRecover: () => !service.restarting && !lifecycle.busy,
    closeUnavailable: window => intentional(undefined, 'close', window) });
  return lifecycle;
}

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
  service.onSharedCommit?.(commit => windows.sendSharedCommit(commit));
  for (const operation of Object.keys(readerChannels) as ReaderOperation[]) {
    ipcMain.handle(readerChannels[operation], (event, ...args: unknown[]) => {
      const caller = windows.resolveCaller(event);
      if (!caller) return { ok: false, error: { code: 'FORBIDDEN' } };
      return service.dispatch(operation, args, caller);
    });
  }
  if (!service.attachLifecycle) return;
  const lifecycle = new ProfileOperationCoordinator(() => windows.participants(), (caller, event) => windows.sendProfileEvent(caller, event),
    () => service.profileStamp(), (caller, command) => service.drainCheckpoint(caller, command), 15000, command => service.profileCheckpointAllowed(command));
  service.attachLifecycle(lifecycle);
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
  const intentional = (caller: import('./caller-context').ReaderCallerContext, kind: 'close' | 'reload') => {
    if (pending.has(caller.windowId) || service.restarting) return;
    const task = lifecycle.scheduleIntentional(async () => {
      let ownedId: string | undefined;
      try {
        if (lifecycle.busy) lifecycle.cancelPreparation();
        await service.settleDataOperation();
        if (!caller.isCurrent() || service.restarting) return;
        await lifecycle.released();
        const previous = lifecycle.current()?.operationId, drained = lifecycle.begin(kind);
        if (lifecycle.current()?.operationId !== previous) ownedId = lifecycle.current()?.operationId;
        await drained; lifecycle.executePhase();
        // Finish once; the initial native close left the context fully authorized.
        lifecycle.accept();
        if (kind === 'close') windows.finishClose(caller); else windows.finishReload(caller);
      } catch { /* Failed saves leave the window open with the release error UI. */ }
      finally { if (ownedId) lifecycle.release(false, ownedId); }
    }).finally(() => { pending.delete(caller.windowId); });
    pending.set(caller.windowId, task);
  };
  windows.setLifecycle({ close: caller => intentional(caller, 'close'), reload: caller => intentional(caller, 'reload'), lost: caller => lifecycle.lost(caller),
    restored: caller => { const event = lifecycle.current(); if (event) windows.sendProfileEvent(caller, event); },
    canRecover: () => !service.restarting && !lifecycle.busy });
  return lifecycle;
}

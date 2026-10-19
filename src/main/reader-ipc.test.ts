import { WindowCoordinator } from './window-coordinator';
import { windowFixture } from './testing/window-fixture';
import { ReaderService as ActualReaderService } from './reader-service';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { ReaderService } from './reader-service';
import { registerReaderIpc } from './reader-ipc';
import { readerChannels } from '../shared/reader-api';
import { profileChannels } from '../shared/profile-operation';
import { transferChannels } from '../shared/tab-transfer';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => { if (handlers.has(channel)) throw new Error('Duplicate handler'); handlers.set(channel, handler); } } }));
beforeEach(() => handlers.clear());

it('application intents are payload-free, current-document authenticated, ready-only and reuse creation/quit callbacks', async () => {
  const windows = new WindowCoordinator('file:///app/index.html', ''), fixture = windowFixture(); windows.register(fixture.window); fixture.commit();
  let allowed = true;
  const service = { dispatch: vi.fn(), nativeWritesAllowed: () => allowed, restarting: false } as unknown as ReaderService;
  const application = { newWindow: vi.fn(), quitApplication: vi.fn() }; registerReaderIpc(service, windows, application);
  const newWindow = handlers.get('reader:window-new'), quit = handlers.get('reader:application-quit');
  expect(newWindow?.(fixture.event())).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
  const caller = windows.resolveCaller(fixture.event()); if (!caller) throw Error('caller'); windows.ready(caller);
  for (const handler of [newWindow, quit]) {
    expect(handler?.(fixture.event(), {})).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(handler?.({ sender: {}, senderFrame: fixture.contents.mainFrame } as IpcMainInvokeEvent)).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(handler?.({ sender: fixture.contents, senderFrame: { url: 'file:///app/index.html' } } as IpcMainInvokeEvent)).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(handler?.({ sender: fixture.contents, senderFrame: null } as IpcMainInvokeEvent)).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(handler?.(fixture.event())).toEqual({ ok: true, value: null });
  }
  expect(application.newWindow).toHaveBeenCalledOnce(); expect(application.quitApplication).toHaveBeenCalledOnce();
  allowed = false; expect(newWindow?.(fixture.event())).toEqual({ ok: false, error: { code: 'DATA_BUSY' } });
  const old = fixture.event(); fixture.reload();
  expect(quit?.(old)).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
});

it('readiness can reveal only its authenticated origin and rejects every payload or stale incarnation', () => {
  const windows = new WindowCoordinator('file:///app/index.html', ''), a = windowFixture(), b = windowFixture();
  windows.register(a.window); a.commit(); windows.register(b.window); b.commit();
  const ready = vi.spyOn(windows, 'ready'); registerReaderIpc({ dispatch: vi.fn() } as unknown as ReaderService, windows);
  const handler = handlers.get('reader:window-ready'); if (!handler) throw new Error('Missing readiness');
  expect(handler(a.event(), { windowId: windows.resolveCaller(b.event())?.windowId })).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  expect(handler(a.event())).toEqual({ ok: true, value: null });
  expect(ready).toHaveBeenCalledExactlyOnceWith(windows.resolveCaller(a.event()));
  const old = a.event(); a.reload();
  expect(handler(old)).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
});
it('page Close routes only its authenticated native origin, rejects payloads/stale documents and stays fenced offline', () => {
  const windows = new WindowCoordinator('file:///app/index.html', ''), a = windowFixture(), b = windowFixture();
  const closeA = vi.fn(), closeB = vi.fn(); Object.assign(a.native, { close: closeA }); Object.assign(b.native, { close: closeB });
  for (const f of [a, b]) { windows.register(f.window); f.commit(); }
  const service = { dispatch: vi.fn(), restarting: false }; registerReaderIpc(service as unknown as ReaderService, windows);
  const handler = handlers.get('reader:window-close'); if (!handler) throw new Error('Missing page Close');
  expect(handler(a.event(), { windowId: 'foreign' })).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  expect(handler(a.event())).toEqual({ ok: true, value: null }); expect(closeA).toHaveBeenCalledOnce(); expect(closeB).not.toHaveBeenCalled();
  const old = a.event(); a.reload(); expect(handler(old)).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
  service.restarting = true; expect(handler(a.event())).toEqual({ ok: false, error: { code: 'DATA_BUSY' } }); expect(closeA).toHaveBeenCalledOnce();
});

it('routes only the expected window top-level application document and rejects foreign frames/windows/URLs', () => {
  const url = 'file:///app/index.html';
  const fixture = windowFixture(url), contents = fixture.contents, frame = contents.mainFrame;
  const windows = new WindowCoordinator(url, ''); windows.register(fixture.window); fixture.commit();
  const dispatch = vi.fn(() => ({ ok: true, value: 'sentinel' }));
  registerReaderIpc({ dispatch } as unknown as ReaderService, windows);
  const handler = handlers.get('reader:bootstrap');
  if (!handler) throw new Error('Missing handler');
  expect(handler({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent)).toEqual({ ok: true, value: 'sentinel' });
  expect(dispatch).toHaveBeenCalledWith('bootstrap', [], windows.resolveCaller(fixture.event()));
  for (const event of [
    { sender: {}, senderFrame: frame },
    { sender: contents, senderFrame: { url } },
    { sender: contents, senderFrame: null },
  ]) expect(handler(event as unknown as IpcMainInvokeEvent)).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
  frame.url = 'https://example.invalid/';
  expect(handler({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent)).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it('applies sender/frame/document checks to every intent, including acquire and refresh', async () => {
  const url = 'file:///app/index.html', fixture = windowFixture(url), contents = fixture.contents, frame = contents.mainFrame;
  const windows = new WindowCoordinator(url, ''); windows.register(fixture.window); fixture.commit();
  const dispatch = vi.fn(async () => ({ ok: true, value: 'ack' }));
  registerReaderIpc({ dispatch } as unknown as ReaderService, windows);
  for (const [operation, channel] of Object.entries(readerChannels)) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error('Missing handler');
    for (const event of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: { url } }, { sender: contents, senderFrame: null }]) {
      expect(await handler(event as unknown as IpcMainInvokeEvent, { executable: 'evil' })).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(await handler({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent, { intent: 'test' })).toEqual({ ok: true, value: 'ack' });
    expect(dispatch).toHaveBeenLastCalledWith(operation, [{ intent: 'test' }], windows.resolveCaller(fixture.event()));
  }
});

it('registers every channel once independently of window creation/reload and retains service payload validation', async () => {
  const windows = new WindowCoordinator('file:///app/index.html', ''), fixture = windowFixture();
  const service = new ActualReaderService(() => { throw new Error('No storage needed'); }, ['en'], () => undefined);
  vi.spyOn(service, 'claimWindowIdentity').mockReturnValue('persisted-test-window');
  registerReaderIpc(service, windows);
  expect(handlers.size).toBe(Object.keys(readerChannels).length + Object.keys(profileChannels).length + 3 + 11);
  for (let i = 0; i < 2; i++) { windows.register(fixture.window); fixture.commit(); fixture.reload(); }
  expect(handlers.size).toBe(Object.keys(readerChannels).length + Object.keys(profileChannels).length + 3 + 11);
  for (const channel of Object.values(readerChannels)) {
    expect(await handlers.get(channel)?.(fixture.event(), { windowId: 'forged', executable: 'evil' }, 'extra'))
      .toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  }
  fixture.native.emit('closed');
  for (const channel of Object.values(readerChannels)) expect(await handlers.get(channel)?.(fixture.event()))
    .toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
  expect(() => registerReaderIpc(service, windows)).toThrow('Duplicate handler');
  await service.shutdown();
});
it('all transfer intents authenticate the exact current top frame even while storage is unavailable', async () => {
  const url = 'file:///app/index.html', fixture = windowFixture(url), windows = new WindowCoordinator(url, '');
  const service = new ActualReaderService(() => { throw Error('Unavailable'); }, ['en'], () => undefined);
  vi.spyOn(service, 'claimWindowIdentity').mockReturnValue('registered-unavailable-window');
  registerReaderIpc(service, windows); windows.register(fixture.window); fixture.commit();
  const old = fixture.event();
  for (const [name, channel] of Object.entries(transferChannels)) if (name !== 'event') {
    const handler = handlers.get(channel); expect(handler).toBeTypeOf('function');
    for (const event of [{ sender: {}, senderFrame: fixture.contents.mainFrame }, { sender: fixture.contents, senderFrame: { url } }, { sender: fixture.contents, senderFrame: null }]) {
      expect(await handler?.(event as unknown as IpcMainInvokeEvent, { token: 'forged' })).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
    }
  }
  fixture.reload();
  for (const [name, channel] of Object.entries(transferChannels)) if (name !== 'event') expect(await handlers.get(channel)?.(old, { token: 'old' })).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
  await service.shutdown();
});

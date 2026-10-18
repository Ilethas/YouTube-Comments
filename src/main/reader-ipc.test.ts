import { WindowCoordinator } from './window-coordinator';
import { windowFixture } from './testing/window-fixture';
import { ReaderService as ActualReaderService } from './reader-service';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { ReaderService } from './reader-service';
import { registerReaderIpc } from './reader-ipc';
import { readerChannels } from '../shared/reader-api';
import { profileChannels } from '../shared/profile-operation';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => { if (handlers.has(channel)) throw new Error('Duplicate handler'); handlers.set(channel, handler); } } }));
beforeEach(() => handlers.clear());

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
  expect(handlers.size).toBe(Object.keys(readerChannels).length + Object.keys(profileChannels).length - 1);
  for (let i = 0; i < 2; i++) { windows.register(fixture.window); fixture.commit(); fixture.reload(); }
  expect(handlers.size).toBe(Object.keys(readerChannels).length + Object.keys(profileChannels).length - 1);
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

import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { ReaderService } from './reader-service';
import { registerReaderIpc } from './reader-ipc';
import { readerChannels } from '../shared/reader-api';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>() }));
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler) } }));
beforeEach(() => handlers.clear());

it('routes only the expected window top-level application document and rejects foreign frames/windows/URLs', () => {
  const url = 'file:///app/index.html';
  const frame = { url };
  const contents = { mainFrame: frame };
  const window = { webContents: contents } as unknown as BrowserWindow;
  const dispatch = vi.fn(() => ({ ok: true, value: 'sentinel' }));
  registerReaderIpc({ dispatch } as unknown as ReaderService, () => window, url);
  const handler = handlers.get('reader:bootstrap');
  if (!handler) throw new Error('Missing handler');
  expect(handler({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent)).toEqual({ ok: true, value: 'sentinel' });
  expect(dispatch).toHaveBeenCalledWith('bootstrap', []);
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
  const url = 'file:///app/index.html', frame = { url }, contents = { mainFrame: frame };
  const dispatch = vi.fn(async () => ({ ok: true, value: 'ack' }));
  registerReaderIpc({ dispatch } as unknown as ReaderService, () => ({ webContents: contents }) as unknown as BrowserWindow, url);
  for (const [operation, channel] of Object.entries(readerChannels)) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error('Missing handler');
    for (const event of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: { url } }, { sender: contents, senderFrame: null }]) {
      expect(await handler(event as unknown as IpcMainInvokeEvent, { executable: 'evil' })).toEqual({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    expect(await handler({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent, { intent: 'test' })).toEqual({ ok: true, value: 'ack' });
    expect(dispatch).toHaveBeenLastCalledWith(operation, [{ intent: 'test' }]);
  }
});

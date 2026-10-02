import { beforeEach, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { ReaderService } from './reader-service';
import { registerReaderIpc } from './reader-ipc';

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

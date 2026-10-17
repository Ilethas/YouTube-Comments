import { expect, it, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { createApplicationWindow } from './application-window';
import { WindowCoordinator } from './window-coordinator';

const { native } = vi.hoisted(() => ({ native: { webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  on: vi.fn(), removeListener: vi.fn(), loadURL: vi.fn() } }));
vi.mock('electron', () => ({ BrowserWindow: vi.fn(function () { return native; }) }));

it('uses the same fixed security options and popup/navigation denial for every reader window', () => {
  createApplicationWindow('/trusted/preload.js');
  expect(BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({ width: 1240, height: 900, minWidth: 720, minHeight: 520,
    webPreferences: { preload: '/trusted/preload.js', contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } }));
  expect(native.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    const preventDefault = vi.fn();
    native.webContents.on.mock.calls.find(([name]) => name === event)?.[1]({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  }
});

it('registers lifetime listeners before loading the exact application URL', () => {
  const url = 'file:///trusted/index.html', coordinator = new WindowCoordinator(url, '/trusted/preload.js');
  coordinator.createReaderWindow();
  expect(coordinator.size).toBe(1); expect(native.loadURL).toHaveBeenCalledWith(url);
  const commitIndex = native.webContents.on.mock.calls.findIndex(([name]) => name === 'did-frame-navigate');
  expect(native.webContents.on.mock.invocationCallOrder[commitIndex]).toBeLessThan(native.loadURL.mock.invocationCallOrder[0]);
});

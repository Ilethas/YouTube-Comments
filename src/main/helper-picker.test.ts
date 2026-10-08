import { expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createHelperPicker } from './helper-picker';

const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showOpenDialog } }));
it('parents a native single-file .exe picker, while cancellation/ambiguous choice is clean', async () => {
  const parent = {} as BrowserWindow, choose = createHelperPicker(() => parent, 'win32');
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\tools\\yt-dlp.exe'] });
  expect(await choose()).toBe('C:\\tools\\yt-dlp.exe');
  expect(showOpenDialog).toHaveBeenLastCalledWith(parent, { properties: ['openFile'], filters: [{ name: 'Executable (.exe)', extensions: ['exe'] }] });
  for (const result of [{ canceled: true, filePaths: [] }, { canceled: false, filePaths: [] }, { canceled: false, filePaths: ['one', 'two'] }]) {
    showOpenDialog.mockResolvedValueOnce(result); expect(await choose()).toBeUndefined();
  }
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tools/yt-dlp'] });
  expect(await createHelperPicker(() => undefined, 'linux')()).toBe('/tools/yt-dlp');
  expect(showOpenDialog).toHaveBeenLastCalledWith({ properties: ['openFile'] });
});

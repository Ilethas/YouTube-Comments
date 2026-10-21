import { expect, it, vi } from 'vitest';
import { dialog } from 'electron';
import { createThemeSavePicker } from './appearance-picker';
import type { BrowserWindow } from 'electron';
import type { ReaderCallerContext } from './caller-context';

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Users\\Test\\Documents' }, dialog: { showSaveDialog: vi.fn() } }));
it.each(['en', 'pl'] as const)('uses a parented JSON Save dialog and a writable Documents suggestion in %s', async locale => {
  const parent = {} as BrowserWindow, caller = { isCurrent: () => true } as ReaderCallerContext;
  vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: 'C:\\chosen.json' });
  expect(await createThemeSavePicker(() => parent)(locale, caller)).toBe('C:\\chosen.json');
  expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(parent, expect.objectContaining({
    defaultPath: expect.stringContaining('Documents'), filters: [{ name: 'JSON', extensions: ['json'] }],
  }));
});
it('drops native replies after document loss and never reparents them', async () => {
  const parent = {} as BrowserWindow;
  let current = true;
  const caller = { isCurrent: () => current } as ReaderCallerContext;
  vi.mocked(dialog.showSaveDialog).mockImplementationOnce(async () => { current = false; return { canceled: false, filePath: 'C:\\chosen.json' }; });
  expect(await createThemeSavePicker(() => parent)('en', caller)).toBeUndefined();
  current = true;
  let owner: BrowserWindow | undefined = parent;
  vi.mocked(dialog.showSaveDialog).mockImplementationOnce(async () => { owner = undefined; throw Error('closed'); });
  expect(await createThemeSavePicker(() => owner)('en', caller)).toBeUndefined();
});

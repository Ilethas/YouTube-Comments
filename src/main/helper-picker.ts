import { dialog } from 'electron';
import type { BrowserWindow, OpenDialogOptions } from 'electron';

/** Native main-owned single-file choice. Filters are convenience, not validation. */
export function createHelperPicker(window: () => BrowserWindow | undefined, platform = process.platform) {
  return async (): Promise<string | undefined> => {
    const options: OpenDialogOptions = { properties: ['openFile'],
      ...(platform === 'win32' ? { filters: [{ name: 'Executable (.exe)', extensions: ['exe'] }] } : {}) };
    const parent = window();
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled || result.filePaths.length !== 1 ? undefined : result.filePaths[0];
  };
}

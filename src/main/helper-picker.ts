import { dialog } from 'electron';
import type { BrowserWindow, OpenDialogOptions } from 'electron';
import type { ReaderCallerContext } from './caller-context';
import type { HelperKind } from '../shared/helper-settings';

/** Native main-owned single-file choice. Filters are convenience, not validation. */
export function createHelperPicker(window: (caller?: ReaderCallerContext) => BrowserWindow | undefined, platform = process.platform) {
  return async (_kind: HelperKind, caller?: ReaderCallerContext): Promise<string | undefined> => {
    const options: OpenDialogOptions = { properties: ['openFile'],
      ...(platform === 'win32' ? { filters: [{ name: 'Executable (.exe)', extensions: ['exe'] }] } : {}) };
    const parent = window(caller);
    if (!parent) return undefined;
    const result = await dialog.showOpenDialog(parent, options).catch(error => { if (window(caller) !== parent) return { canceled: true, filePaths: [] }; throw error; });
    return window(caller) !== parent || result.canceled || result.filePaths.length !== 1 ? undefined : result.filePaths[0];
  };
}

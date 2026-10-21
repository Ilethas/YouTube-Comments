import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import type { ReaderCallerContext } from './caller-context';
import type { AppearanceAssetsOptions } from './appearance-assets';

/** Captured authenticated parent; a lost document never reparents the picker. */
export function createAppearancePicker(window: (caller: ReaderCallerContext) => BrowserWindow | undefined): AppearanceAssetsOptions['choose'] {
  return async (kind, locale, caller) => {
    const parent = window(caller);
    if (!parent || !caller.isCurrent()) return;
    const result = await dialog.showOpenDialog(parent, {
      title: kind === 'theme' ? locale === 'pl' ? 'Importuj motyw JSON' : 'Import JSON theme' : locale === 'pl' ? 'Wybierz tapetę czytnika' : 'Choose reader wallpaper',
      properties: ['openFile'], filters: [{ name: kind === 'theme' ? 'JSON' : 'PNG / JPEG / WebP', extensions: kind === 'theme' ? ['json'] : ['png', 'jpg', 'jpeg', 'webp'] }],
    }).catch(error => { if (!caller.isCurrent() || window(caller) !== parent) return { canceled: true, filePaths: [] }; throw error; });
    return caller.isCurrent() && window(caller) === parent && !result.canceled && result.filePaths.length === 1 ? result.filePaths[0] : undefined;
  };
}

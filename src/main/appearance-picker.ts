import { app, dialog } from 'electron';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { ReaderCallerContext } from './caller-context';
import type { AppearanceAssetsOptions } from './appearance-assets';

export function createThemeSavePicker(window: (caller: ReaderCallerContext) => BrowserWindow | undefined): NonNullable<AppearanceAssetsOptions['saveTheme']> {
  return async (locale, caller) => {
    const parent = window(caller);
    if (!parent || !caller.isCurrent()) return;
    const result = await dialog.showSaveDialog(parent, {
      title: locale === 'pl' ? 'Eksportuj motyw jako JSON' : 'Export theme as JSON',
      defaultPath: path.join(app.getPath('documents'), 'youtube-comments-theme.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }).catch(error => { if (!caller.isCurrent() || window(caller) !== parent) return { canceled: true, filePath: undefined }; throw error; });
    return caller.isCurrent() && window(caller) === parent && !result.canceled ? result.filePath : undefined;
  };
}

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

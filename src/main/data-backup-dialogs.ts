import { dialog } from 'electron';
import type { BrowserWindow, MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from 'electron';
import { backupText } from '../shared/data-backup';
import type { Locale } from '../shared/preferences';
import type { ReaderCallerContext } from './caller-context';

/** Main-only native selection and explicit destructive confirmation. */
export interface DataBackupDialogs {
  save(locale: Locale, caller?: ReaderCallerContext): Promise<string | undefined>;
  select(locale: Locale, caller?: ReaderCallerContext): Promise<string | undefined>;
  confirm(locale: Locale, caller?: ReaderCallerContext): Promise<boolean>;
}
export function backupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `youtube-comments-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.sqlite`;
}
export function createDataBackupDialogs(window: (caller?: ReaderCallerContext) => BrowserWindow | undefined): DataBackupDialogs {
  return {
    async save(locale, caller) {
      const options: SaveDialogOptions = { title: backupText(locale).saveTitle, defaultPath: backupFilename(),
        filters: [{ name: 'SQLite', extensions: ['sqlite'] }], properties: ['showOverwriteConfirmation'] };
      const owner = window(caller);
      if (!owner) return undefined;
      const result = await dialog.showSaveDialog(owner, options).catch(error => { if (window(caller) !== owner) return { canceled: true, filePath: undefined }; throw error; });
      return window(caller) !== owner || result.canceled ? undefined : result.filePath;
    },
    async select(locale, caller) {
      const options: OpenDialogOptions = { title: backupText(locale).openTitle, properties: ['openFile'], filters: [{ name: 'SQLite', extensions: ['sqlite'] }] };
      const owner = window(caller);
      if (!owner) return undefined;
      const result = await dialog.showOpenDialog(owner, options).catch(error => { if (window(caller) !== owner) return { canceled: true, filePaths: [] }; throw error; });
      return window(caller) !== owner || result.canceled ? undefined : result.filePaths[0];
    },
    async confirm(locale, caller) {
      const t = backupText(locale);
      const options: MessageBoxOptions = { type: 'warning', title: t.confirmTitle, message: t.confirm,
        buttons: [t.cancel, t.replace], defaultId: 0, cancelId: 0, noLink: true };
      const owner = window(caller);
      if (!owner) return false;
      const result = await dialog.showMessageBox(owner, options).catch(error => { if (window(caller) !== owner) return { response: 0 }; throw error; });
      return window(caller) === owner && result.response === 1;
    },
  };
}

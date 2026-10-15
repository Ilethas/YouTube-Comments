import { dialog } from 'electron';
import type { BrowserWindow, MessageBoxOptions, OpenDialogOptions, SaveDialogOptions } from 'electron';
import { backupText } from '../shared/data-backup';
import type { Locale } from '../shared/preferences';

/** Main-only native selection and explicit destructive confirmation. */
export interface DataBackupDialogs {
  save(locale: Locale): Promise<string | undefined>;
  select(locale: Locale): Promise<string | undefined>;
  confirm(locale: Locale): Promise<boolean>;
}
export function backupFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `youtube-comments-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.sqlite`;
}
export function createDataBackupDialogs(window: () => BrowserWindow | undefined): DataBackupDialogs {
  return {
    async save(locale) {
      const options: SaveDialogOptions = { title: backupText(locale).saveTitle, defaultPath: backupFilename(),
        filters: [{ name: 'SQLite', extensions: ['sqlite'] }], properties: ['showOverwriteConfirmation'] };
      const owner = window();
      const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
      return result.canceled ? undefined : result.filePath;
    },
    async select(locale) {
      const options: OpenDialogOptions = { title: backupText(locale).openTitle, properties: ['openFile'], filters: [{ name: 'SQLite', extensions: ['sqlite'] }] };
      const owner = window();
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      return result.canceled ? undefined : result.filePaths[0];
    },
    async confirm(locale) {
      const t = backupText(locale);
      const options: MessageBoxOptions = { type: 'warning', title: t.confirmTitle, message: t.confirm,
        buttons: [t.cancel, t.replace], defaultId: 0, cancelId: 0, noLink: true };
      const owner = window();
      const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
      return result.response === 1;
    },
  };
}

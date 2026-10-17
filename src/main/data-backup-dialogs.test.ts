import { expect, it, vi } from 'vitest';
import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import { backupFilename, createDataBackupDialogs } from './data-backup-dialogs';
import { backupText } from '../shared/data-backup';
import { WindowCoordinator } from './window-coordinator';
import { windowFixture } from './testing/window-fixture';

vi.mock('electron', () => ({ dialog: {
  showSaveDialog: vi.fn(async () => ({ canceled: true })), showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
} }));
it.each(['en', 'pl'] as const)('uses owned native dialogs and %s confirmation with Cancel initially focused and Escape cancelling', async locale => {
  const window = {} as BrowserWindow, dialogs = createDataBackupDialogs(() => window);
  expect(await dialogs.save(locale)).toBeUndefined(); expect(await dialogs.select(locale)).toBeUndefined(); expect(await dialogs.confirm(locale)).toBe(false);
  expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(window, expect.objectContaining({ title: backupText(locale).saveTitle, defaultPath: expect.stringMatching(/^youtube-comments-backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.sqlite$/) }));
  expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(window, expect.objectContaining({ properties: ['openFile'] }));
  expect(dialog.showMessageBox).toHaveBeenLastCalledWith(window, expect.objectContaining({ message: backupText(locale).confirm,
    buttons: [backupText(locale).cancel, backupText(locale).replace], defaultId: 0, cancelId: 0 }));
});
it('uses the local calendar for the suggested name', () => {
  expect(backupFilename(new Date(2026, 9, 15, 8, 5))).toBe('youtube-comments-backup-2026-10-15_08-05.sqlite');
});

it.each(['save', 'select', 'confirm'] as const)('%s keeps the accepted origin across asynchronous completion and cancels on origin death', async operation => {
  const windows = new WindowCoordinator('file:///app/index.html', ''), a = windowFixture(), b = windowFixture();
  for (const entry of [a, b]) { windows.register(entry.window); entry.commit(); }
  const origin = windows.resolveCaller(a.event()), peer = windows.resolveCaller(b.event());
  const dialogs = createDataBackupDialogs(caller => windows.originWindow(caller));
  let finish!: (result: never) => void;
  const mock = operation === 'save' ? vi.mocked(dialog.showSaveDialog) : operation === 'select' ? vi.mocked(dialog.showOpenDialog) : vi.mocked(dialog.showMessageBox);
  mock.mockImplementationOnce(() => new Promise<never>(resolve => { finish = resolve; }));
  const pending = dialogs[operation]('en', origin);
  expect(mock).toHaveBeenLastCalledWith(a.window, expect.anything());
  a.native.emit('closed');
  finish({ canceled: false, filePath: 'chosen.sqlite', filePaths: ['chosen.sqlite'], response: 1 } as never);
  expect(await pending).toBe(operation === 'confirm' ? false : undefined);
  mock.mockClear();
  expect(await dialogs[operation]('en', origin)).toBe(operation === 'confirm' ? false : undefined);
  expect(mock).not.toHaveBeenCalled();
  await dialogs[operation]('en', peer); expect(mock).toHaveBeenLastCalledWith(b.window, expect.anything());
});

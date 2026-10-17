import { expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createHelperPicker } from './helper-picker';
import { WindowCoordinator } from './window-coordinator';
import { windowFixture } from './testing/window-fixture';

const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showOpenDialog } }));
it('parents a native single-file .exe picker, while cancellation/ambiguous choice is clean', async () => {
  const parent = {} as BrowserWindow, choose = createHelperPicker(() => parent, 'win32');
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\tools\\yt-dlp.exe'] });
  expect(await choose('yt-dlp')).toBe('C:\\tools\\yt-dlp.exe');
  expect(showOpenDialog).toHaveBeenLastCalledWith(parent, { properties: ['openFile'], filters: [{ name: 'Executable (.exe)', extensions: ['exe'] }] });
  for (const result of [{ canceled: true, filePaths: [] }, { canceled: false, filePaths: [] }, { canceled: false, filePaths: ['one', 'two'] }]) {
    showOpenDialog.mockResolvedValueOnce(result); expect(await choose('yt-dlp')).toBeUndefined();
  }
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tools/yt-dlp'] });
  expect(await createHelperPicker(() => parent, 'linux')('yt-dlp')).toBe('/tools/yt-dlp');
  expect(showOpenDialog).toHaveBeenLastCalledWith(parent, { properties: ['openFile'] });
});

it('cancels without an origin and discards an asynchronous result after the origin reloads', async () => {
  showOpenDialog.mockClear();
  expect(await createHelperPicker(() => undefined)('yt-dlp')).toBeUndefined();
  expect(showOpenDialog).not.toHaveBeenCalled();
  const windows = new WindowCoordinator('file:///app/index.html', ''), a = windowFixture(), b = windowFixture();
  for (const entry of [a, b]) { windows.register(entry.window); entry.commit(); }
  const caller = windows.resolveCaller(a.event());
  let finish!: (result: unknown) => void;
  showOpenDialog.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = createHelperPicker(origin => windows.originWindow(origin))('yt-dlp', caller);
  expect(showOpenDialog).toHaveBeenLastCalledWith(a.window, expect.anything()); a.reload();
  finish({ canceled: false, filePaths: ['chosen.exe'] }); expect(await pending).toBeUndefined();
  showOpenDialog.mockImplementationOnce(async () => { a.native.emit('closed'); throw new Error('Owner destroyed'); });
  expect(await createHelperPicker(origin => windows.originWindow(origin))('yt-dlp', windows.resolveCaller(a.event()))).toBeUndefined();
});

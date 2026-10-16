import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import identity from '../shared/application-identity.json';

afterEach(() => { vi.resetModules(); vi.doUnmock('electron'); vi.doUnmock('electron-squirrel-startup'); });

it.each(['--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete'])(
'handles %s through the installed helper without real process or shell effects', async event => {
  // Execute the actual installed helper in a VM with inert OS dependencies.
  const child = new EventEmitter(), quit = vi.fn(), spawn = vi.fn(() => child);
  const result = { exports: false };
  vm.runInNewContext(fs.readFileSync(require.resolve('electron-squirrel-startup'), 'utf8'), {
    module: result,
    process: { platform: 'win32', argv: [identity.executableName + '.exe', event], execPath: path.resolve('isolated-app/app-1.0.0/youtube-comments.exe') },
    require: (name: string) => {
      if (name === 'path') return path;
      if (name === 'child_process') return { spawn };
      if (name === 'debug') return () => () => undefined;
      if (name === 'electron') return { app: { quit } };
      throw new Error(`Unexpected helper dependency ${name}`);
    },
  });
  expect(result.exports).toBe(true);
  if (event === '--squirrel-obsolete') { expect(spawn).not.toHaveBeenCalled(); expect(quit).toHaveBeenCalledOnce(); }
  else {
    expect(spawn).toHaveBeenCalledWith(path.resolve('isolated-app/Update.exe'),
      [`--${event === '--squirrel-uninstall' ? 'remove' : 'create'}Shortcut=youtube-comments.exe`], { detached: true });
    expect(quit).not.toHaveBeenCalled(); child.emit('close'); expect(quit).toHaveBeenCalledOnce();
  }
  // Import the real entry with its helper result. Any access to Electron normal
  // initialization fails, including path/profile, ready listeners or windows.
  vi.doMock('electron-squirrel-startup', () => ({ default: result.exports }));
  vi.doMock('electron', () => ({ app: new Proxy({}, { get: (_target, name) => { throw new Error(`Normal Electron access during ${event}: ${String(name)}`); } }) }));
  await expect(import('../main')).resolves.toBeDefined();
});

it('registers ordinary ZIP/first-run startup with fixed identity and established profile', async () => {
  const on = vi.fn(), setPath = vi.fn(), setAppUserModelId = vi.fn();
  vi.doMock('electron-squirrel-startup', () => ({ default: false }));
  vi.doMock('electron', () => ({ app: { isPackaged: true, getPath: () => path.resolve('isolated-roaming'), setPath, setAppUserModelId, on } }));
  vi.stubGlobal('MAIN_WINDOW_VITE_NAME', 'main_window'); vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
  vi.stubEnv('YOUTUBE_COMMENTS_DEMO_ROOT', undefined);
  try {
    await import('../main');
    expect(setPath).toHaveBeenCalledWith('userData', path.resolve('isolated-roaming/youtube-comments-production'));
    if (process.platform === 'win32') expect(setAppUserModelId).toHaveBeenCalledWith(identity.appUserModelId);
    expect(on.mock.calls.map(([name]) => name)).toEqual(['ready', 'before-quit', 'window-all-closed', 'activate']);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

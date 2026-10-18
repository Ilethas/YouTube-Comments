import { isAcquisitionNotification } from './shared/acquisition';
import { app, shell, dialog, clipboard, protocol, nativeImage, Menu, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { ReaderRepository } from './main/persistence/reader-repository';
import { resolveDatabasePath, resolveThumbnailDirectory } from './main/persistence/profile';
import { ThumbnailCache } from './main/thumbnail-cache';
import { WindowCoordinator } from './main/window-coordinator';
import { ReaderService } from './main/reader-service';
import { registerReaderIpc } from './main/reader-ipc';
import { createHelperPicker } from './main/helper-picker';
import { createDataBackupDialogs } from './main/data-backup-dialogs';
import { protectBeforeMigration, recoverProfile } from './main/persistence/profile-restore';
import { backupText } from './shared/data-backup';
import { initialLocale } from './shared/preferences';
import identity from './shared/application-identity.json';
import type { ProfileOperationCoordinator } from './main/profile-operation-coordinator';

// The startup helper owns shortcut creation/removal and quits after Update.exe
// closes. Do not quit early or register ANY reader work during lifecycle events.
if (!started) startReader();

function startReader() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'reader-thumbnail', privileges: { standard: true, secure: true, supportFetchAPI: false } }]);
  if (process.platform === 'win32') app.setAppUserModelId(identity.appUserModelId);

  // A privileged, explicit demo root also permits testing the packaged artifact
  // without opening its production profile. Empty/relative configuration fails.
  const demoRoot = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  const mode = !app.isPackaged || demoRoot !== undefined ? 'development' : 'production';
  const databasePath = resolveDatabasePath({ mode, appData: demoRoot ?? app.getPath('appData') });
  const thumbnailDirectory = resolveThumbnailDirectory({ mode, appData: demoRoot ?? app.getPath('appData') });
  app.setPath('userData', path.dirname(databasePath));
  let service: ReaderService;
  let lifecycle: ProfileOperationCoordinator | undefined;
  const documentPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  const documentUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).href : pathToFileURL(documentPath).href;

  const windows = new WindowCoordinator(documentUrl, path.join(__dirname, 'preload.js'));

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.on('ready', async () => {
    if (!app.requestSingleInstanceLock()) { app.quit(); return; }
    const text = backupText(initialLocale(app.getPreferredSystemLanguages()));
    let recovery: Awaited<ReturnType<typeof recoverProfile>>;
    let profileLocale = initialLocale(app.getPreferredSystemLanguages());
    const fresh = !existsSync(databasePath);
    try {
      recovery = await recoverProfile(databasePath);
      await protectBeforeMigration(databasePath);
    } catch (error) {
      console.error(error);
      dialog.showErrorBox(text.title, `${text.RECOVERY_REQUIRED}\n${path.dirname(databasePath)}`);
      app.quit(); return;
    }
    service = new ReaderService(() => {
      const repository = ReaderRepository.open(databasePath);
      try {
        if (mode === 'development' && fresh && !recovery) repository.initializeDemo();
        profileLocale = repository.preferences(app.getPreferredSystemLanguages()).locale;
        return repository;
      } catch (error) { repository.close(); throw error; }
    }, app.getPreferredSystemLanguages(), console.error, undefined, { choose: createHelperPicker(caller => windows.originWindow(caller)) }, url => shell.openExternal(url), value => {
      if (isAcquisitionNotification(value)) windows.sendAcquisitionProgress(value);
    }, { databasePath, dialogs: createDataBackupDialogs(caller => windows.originWindow(caller)), restart: () => { app.relaunch(); app.quit(); } }, text => clipboard.writeText(text), {
      cache: new ThumbnailCache(thumbnailDirectory, { decode: bytes => {
        const image = nativeImage.createFromBuffer(bytes);
        return image.isEmpty() ? undefined : image.getSize();
      } }), openPath: file => shell.openPath(file),
    });
    protocol.handle('reader-thumbnail', async request => {
      try {
        const image = request.method === 'GET' ? await service.thumbnailImage(request.url) : undefined;
        return image ? new Response(new Uint8Array(image.bytes), { headers: { 'Content-Type': image.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
          : new Response(null, { status: 404 });
      } catch { return new Response(null, { status: 404 }); }
    });
    lifecycle = registerReaderIpc(service, windows);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' }, { role: 'editMenu' },
      { label: 'View', submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => {
          const window = BrowserWindow.getFocusedWindow();
          if (window) windows.requestReload(window);
        } }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
      ] }, { role: 'windowMenu' },
    ]));
    const window = windows.createReaderWindow();
    if (recovery) void dialog.showMessageBox(window, { type: 'info', message: backupText(profileLocale)[recovery] });
  });
  let shutdownStarted = false;
  let quitReady = false;
  let quitTask: Promise<void> | undefined;
  app.on('before-quit', event => {
    if (!service || quitReady) return;
    event.preventDefault();
    if (quitTask) return;
    const quit = async () => {
      let ownedId: string | undefined;
      try {
        if (!service.restarting && lifecycle) {
          lifecycle.cancelPreparation();
          await service.settleDataOperation();
          if (!service.restarting) {
            await lifecycle.released();
            const previous = lifecycle.current()?.operationId, drained = lifecycle.begin('quit');
            if (lifecycle.current()?.operationId !== previous) ownedId = lifecycle.current()?.operationId;
            await drained; lifecycle.executePhase(); lifecycle.accept();
          }
        }
        shutdownStarted = true;
        await service.shutdown();
        windows.finishAll(); quitReady = true; app.quit();
      } catch { if (ownedId) lifecycle?.release(true, ownedId); shutdownStarted = false; }
    };
    quitTask = (lifecycle ? lifecycle.scheduleIntentional(quit) : quit()).finally(() => { quitTask = undefined; });
  });

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (service && !shutdownStarted && windows.size === 0) {
      windows.createReaderWindow();
    }
  });

  // In this file you can include the rest of your app's specific main process
  // code. You can also put them in separate files and import them here.
}

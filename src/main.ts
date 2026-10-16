import { acquisitionProgressChannel, isAcquisitionNotification } from './shared/acquisition';
import { app, BrowserWindow, shell, dialog } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { ReaderRepository } from './main/persistence/reader-repository';
import { resolveDatabasePath } from './main/persistence/profile';
import { ReaderService } from './main/reader-service';
import { registerReaderIpc } from './main/reader-ipc';
import { createHelperPicker } from './main/helper-picker';
import { createDataBackupDialogs } from './main/data-backup-dialogs';
import { protectBeforeMigration, recoverProfile } from './main/persistence/profile-restore';
import { backupText } from './shared/data-backup';
import { initialLocale } from './shared/preferences';
import identity from './shared/application-identity.json';

// The startup helper owns shortcut creation/removal and quits after Update.exe
// closes. Do not quit early or register ANY reader work during lifecycle events.
if (!started) startReader();

function startReader() {
  if (process.platform === 'win32') app.setAppUserModelId(identity.appUserModelId);

  // A privileged, explicit demo root also permits testing the packaged artifact
  // without opening its production profile. Empty/relative configuration fails.
  const demoRoot = process.env.YOUTUBE_COMMENTS_DEMO_ROOT;
  const mode = !app.isPackaged || demoRoot !== undefined ? 'development' : 'production';
  const databasePath = resolveDatabasePath({ mode, appData: demoRoot ?? app.getPath('appData') });
  app.setPath('userData', path.dirname(databasePath));
  let mainWindow: BrowserWindow | undefined;
  let service: ReaderService;
  const documentPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  const documentUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).href : pathToFileURL(documentPath).href;

  const createWindow = () => {
    // Create the browser window.
    mainWindow = new BrowserWindow({
      width: 1240,
      height: 900,
      minWidth: 720,
      minHeight: 520,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    // and load the index.html of the app.
    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      mainWindow.loadFile(
        documentPath,
      );
    }

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.on('closed', () => { mainWindow = undefined; });
  };

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
    }, app.getPreferredSystemLanguages(), console.error, undefined, { choose: createHelperPicker(() => mainWindow) }, url => shell.openExternal(url), value => {
      const contents = mainWindow?.webContents;
      if (contents && !contents.isDestroyed() && contents.mainFrame.url === documentUrl && isAcquisitionNotification(value))
        contents.send(acquisitionProgressChannel, value);
    }, { databasePath, dialogs: createDataBackupDialogs(() => mainWindow), restart: () => { app.relaunch(); app.quit(); } });
    registerReaderIpc(service, () => mainWindow, documentUrl);
    createWindow();
    if (recovery && mainWindow) void dialog.showMessageBox(mainWindow, { type: 'info', message: backupText(profileLocale)[recovery] });
  });
  let shutdownStarted = false;
  app.on('before-quit', event => {
    if (!shutdownStarted && service) {
      event.preventDefault();
      shutdownStarted = true;
      void service.shutdown().finally(() => app.quit());
    }
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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // In this file you can include the rest of your app's specific main process
  // code. You can also put them in separate files and import them here.
}

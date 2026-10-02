import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import started from 'electron-squirrel-startup';
import { ReaderRepository } from './main/persistence/reader-repository';
import { resolveDatabasePath } from './main/persistence/profile';
import { ReaderService } from './main/reader-service';
import { registerReaderIpc } from './main/reader-ipc';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

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
app.on('ready', () => {
  service = new ReaderService(() => {
    const repository = ReaderRepository.open(databasePath);
    try {
      if (mode === 'development') repository.initializeDemo();
      return repository;
    } catch (error) { repository.close(); throw error; }
  }, app.getPreferredSystemLanguages());
  registerReaderIpc(service, () => mainWindow, documentUrl);
  createWindow();
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

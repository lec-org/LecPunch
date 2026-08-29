import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';

const createWindow = () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#090e1d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (app.isPackaged) {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    void window.loadURL('http://127.0.0.1:5174');
  }
};

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

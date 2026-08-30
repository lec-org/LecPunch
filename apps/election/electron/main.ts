import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, protocol, screen, shell, Tray } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { uIOhook, UiohookKey } from 'uiohook-napi';

protocol.registerSchemesAsPrivileged([
  { scheme: 'lecpunch-assets', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const COMPANION_BASE_WIDTH = 560;
const COMPANION_BASE_HEIGHT = 390;
type CompanionSettings = { scale: number; visible: boolean };
type QuietNotificationResult = { enabled: boolean; managedApps: string[]; message: string };
let companionSettings: CompanionSettings = { scale: 1, visible: true };
let quietNotificationConsentGranted = false;
const quietNotificationBackup = new Map<string, string | null>();

const companionSettingsPath = () => path.join(app.getPath('userData'), 'companion-settings.json');
const normalizeCompanionSettings = (settings: Partial<CompanionSettings>): CompanionSettings => ({
  // The desktop control is a continuous slider. Clamp persisted values too so a
  // manually edited preference file can never create an impractically sized pet.
  scale: Number.isFinite(Number(settings.scale))
    ? Math.round(Math.max(0.7, Math.min(1.3, Number(settings.scale))) * 100) / 100
    : companionSettings.scale,
  visible: typeof settings.visible === 'boolean' ? settings.visible : companionSettings.visible
});
const loadCompanionSettings = () => {
  try {
    companionSettings = normalizeCompanionSettings(JSON.parse(fs.readFileSync(companionSettingsPath(), 'utf8')) as Partial<CompanionSettings>);
  } catch {
    // First launch and malformed preference files both fall back to the safe defaults.
  }
};
const saveCompanionSettings = () => fs.writeFileSync(companionSettingsPath(), JSON.stringify(companionSettings));
const quietNotificationSettingsPath = () => path.join(app.getPath('userData'), 'quiet-notification-settings.json');
const loadQuietNotificationSettings = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(quietNotificationSettingsPath(), 'utf8')) as { consentGranted?: boolean; backup?: Record<string, string | null> };
    quietNotificationConsentGranted = saved.consentGranted === true;
    Object.entries(saved.backup ?? {}).forEach(([key, value]) => quietNotificationBackup.set(key, value));
  } catch {
    // First launch has no notification changes to restore.
  }
};
const saveQuietNotificationSettings = () => fs.writeFileSync(quietNotificationSettingsPath(), JSON.stringify({
  consentGranted: quietNotificationConsentGranted,
  backup: Object.fromEntries(quietNotificationBackup)
}));
const runReg = (args: string[]) => new Promise<{ stdout: string }>((resolve, reject) => {
  execFile('reg.exe', args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
    if (error) reject(error);
    else resolve({ stdout });
  });
});
const notificationSettingsRoot = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';
const quietAppKeyPattern = /(wechat|weixin|(?:tencent.*)?qq)/i;
const findQuietAppNotificationKeys = async () => {
  const { stdout } = await runReg(['query', notificationSettingsRoot, '/s']);
  return [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('HKEY_CURRENT_USER\\') && quietAppKeyPattern.test(line)))];
};
const readEnabledValue = async (key: string) => {
  try {
    const { stdout } = await runReg(['query', key, '/v', 'Enabled']);
    const match = stdout.match(/Enabled\s+REG_DWORD\s+(0x[\da-f]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};
const setQuietAppNotifications = async (enabled: boolean): Promise<QuietNotificationResult> => {
  if (process.platform !== 'win32') return { enabled: false, managedApps: [], message: '该功能仅支持 Windows。' };
  if (enabled && !quietNotificationConsentGranted) {
    const promptOptions = {
      type: 'question' as const,
      buttons: ['取消', '授权并开启'] as string[],
      defaultId: 1,
      cancelId: 0,
      title: '授权管理 QQ / 微信通知',
      message: '允许 LecPunch 管理 Windows 已登记的 QQ、微信通知吗？',
      detail: '开启后会暂时关闭这些应用的 Windows 通知横幅与提示音；退出免提示模式时会恢复你此前的设置。不会读取聊天内容、账号或文件。'
    };
    const parentWindow = mainWindow ?? companionWindow;
    const result = parentWindow ? await dialog.showMessageBox(parentWindow, promptOptions) : await dialog.showMessageBox(promptOptions);
    if (result.response !== 1) return { enabled: false, managedApps: [], message: '未授予 QQ、微信通知管理权限。' };
    quietNotificationConsentGranted = true;
    saveQuietNotificationSettings();
  }
  let keys: string[] = [];
  try {
    keys = await findQuietAppNotificationKeys();
    for (const key of keys) {
      if (enabled) {
        if (!quietNotificationBackup.has(key)) quietNotificationBackup.set(key, await readEnabledValue(key));
        await runReg(['add', key, '/v', 'Enabled', '/t', 'REG_DWORD', '/d', '0', '/f']);
      } else if (quietNotificationBackup.has(key)) {
        const previous = quietNotificationBackup.get(key);
        if (previous) await runReg(['add', key, '/v', 'Enabled', '/t', 'REG_DWORD', '/d', String(Number.parseInt(previous, 16)), '/f']);
        else await runReg(['delete', key, '/v', 'Enabled', '/f']);
      }
    }
    if (!enabled) quietNotificationBackup.clear();
    saveQuietNotificationSettings();
  } catch {
    return { enabled: false, managedApps: [], message: 'Windows 通知设置暂时无法修改；可改用 Windows 专注助手。' };
  }
  const managedApps = keys.map((key) => /wechat|weixin/i.test(key) ? '微信' : 'QQ');
  if (!managedApps.length) return { enabled, managedApps: [], message: '未发现已登记的 QQ 或微信通知。可从 Windows 专注助手手动管理。' };
  return { enabled, managedApps: [...new Set(managedApps)], message: enabled ? `已暂时关闭 ${[...new Set(managedApps)].join('、')} 的 Windows 通知。` : `已恢复 ${[...new Set(managedApps)].join('、')} 的原通知设置。` };
};
const companionDimensions = () => ({
  width: Math.round(COMPANION_BASE_WIDTH * companionSettings.scale),
  height: Math.round(COMPANION_BASE_HEIGHT * companionSettings.scale)
});

const keyboardKeyMap = new Map<number, string>([
  [UiohookKey.A, 'KeyA'], [UiohookKey.B, 'KeyB'], [UiohookKey.C, 'KeyC'], [UiohookKey.D, 'KeyD'], [UiohookKey.E, 'KeyE'], [UiohookKey.F, 'KeyF'], [UiohookKey.G, 'KeyG'], [UiohookKey.H, 'KeyH'], [UiohookKey.I, 'KeyI'], [UiohookKey.J, 'KeyJ'], [UiohookKey.K, 'KeyK'], [UiohookKey.L, 'KeyL'], [UiohookKey.M, 'KeyM'], [UiohookKey.N, 'KeyN'], [UiohookKey.O, 'KeyO'], [UiohookKey.P, 'KeyP'], [UiohookKey.Q, 'KeyQ'], [UiohookKey.R, 'KeyR'], [UiohookKey.S, 'KeyS'], [UiohookKey.T, 'KeyT'], [UiohookKey.U, 'KeyU'], [UiohookKey.V, 'KeyV'], [UiohookKey.W, 'KeyW'], [UiohookKey.X, 'KeyX'], [UiohookKey.Y, 'KeyY'], [UiohookKey.Z, 'KeyZ'],
  [UiohookKey[0], 'Num0'], [UiohookKey[1], 'Num1'], [UiohookKey[2], 'Num2'], [UiohookKey[3], 'Num3'], [UiohookKey[4], 'Num4'], [UiohookKey[5], 'Num5'], [UiohookKey[6], 'Num6'], [UiohookKey[7], 'Num7'], [UiohookKey[8], 'Num8'], [UiohookKey[9], 'Num9'],
  [UiohookKey.Space, 'Space'], [UiohookKey.Enter, 'Return'], [UiohookKey.Backspace, 'Backspace'], [UiohookKey.Tab, 'Tab'], [UiohookKey.Escape, 'Escape'], [UiohookKey.CapsLock, 'CapsLock'], [UiohookKey.Delete, 'Delete'], [UiohookKey.Shift, 'ShiftLeft'], [UiohookKey.ShiftRight, 'ShiftRight'], [UiohookKey.Ctrl, 'ControlLeft'], [UiohookKey.CtrlRight, 'ControlRight'], [UiohookKey.Alt, 'Alt'], [UiohookKey.AltRight, 'AltGr'], [UiohookKey.Meta, 'Meta'], [UiohookKey.MetaRight, 'Meta'], [UiohookKey.ArrowUp, 'UpArrow'], [UiohookKey.ArrowDown, 'DownArrow'], [UiohookKey.ArrowLeft, 'LeftArrow'], [UiohookKey.ArrowRight, 'RightArrow']
]);

const getIconPath = () => app.isPackaged
  ? path.join(process.resourcesPath, 'icon.ico')
  : path.join(__dirname, '..', 'resources', 'icon.ico');

const showWindow = () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const showCompanion = () => {
  companionSettings.visible = true;
  saveCompanionSettings();
  companionWindow?.showInactive();
};

const hideCompanion = () => {
  companionSettings.visible = false;
  saveCompanionSettings();
  companionWindow?.hide();
};

const createTray = () => {
  const icon = nativeImage.createFromPath(getIconPath());
  tray = new Tray(icon);
  tray.setToolTip('LecPunch Election');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 LecPunch Election', click: showWindow },
    { label: '显示桌面小猫', click: showCompanion },
    { label: '隐藏桌面小猫', click: hideCompanion },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', showWindow);
};

const loadRenderer = (window: BrowserWindow, hash?: string) => {
  if (app.isPackaged) {
    return window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), hash ? { hash } : undefined);
  }
  return window.loadURL(`http://127.0.0.1:5174/${hash ? `#${hash}` : ''}`);
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    // Keep Windows controls while removing the native menu bar and white title bar.
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'hiddenInset',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            // Keep the native caption buttons visually merged with the blue-white UI.
            color: '#edf8ff',
            symbolColor: '#22557f',
            height: 36
          }
        }
      : {}),
    backgroundColor: '#edf8ff',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void loadRenderer(mainWindow);

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const createCompanionWindow = () => {
  const dimensions = companionDimensions();
  companionWindow = new BrowserWindow({
    width: dimensions.width,
    height: dimensions.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  companionWindow.setAlwaysOnTop(true, 'floating');
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  companionWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  void loadRenderer(companionWindow, 'companion');
  companionWindow.once('ready-to-show', () => {
    if (companionSettings.visible) companionWindow?.showInactive();
  });
  companionWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    companionWindow?.hide();
  });
  companionWindow.on('closed', () => {
    companionWindow = null;
  });
};

app.whenReady().then(() => {
  protocol.handle('lecpunch-assets', (request) => {
    const requestUrl = new URL(request.url);
    const requestedPath = decodeURIComponent(`${requestUrl.hostname}${requestUrl.pathname}`);
    const relativePath = path.normalize(requestedPath).replace(/^([/\\])+/, '');
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return new Response('Not found', { status: 404 });
    }
    const assetPath = path.join(app.getAppPath(), 'dist', relativePath);
    return net.fetch(pathToFileURL(assetPath).toString());
  });

  Menu.setApplicationMenu(null);
  loadCompanionSettings();
  loadQuietNotificationSettings();
  createWindow();
  createCompanionWindow();
  createTray();

  uIOhook.on('keydown', (event) => {
    const key = keyboardKeyMap.get(event.keycode);
    if (key) companionWindow?.webContents.send('bongo:key', { kind: 'keydown', key });
  });
  uIOhook.on('keyup', (event) => {
    const key = keyboardKeyMap.get(event.keycode);
    if (key) companionWindow?.webContents.send('bongo:key', { kind: 'keyup', key });
  });
  uIOhook.start();

  ipcMain.handle('desktop:notify', (_event, payload: { title?: string; body?: string }) => {
    if (!Notification.isSupported()) return;
    new Notification({
      title: payload.title || 'LecPunch Election',
      body: payload.body || ''
    }).show();
  });

  ipcMain.handle('desktop:hide-to-tray', () => mainWindow?.hide());
  ipcMain.handle('desktop:set-immersive', async (_event, enabled: boolean) => {
    const quietResult = await setQuietAppNotifications(Boolean(enabled));
    mainWindow?.webContents.send('desktop:main-immersive', Boolean(enabled) && quietResult.enabled);
    return quietResult;
  });
  ipcMain.handle('desktop:get-companion-settings', () => companionSettings);
  ipcMain.handle('desktop:update-companion-settings', (_event, changes: Partial<CompanionSettings>) => {
    const window = companionWindow;
    companionSettings = normalizeCompanionSettings(changes);
    saveCompanionSettings();
    if (!window) return companionSettings;
    const [x, y] = window.getPosition();
    const [oldWidth, oldHeight] = window.getSize();
    const { width, height } = companionDimensions();
    const display = screen.getDisplayNearestPoint({ x, y });
    const area = display.workArea;
    const nextX = Math.max(area.x, Math.min(x + Math.round((oldWidth - width) / 2), area.x + area.width - width));
    const nextY = Math.max(area.y, Math.min(y + Math.round((oldHeight - height) / 2), area.y + area.height - height));
    window.setBounds({ x: nextX, y: nextY, width, height });
    if (companionSettings.visible) window.showInactive();
    else window.hide();
    return companionSettings;
  });
  ipcMain.handle('desktop:open-focus-assist', () => shell.openExternal('ms-settings:quiethours'));
  ipcMain.handle('desktop:show-main', (_event, action: 'schedule' | 'shop') => {
    showWindow();
    mainWindow?.webContents.send('desktop:main-action', action);
  });
  ipcMain.handle('desktop:notify-main-state', () => mainWindow?.webContents.send('desktop:main-action', 'refresh'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createCompanionWindow();
    } else {
      showWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  uIOhook.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

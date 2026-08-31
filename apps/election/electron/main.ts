import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, protocol, screen, shell, Tray } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
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
let companionOverlayState = { menuOpen: false, settingsOpen: false };
let companionPointerDown: { x: number; y: number } | null = null;
// The transparent host stays fixed. Only the model inside it scales, leaving
// the menu bubbles in the same desktop coordinates at every size.
const COMPANION_WINDOW_WIDTH = 780;
const COMPANION_WINDOW_HEIGHT = 520;
type CompanionSettings = { scale: number; visible: boolean; replyTemplate: string };
type QuietNotificationResult = { enabled: boolean; managedApps: string[]; message: string };
let companionSettings: CompanionSettings = { scale: 1, visible: true, replyTemplate: '{username} {message}' };
let quietNotificationConsentGranted = false;
const quietNotificationBackup = new Map<string, string | null>();
let quietPopupGuard: ChildProcess | null = null;

const companionSettingsPath = () => path.join(app.getPath('userData'), 'companion-settings.json');
const normalizeCompanionSettings = (settings: Partial<CompanionSettings>): CompanionSettings => ({
  // The desktop control is a continuous slider. Clamp persisted values too so a
  // manually edited preference file can never create an impractically sized pet.
  scale: Number.isFinite(Number(settings.scale))
    ? Math.round(Math.max(0.7, Math.min(1.3, Number(settings.scale))) * 100) / 100
    : companionSettings.scale,
  visible: typeof settings.visible === 'boolean' ? settings.visible : companionSettings.visible,
  replyTemplate: typeof settings.replyTemplate === 'string' && settings.replyTemplate.trim().length > 0
    ? settings.replyTemplate.trim().slice(0, 80)
    : companionSettings.replyTemplate
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
const quietPopupGuardPath = () => path.join(app.getPath('userData'), 'quiet-popup-guard.ps1');
const quietPopupGuardScript = `
$source = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class LecPunchQuietWindowGuard {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
}
'@
Add-Type -TypeDefinition $source
while ($true) {
  [LecPunchQuietWindowGuard]::EnumWindows({
    param($handle, $unused)
    if (-not [LecPunchQuietWindowGuard]::IsWindowVisible($handle)) { return $true }
    $processId = [uint32]0
    [LecPunchQuietWindowGuard]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
    try { $process = Get-Process -Id $processId -ErrorAction Stop } catch { return $true }
    if ($process.ProcessName -notmatch '^(QQ|WeChat|Weixin)$') { return $true }
    $rect = [LecPunchQuietWindowGuard+RECT]::new()
    [LecPunchQuietWindowGuard]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    # Preserve full chat windows. QQ/WeChat native notification panes are
    # short, secondary top-level windows; hide only that constrained shape.
    if ($width -ge 160 -and $width -le 700 -and $height -ge 55 -and $height -le 420) {
      [LecPunchQuietWindowGuard]::ShowWindow($handle, 0) | Out-Null
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 150
}
`;
const setQuietNativePopupGuard = (enabled: boolean) => {
  if (process.platform !== 'win32') return false;
  if (!enabled) {
    quietPopupGuard?.kill();
    quietPopupGuard = null;
    return false;
  }
  if (quietPopupGuard && !quietPopupGuard.killed) return true;
  try {
    fs.writeFileSync(quietPopupGuardPath(), quietPopupGuardScript, 'utf8');
    quietPopupGuard = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', quietPopupGuardPath()], { windowsHide: true, stdio: 'ignore' });
    quietPopupGuard.once('exit', () => { quietPopupGuard = null; });
    return true;
  } catch {
    quietPopupGuard = null;
    return false;
  }
};
const quietAppKind = (key: string): '微信' | 'QQ' | null => {
  const appId = key.split('\\').pop()?.toLowerCase() ?? '';
  // Keep this deliberately strict: QQLive and other Tencent products must not
  // be muted when the user only asks to silence QQ / WeChat messages.
  if (/(^|[!._-])(wechat|weixin|wecom|tencentwechat|tencentwework)([!._-]|$)/i.test(appId)) return '微信';
  if (/(^|!)(qq|tencentqq|qq\.exe|com\.tencent\.qq)(?=$|[._-])/i.test(appId)) return 'QQ';
  return null;
};
const findQuietAppNotificationKeys = async () => {
  const { stdout } = await runReg(['query', notificationSettingsRoot, '/s']);
  return [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('HKEY_CURRENT_USER\\') && quietAppKind(line)))];
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
  let popupGuardActive = false;
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
    popupGuardActive = setQuietNativePopupGuard(enabled);
    return { enabled: false, managedApps: [], message: popupGuardActive ? 'Windows 横幅设置暂时无法修改，但 QQ/微信原生通知窗拦截已开启。' : 'Windows 通知设置暂时无法修改；可改用 Windows 专注助手。' };
  }
  popupGuardActive = setQuietNativePopupGuard(enabled);
  const managedApps = keys.map((key) => quietAppKind(key)).filter((name): name is '微信' | 'QQ' => Boolean(name));
  if (!managedApps.length) return { enabled, managedApps: [], message: enabled && popupGuardActive ? '未发现已登记的 Windows 横幅；QQ/微信原生通知窗拦截已开启。' : '未发现已登记的 QQ 或微信 Windows 通知。请先让对应软件产生一次系统通知后，再重新开启免提示模式。' };
  return { enabled, managedApps: [...new Set(managedApps)], message: enabled ? `已关闭 ${[...new Set(managedApps)].join('、')} 的 Windows 通知${popupGuardActive ? '，并开启原生通知窗拦截。' : '。'}` : `已恢复 ${[...new Set(managedApps)].join('、')} 的原通知设置，并停止原生通知窗拦截。` };
};
const companionDimensions = () => ({ width: COMPANION_WINDOW_WIDTH, height: COMPANION_WINDOW_HEIGHT });
const companionModelBounds = () => {
  if (!companionWindow || !companionWindow.isVisible()) return null;
  const [windowX, windowY] = companionWindow.getPosition();
  const scale = companionSettings.scale;
  // Keep these values in sync with the fixed desktop CSS layout. The scale
  // origin is the model's bottom center, matching .cat-visual.
  const baseX = windowX + 140;
  const baseY = windowY + 142;
  return {
    x: baseX + (1 - scale) * 240,
    y: baseY + (1 - scale) * 278,
    width: 480 * scale,
    height: 278 * scale
  };
};
const isCursorOnCompanionModel = () => {
  const bounds = companionModelBounds();
  if (!bounds) return false;
  const point = screen.getCursorScreenPoint();
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
};
const companionMenuAnchor = () => ({
  x: 320 - companionSettings.scale * 60,
  y: 350 - companionSettings.scale * 145
});
const isCursorOnCompanionBubble = () => {
  if (!companionOverlayState.menuOpen) return false;
  const bounds = companionModelBounds();
  if (!bounds || !companionWindow) return false;
  const [windowX, windowY] = companionWindow.getPosition();
  const anchor = companionMenuAnchor();
  const offsets = [[-71, 65], [-126, 12], [-130, -55], [-79, -108], [-8, -129]];
  const point = screen.getCursorScreenPoint();
  return offsets.some(([offsetX, offsetY]) => {
    const x = windowX + 60 + anchor.x + offsetX;
    const y = windowY + 70 + anchor.y + offsetY;
    return point.x >= x && point.x <= x + 44 && point.y >= y && point.y <= y + 44;
  });
};

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
  companionOverlayState = { menuOpen: false, settingsOpen: false };
  companionPointerDown = null;
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
  // Native drag regions do not emit DOM click events. Track a global press and
  // release so the complete scaled model can both drag and open its menu.
  uIOhook.on('mousedown', (event) => {
    if (Number(event.button) !== 1 || companionOverlayState.settingsOpen || isCursorOnCompanionBubble() || !isCursorOnCompanionModel()) return;
    companionPointerDown = screen.getCursorScreenPoint();
  });
  uIOhook.on('mouseup', (event) => {
    if (Number(event.button) !== 1 || !companionPointerDown) return;
    const start = companionPointerDown;
    companionPointerDown = null;
    const end = screen.getCursorScreenPoint();
    if (companionOverlayState.settingsOpen || isCursorOnCompanionBubble() || Math.hypot(end.x - start.x, end.y - start.y) > 6 || !isCursorOnCompanionModel()) return;
    companionWindow?.webContents.send('bongo:toggle-menu');
  });
  uIOhook.start();

  ipcMain.handle('desktop:notify', (_event, payload: { title?: string; body?: string }) => {
    // The pet bubble is the fallback when Windows notifications are unavailable
    // or disabled by the operating system.
    companionWindow?.webContents.send('bongo:message', { message: payload.body || '' });
    if (!Notification.isSupported()) return { supported: false };
    new Notification({
      title: payload.title || 'LecPunch Election',
      body: payload.body || ''
    }).show();
    return { supported: true };
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
    const shouldResizeWindow = changes.visible !== undefined || oldWidth !== width || oldHeight !== height;
    // Slider changes deliberately do not resize the native window after the
    // one-time host migration from older, smaller companion windows.
    if (!shouldResizeWindow) return companionSettings;
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
  ipcMain.handle('desktop:show-companion', () => {
    showCompanion();
    return companionSettings;
  });
  ipcMain.on('desktop:set-companion-overlay-state', (_event, state: Partial<typeof companionOverlayState>) => {
    companionOverlayState = { ...companionOverlayState, ...state };
  });
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
  setQuietNativePopupGuard(false);
  uIOhook.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

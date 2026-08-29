import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lecpunchDesktop', {
  platform: process.platform,
  isDesktop: true,
  isPackaged: !process.defaultApp,
  notify: (payload: { title: string; body: string }) => ipcRenderer.invoke('desktop:notify', payload),
  hideToTray: () => ipcRenderer.invoke('desktop:hide-to-tray'),
  setImmersive: (enabled: boolean) => ipcRenderer.invoke('desktop:set-immersive', enabled),
  onBongoKey: (callback: (event: { kind: 'keydown' | 'keyup'; key: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { kind: 'keydown' | 'keyup'; key: string }) => callback(payload);
    ipcRenderer.on('bongo:key', listener);
    return () => ipcRenderer.removeListener('bongo:key', listener);
  },
  moveCompanionBy: (delta: { x: number; y: number }) => ipcRenderer.invoke('desktop:move-companion-by', delta),
  showMain: (action: 'schedule' | 'shop') => ipcRenderer.invoke('desktop:show-main', action),
  notifyMainStateChanged: () => ipcRenderer.invoke('desktop:notify-main-state'),
  onMainAction: (callback: (action: 'schedule' | 'shop' | 'refresh') => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: 'schedule' | 'shop' | 'refresh') => callback(action);
    ipcRenderer.on('desktop:main-action', listener);
    return () => ipcRenderer.removeListener('desktop:main-action', listener);
  }
});

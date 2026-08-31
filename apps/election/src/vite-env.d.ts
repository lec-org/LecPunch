/// <reference types="vite/client" />

interface Window {
  lecpunchDesktop?: {
    platform: string;
    isDesktop: boolean;
    isPackaged: boolean;
    notify: (payload: { title: string; body: string }) => Promise<void>;
    hideToTray: () => Promise<void>;
    setImmersive: (enabled: boolean) => Promise<{ enabled: boolean; managedApps: string[]; message: string }>;
    onMainImmersive: (callback: (enabled: boolean) => void) => () => void;
    onBongoKey: (callback: (event: { kind: 'keydown' | 'keyup'; key: string }) => void) => () => void;
    onBongoMenuToggle: (callback: () => void) => () => void;
    setCompanionOverlayActive: (active: boolean) => void;
    getCompanionSettings: () => Promise<{ scale: number; visible: boolean }>;
    updateCompanionSettings: (settings: { scale?: number; visible?: boolean }) => Promise<{ scale: number; visible: boolean }>;
    showCompanion: () => Promise<{ scale: number; visible: boolean }>;
    openFocusAssist: () => Promise<void>;
    showMain: (action: 'schedule' | 'shop') => Promise<void>;
    notifyMainStateChanged: () => Promise<void>;
    onMainAction: (callback: (action: 'schedule' | 'shop' | 'refresh') => void) => () => void;
  };
}

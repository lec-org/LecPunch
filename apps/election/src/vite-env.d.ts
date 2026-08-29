/// <reference types="vite/client" />

interface Window {
  lecpunchDesktop?: {
    platform: string;
    isDesktop: boolean;
    isPackaged: boolean;
    notify: (payload: { title: string; body: string }) => Promise<void>;
    hideToTray: () => Promise<void>;
    setImmersive: (enabled: boolean) => Promise<void>;
    onMainImmersive: (callback: (enabled: boolean) => void) => () => void;
    onBongoKey: (callback: (event: { kind: 'keydown' | 'keyup'; key: string }) => void) => () => void;
    getCompanionSettings: () => Promise<{ scale: number; visible: boolean }>;
    updateCompanionSettings: (settings: { scale?: number; visible?: boolean }) => Promise<{ scale: number; visible: boolean }>;
    openFocusAssist: () => Promise<void>;
    showMain: (action: 'schedule' | 'shop') => Promise<void>;
    notifyMainStateChanged: () => Promise<void>;
    onMainAction: (callback: (action: 'schedule' | 'shop' | 'refresh') => void) => () => void;
  };
}

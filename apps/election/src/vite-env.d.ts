/// <reference types="vite/client" />

interface Window {
  lecpunchDesktop?: {
    platform: string;
    isDesktop: boolean;
    isPackaged: boolean;
    notify: (payload: { title: string; body: string }) => Promise<void>;
    hideToTray: () => Promise<void>;
    setImmersive: (enabled: boolean) => Promise<void>;
    onBongoKey: (callback: (event: { kind: 'keydown' | 'keyup'; key: string }) => void) => () => void;
    moveCompanionBy: (delta: { x: number; y: number }) => Promise<void>;
    showMain: (action: 'schedule' | 'shop') => Promise<void>;
    notifyMainStateChanged: () => Promise<void>;
    onMainAction: (callback: (action: 'schedule' | 'shop' | 'refresh') => void) => () => void;
  };
}

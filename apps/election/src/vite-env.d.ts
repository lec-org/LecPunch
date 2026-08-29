/// <reference types="vite/client" />

interface Window {
  lecpunchDesktop?: {
    platform: string;
    isDesktop: boolean;
    notify: (payload: { title: string; body: string }) => Promise<void>;
    hideToTray: () => Promise<void>;
    setImmersive: (enabled: boolean) => Promise<void>;
  };
}

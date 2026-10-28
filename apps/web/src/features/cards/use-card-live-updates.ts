import { useEffect, useRef } from 'react';

export const CARD_LIVE_INTERVAL_MS = 5_000;
type Sync = (signal: AbortSignal) => Promise<boolean | undefined>;

/** Notifications remain durable on the server while animations or dialogs hold delivery. */
export const useCardLiveUpdates = (sync: Sync, paused: boolean, ready: boolean) => {
  const started = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (paused) { started.current = true; return; }
    let stopped = false, running = false, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const available = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && available()) timer = setTimeout(() => void tick(), Math.min(30_000, CARD_LIVE_INTERVAL_MS * 2 ** failures));
    };
    const tick = async () => {
      if (stopped || running || !available()) return;
      running = true; controller = new AbortController();
      try {
        const success = await sync(controller.signal);
        if (!stopped && !controller.signal.aborted) failures = success === false ? Math.min(3, failures + 1) : 0;
      } catch {
        if (!stopped && !controller.signal.aborted) failures = Math.min(3, failures + 1);
      } finally { running = false; schedule(); }
    };
    const wake = () => {
      clearTimeout(timer);
      if (!available()) { controller?.abort(); return; }
      failures = 0; void tick();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', wake);
    // The initial page load already read the state; only resuming a hold needs an immediate catch-up.
    if (started.current) void tick(); else { started.current = true; schedule(); }
    return () => {
      stopped = true; clearTimeout(timer); controller?.abort();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', wake);
    };
  }, [sync, paused, ready]);
};

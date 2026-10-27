import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCardArt } from './cards.api';

class ArtCache {
  private entries = new Map<string, { controller: AbortController; promise: Promise<string>; url?: string }>();
  get(id: string): Promise<string> {
    const existing = this.entries.get(id); if (existing) return existing.promise;
    const controller = new AbortController();
    const entry: { controller: AbortController; promise: Promise<string>; url?: string } = { controller, promise: Promise.resolve('') };
    entry.promise = getCardArt(id, controller.signal).then(blob => {
      if (controller.signal.aborted) throw new Error('Card art request cancelled');
      entry.url = URL.createObjectURL(blob); return entry.url;
    }).catch(error => { if (this.entries.get(id) === entry) this.entries.delete(id); throw error; });
    this.entries.set(id, entry); return entry.promise;
  }
  dispose() { for (const entry of this.entries.values()) { entry.controller.abort(); if (entry.url) URL.revokeObjectURL(entry.url); } this.entries.clear(); }
}
const ArtContext = createContext<ArtCache | null>(null);
// The scope is keyed by the authenticated account. No cross-account art cache survives logout.
export const CardArtScope = ({ children }: { children: ReactNode }) => {
  const cache = useMemo(() => new ArtCache(), []);
  useEffect(() => () => cache.dispose(), [cache]);
  return <ArtContext.Provider value={cache}>{children}</ArtContext.Provider>;
};

export const CardArt = ({ id, name, interactive = true, onReady }: { id: string; name: string; interactive?: boolean; onReady?: () => void }) => {
  const sharedCache = useContext(ArtContext);
  const ownCache = useMemo(() => new ArtCache(), []);
  const cache = sharedCache ?? ownCache;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setUrl(null); setFailed(false);
    void cache.get(id).then(value => { if (active) setUrl(value); }).catch(() => { if (active) { setFailed(true); onReady?.(); } });
    return () => { active = false; };
  }, [cache, id, attempt, onReady]);
  useEffect(() => () => ownCache.dispose(), [ownCache]);
  return <div className="aspect-[2/3] overflow-hidden rounded-xl bg-gray-100 flex items-center justify-center">
    {url ? <img className="h-full w-full object-cover" src={url} alt={`${name}卡面`} onLoad={onReady} onError={() => { setFailed(true); setUrl(null); onReady?.(); }} /> :
      <span className="px-4 text-center text-sm text-gray-500">{failed ? interactive ? <button type="button" className="underline underline-offset-4" onClick={() => setAttempt(n => n + 1)}>卡面加载失败，重试</button> : '卡面暂不可用' : '正在读取卡面…'}</span>}
  </div>;
};

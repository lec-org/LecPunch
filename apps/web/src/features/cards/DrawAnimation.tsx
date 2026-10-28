import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CardGameActionResponse } from '@lecpunch/shared';
import { Play, SkipForward, X } from 'lucide-react';
import { Button } from '@lecpunch/ui';
import { CardArt } from './CardArt';
import './draw-reveal.css';

const RewardArt = ({ id, name, animated }: { id: string; name: string; animated: boolean }) => {
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  return <div className={`draw-card-art${ready ? ' is-ready' : ''}${animated ? '' : ' is-instant'}`} data-art-ready={ready}>
    <CardArt id={id} name={name} onReady={markReady} />
  </div>;
};

const sources = {
  blue: '/media/card-draw/blue.mp4', purple: '/media/card-draw/purple.mp4',
  gold: '/media/card-draw/gold.mp4', radiance: '/media/card-draw/radiance.mp4'
};
export const DrawAnimation = ({ response, onComplete }: { response: CardGameActionResponse; onComplete: () => void }) => {
  const batch = response.result.drawCount === 10;
  const dialog = useRef<HTMLDialogElement>(null), video = useRef<HTMLVideoElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [revealed, setRevealed] = useState(false), [manualPlay, setManualPlay] = useState(false), [notice, setNotice] = useState('');
  const [transitioning, setTransitioning] = useState(false);
  const [summary, setSummary] = useState(false), [revealIndex, setRevealIndex] = useState(0);
  const revealTimer = useRef<number | undefined>(undefined), revealStarted = useRef(false);
  const completed = useRef(false), mounted = useRef(true);
  const complete = useCallback(() => { if (completed.current) return; completed.current = true; onComplete(); }, [onComplete]);
  const reveal = useCallback((failure?: string, cinematic = false, summaryOnly = false) => {
    if (cinematic && revealStarted.current) return;
    revealStarted.current = true;
    video.current?.pause(); setNotice(failure ?? ''); setSummary(summaryOnly);
    window.clearTimeout(revealTimer.current);
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (cinematic && !reduced) {
      setTransitioning(true);
      // Swap the video for the result while the white wash is at its brightest.
      revealTimer.current = window.setTimeout(() => setRevealed(true), 260);
    } else { setTransitioning(false); setRevealed(true); }
  }, []);
  const orderedIds = useMemo(() => response.result.gainedCardIds ?? (response.result.gainedCardId ? [response.result.gainedCardId] : []), [response]);
  const rewards = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of orderedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].map(([id, quantity]) => ({ id, quantity, card: response.state.collection.find(card => card.id === id && card.unlocked) }));
  }, [orderedIds, response]);
  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    if (element && !element.open) { if (typeof element.showModal === 'function') element.showModal(); else element.setAttribute('open', ''); }
    return () => { mounted.current = false; window.clearTimeout(revealTimer.current); video.current?.pause(); element?.close?.(); returnFocus.current?.focus(); };
  }, []);
  const play = useCallback(() => {
    setManualPlay(false);
    try {
      const promise = video.current?.play();
      if (promise) void promise.catch(() => { if (mounted.current) setManualPlay(true); });
    } catch { setManualPlay(true); }
  }, []);
  useEffect(() => {
    if (revealed) return;
    play();
    const timer = window.setTimeout(() => { if (video.current && video.current.readyState < 2) reveal('视频加载超时；抽卡已完成，奖励已保存。'); }, 15000);
    return () => window.clearTimeout(timer);
  }, [play, reveal, revealed]);
  const animation = response.result.drawAnimation;
  const rewardCount = orderedIds.length;
  const sequential = batch && !summary;
  const activeId = orderedIds[revealIndex];
  const activeCard = response.state.collection.find(card => card.id === activeId && card.unlocked);
  return <dialog ref={dialog} aria-labelledby="draw-animation-title" aria-describedby="draw-animation-description" onCancel={event => { event.preventDefault(); complete(); }} className="m-auto w-[min(900px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-950 p-0 text-white shadow-2xl backdrop:bg-black/80">
    <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4"><div><h2 id="draw-animation-title" className="text-lg font-medium">{revealed ? sequential ? `第 ${revealIndex + 1} / ${rewardCount} 张` : batch ? '十连结果' : '本次获得' : '抽卡揭晓'}</h2><p id="draw-animation-description" className="mt-1 text-xs text-gray-300">{revealed ? '奖励已由服务端保存到你的库存。' : '抽卡已完成，正在播放揭晓动画；跳过不会影响奖励。'}</p></div><button type="button" autoFocus className="rounded-lg p-2 text-gray-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white" aria-label="关闭动画并查看已保存结果" onClick={complete}><X size={20} aria-hidden="true" /></button></header>
    <div className="draw-presentation">
    {!revealed ? <><div className="relative flex aspect-video max-h-[65vh] items-center justify-center bg-black">
      {animation && <video ref={video} className="h-full w-full object-contain" src={sources[animation]} autoPlay muted playsInline preload="metadata" onEnded={() => reveal(undefined, true)} onError={() => reveal('视频无法播放；抽卡已完成，奖励已保存。')} onPlaying={() => setManualPlay(false)} aria-label="抽卡揭晓视频" />}
      {manualPlay && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60"><p className="text-sm">浏览器暂停了自动播放，点击继续。</p><Button onClick={play}><Play size={16} aria-hidden="true" />播放揭晓动画</Button></div>}
    </div><div className="flex justify-end px-5 py-4"><Button variant="outline" onClick={() => reveal(undefined, false, batch)}><SkipForward size={16} aria-hidden="true" />{batch ? '跳过展示，直接看十连结果' : '跳过动画，查看结果'}</Button></div></> : <div className="p-5 space-y-5">
      {notice && <p role="alert" className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">{notice}</p>}
      {sequential ? <>
        <article key={`${revealIndex}:${activeId}`} className="draw-reward-enter mx-auto w-48 rounded-xl border border-white/20 bg-white/5 p-3 sm:w-56">
          <RewardArt id={activeId} name={activeCard?.name ?? '已获得卡牌'} animated />
          <h3 className="mt-3 break-words text-center font-medium">{activeCard?.name ?? '已获得卡牌'}</h3>
          <p className="mt-1 text-center text-xs text-gray-300">{activeCard?.rarity} · 已加入库存</p>
        </article>
        <p role="status" aria-live="polite" className="text-center text-sm text-gray-200">已揭晓 {revealIndex + 1} / {rewardCount} 张</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => { if (revealIndex + 1 < rewardCount) setRevealIndex(index => index + 1); else { setSummary(true); setTransitioning(false); } }}>{revealIndex + 1 < rewardCount ? '下一张' : '查看十连结果'}</Button>
          <Button variant="outline" onClick={() => { setSummary(true); setTransitioning(false); }}><SkipForward size={16} aria-hidden="true" />跳过展示，直接看十连结果</Button>
        </div>
      </> : <>
      {batch && <p className="text-center text-sm text-gray-200">10 次抽取 · 共获得 {rewardCount} 张卡牌；相同卡牌合并显示数量。</p>}
      {response.result.drawAnimation === 'radiance' && <p className="text-center text-sm text-amber-200">{batch ? '捕获明光 · 十连至少获得两张 SSR，总数仍为 10 张' : '捕获明光 · 本次获得 2 张 SSR 卡牌'}</p>}
      <div className={`mx-auto flex flex-wrap justify-center gap-5 ${batch ? 'max-w-3xl' : 'max-w-xl'}`}>{rewards.map(({ id, quantity, card }, index) => <article key={id} className={`${batch ? 'w-28 sm:w-32' : 'w-40 sm:w-48'} rounded-xl border border-white/20 bg-white/5 p-3${transitioning ? ' draw-reward-enter' : ''}`} style={{ '--reward-index': index } as CSSProperties}><RewardArt id={id} name={card?.name ?? '已获得卡牌'} animated={transitioning} /><h3 className="mt-3 break-words font-medium">{card?.name ?? '已获得卡牌'} {quantity > 1 && `×${quantity}`}</h3><p className="mt-1 text-xs text-gray-300">{card?.rarity} · 已加入库存</p></article>)}</div>
      <p role="status" className="text-center text-sm leading-6 text-gray-200">{response.result.message}</p>
      <div className="flex justify-center"><Button onClick={complete}>完成，返回卡牌页面</Button></div>
      </>}
    </div>}
    {transitioning && <div className="draw-white-wash" aria-hidden="true" />}
    </div>
  </dialog>;
};

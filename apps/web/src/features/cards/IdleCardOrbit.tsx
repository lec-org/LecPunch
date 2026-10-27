import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CircleHelp, Pause, Play, Sparkles } from 'lucide-react';
import type { CardCollectionItem, CardGameActionResult, CardRarity } from '@lecpunch/shared';
import { CardArt } from './CardArt';
import './idle-card-orbit.css';

export interface DrawAnimationState { pending: boolean; result: CardGameActionResult | null }
export interface IdleCardOrbitProps {
  collection: CardCollectionItem[];
  animationState?: DrawAnimationState;
  /** Future user-supplied draw animation mounts here; the orbit itself never simulates a draw. */
  renderDrawAnimation?: (state: DrawAnimationState) => ReactNode;
}
const levels: CardRarity[] = ['N', 'R', 'SR', 'SSR'];
const OrbitFace = ({ card, back = false }: { card: CardCollectionItem; back?: boolean }) => (
  <div className={`card-orbit-face ${back ? 'card-orbit-back' : 'card-orbit-front'}`} data-rarity={card.unlocked ? card.rarity : 'unknown'}>
    {card.unlocked ? <CardArt id={card.id} name={card.name ?? '已发现卡牌'} interactive={false} /> : <div className="card-orbit-unknown"><CircleHelp size={36} strokeWidth={1} /><span>未发现</span></div>}
    <div className="card-orbit-label"><span>{card.rarity}</span><span>{card.unlocked ? card.name : '未知卡牌'}</span></div>
  </div>
);
export const selectOrbitCards = (collection: CardCollectionItem[]) => {
  const sorted = [...collection].sort((a,b) => a.id.localeCompare(b.id));
  const result: CardCollectionItem[] = [];
  for (const rarity of levels) {
    const group = sorted.filter(card => card.rarity === rarity);
    const revealed = group.filter(card => card.unlocked);
    const unknown = group.filter(card => !card.unlocked);
    // At most two representatives per rarity: an obtained face plus an unexplored place.
    if (revealed.length) result.push(revealed[0]);
    if (unknown.length) result.push(unknown[Math.floor((unknown.length - 1) / 2)]);
    else if (revealed.length > 1) result.push(revealed[revealed.length - 1]);
    if (!revealed.length && unknown.length > 1) result.push(unknown[unknown.length - 1]);
  }
  return result.slice(0,8);
};
export const IdleCardOrbit = ({ collection, renderDrawAnimation, animationState = { pending: false, result: null } }: IdleCardOrbitProps) => {
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null), offset = useRef(0), target = useRef(0);
  const frame = useRef<number | null>(null), previousFrame = useRef<number | null>(null);
  const drag = useRef<{ pointerId: number; x: number } | null>(null);
  const instructionsId = useId();
  const stopRotation = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null; previousFrame.current = null; target.current = offset.current;
  }, []);
  const rotate = useCallback((degrees: number, smooth = false) => {
    if (!Number.isFinite(degrees)) return;
    if (!smooth) {
      stopRotation(); offset.current += degrees; target.current = offset.current;
      stage.current?.style.setProperty('--orbit-offset', `${offset.current}deg`); return;
    }
    // Keep the target unwrapped: crossing 360 degrees must not reverse the interpolation.
    // Opposite input replaces queued momentum so reversal follows the next frame.
    if ((target.current - offset.current) * degrees < 0) target.current = offset.current;
    target.current += degrees;
    if (frame.current !== null) return;
    const tick = (now: number) => {
      const elapsed = previousFrame.current === null ? 16 : Math.min(64, Math.max(0, now - previousFrame.current));
      previousFrame.current = now;
      const remaining = target.current - offset.current;
      offset.current = Math.abs(remaining) < .02 ? target.current : offset.current + remaining * (1 - Math.exp(-elapsed / 95));
      stage.current?.style.setProperty('--orbit-offset', `${offset.current}deg`);
      if (offset.current === target.current) { frame.current = null; previousFrame.current = null; }
      else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [stopRotation]);
  useEffect(() => () => stopRotation(), [stopRotation]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      // Preserve browser pinch/zoom gestures. Only the card stage consumes ordinary wheel input.
      if (event.ctrlKey || event.metaKey || !event.cancelable) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta || !Number.isFinite(delta)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
      rotate(Math.max(-120, Math.min(120, delta * unit)) * .18, true);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [rotate]);
  const cards = useMemo(() => selectOrbitCards(collection), [collection]);
  return <section className="card-orbit-shell" aria-label="卡牌浮空展示">
    <header className="card-orbit-header"><div><p className="card-orbit-eyebrow">LEC COLLECTION</p><h2>等待下一次相遇</h2><p>未知的卡面，等你亲手揭晓。</p></div><button type="button" className="card-orbit-toggle" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{paused ? '继续旋绕' : '暂停旋绕'}</button></header>
    <div ref={stage} className={`card-orbit-stage${paused ? ' is-paused' : ''}${dragging ? ' is-dragging' : ''}`}
      data-paused={paused ? 'true' : 'false'} role="group" aria-label="可交互卡阵" aria-describedby={instructionsId} tabIndex={0}
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        stopRotation(); drag.current = { pointerId: event.pointerId, x: event.clientX };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.focus({ preventScroll: true }); setDragging(true);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        rotate((current.x - event.clientX) * .45); current.x = event.clientX;
      }}
      onPointerUp={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null; setDragging(false);
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); rotate(event.key === 'ArrowLeft' ? -15 : 15); }
        else if (event.key === 'Home') { event.preventDefault(); rotate(-offset.current); }
      }}>
      <div className="card-orbit-track" aria-hidden="true" />
      <div className="card-orbit-core" aria-hidden="true"><Sparkles size={26} /><span>LEC</span></div>
      <div className="card-orbit-space" aria-hidden="true">{cards.map((card,index) => <div key={card.id} data-orbit-card={card.id} className="card-orbit-position" style={{ '--slot': index, '--slots': cards.length, '--tilt': `${index % 2 ? -9 : 11}deg` } as CSSProperties}>
        <div className="card-orbit-card"><OrbitFace card={card} /><OrbitFace card={card} back /></div>
      </div>)}</div>
      {renderDrawAnimation && <div className="card-draw-animation-slot">{renderDrawAnimation(animationState)}</div>}
    </div>
    <p id={instructionsId} className="card-orbit-caption">拖拽或滚轮双向旋转 · 键盘 ← → 旋转，Home 复位 · 悬停或聚焦暂停自动旋绕</p>
  </section>;
};

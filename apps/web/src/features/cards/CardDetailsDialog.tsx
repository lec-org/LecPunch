import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { CardCollectionItem } from '@lecpunch/shared';
import { CardArt } from './CardArt';

export const CardDetailsDialog = ({ card, onClose, children }: {
  card: CardCollectionItem; onClose: () => void; children: ReactNode;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    }
    return () => { element?.close?.(); returnFocus.current?.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="card-details-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    className="m-auto w-[min(820px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl backdrop:bg-black/55">
    <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
      <div><h2 id="card-details-title" className="text-xl font-semibold leading-7">{card.name}</h2>
        <p className="mt-2 text-sm text-gray-500">{card.rarity} · {card.type} · 持有 {card.quantity}</p></div>
      <button type="button" autoFocus aria-label="关闭卡牌详情" onClick={onClose}
        className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-600"><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="grid gap-6 p-6 sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="mx-auto w-36 sm:w-full"><CardArt id={card.id} name={card.name ?? '已发现卡牌'} /></div>
      <div className="min-w-0 space-y-4">
        <p className="text-sm leading-7">{card.effect}</p>
        <p className="text-sm leading-7 text-gray-500">{card.detail}</p>
        {children}
      </div>
    </div>
  </dialog>;
};

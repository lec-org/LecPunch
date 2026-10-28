import { useEffect, useRef, useState } from 'react';
import { Gift, X } from 'lucide-react';
import { Button } from '@lecpunch/ui';
import type { CardGiftNotice } from '@lecpunch/shared';
import { CardArt } from './CardArt';
import { acknowledgeCardGifts } from './cards.api';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatDateTime } from '@/shared/lib/time';

export const CardGiftInboxDialog = ({ gifts, onClose, onConfirmed }: {
  gifts: CardGiftNotice[]; onClose: () => void; onConfirmed: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null), gate = useRef(false), alive = useRef(true);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    alive.current = true;
    const element = dialog.current;
    if (element && !element.open) { if (typeof element.showModal === 'function') element.showModal(); else element.setAttribute('open', ''); }
    return () => { alive.current = false; element?.close?.(); returnFocus.current?.isConnected && returnFocus.current.focus(); };
  }, []);
  const confirm = async () => {
    if (gate.current) return;
    gate.current = true; setBusy(true); setError('');
    try {
      await acknowledgeCardGifts(gifts.map(gift => gift.id));
      if (alive.current) onConfirmed();
    } catch (cause) {
      if (alive.current) setError(getApiErrorMessage(cause, '已读状态尚未确认，卡片已经在库存中。可以重试，不会重复领取。'));
    } finally { gate.current = false; if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} aria-labelledby="card-gifts-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto w-[min(720px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl backdrop:bg-black/55">
    <header className="flex items-start justify-between gap-4"><div><Gift className="mb-3 h-7 w-7 text-gray-700" aria-hidden="true" /><h2 id="card-gifts-title" className="text-xl font-semibold">你收到了赠送的卡片</h2><p className="mt-2 text-sm leading-6 text-gray-500">以下 {gifts.length} 张卡片已自动加入库存，并永久解锁图鉴，无需再次领取。</p></div>
      <button autoFocus type="button" disabled={busy} aria-label="稍后查看赠卡通知" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"><X size={20} /></button></header>
    <ul className="mt-5 grid gap-4 sm:grid-cols-2">{gifts.map(gift => <li key={gift.id} className="flex gap-4 rounded-xl border border-gray-200 p-4"><div className="w-20 shrink-0"><CardArt id={gift.card.id} name={gift.card.name} interactive={false} /></div><div className="min-w-0 text-sm"><p className="text-xs text-gray-500">{gift.card.rarity} · 1 张</p><h3 className="mt-1 font-semibold">{gift.card.name}</h3><p className="mt-3 break-words">来自 {gift.sender.displayName}（{gift.sender.username}）</p><time dateTime={gift.at} className="mt-1 block text-xs text-gray-500">{formatDateTime(gift.at)}</time></div></li>)}</ul>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <footer className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={busy} onClick={onClose}>稍后再看</Button><Button loading={busy} disabled={busy} onClick={() => void confirm()}>知道了，查看卡牌</Button></footer>
  </dialog>;
};

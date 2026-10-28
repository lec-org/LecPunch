import { useCallback, useEffect, useRef } from 'react';
import { Layers3, X } from 'lucide-react';
import { Button } from '@lecpunch/ui';
import type { MemberCardInventory } from '@lecpunch/shared';
import { getMemberCardInventory } from './cards.api';
import { useAsyncData } from '@/shared/hooks/useAsyncData';
import { getApiErrorMessage } from '@/shared/lib/api-error';

export const MemberCardInventoryDialog = ({ memberKey, displayName, onClose }: {
  memberKey: string; displayName: string; onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const fetchInventory = useCallback((signal: AbortSignal) => getMemberCardInventory(memberKey, signal), [memberKey]);
  const { data, loading, error, refresh } = useAsyncData(fetchInventory, [memberKey], { initialData: null as MemberCardInventory | null });
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) { if (typeof element.showModal === 'function') element.showModal(); else element.setAttribute('open', ''); }
    return () => { element?.close?.(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="member-card-inventory-title" onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto w-[min(820px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl backdrop:bg-black/55">
    <header className="flex items-start justify-between gap-4"><div><h2 id="member-card-inventory-title" className="text-xl font-semibold">{displayName}的卡牌库存</h2><p className="mt-2 text-sm text-gray-500">{data ? `当前持有 ${data.total} 张 · ${data.items.length} 种；重复卡按张数计入。` : '读取当前持有卡片…'}</p></div>
      <button autoFocus type="button" aria-label="关闭成员卡牌库存" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-600"><X size={20} aria-hidden="true" /></button></header>
    {Boolean(error) && <div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800">{getApiErrorMessage(error, '卡牌库存读取失败，不能确定当前数量。')}<Button className="mt-3" variant="outline" disabled={loading} onClick={refresh}>重新读取库存</Button></div>}
    {loading && <p role="status" className="py-6 text-sm text-gray-500">正在读取卡牌库存…</p>}
    {data && !data.items.length && <p className="mt-5 rounded-xl bg-gray-50 p-5 text-sm text-gray-600">当前没有持有的卡片；已使用或送出的卡片不计入库存。</p>}
    {data && <ul className="mt-5 grid gap-3 sm:grid-cols-2">{data.items.map(card => <li key={card.id} className="rounded-xl border border-gray-200 p-4"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold tracking-wide text-gray-500">{card.rarity}</span><span className="rounded-full bg-gray-100 px-3 py-1 text-sm tabular-nums">×{card.quantity}</span></div><h3 className="mt-2 flex items-center gap-2 font-semibold"><Layers3 size={16} className="shrink-0 text-gray-400" aria-hidden="true" />{card.name}</h3><p className="mt-1 text-xs text-gray-500">{card.type}</p><p className="mt-3 text-sm leading-6 text-gray-700">{card.effect}</p><p className="mt-2 text-xs leading-6 text-gray-500">{card.detail}</p></li>)}</ul>}
    <p className="mt-5 text-xs leading-6 text-gray-500">库存会随抽卡、用卡、自动防御和赠送变化。查看成员库存不会解锁你的图鉴；卡面需本人获得后查看。</p>
  </dialog>;
};

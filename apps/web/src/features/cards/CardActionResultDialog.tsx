import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@lecpunch/ui';
import type { CardGameActionResponse } from '@lecpunch/shared';
import { CardArt } from './CardArt';
import { formatComprehensiveDuration } from '@/shared/lib/time';

export const CardActionResultDialog = ({ action, response, onClose }: {
  action: 'use' | 'gift'; response: CardGameActionResponse; onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) { if (typeof element.showModal === 'function') element.showModal(); else element.setAttribute('open', ''); }
    return () => { element?.close?.(); returnFocus.current?.isConnected && returnFocus.current.focus(); };
  }, []);
  const card = response.result.actionCard;
  return <dialog ref={dialog} aria-labelledby="card-action-result-title" onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto w-[min(680px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl backdrop:bg-black/55">
    <header className="flex items-center justify-between gap-4"><h2 id="card-action-result-title" className="text-xl font-semibold">{action === 'gift' ? '赠送成功' : '用卡结果'}</h2>
      <button autoFocus type="button" onClick={onClose} aria-label="关闭操作结果" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-600"><X size={20} /></button></header>
    {card && <div className="mt-5 flex items-center gap-5"><div className="w-20 shrink-0"><CardArt id={card.id} name={card.name} interactive={false} /></div><div><p className="text-xs text-gray-500">{card.rarity}</p><h3 className="mt-1 font-semibold">{card.name}</h3><p className="mt-2 text-sm text-gray-500">{action === 'gift' ? '卡片已转入对方库存，并解锁对方图鉴。' : '卡片已结算，以下为服务端确认的结果。'}</p></div></div>}
    {response.result.effects?.length ? <ol className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-200 px-4" aria-label="本次卡牌作用对象">
      {response.result.effects.map((effect, index) => <li key={index} className="py-4 text-sm leading-6">
        <p className="font-medium">{effect.target.displayName} <span className="font-normal text-gray-500">（{effect.target.username}）</span></p>
        {effect.outcome === 'blocked' ? <p className="text-gray-600">被防御或免疫抵消，未对该目标生效。</p> : <>
          {effect.outcome === 'reflected' && effect.actualTarget && <p className="text-amber-800">被反弹，实际作用于 {effect.actualTarget.displayName}（{effect.actualTarget.username}）。</p>}
          <p className={effect.kind === 'time' && (effect.deltaSeconds ?? 0) < 0 ? 'text-red-700' : 'text-gray-600'}>
            {effect.kind === 'time' ? effect.outcome === 'no-effect' ? '未产生时长变化。' : `${effect.deltaSeconds! < 0 ? '扣除' : '增加'} ${formatComprehensiveDuration(Math.abs(effect.deltaSeconds!))} 综合时长` : effect.detail ?? '已生效'}
          </p>
        </>}
      </li>)}
    </ol> : <p className="mt-5 text-sm leading-7 text-gray-600">{response.result.message}</p>}
    <div className="mt-6 flex justify-end"><Button onClick={onClose}><Check size={16} aria-hidden="true" />知道了</Button></div>
  </dialog>;
};

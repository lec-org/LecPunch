import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { Button } from '@lecpunch/ui';
import type { CardDefenseNotice } from '@lecpunch/shared';
import { acknowledgeCardDefenses } from './cards.api';
import { CardEffectSummary } from './CardEffectSummary';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatDateTime } from '@/shared/lib/time';

export const CardDefenseInboxDialog = ({ notices, onClose, onConfirmed }: {
  notices: CardDefenseNotice[]; onClose: () => void; onConfirmed: () => void;
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
      await acknowledgeCardDefenses(notices.map(notice => notice.id));
      if (alive.current) onConfirmed();
    } catch (cause) {
      if (alive.current) setError(getApiErrorMessage(cause, '已读状态尚未确认。防御已完成，可以重试，不会再次消耗卡片。'));
    } finally { gate.current = false; if (alive.current) setBusy(false); }
  };
  return <dialog ref={dialog} aria-labelledby="card-defenses-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto w-[min(720px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl backdrop:bg-black/55">
    <header className="flex items-start justify-between gap-4"><div><ShieldCheck className="mb-3 h-7 w-7 text-gray-700" aria-hidden="true" /><h2 id="card-defenses-title" className="text-xl font-semibold">你的卡片已自动防御</h2><p className="mt-2 text-sm leading-6 text-gray-500">以下防御已自动完成，防御卡已消耗，无需再次使用。确认仅标记已读。</p></div>
      <button autoFocus type="button" disabled={busy} aria-label="稍后查看防御通知" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"><X size={20} aria-hidden="true" /></button></header>
    <ul className="mt-5 space-y-3">{notices.map(notice => <li key={notice.id} className="rounded-xl border border-gray-200 p-4"><time dateTime={notice.at} className="text-xs text-gray-500">{formatDateTime(notice.at)}</time>{notice.randomlySelected && <p className="mt-3 text-sm leading-7 text-gray-700">本次你是<strong className="font-bold text-gray-900">被系统随机判定到的</strong>成员。</p>}<ul className="mt-3 space-y-3">{notice.events.map((event, index) => <li key={index} className="text-sm leading-7"><p><span className="font-semibold">{event.attacker.displayName}</span>（{event.attacker.username}）对你使用了 <span className="font-semibold">{event.attackCard.name}</span>（{event.attackCard.rarity}）。</p><p className="mt-1 text-gray-600">已自动使用并消耗 1 张 <span className="font-semibold text-gray-900">{event.defenseCard.name}</span>（{event.defenseCard.rarity}），{event.outcome === 'reflected' ? '成功防住并反弹该次攻击。' : '成功防住该次攻击。'}</p></li>)}</ul>{Boolean(notice.effects?.length) && <div className="mt-3 border-t border-gray-100 pt-3"><CardEffectSummary effects={notice.effects!} /></div>}</li>)}</ul>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <footer className="mt-6 flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={busy} onClick={onClose}>稍后再看</Button><Button loading={busy} disabled={busy} onClick={() => void confirm()}>知道了，确认防御记录</Button></footer>
  </dialog>;
};

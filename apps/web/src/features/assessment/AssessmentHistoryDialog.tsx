import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssessmentMemberHistory } from '@lecpunch/shared';
import { X } from 'lucide-react';
import { Button } from '@lecpunch/ui';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatComprehensiveDuration, formatDateTime, formatDuration } from '@/shared/lib/time';
import { getAssessmentHistory } from './assessment.api';

// Calendar dates use UTC arithmetic so the browser timezone cannot shift Sunday.
const sundayForWeek = (weekKey: string) => {
  const date = new Date(`${weekKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return Number.isNaN(date.getTime()) ? '日期待核实' : date.toISOString().slice(0, 10);
};

export const AssessmentHistoryDialog = ({ memberKey, displayName, onClose }: { memberKey: string; displayName: string; onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null), mounted = useRef(true), gate = useRef(false), request = useRef<AbortController | null>(null);
  const [history, setHistory] = useState<AssessmentMemberHistory | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const failedCursor = useRef<string | undefined>(undefined);
  const load = useCallback(async (before?: string) => {
    if (gate.current) return; gate.current = true; setLoading(true); setError(''); failedCursor.current = before;
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await getAssessmentHistory(memberKey, before, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setHistory(previous => before && previous ? { ...result, items: [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.weekKey === item.weekKey))] } : result);
    } catch (e) { if (mounted.current && !controller.signal.aborted) setError(getApiErrorMessage(e, '未完成周详情加载失败，请重试。')); }
    finally { if (mounted.current && !controller.signal.aborted) { gate.current = false; setLoading(false); } }
  }, [memberKey]);
  useEffect(() => {
    mounted.current = true; const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; const element = dialog.current;
    if (element && !element.open) { if (typeof element.showModal === 'function') element.showModal(); else element.setAttribute('open', ''); }
    void load();
    return () => { mounted.current = false; gate.current = false; request.current?.abort(); element?.close?.(); previous?.focus(); };
  }, [load]);
  return <dialog ref={dialog} aria-labelledby="assessment-history-title" onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto w-[min(760px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/50">
    <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5"><div><h2 id="assessment-history-title" className="text-lg font-semibold">{displayName} · 未完成考核周</h2><p className="mt-2 text-xs text-gray-500">按考核周的周日日期展示未通过记录；周结束五小时后结算，本周实时进度不计入历史次数。</p></div><button type="button" aria-label="关闭未完成周详情" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
    <div className="p-6 space-y-5">
      {history && <p className="text-sm">打卡考核未通过 <strong>{history.failedWeeksCount}</strong> 次，记录随账号保留。</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error}</p><button type="button" className="mt-3 underline underline-offset-4" disabled={loading} onClick={() => void load(failedCursor.current)}>重试加载详情</button></div>}
      {!history && loading && <p role="status" className="py-8 text-center text-sm text-gray-500">正在读取已结算周记录…</p>}
      {history && history.items.length === 0 && <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">当前起算范围内，尚无已结算的未完成周记录。</p>}
      {history?.items.map(item => <article key={item.weekKey} className="rounded-xl border border-gray-200 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">考核周日：{item.assessmentDate ?? sundayForWeek(item.weekKey)}</h3><span className="text-red-700">未完成 · 差 {formatDuration(item.shortfallSeconds)}</span></div><dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3"><div><dt className="text-xs text-gray-500">最终综合时长</dt><dd className="mt-1 tabular-nums">{formatComprehensiveDuration(item.totalDurationSeconds)}</dd></div><div><dt className="text-xs text-gray-500">当周目标</dt><dd className="mt-1 tabular-nums">{formatDuration(item.goalSeconds)}</dd></div><div><dt className="text-xs text-gray-500">原始有效考勤</dt><dd className="mt-1 tabular-nums">{formatDuration(item.recordedDurationSeconds)}</dd></div><div><dt className="text-xs text-gray-500">管理员调整</dt><dd className="mt-1 tabular-nums">{formatComprehensiveDuration(item.manualAdjustmentSeconds)}</dd></div><div><dt className="text-xs text-gray-500">娱乐时长</dt><dd className="mt-1 tabular-nums">{formatComprehensiveDuration(item.entertainmentSeconds)}</dd></div><div><dt className="text-xs text-gray-500">结算时间</dt><dd className="mt-1">{formatDateTime(item.settledAt)}</dd></div></dl></article>)}
      {history?.nextCursor && <Button variant="outline" loading={loading} disabled={loading} onClick={() => void load(history.nextCursor!)}>加载更早的未完成周</Button>}
      <p className="text-xs leading-6 text-gray-500">综合时长包含卡牌娱乐效果。历史数据以当周结算目标和组成快照为准；未结算周与起算前周不计入该标签。</p>
    </div>
  </dialog>;
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleAlert, RefreshCw, Trophy } from 'lucide-react';
import type { AssessmentLeaderboardView } from '@lecpunch/shared';
import { Button } from '@lecpunch/ui';
import { useAuthStore } from '@/app/store/auth-store';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatComprehensiveDuration, formatDuration } from '@/shared/lib/time';
import { getAssessmentLeaderboard } from '@/features/assessment/assessment.api';
import { AssessmentHistoryDialog } from '@/features/assessment/AssessmentHistoryDialog';

export const TimeRankingsPage = () => {
  const user = useAuthStore(state => state.auth.user);
  if (!user) return null;
  return <TimeRankingsWorkspace key={`${user.teamId}:${user.id}`} />;
};
const TimeRankingsWorkspace = () => {
  const [view, setView] = useState<AssessmentLeaderboardView | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<{ memberKey: string; displayName: string } | null>(null);
  const request = useRef<AbortController | null>(null), alive = useRef(true);
  const refresh = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoading(true); setError('');
    try { const result = await getAssessmentLeaderboard(controller.signal); if (alive.current && !controller.signal.aborted) setView(result); }
    catch (e) { if (alive.current && !controller.signal.aborted) setError(getApiErrorMessage(e, '综合时长排行加载失败，请重试。')); }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; request.current?.abort(); }; }, [refresh]);
  return <div className="mx-auto max-w-6xl p-5 md:p-8 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">综合时长排行与考核记录</h1><p className="mt-2 text-sm leading-6 text-gray-500">按本周综合时长排序，相同时长并列。红绿标签表示本周实时进度，周结束并结算后才进入历史记录。</p></div><Button variant="outline" loading={loading} disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />刷新排行</Button></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{view && <p className="mt-2">当前保留上次成功读取的排行，请刷新后核实最新状态。</p>}</div>}
    {!view && loading && <p role="status" className="py-16 text-center text-sm text-gray-500">正在读取本周排行…</p>}
    {!view && !loading && <Button variant="outline" onClick={() => void refresh()}>重新加载排行</Button>}
    {view && <>
      {!view.enabled ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-5" aria-label="历史考核尚未启用"><h2 className="font-semibold text-amber-900">历史考核尚未启用</h2><p className="mt-2 text-sm leading-7 text-amber-900">起算规则待确认，不追罚过去周。当前没有历史标签，不代表成员从未有过未完成考核。</p></section> : <p className="rounded-xl border bg-white p-4 text-sm text-gray-600">历史考核从 {view.startWeek} 起算，仅累计符合应考范围的已结算周。</p>}
      <section className="rounded-2xl border border-gray-200 bg-white" aria-labelledby="time-rankings-title"><div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4"><Trophy size={18} className="text-gray-500" aria-hidden="true" /><h2 id="time-rankings-title" className="font-semibold">本周排行</h2><span className="ml-auto text-xs text-gray-500">{view.week} 起 · 北京时间</span></div>
        {view.items.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">当前团队暂无可展示的考核成员。</p> : <ol className="divide-y divide-gray-100">{view.items.map(member => <li key={member.memberKey} className="flex flex-wrap items-center gap-4 px-5 py-5"><span aria-label={`第${member.rank}名`} className="w-8 text-center text-xl font-medium tabular-nums text-gray-400">{member.rank}</span><div className="min-w-0 flex-1"><h3 className="font-medium break-words">{member.displayName}</h3><p className="mt-1 break-all text-xs text-gray-500">{member.username} · {member.enrollYear} 级</p><div className="mt-3 flex flex-wrap items-center gap-2"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${member.assessmentComplete ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>{member.assessmentComplete ? <CircleCheck size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}{member.assessmentComplete ? '本周已完成' : '本周未完成'}</span>{view.enabled && (member.failedWeeksCount > 0 ? <button type="button" className="rounded-full border border-red-200 px-2.5 py-1 text-xs text-red-700 underline underline-offset-2" onClick={() => setSelected({ memberKey: member.memberKey, displayName: member.displayName })}>没有完成 {member.failedWeeksCount} 周</button> : <button type="button" className="text-xs text-gray-500 underline underline-offset-2" onClick={() => setSelected({ memberKey: member.memberKey, displayName: member.displayName })}>已结算未完成 0 周</button>)}</div></div><div className="text-right"><p className="font-mono text-xl tabular-nums">{formatComprehensiveDuration(member.totalDurationSeconds)}</p><p className="mt-1 text-xs text-gray-500">综合时长 · 目标 {formatDuration(member.weeklyGoalSeconds)}</p></div></li>)}</ol>}
      </section>
      <p className="text-xs leading-6 text-gray-500">{view.settlementNote} 综合时长包含有效考勤、管理员调整和娱乐时长；卡牌不会改写原始考勤记录。</p>
    </>}
    {selected && view?.enabled && <AssessmentHistoryDialog key={selected.memberKey} memberKey={selected.memberKey} displayName={selected.displayName} onClose={() => setSelected(null)} />}
  </div>;
};

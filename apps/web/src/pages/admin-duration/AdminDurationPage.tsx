import { useEffect, useState } from 'react';
import type { User } from '@lecpunch/shared';
import { Button } from '@lecpunch/ui';
import { getAdminMembers } from '@/features/users/users.api';
import { adjustDuration, getAdjustmentAudit, getAdjustmentContext, type AdjustmentAudit, type AdjustmentContext } from '@/features/attendance/duration-adjustments.api';
import { formatDateTime, formatDuration } from '@/shared/lib/time';
import { getApiErrorMessage } from '@/shared/lib/api-error';

export const AdminDurationPage = () => {
  const [members, setMembers] = useState<User[]>([]), [audit, setAudit] = useState<AdjustmentAudit[]>([]);
  const [userId, setUserId] = useState(''), [search, setSearch] = useState('');
  const [context, setContext] = useState<AdjustmentContext | null>(null);
  const [operation, setOperation] = useState<'add' | 'subtract'>('add');
  const [minutes, setMinutes] = useState(''), [reason, setReason] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const reload = async () => {
    const next = await getAdjustmentContext(userId);
    const rows = await getAdjustmentAudit(next.isoWeek);
    setContext(next); setAudit(rows); setRefreshNeeded(false);
  };
  useEffect(() => { void getAdminMembers().then(setMembers).catch(e => setError(getApiErrorMessage(e, '加载成员失败'))); }, []);
  useEffect(() => {
    let active = true; setContext(null); setRequestKey(crypto.randomUUID()); setSuccess(''); setRefreshNeeded(false); setError(''); setAudit([]);
    if (userId) void getAdjustmentContext(userId).then(async value => {
      const rows = await getAdjustmentAudit(value.isoWeek);
      if (active) { setContext(value); setAudit(rows); }
    }).catch(e => { if (active) setError(getApiErrorMessage(e, '加载调整信息失败')); });
    return () => { active = false; };
  }, [userId]);
  const seconds = Number(minutes) * 60;
  const validAmount = Number.isInteger(Number(minutes)) && seconds >= 60 && seconds <= 604800;
  const projected = context ? context.totalDurationSeconds + (operation === 'add' ? seconds : -seconds) : 0;
  const filtered = members.filter(m => m.status === 'active' && [m.displayName, m.name, m.username, m.studentNumber].some(s => s?.toLowerCase().includes(search.toLowerCase())));
  return <div className="mx-auto max-w-4xl p-8 space-y-5">
    <h1 className="text-2xl font-bold">当前周时长调整</h1>
    <p className="text-sm text-gray-500">仅调整当前周统计，不改原始打卡记录或原始积分。每次操作保留操作者、原因和结果。</p>
    <form className="rounded-xl border bg-white p-5 space-y-4" onSubmit={async e => {
      e.preventDefault(); if (!context || !validAmount || busy || refreshNeeded || projected < 0) return;
      setBusy(true); setError(''); setSuccess('');
      try {
        let result;
        try {
          result = await adjustDuration({ userId, operation, durationSeconds: seconds, reason, requestKey, expectedWeekKey: context.weekKey });
        } catch (e) {
          setError(getApiErrorMessage(e, '操作结果未确认；请保留原输入重试，系统会防止重复调整'));
          return;
        }
        setSuccess(`调整成功，操作结果 ${formatDuration(result.resultingDurationSeconds)}。`);
        setRequestKey(crypto.randomUUID()); setMinutes(''); setReason('');
        try { await reload(); }
        catch { setRefreshNeeded(true); setError('调整已成功，但刷新数据失败。请仅刷新数据，不要重复提交本次调整。'); }
      }
      finally { setBusy(false); }
    }}>
      <label className="block text-sm">搜索成员<input className="mt-1 block w-full rounded border p-2" value={search} disabled={busy} onChange={e => setSearch(e.target.value)} placeholder="姓名、用户名或学号" /></label>
      <label className="block text-sm">选择成员<select className="mt-1 block w-full rounded border p-2" required disabled={busy} value={userId} onChange={e => setUserId(e.target.value)}><option value="">请选择</option>{[...new Map([...filtered, ...members.filter(m => m.id === userId)].map(m => [m.id, m])).values()].map(m => <option key={m.id} value={m.id}>{m.displayName} · @{m.username} · 学号尾号 {m.studentNumber?.slice(-4) ?? '未填写'}</option>)}</select></label>
      {context && <p className="text-sm">本周 {context.weekKey} 起：原始 {formatDuration(context.recordedDurationSeconds)}，人工调整 {context.manualAdjustmentSeconds} 秒，当前合计 {context.totalDurationSeconds < 0 ? `-${formatDuration(-context.totalDurationSeconds)}` : formatDuration(context.totalDurationSeconds)}</p>}
      {context && context.totalDurationSeconds < 0 && <p role="alert" className="text-amber-700">历史记录变化导致余额为负，请核对后增加至少 {-context.totalDurationSeconds} 秒补正至非负；调整审计将保留真实余额。</p>}
      <div className="flex gap-3"><select aria-label="增减方式" className="rounded border p-2" value={operation} disabled={busy} onChange={e => { setOperation(e.target.value as 'add' | 'subtract'); setRequestKey(crypto.randomUUID()); }}><option value="add">增加</option><option value="subtract">减少</option></select><label>分钟<input className="ml-2 rounded border p-2" type="number" min={1} max={10080} step={1} required value={minutes} disabled={busy} onChange={e => { setMinutes(e.target.value); setRequestKey(crypto.randomUUID()); }} /></label></div>
      <label className="block text-sm">调整原因<textarea className="mt-1 block w-full rounded border p-2" required maxLength={500} value={reason} disabled={busy} onChange={e => { setReason(e.target.value); setRequestKey(crypto.randomUUID()); }} /></label>
      {context && validAmount && <p>预计调整后：{projected < 0 ? '低于零，不可提交' : formatDuration(projected)}（以服务端提交结果为准）</p>}
      <Button type="submit" loading={busy} disabled={!context || !validAmount || projected < 0 || !reason.trim() || refreshNeeded}>确认调整</Button>
    </form>
    {refreshNeeded && <Button variant="outline" loading={busy} onClick={async () => {
      if (busy) return;
      setBusy(true);
      try { await reload(); setError(''); }
      catch { setError('调整已成功，数据仍未刷新成功，请稍后重试刷新。'); }
      finally { setBusy(false); }
    }}>仅刷新数据</Button>}
    {error && <p role="alert" className="text-red-600">{error}</p>}{success && <p role="status" className="text-green-700">{success}</p>}
    <h2 className="font-semibold">本周团队调整审计</h2>
    {audit.map(row => <article key={row.adjustmentId} className="rounded-lg border bg-white p-4 text-sm"><p>{row.displayName} · {row.operation === 'add' ? '+' : '-'}{row.durationSeconds / 60} 分钟 · {formatDateTime(row.createdAt)}</p><p className="whitespace-pre-wrap">{row.reason || '历史记录未填写原因'}</p>{row.createdBy && <p className="text-gray-500">操作者：{row.createdByDisplayName || '历史管理员'}</p>}</article>)}
  </div>;
};

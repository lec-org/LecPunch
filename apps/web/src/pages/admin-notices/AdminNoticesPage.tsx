import { useEffect, useState } from 'react';
import type { NotificationItem } from '@lecpunch/shared';
import { Button } from '@lecpunch/ui';
import { getNotificationReadStatus, getSentNotifications, publishNotice } from '@/features/notifications/notifications.api';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatDateTime } from '@/shared/lib/time';

type Receipt = { userId: string; displayName: string; readAt: string | null };
export const AdminNoticesPage = () => {
  const [title, setTitle] = useState(''), [message, setMessage] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [sent, setSent] = useState<NotificationItem[]>([]);
  const [detail, setDetail] = useState<{ id: string; items: Receipt[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = () => { void getSentNotifications().then(setSent).catch(e => setError(getApiErrorMessage(e, '加载已发通知失败'))); };
  useEffect(load, []);
  return <div className="mx-auto max-w-4xl p-8 space-y-5">
    <h1 className="text-2xl font-bold">管理员通知与已读状态</h1>
    <p className="text-sm text-gray-500">发布给当前已绑定且启用的团队成员。未读通知持续显示数字红点；成员点击“标记已读”后记录确认时间。</p>
    <form className="rounded-xl border bg-white p-5 space-y-3" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError('');
      try { await publishNotice({ title, message, requestKey }); setTitle(''); setMessage(''); setRequestKey(crypto.randomUUID()); load(); }
      catch (e) { setError(getApiErrorMessage(e, '发布结果未确认，原内容可重试')); }
      finally { setBusy(false); }
    }}>
      <label className="block text-sm">标题<input className="mt-1 block w-full rounded border p-2" required maxLength={100} value={title} disabled={busy} onChange={e => { setTitle(e.target.value); setRequestKey(crypto.randomUUID()); }} /></label>
      <label className="block text-sm">通知内容<textarea className="mt-1 block w-full rounded border p-2" required rows={4} maxLength={2000} value={message} disabled={busy} onChange={e => { setMessage(e.target.value); setRequestKey(crypto.randomUUID()); }} /></label>
      <Button type="submit" loading={busy} disabled={!title.trim() || !message.trim()}>发布团队通知</Button>
    </form>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    <div className="flex gap-4 items-center"><h2 className="font-semibold">本人最近发出的通知</h2><Button size="sm" variant="outline" onClick={load}>刷新</Button></div>
    {sent.map(item => <article key={item.id} className="rounded-xl border bg-white p-5 space-y-3">
      <h3 className="font-semibold">{item.title}</h3><p className="whitespace-pre-wrap break-words text-sm">{item.message}</p><p className="text-xs text-gray-500">{formatDateTime(item.createdAt)}</p>
      <Button size="sm" variant="outline" onClick={async () => { try { setDetail({ id: item.id, items: await getNotificationReadStatus(item.id) }); } catch (e) { setError(getApiErrorMessage(e, '读取状态失败')); } }}>查看／刷新成员已读状态</Button>
      {detail?.id === item.id && <div className="space-y-2 text-sm">
        <p>已读 {detail.items.filter(r => r.readAt).length} / {detail.items.length}</p>
        {detail.items.map(r => <div key={r.userId} className="flex justify-between border-t pt-2"><span>{r.displayName}</span><span>{r.readAt ? `已读 · ${formatDateTime(r.readAt)}` : '未读'}</span></div>)}
      </div>}
    </article>)}
    {!sent.length && <p className="text-gray-500">暂无已发通知。</p>}
  </div>;
};

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NotificationItem } from '@lecpunch/shared';
import { Button } from '@lecpunch/ui';
import { useAuthStore } from '@/app/store/auth-store';
import { acknowledgeNotification, getNotificationPage, getNotificationPreferences, setNotificationPreferences } from '@/features/notifications/notifications.api';
import { useNotifications } from '@/features/notifications/NotificationProvider';
import { getApiErrorMessage } from '@/shared/lib/api-error';
import { formatDateTime } from '@/shared/lib/time';

export const NotificationsPage = () => {
  const { count, error: syncError, refresh } = useNotifications();
  const admin = useAuthStore(s => s.auth.user?.role === 'admin');
  const userId = useAuthStore(s => s.auth.user?.id);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unacked'>('unacked');
  const [enabled, setEnabled] = useState(true);
  const [preferenceBusy, setPreferenceBusy] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const accountGeneration = useRef(0);
  const currentFilter = useRef(filter);
  const loadedPages = useRef(1);
  const queryKey = useRef('');
  const invalidate = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
  }, []);
  useLayoutEffect(() => {
    accountGeneration.current += 1;
    setPending(null);
    return () => { accountGeneration.current += 1; };
  }, [userId]);
  const load = useCallback(async (before?: string, preserveWindow = false) => {
    invalidate();
    if (!userId) { setLoading(false); return; }
    const controller = new AbortController();
    request.current = controller;
    const version = generation.current;
    const isCurrent = () => !controller.signal.aborted && version === generation.current;
    setLoading(true); setError('');
    try {
      const pages = preserveWindow ? loadedPages.current : 1;
      let next = before;
      const received: NotificationItem[] = [];
      let fetchedPages = 0;
      for (let index = 0; index < pages; index++) {
        const page = await getNotificationPage({ status: filter, limit: 20, before: next }, controller.signal);
        if (!isCurrent()) return;
        fetchedPages += 1;
        const ids = new Set(received.map(item => item.id));
        received.push(...page.items.filter(item => !ids.has(item.id)));
        next = page.items.length === 20 ? page.nextCursor ?? undefined : undefined;
        if (!next) break;
      }
      if (!isCurrent()) return;
      loadedPages.current = before ? loadedPages.current + fetchedPages : fetchedPages;
      setItems(old => before ? [...old, ...received.filter(item => !old.some(n => n.id === item.id))] : received);
      setCursor(next ?? null);
      refresh();
    } catch (e) { if (isCurrent()) setError(getApiErrorMessage(e, '加载通知失败')); }
    finally { if (isCurrent()) setLoading(false); }
  }, [userId, filter, refresh, invalidate]);
  useLayoutEffect(() => {
    currentFilter.current = filter;
    const key = JSON.stringify([userId, filter]);
    const changed = queryKey.current !== key;
    queryKey.current = key;
    if (changed) { setItems([]); setCursor(null); loadedPages.current = 1; }
    void load(undefined, !changed);
    return invalidate;
  }, [load, count, reloadVersion, invalidate, filter, userId]);
  useEffect(() => {
    let active = true;
    setEnabled(true);
    setPreferenceBusy(admin);
    if (admin) void getNotificationPreferences().then(p => {
      if (active) setEnabled(p.adminMessageBadgeEnabled);
    }).catch(() => { if (active) setError('接收偏好加载失败'); })
      .finally(() => { if (active) setPreferenceBusy(false); });
    return () => { active = false; };
  }, [admin, userId]);
  const read = async (id: string) => {
    const owner = accountGeneration.current;
    const isCurrentAccount = () => owner === accountGeneration.current;
    setPending(id);
    try {
      const updated = await acknowledgeNotification(id);
      if (!isCurrentAccount()) return;
      invalidate();
      setItems(old => currentFilter.current === 'unacked' ? old.filter(n => n.id !== id) : old.map(n => n.id === id ? updated : n));
      setReloadVersion(value => value + 1);
      refresh();
    } catch (e) { if (isCurrentAccount()) setError(getApiErrorMessage(e, '标记已读失败')); }
    finally { if (isCurrentAccount()) setPending(null); }
  };
  return <div className="mx-auto max-w-4xl space-y-5 p-8">
    <h1 className="text-2xl font-bold">通知中心 <span className="text-base text-gray-500">未读 {count} 条</span></h1>
    <p className="text-sm text-gray-500">打开通知中心不会自动标记已读。阅读内容后可点击“标记已读”；消息处理状态单独记录。</p>
    <div className="flex gap-3"><Button variant={filter === 'unacked' ? 'primary' : 'outline'} onClick={() => setFilter('unacked')}>未读</Button><Button variant={filter === 'all' ? 'primary' : 'outline'} onClick={() => setFilter('all')}>全部</Button><Button variant="outline" onClick={() => void load()}>刷新</Button></div>
    {admin && <label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} disabled={preferenceBusy} onChange={async e => {
      if (preferenceBusy) return;
      const next = e.target.checked;
      const owner = accountGeneration.current;
      setPreferenceBusy(true);
      try {
        await setNotificationPreferences(next);
        if (owner === accountGeneration.current) { setEnabled(next); refresh(); }
      }
      catch { if (owner === accountGeneration.current) setError('接收设置保存失败'); }
      finally { if (owner === accountGeneration.current) setPreferenceBusy(false); }
    }} />成员消息计入顶部未读红点（关闭后仍保存在管理员收件箱）</label>}
    {(error || syncError) && <p role="alert" className="text-red-600">{error || syncError}</p>}
    {loading && <p>正在加载…</p>}
    {!loading && !items.length && <p className="text-gray-500">暂无{filter === 'unacked' ? '未读' : ''}通知。</p>}
    {items.map(item => <article key={item.id} className="rounded-xl border bg-white p-5 space-y-3">
      <div className="flex justify-between gap-3"><h2 className="font-semibold">{item.title}</h2><span className="text-xs text-gray-500">{item.acknowledgedAt ? '已读' : '未读'}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm">{item.message}</p>
      <p className="text-xs text-gray-500">{formatDateTime(item.createdAt)}</p>
      <div className="flex gap-4 items-center">
        {!item.acknowledgedAt && <Button size="sm" loading={pending === item.id} onClick={() => void read(item.id)}>标记已读</Button>}
        {item.type === 'report.submitted' && admin ? <Link className="text-blue-600" to="/admin/messages">查看收件箱</Link> : item.type === 'attendance.record_marked' ? <Link className="text-blue-600" to="/records">查看打卡记录</Link> : null}
      </div>
    </article>)}
    {cursor && <Button disabled={loading} variant="outline" onClick={() => void load(cursor)}>加载更多</Button>}
  </div>;
};

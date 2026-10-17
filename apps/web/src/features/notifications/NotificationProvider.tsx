import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuthStore } from '@/app/store/auth-store';
import { connectNotificationStream, getUnreadCount } from './notifications.api';

const Context = createContext({ count: 0, badgeCount: 0, error: '', refresh: () => {} });
export const useNotifications = () => useContext(Context);
export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const userId = useAuthStore(s => s.auth.user?.id);
  const token = useAuthStore(s => s.auth.token);
  const [counts, setCounts] = useState({ count: 0, badgeCount: 0 });
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [connection, setConnection] = useState(0);
  const generation = useRef(0);
  const failures = useRef(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    const id = ++generation.current;
    let active = true;
    const update = () => { void getUnreadCount().then(result => {
      if (active && id === generation.current) { setCounts(result); setError(''); }
    }).catch(() => { if (active) setError('通知暂时无法同步，点击通知中心可重试'); }); };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [userId, revision]);
  useEffect(() => {
    setCounts({ count: 0, badgeCount: 0 }); setError('');
  }, [userId]);
  useEffect(() => {
    if (!token || !userId) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    void connectNotificationStream(token, {
      signal: controller.signal,
      onEvent: event => {
        if (event.event !== 'heartbeat') { failures.current = 0; refresh(); }
      },
      onError: (error) => {
        if ((error as { status?: number })?.status === 403) { setError('没有通知访问权限，请联系管理员'); return; }
        if (controller.signal.aborted) return;
        setError('实时通知连接暂时中断，正在重连；未读状态仍会定期同步');
        retry = setTimeout(() => setConnection(n => n + 1), Math.min(30_000, 2000 * 2 ** failures.current++) + Math.random() * 1000);
      }
    });
    return () => { controller.abort(); clearTimeout(retry); };
  }, [token, userId, connection, refresh]);
  return <Context.Provider value={{ ...counts, error, refresh }}>{children}</Context.Provider>;
};

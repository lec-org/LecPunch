import { formatMemberName } from '@lecpunch/shared';
import { useEffect, useState } from 'react';
import { Bell, Wifi, WifiOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '@lecpunch/ui';
import { getCurrentNetworkStatus, type CurrentNetworkStatus } from '@/features/network-policy/network-policy.api';
import { NETWORK_STATUS_ERROR_RETRY_MS, NETWORK_STATUS_REFRESH_MS } from '@/shared/constants/timing';
import { useAuthStore } from '../store/auth-store';

import { useNotifications } from '@/features/notifications/NotificationProvider';

export const AppHeader = () => {
  const { badgeCount, error: notificationError } = useNotifications();
  const user = useAuthStore((s) => s.auth.user);
  const token = useAuthStore((s) => s.auth.token);
  const navigate = useNavigate();
  const [networkStatus, setNetworkStatus] = useState<CurrentNetworkStatus | null>(null);
  const [networkStatusLoaded, setNetworkStatusLoaded] = useState(false);
  const [networkStatusError, setNetworkStatusError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;
    const setTimeoutFn =
      typeof globalThis.setTimeout === 'function' ? globalThis.setTimeout : window.setTimeout.bind(window);
    const clearTimeoutFn =
      typeof globalThis.clearTimeout === 'function' ? globalThis.clearTimeout : window.clearTimeout.bind(window);

    if (!token) {
      setNetworkStatus(null);
      setNetworkStatusLoaded(false);
      setNetworkStatusError(true);
      return;
    }

    const loadNetworkStatus = async () => {
      try {
        const nextStatus = await getCurrentNetworkStatus();
        if (cancelled) {
          return;
        }
        consecutiveFailures = 0;

        setNetworkStatus(nextStatus);
        setNetworkStatusLoaded(true);
        setNetworkStatusError(false);
      } catch {
        if (cancelled) {
          return;
        }
        consecutiveFailures += 1;

        setNetworkStatus(null);
        setNetworkStatusLoaded(true);
        setNetworkStatusError(true);
      } finally {
        if (cancelled) {
          return;
        }

        const retryDelayMs = consecutiveFailures > 0 ? NETWORK_STATUS_ERROR_RETRY_MS : NETWORK_STATUS_REFRESH_MS;
        timeoutId = setTimeoutFn(() => {
          void loadNetworkStatus();
        }, retryDelayMs);
      }
    };

    setNetworkStatus(null);
    setNetworkStatusLoaded(false);
    setNetworkStatusError(false);
    void loadNetworkStatus();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        clearTimeoutFn(timeoutId);
      }
    };
  }, [token]);

  const isAllowed = networkStatus?.isAllowed ?? false;
  const isBlocked = networkStatusLoaded && Boolean(networkStatus) && !isAllowed;
  const statusLabel = !networkStatusLoaded
    ? '检测网络中'
    : isAllowed
      ? '已连接团队网络'
      : networkStatusError
        ? '网络状态待确认'
        : '当前网络未放行';
  const statusClassName = isAllowed
    ? 'bg-green-50 text-green-700 border-green-100'
    : isBlocked
      ? 'bg-amber-50 text-amber-800 border-amber-200'
      : 'bg-slate-100 text-slate-700 border-slate-200';
  const StatusIcon = isAllowed ? Wifi : WifiOff;

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 z-10 flex-shrink-0">
      <div className="flex items-center text-sm">
        <div
          className={`flex items-center rounded-full border px-3 py-1.5 ${statusClassName}`}
          title={networkStatus?.clientIp ? `服务端识别 IP: ${networkStatus.clientIp}` : undefined}
        >
          <StatusIcon className="mr-2 h-4 w-4" />
          <span className="font-medium">{statusLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <Link to="/notifications" className="relative rounded-lg p-2 text-gray-600 hover:bg-gray-100" aria-label={`通知，${badgeCount} 条未读${notificationError ? `，${notificationError}` : ''}`} title={notificationError || '通知中心'}>
          <Bell className="h-5 w-5" />
          {badgeCount > 0 && <span aria-hidden="true" className="absolute -right-2 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs leading-5 text-white">{badgeCount > 99 ? '99+' : badgeCount}</span>}
        </Link>
      <div
        className="flex items-center space-x-3 cursor-pointer"
        onClick={() => navigate('/profile')}
      >
        <Avatar
          name={user ? formatMemberName(user) : '用户'}
          size="sm"
          avatarUrl={user?.avatar}
          avatarBase64={user?.avatarBase64}
          avatarEmoji={user?.avatarEmoji}
          avatarColor={user?.avatarColor}
        />
        <span className="text-sm font-medium text-gray-700 hidden md:block">
          {user ? formatMemberName(user) : '用户'}
        </span>
      </div></div>
    </header>
  );
};

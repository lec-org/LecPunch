import { getAccessToken, refreshAccessToken } from '@/shared/auth/logto';
import type { NotificationItem } from '@lecpunch/shared';
import { useAuthStore } from '@/app/store/auth-store';
import { apiClient } from '@/shared/http/api-client';

export interface NotificationFilters {
  status?: 'unacked' | 'all';
  limit?: number;
  before?: string;
}

export type NotificationStreamEventName = 'connected' | 'notification.created' | 'notifications.changed' | 'heartbeat';

export interface NotificationStreamEvent {
  event: NotificationStreamEventName;
  data: unknown;
}

interface NotificationListResponse {
  items: NotificationItem[];
}

interface NotificationStreamHandlers {
  signal: AbortSignal;
  onEvent: (event: NotificationStreamEvent) => void;
  onError?: (error: unknown) => void;
}

const buildApiUrl = (path: string) => {
  const baseUrl = apiClient.defaults.baseURL ?? '/api';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (/^https?:\/\//.test(normalizedBase)) {
    return `${normalizedBase}${normalizedPath}`;
  }

  return new URL(`${normalizedBase}${normalizedPath}`, window.location.origin).toString();
};

const resetAuth = () => {
  useAuthStore.getState().setAuth({ token: null, user: null });
};

const parseEventChunk = (chunk: string): NotificationStreamEvent | null => {
  const normalized = chunk.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return null;
  }

  let event: NotificationStreamEventName = 'heartbeat';
  const dataLines: string[] = [];

  for (const line of normalized.split('\n')) {
    if (line.startsWith('event:')) {
      const value = line.slice('event:'.length).trim() as NotificationStreamEventName;
      event = value;
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  const rawData = dataLines.join('\n');
  if (!rawData) {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(rawData)
    };
  } catch {
    return {
      event,
      data: rawData
    };
  }
};

export const getMyNotifications = async (filters?: NotificationFilters) => {
  const response = await apiClient.get<NotificationListResponse>('/notifications/me', {
    params: filters ?? undefined
  });
  return response.data.items;
};

export const acknowledgeNotification = async (notificationId: string) => {
  const response = await apiClient.patch<NotificationItem>(`/notifications/${notificationId}/ack`);
  return response.data;
};

export const getNotificationPage = async (filters?: NotificationFilters, signal?: AbortSignal) => {
  const response = await apiClient.get<NotificationListResponse & { nextCursor: string | null }>('/notifications/me', { params: filters, signal });
  return response.data;
};
export const getUnreadCount = async () => (await apiClient.get<{ count: number; badgeCount: number }>('/notifications/me/unread-count')).data;
export const getNotificationPreferences = async () => (await apiClient.get<{ adminMessageBadgeEnabled: boolean }>('/notifications/preferences')).data;
export const setNotificationPreferences = async (enabled: boolean) => (await apiClient.patch('/notifications/preferences', { adminMessageBadgeEnabled: enabled })).data;
export const publishNotice = async (input: { title: string; message: string; requestKey: string }) => (await apiClient.post<NotificationItem>('/notifications/admin/notices', input)).data;
export const getSentNotifications = async () => (await apiClient.get<NotificationItem[]>('/notifications/admin/sent')).data;
export const getNotificationReadStatus = async (id: string) => (await apiClient.get<{ userId: string; displayName: string; readAt: string | null }[]>(`/notifications/admin/${id}/read-status`)).data;

export const connectNotificationStream = async (_loginSnapshot: string, handlers: NotificationStreamHandlers) => {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (handlers.signal.aborted) return;
      const token = await (attempt === 0 ? getAccessToken() : refreshAccessToken());
      if (handlers.signal.aborted) return;
      if (!token) throw new Error('登录凭据不可用，请重新登录');
      response = await fetch(buildApiUrl('/notifications/stream'), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: handlers.signal
      });
      if (handlers.signal.aborted) { await response.body?.cancel(); return; }
      if (response.status !== 401) break;
      await response.body?.cancel();
      if (handlers.signal.aborted) return;
      if (attempt === 1) { resetAuth(); throw new Error('登录已失效，请重新登录'); }
    }
    if (!response?.ok || !response.body) {
      throw Object.assign(new Error(response?.status === 403 ? '没有通知访问权限，请联系管理员' : `通知连接失败 (${response?.status})`), { status: response?.status });
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!handlers.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = parseEventChunk(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) handlers.onEvent(event);
        boundary = buffer.indexOf('\n\n');
      }
    }
    const event = parseEventChunk(buffer + decoder.decode());
    if (event) handlers.onEvent(event);
    if (!handlers.signal.aborted) handlers.onError?.(new Error('通知连接已断开'));
  } catch (error) {
    if (!handlers.signal.aborted && (error as { name?: string }).name !== 'AbortError') handlers.onError?.(error);
  } finally { reader?.releaseLock(); }
};

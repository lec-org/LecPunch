import type { AttendanceSnapshot, ElectionUser, TeamWeeklyStatsResponse } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://43.138.244.158/api';
const TOKEN_KEY = 'lecpunch.election.token';

export const getApiBaseUrl = () => API_BASE_URL;

export const readToken = () => localStorage.getItem(TOKEN_KEY);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = readToken();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers
      }
    });
  } catch {
    throw new Error(`无法连接 LecPunch 服务端（${API_BASE_URL}）。请先启动 API 服务后再登录。`);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || '无法连接 LecPunch 服务');
  }

  return response.json() as Promise<T>;
};

export const login = async (username: string, password: string) => {
  const result = await request<{ accessToken: string; user: ElectionUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  localStorage.setItem(TOKEN_KEY, result.accessToken);
  return result.user;
};

export const fetchCurrentUser = () => request<ElectionUser>('/auth/me');
export const updateProfile = (displayName: string) => request<ElectionUser>('/users/me', { method: 'PATCH', body: JSON.stringify({ displayName }) });
export const updatePassword = (oldPassword: string, newPassword: string) => request('/users/me/password', { method: 'PATCH', body: JSON.stringify({ oldPassword, newPassword }) });
export const fetchAttendance = () => request<AttendanceSnapshot>('/attendance/current');
export const fetchPoints = () => request<{ totalPoints: number }>('/points/me');
export const fetchTeamWeeklyStats = () => request<TeamWeeklyStatsResponse>('/stats/team/current-week');
export const checkIn = () => request('/attendance/check-in', { method: 'POST' });
export const checkOut = () => request('/attendance/check-out', { method: 'POST' });

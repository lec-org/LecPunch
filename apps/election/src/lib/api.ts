import type { AttendanceSnapshot, ElectionUser } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:4000';
const TOKEN_KEY = 'lecpunch.election.token';

export const readToken = () => localStorage.getItem(TOKEN_KEY);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = readToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });

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
export const fetchAttendance = () => request<AttendanceSnapshot>('/attendance/current');
export const fetchPoints = () => request<{ totalPoints: number }>('/points/me');
export const checkIn = () => request('/attendance/check-in', { method: 'POST' });
export const checkOut = () => request('/attendance/check-out', { method: 'POST' });

import axios, { AxiosHeaders, CanceledError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/app/store/auth-store';
import { getAccessToken } from '@/shared/auth/logto';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Frontend-only owner of an account-scoped request; never sent as a header. */
    accountScope?: string | null;
  }
}
export const getCurrentAccountKey = () => {
  const user = useAuthStore.getState().auth.user;
  return user ? `${user.teamId}:${user.id}` : null;
};
const belongsToCurrentAccount = (config?: { accountScope?: string | null }) =>
  config?.accountScope === undefined || config.accountScope === getCurrentAccountKey();
const accountChanged = (config: InternalAxiosRequestConfig) => {
  const error = new CanceledError('账号已切换，旧请求或响应已取消');
  error.config = config;
  return error;
};

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 10000
});

// Injected by AppProviders so the interceptor can navigate without React Router context
let _navigateToLogin: (() => void) | null = null;
export const setNavigateToLogin = (fn: () => void) => {
  _navigateToLogin = fn;
};

apiClient.interceptors.request.use(async (config) => {
  if (!belongsToCurrentAccount(config)) throw accountChanged(config);
  let token: Awaited<ReturnType<typeof getAccessToken>>;
  try { token = await getAccessToken(); }
  catch (error) {
    if (!belongsToCurrentAccount(config)) throw accountChanged(config);
    throw error;
  }
  // Token lookup is asynchronous: never dispatch an old action with a new account's token.
  if (!belongsToCurrentAccount(config)) throw accountChanged(config);
  if (token) {
    const headers = AxiosHeaders.from(config.headers);
    headers.set('Authorization', `Bearer ${token}`);
    config.headers = headers;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    if (!belongsToCurrentAccount(response.config)) throw accountChanged(response.config);
    return response;
  },
  (error) => {
    if (error.response?.status === 401 && belongsToCurrentAccount(error.config)) {
      useAuthStore.getState().setAuth({ token: null, user: null });
      _navigateToLogin?.();
    }
    return Promise.reject(error);
  }
);

import type { User } from '@lecpunch/shared';
import { apiClient } from '@/shared/http/api-client';

export const logtoEndpoint = import.meta.env.VITE_LOGTO_ENDPOINT || 'http://localhost:3001';
export const logtoAppId = import.meta.env.VITE_LOGTO_APP_ID || 'lecpunch-web';
export const logtoResource = import.meta.env.VITE_LOGTO_RESOURCE || 'https://api.lecpunch.lec.org';
export const logtoOrganizationId = import.meta.env.VITE_LOGTO_ORGANIZATION_ID || 'lec-studio';
export const logtoCallbackUri = `${window.location.origin}/callback`;

let accessTokenProvider: ((forceRefresh?: boolean) => Promise<string | undefined>) | null = null;
let logoutProvider: (() => Promise<void>) | null = null;

export const setAccessTokenProvider = (provider: typeof accessTokenProvider) => {
  accessTokenProvider = provider;
};

export const setLogoutProvider = (provider: typeof logoutProvider) => {
  logoutProvider = provider;
};

export const getAccessToken = async () => accessTokenProvider?.();
export const refreshAccessToken = async () => accessTokenProvider?.(true);
export const signOut = async () => logoutProvider?.();

export const fetchCurrentUser = async (): Promise<User> => {
  const response = await apiClient.get<User>('/auth/me');
  return response.data;
};

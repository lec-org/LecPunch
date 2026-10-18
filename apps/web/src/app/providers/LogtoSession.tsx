import { getApiErrorMessage } from '@/shared/lib/api-error';
import { useEffect } from 'react';
import { useLogto } from '@logto/react';
import { useAuthStore } from '@/app/store/auth-store';
import {
  fetchCurrentUser,
  logtoOrganizationId,
  logtoResource,
  setAccessTokenProvider,
  setLogoutProvider
} from '@/shared/auth/logto';

export const LogtoSession = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading, getAccessToken, clearAccessToken, signOut } = useLogto();
  const setAuth = useAuthStore((state) => state.setAuth);
  const retrySession = useAuthStore(state => state.retrySession);
  const setSessionError = useAuthStore(state => state.setSessionError);
  const setAuthInitializing = useAuthStore((state) => state.setAuthInitializing);

  useEffect(() => {
    setAccessTokenProvider(async (forceRefresh = false) => {
      if (forceRefresh) await clearAccessToken();
      return getAccessToken(logtoResource, logtoOrganizationId);
    });
    setLogoutProvider(() => signOut(window.location.origin));
    return () => {
      setAccessTokenProvider(null);
      setLogoutProvider(null);
    };
  }, [getAccessToken, clearAccessToken, signOut]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setAuth({ token: null, user: null });
      setAuthInitializing(false);
    }
  }, [isAuthenticated, isLoading, setAuth, setAuthInitializing]);

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    setAuthInitializing(true);
    setSessionError(null);
    void (async () => {
      try {
        const token = await getAccessToken(logtoResource, logtoOrganizationId);
        if (cancelled) return;
        if (!token) throw new Error('SSO 未返回打卡访问凭据，请重新登录');
        const user = await fetchCurrentUser();
        if (!cancelled) setAuth({ token, user });
      } catch (error) {
        if (!cancelled) setSessionError(getApiErrorMessage(error, '登录资料恢复失败，请重试或联系管理员'));
      } finally {
        if (!cancelled) setAuthInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getAccessToken, isAuthenticated, setAuth, setAuthInitializing, retrySession, setSessionError]);

  return children;
};

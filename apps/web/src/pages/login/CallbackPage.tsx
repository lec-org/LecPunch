import { Button } from '@lecpunch/ui';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHandleSignInCallback } from '@logto/react';
import { useAuthStore } from '@/app/store/auth-store';

export const CallbackPage = () => {
  const navigate = useNavigate();
  const sessionError = useAuthStore(state => state.sessionError);
  const retry = useAuthStore(state => state.retrySessionRestore);
  const auth = useAuthStore((state) => state.auth);
  const { error } = useHandleSignInCallback();

  useEffect(() => {
    if (auth.token && auth.user) navigate('/', { replace: true });
  }, [auth, navigate]);

  if (error || sessionError) return <div className="space-y-4">
    <p role="alert" className="text-sm text-red-600">SSO 登录未完成：{error?.message || sessionError}</p>
    <Button onClick={retry}>重试恢复登录</Button> <Button variant="outline" onClick={() => navigate('/login', { replace: true })}>重新登录</Button>
  </div>;
  return <p className="text-sm text-gray-500">正在完成登录…</p>;
};

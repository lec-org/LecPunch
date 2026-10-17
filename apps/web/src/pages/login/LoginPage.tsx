import { useState } from 'react';
import { useAuthStore } from '@/app/store/auth-store';
import { useLogto } from '@logto/react';
import { Alert, Button } from '@lecpunch/ui';
import { logtoCallbackUri, logtoOrganizationId } from '@/shared/auth/logto';

export const LoginPage = () => {
  const sessionError = useAuthStore(state => state.sessionError);
  const { signIn, error } = useLogto();
  const [submitting, setSubmitting] = useState(false);

  const handleSignIn = async () => {
    setSubmitting(true);
    try {
      await signIn({
        redirectUri: logtoCallbackUri,
        extraParams: { organization_id: logtoOrganizationId }
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-10 shadow-xl">
      <div className="mb-8">
        <h2 className="mb-2 text-2xl font-bold text-gray-900">欢迎回来 👋</h2>
        <p className="text-gray-500">使用 LEC SSO 账号登录 LecPunch</p>
      </div>
      {error || sessionError ? <Alert variant="error">{error?.message || sessionError}</Alert> : null}
      <Button type="button" size="lg" loading={submitting} className="mt-4 w-full" onClick={handleSignIn}>
        使用 LEC SSO 登录
      </Button>
    </div>
  );
};

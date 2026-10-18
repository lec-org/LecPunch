import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/app/store/auth-store';
import { LogtoSession } from './LogtoSession';

const mocks = vi.hoisted(() => ({
  isAuthenticated: true,
  isLoading: false,
  getAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
  signOut: vi.fn(),
  fetchCurrentUser: vi.fn(),
  setAccessTokenProvider: vi.fn(),
  setLogoutProvider: vi.fn()
}));

vi.mock('@logto/react', () => ({
  useLogto: () => ({
    isAuthenticated: mocks.isAuthenticated,
    isLoading: mocks.isLoading,
    getAccessToken: mocks.getAccessToken,
    clearAccessToken: mocks.clearAccessToken,
    signOut: mocks.signOut
  })
}));

vi.mock('@/shared/auth/logto', () => ({
  logtoOrganizationId: 'lec-studio',
  logtoResource: 'https://api.lecpunch.lec.org',
  fetchCurrentUser: mocks.fetchCurrentUser,
  setAccessTokenProvider: mocks.setAccessTokenProvider,
  setLogoutProvider: mocks.setLogoutProvider
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('LogtoSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthenticated = true;
    mocks.isLoading = false;
    useAuthStore.setState({ auth: { token: null, user: null }, authInitializing: true });
  });

  afterEach(cleanup);

  it('强制刷新只清理访问 token 缓存，再向 SDK 获取原资源和组织的凭据', async () => {
    mocks.getAccessToken.mockResolvedValue('fresh-token');
    mocks.clearAccessToken.mockResolvedValue(undefined);
    mocks.fetchCurrentUser.mockResolvedValue({ id: 'user-1', role: 'member' });
    render(<LogtoSession><p>应用</p></LogtoSession>);
    await waitFor(() => expect(useAuthStore.getState().auth.token).toBe('fresh-token'));
    const calls = mocks.setAccessTokenProvider.mock.calls;
    const provider = calls[calls.length - 1][0];
    mocks.getAccessToken.mockClear();
    expect(await provider()).toBe('fresh-token');
    expect(mocks.clearAccessToken).not.toHaveBeenCalled();
    mocks.getAccessToken.mockClear();
    expect(await provider(true)).toBe('fresh-token');
    expect(mocks.clearAccessToken).toHaveBeenCalledOnce();
    expect(mocks.getAccessToken).toHaveBeenCalledExactlyOnceWith('https://api.lecpunch.lec.org', 'lec-studio');
    expect(mocks.clearAccessToken.mock.invocationCallOrder[0]).toBeLessThan(mocks.getAccessToken.mock.invocationCallOrder[0]);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('获取 token 引发 SDK loading 时不会取消会话恢复', async () => {
    const token = deferred<string | undefined>();
    const user = {
      id: 'user-1', lecUserId: 'sso-user-1', name: null, avatar: null, studentNumber: null, teamId: 'team-1', username: 'alice', displayName: 'Alice',
      role: 'member', status: 'active', enrollYear: 2024,
      createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z'
    };
    mocks.getAccessToken.mockReturnValue(token.promise);
    mocks.fetchCurrentUser.mockResolvedValue(user);

    const view = render(<LogtoSession><p>应用</p></LogtoSession>);
    await waitFor(() => expect(mocks.getAccessToken).toHaveBeenCalledOnce());

    mocks.isLoading = true;
    view.rerender(<LogtoSession><p>应用</p></LogtoSession>);
    await act(() => {
      token.resolve('access-token');
      return token.promise;
    });

    await waitFor(() => {
      expect(useAuthStore.getState().auth).toEqual({ token: 'access-token', user });
      expect(useAuthStore.getState().authInitializing).toBe(false);
    });
  });

  it('业务恢复失败可重试，且不会调用 SSO 登出或签退', async () => {
    mocks.getAccessToken.mockResolvedValue('valid-token');
    mocks.fetchCurrentUser.mockRejectedValueOnce(new Error('network unavailable'));
    render(<LogtoSession><p>应用</p></LogtoSession>);
    await waitFor(() => expect(useAuthStore.getState().sessionError).toBeTruthy());
    expect(useAuthStore.getState().authInitializing).toBe(false);
    expect(mocks.signOut).not.toHaveBeenCalled();

    mocks.fetchCurrentUser.mockResolvedValue({ id: 'user-1', role: 'member' });
    act(() => useAuthStore.getState().retrySessionRestore());
    await waitFor(() => expect(useAuthStore.getState().auth.token).toBe('valid-token'));
    expect(useAuthStore.getState().sessionError).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});

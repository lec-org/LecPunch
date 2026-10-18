import { createUserFixture } from '@/test/user-fixture';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/app/store/auth-store';
import { CallbackPage } from './CallbackPage';

const sdk = vi.hoisted(() => ({ error: undefined as Error | undefined }));
vi.mock('@logto/react', () => ({
  useHandleSignInCallback: () => ({ isLoading: false, isAuthenticated: true, error: sdk.error })
}));

const Location = () => <span data-testid="location">{useLocation().pathname}</span>;

const renderCallback = () =>
  render(
    <MemoryRouter initialEntries={['/callback?code=test&state=test']}>
      <Location />
      <Routes>
        <Route path="/callback" element={<CallbackPage />} />
        <Route path="/login" element={<p>登录页</p>} />
        <Route path="/" element={<p>首页</p>} />
      </Routes>
    </MemoryRouter>
  );

describe('CallbackPage', () => {
  beforeEach(() => {
    sdk.error = undefined;
    useAuthStore.setState({ auth: { token: null, user: null }, authInitializing: true, sessionError: null });
  });
  afterEach(cleanup);

  it('会话快照恢复前停留在回调页', () => {
    renderCallback();

    expect(screen.getByTestId('location')).toHaveTextContent('/callback');
    expect(screen.getByText('正在完成登录…')).toBeInTheDocument();
  });

  it('API 用户快照恢复后进入首页', () => {
    useAuthStore.setState({
      auth: {
        token: 'access-token',
        user: createUserFixture({
          id: 'user-1', teamId: 'team-1', username: 'alice', displayName: 'Alice',
          role: 'member', status: 'active', enrollYear: 2024,
          createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z'
        })
      }
    });

    renderCallback();

    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(screen.getByText('首页')).toBeInTheDocument();
  });

  it('only offers re-login for callback errors, even if a business recovery error also exists', async () => {
    sdk.error = new Error('callback failed');
    useAuthStore.setState({ sessionError: 'profile failed' });
    renderCallback();
    expect(screen.queryByRole('button', { name: '重试恢复登录' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重新登录' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('offers recovery when only restoring the business profile failed', async () => {
    useAuthStore.setState({ sessionError: 'profile failed' });
    const previous = useAuthStore.getState().retrySession;
    renderCallback();
    await userEvent.click(screen.getByRole('button', { name: '重试恢复登录' }));
    expect(useAuthStore.getState().retrySession).toBe(previous + 1);
  });
});

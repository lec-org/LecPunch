import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '@/app/store/auth-store';
import { NETWORK_STATUS_ERROR_RETRY_MS, NETWORK_STATUS_REFRESH_MS } from '@/shared/constants/timing';
import { AppHeader } from './AppHeader';

const mocks = vi.hoisted(() => ({
  getCurrentNetworkStatus: vi.fn(), notificationError: ''
}));

vi.mock('@/features/network-policy/network-policy.api', () => ({
  getCurrentNetworkStatus: mocks.getCurrentNetworkStatus
}));
vi.mock('@/features/notifications/NotificationProvider', () => ({ useNotifications: () => ({ badgeCount: 3, error: mocks.notificationError }) }));

describe('AppHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationError = '';
    useAuthStore.setState({
      auth: {
        token: 'token',
        user: {
          id: 'member-1',
          lecUserId: null, name: null, avatar: null, studentNumber: null,
          teamId: 'team-1',
          username: 'member',
          displayName: 'Member',
          role: 'member',
          status: 'active',
          enrollYear: 2024,
          createdAt: '2026-04-11T00:00:00.000Z',
          updatedAt: '2026-04-11T00:00:00.000Z'
        }
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows a blocked network state when the current request is not allowed', async () => {
    mocks.getCurrentNetworkStatus.mockResolvedValue({
      clientIp: '203.0.113.10',
      isAllowed: false
    });

    render(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    expect(await screen.findByText('当前网络未放行')).toBeInTheDocument();
    expect(screen.getByTitle('服务端识别 IP: 203.0.113.10')).toBeInTheDocument();
  });

  it('shows a connected network state when the current request is allowed', async () => {
    mocks.getCurrentNetworkStatus.mockResolvedValue({
      clientIp: '198.51.100.8',
      isAllowed: true
    });

    render(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    expect(await screen.findByText('已连接团队网络')).toBeInTheDocument();
  });

  it('uses a longer retry delay when network status requests fail', async () => {
    vi.useFakeTimers();
    mocks.getCurrentNetworkStatus.mockRejectedValue(new Error('offline'));

    render(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.getCurrentNetworkStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(NETWORK_STATUS_REFRESH_MS);
    expect(mocks.getCurrentNetworkStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(NETWORK_STATUS_ERROR_RETRY_MS - NETWORK_STATUS_REFRESH_MS);
    expect(mocks.getCurrentNetworkStatus).toHaveBeenCalledTimes(2);
  });

  it('includes notification errors and unread count in the accessible link name', () => {
    mocks.notificationError = '通知同步失败';
    render(<MemoryRouter><AppHeader /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '通知，3 条未读，通知同步失败' })).toBeInTheDocument();
  });
});

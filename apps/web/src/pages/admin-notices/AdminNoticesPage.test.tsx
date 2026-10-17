import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminNoticesPage } from './AdminNoticesPage';

const mocks = vi.hoisted(() => ({ sent: vi.fn(), status: vi.fn(), publish: vi.fn() }));
vi.mock('@/features/notifications/notifications.api', () => ({
  getSentNotifications: mocks.sent, getNotificationReadStatus: mocks.status, publishNotice: mocks.publish
}));

describe('AdminNoticesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sent.mockResolvedValue([{ id: 'notice-1', title: '管理员通知', message: '请核对', createdAt: '2026-10-17T10:00:00Z' }]);
    mocks.status.mockResolvedValue([
      { userId: 'member-1', displayName: '已读成员', readAt: '2026-10-17T11:00:00Z' },
      { userId: 'member-2', displayName: '未读成员', readAt: null }
    ]);
  });
  afterEach(cleanup);

  it('shows which members have explicitly read an administrator notice', async () => {
    render(<AdminNoticesPage />);
    await userEvent.click(await screen.findByRole('button', { name: '查看／刷新成员已读状态' }));
    expect(await screen.findByText('已读 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('已读成员')).toBeInTheDocument();
    expect(screen.getByText('未读成员')).toBeInTheDocument();
    expect(screen.getByText('未读')).toBeInTheDocument();
    expect(mocks.status).toHaveBeenCalledWith('notice-1');
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

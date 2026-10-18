import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminNoticesPage } from './AdminNoticesPage';

const mocks = vi.hoisted(() => ({ sent: vi.fn(), status: vi.fn(), publish: vi.fn() }));
vi.mock('@/features/notifications/notifications.api', () => ({
  getSentNotifications: mocks.sent, getNotificationReadStatus: mocks.status, publishNotice: mocks.publish
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const notice = { id: 'notice-1', title: '管理员通知', message: '请核对', createdAt: '2026-10-17T10:00:00Z' };
const readReceipt: { userId: string; displayName: string; readAt: string | null }[] = [
  { userId: 'member-1', displayName: '成员', readAt: '2026-10-17T11:00:00Z' }
];

describe('AdminNoticesPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sent.mockResolvedValue([notice]);
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

  it.each(['success', 'failure'])('keeps the published notice when an older list completes with %s', async outcome => {
    const old = deferred<typeof notice[]>();
    mocks.sent.mockReturnValueOnce(old.promise).mockResolvedValueOnce([notice]);
    mocks.publish.mockResolvedValueOnce(notice);
    render(<AdminNoticesPage />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: '标题' }), notice.title);
    await user.type(screen.getByRole('textbox', { name: '通知内容' }), notice.message);
    await user.click(screen.getByRole('button', { name: '发布团队通知' }));
    await screen.findByRole('heading', { name: notice.title });
    expect(mocks.sent).toHaveBeenCalledTimes(2);
    await act(async () => {
      if (outcome === 'success') old.resolve([]);
      else old.reject(new Error('旧读取失败'));
      await old.promise.catch(() => {});
    });
    expect(screen.getByRole('heading', { name: notice.title })).toBeInTheDocument();
    expect(screen.queryByText('暂无已发通知。')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'])('keeps the latest read status when an older request completes with %s', async outcome => {
    const old = deferred<typeof readReceipt>();
    mocks.status.mockReturnValueOnce(old.promise).mockResolvedValueOnce(readReceipt);
    render(<AdminNoticesPage />);
    const button = await screen.findByRole('button', { name: '查看／刷新成员已读状态' });
    await userEvent.click(button);
    await userEvent.click(button);
    await screen.findByText('已读 1 / 1');
    await act(async () => {
      if (outcome === 'success') old.resolve([{ ...readReceipt[0], readAt: null }]);
      else old.reject(new Error('旧状态读取失败'));
      await old.promise.catch(() => {});
    });
    expect(screen.getByText('已读 1 / 1')).toBeInTheDocument();
    expect(screen.queryByText('未读')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not reopen a previously selected notice when its status arrives late', async () => {
    const old = deferred<typeof readReceipt>();
    mocks.sent.mockResolvedValueOnce([notice, { ...notice, id: 'notice-2', title: '第二条通知' }]);
    mocks.status.mockReturnValueOnce(old.promise).mockResolvedValueOnce(readReceipt);
    render(<AdminNoticesPage />);
    const buttons = await screen.findAllByRole('button', { name: '查看／刷新成员已读状态' });
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);
    const readCount = await screen.findByText('已读 1 / 1');
    expect(readCount.closest('article')).toHaveTextContent('第二条通知');
    await act(async () => { old.resolve([]); await old.promise; });
    expect(screen.getByText('已读 1 / 1').closest('article')).toHaveTextContent('第二条通知');
    expect(screen.queryByText('已读 0 / 0')).not.toBeInTheDocument();
  });
});

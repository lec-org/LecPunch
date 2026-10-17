import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '@/app/store/auth-store';
import { createUserFixture } from '@/test/user-fixture';
import { NotificationsPage } from './NotificationsPage';
const mocks = vi.hoisted(() => ({ page: vi.fn(), ack: vi.fn(), refresh: vi.fn(), preferences: vi.fn(), savePreferences: vi.fn() }));
vi.mock('@/features/notifications/NotificationProvider', () => ({ useNotifications: () => ({ count: 1, error: '', refresh: mocks.refresh }) }));
vi.mock('@/features/notifications/notifications.api', () => ({ getNotificationPage: mocks.page, acknowledgeNotification: mocks.ack, getNotificationPreferences: mocks.preferences, setNotificationPreferences: mocks.savePreferences }));
const notice = { id: 'notice-1', title: '团队通知', message: '请确认阅读', type: 'admin.notice', acknowledgedAt: null as string | null, createdAt: '2026-10-17T10:00:00Z' };
type Page = { items: typeof notice[]; nextCursor: string | null };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const mount = () => render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
const settle = async (pending: ReturnType<typeof deferred<Page>>, items: typeof notice[]) => {
  await act(async () => { pending.resolve({ items, nextCursor: null }); await pending.promise; });
};
afterEach(cleanup);
describe('NotificationsPage', () => {
  beforeEach(() => { vi.resetAllMocks(); useAuthStore.setState({ auth: { token: 'token', user: createUserFixture({ role: 'member' }) } }); mocks.page.mockResolvedValue({ items: [notice], nextCursor: null }); });
  it('does not mark messages read on page load, and persists explicit member confirmation', async () => {
    mocks.ack.mockResolvedValue({ ...notice, acknowledgedAt: '2026-10-17T11:00:00Z' });
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    expect(await screen.findByText('请确认阅读')).toBeInTheDocument(); expect(mocks.ack).not.toHaveBeenCalled();
    mocks.page.mockResolvedValue({ items: [], nextCursor: null });
    await userEvent.click(screen.getByRole('button', { name: '标记已读' }));
    await waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('notice-1'));
    await waitFor(() => expect(screen.queryByText('请确认阅读')).not.toBeInTheDocument());
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('ignores a late all response after switching back to unread, including its loading state', async () => {
    mount();
    await screen.findByText('请确认阅读');
    const all = deferred<Page>();
    const unread = deferred<Page>();
    mocks.page.mockReturnValueOnce(all.promise).mockReturnValueOnce(unread.promise);
    await userEvent.click(screen.getByRole('button', { name: '全部' }));
    const allSignal = mocks.page.mock.calls[mocks.page.mock.calls.length - 1][1] as AbortSignal;
    await userEvent.click(screen.getByRole('button', { name: '未读' }));
    expect(allSignal.aborted).toBe(true);
    await settle(all, [{ ...notice, message: '过期全部结果' }]);
    expect(screen.getByText('正在加载…')).toBeInTheDocument();
    expect(screen.queryByText('过期全部结果')).not.toBeInTheDocument();
    await settle(unread, [{ ...notice, message: '最新未读结果' }]);
    expect(screen.getByText('最新未读结果')).toBeInTheDocument();
    expect(screen.queryByText('正在加载…')).not.toBeInTheDocument();
  });

  it('does not append an old page to a different filter', async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => ({ ...notice, id: `notice-${i}`, message: `第一页 ${i}` }));
    mocks.page.mockResolvedValueOnce({ items: firstPage, nextCursor: 'cursor-1' });
    mount();
    await screen.findByText('第一页 0');
    const pagination = deferred<Page>();
    mocks.page.mockReturnValueOnce(pagination.promise).mockResolvedValueOnce({ items: [{ ...notice, message: '全部结果' }], nextCursor: null });
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(mocks.page).toHaveBeenLastCalledWith({ status: 'unacked', limit: 20, before: 'cursor-1' }, expect.any(AbortSignal));
    const signal = mocks.page.mock.calls[mocks.page.mock.calls.length - 1][1] as AbortSignal;
    await userEvent.click(screen.getByRole('button', { name: '全部' }));
    await screen.findByText('全部结果');
    await settle(pagination, [{ ...notice, id: 'old-page', message: '过期分页' }]);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('过期分页')).not.toBeInTheDocument();
    expect(screen.queryByText('第一页 0')).not.toBeInTheDocument();
  });

  it('deduplicates same-query pagination and replaces the list on manual refresh', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ ...notice, id: `notice-${i}`, message: `通知 ${i}` }));
    mocks.page.mockResolvedValueOnce({ items, nextCursor: 'cursor-1' }).mockResolvedValueOnce({ items: [items[0], { ...notice, id: 'extra', message: '追加通知' }], nextCursor: null });
    mount();
    await screen.findByText('通知 0');
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await screen.findByText('追加通知');
    expect(screen.getAllByText('通知 0')).toHaveLength(1);
    mocks.page.mockResolvedValueOnce({ items: [{ ...notice, message: '刷新结果' }], nextCursor: null });
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByText('刷新结果');
    expect(screen.queryByText('追加通知')).not.toBeInTheDocument();
  });

  it('invalidates in-flight unread responses immediately after acknowledgement', async () => {
    mount();
    await screen.findByText('请确认阅读');
    const stale = deferred<Page>();
    const fresh = deferred<Page>();
    mocks.page.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    const staleSignal = mocks.page.mock.calls[mocks.page.mock.calls.length - 1][1] as AbortSignal;
    mocks.ack.mockResolvedValue({ ...notice, acknowledgedAt: '2026-10-17T11:00:00Z' });
    await userEvent.click(screen.getByRole('button', { name: '标记已读' }));
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(3));
    expect(staleSignal.aborted).toBe(true);
    await settle(stale, [notice]);
    expect(screen.queryByText('请确认阅读')).not.toBeInTheDocument();
    await settle(fresh, []);
    expect(screen.getByText('暂无未读通知。')).toBeInTheDocument();
  });

  it('rejects late results and acknowledgement from the previous account', async () => {
    mount();
    await screen.findByText('请确认阅读');
    const ack = deferred<typeof notice>();
    const oldPage = deferred<Page>();
    mocks.ack.mockReturnValue(ack.promise);
    await userEvent.click(screen.getByRole('button', { name: '标记已读' }));
    mocks.page.mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce({ items: [{ ...notice, message: '新账号通知' }], nextCursor: null });
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    const signal = mocks.page.mock.calls[mocks.page.mock.calls.length - 1][1] as AbortSignal;
    act(() => useAuthStore.getState().setAuth({ token: 'new', user: createUserFixture({ id: 'member-2' }) }));
    await screen.findByText('新账号通知');
    const calls = mocks.page.mock.calls.length;
    await settle(oldPage, [notice]);
    await act(async () => { ack.resolve({ ...notice, acknowledgedAt: 'now' }); await ack.promise; });
    expect(signal.aborted).toBe(true);
    expect(screen.getByText('新账号通知')).toBeInTheDocument();
    expect(screen.queryByText('请确认阅读')).not.toBeInTheDocument();
    expect(mocks.page).toHaveBeenCalledTimes(calls);
  });

  it('resynchronizes the currently selected filter if it changes while acknowledgement is pending', async () => {
    mount();
    await screen.findByText('请确认阅读');
    const ack = deferred<typeof notice>();
    mocks.ack.mockReturnValueOnce(ack.promise);
    await userEvent.click(screen.getByRole('button', { name: '标记已读' }));
    await userEvent.click(screen.getByRole('button', { name: '全部' }));
    await screen.findByText('请确认阅读');
    mocks.page.mockResolvedValueOnce({ items: [{ ...notice, acknowledgedAt: 'now' }], nextCursor: null });
    await act(async () => { ack.resolve({ ...notice, acknowledgedAt: 'now' }); await ack.promise; });
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(3));
    expect(mocks.page).toHaveBeenLastCalledWith({ status: 'all', limit: 20, before: undefined }, expect.any(AbortSignal));
    expect(await screen.findByText('已读')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '标记已读' })).not.toBeInTheDocument();
  });

  it('cancels pending requests on unmount and ignores late results', async () => {
    const page = deferred<Page>();
    mocks.page.mockReturnValueOnce(page.promise);
    const view = mount();
    const signal = mocks.page.mock.calls[0][1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await settle(page, [notice]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('ignores stale failures after a newer manual refresh succeeds', async () => {
    const stale = deferred<Page>();
    mocks.page.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ items: [notice], nextCursor: null });
    mount();
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByText('请确认阅读');
    await act(async () => { stale.reject(new Error('old failure')); await stale.promise.catch(() => {}); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('prevents preference changes until the initial read completes and serializes saves', async () => {
    useAuthStore.getState().updateUser({ role: 'admin' });
    const initial = deferred<{ adminMessageBadgeEnabled: boolean }>();
    const save = deferred<{ adminMessageBadgeEnabled: boolean }>();
    mocks.preferences.mockReturnValueOnce(initial.promise);
    mocks.savePreferences.mockReturnValueOnce(save.promise);
    mount();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();
    await userEvent.click(checkbox);
    expect(mocks.savePreferences).not.toHaveBeenCalled();
    await act(async () => { initial.resolve({ adminMessageBadgeEnabled: true }); await initial.promise; });
    expect(checkbox).toBeEnabled();
    await userEvent.click(checkbox);
    expect(mocks.savePreferences).toHaveBeenCalledExactlyOnceWith(false);
    expect(checkbox).toBeDisabled();
    await userEvent.click(checkbox);
    expect(mocks.savePreferences).toHaveBeenCalledOnce();
    await act(async () => { save.resolve({ adminMessageBadgeEnabled: false }); await save.promise; });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeEnabled();
  });

  it('keeps the confirmed preference and allows retry when saving fails', async () => {
    useAuthStore.getState().updateUser({ role: 'admin' });
    mocks.preferences.mockResolvedValue({ adminMessageBadgeEnabled: true });
    mocks.savePreferences.mockRejectedValueOnce(new Error('network down'));
    mount();
    const checkbox = screen.getByRole('checkbox');
    await waitFor(() => expect(checkbox).toBeEnabled());
    await userEvent.click(checkbox);
    expect(await screen.findByRole('alert')).toHaveTextContent('接收设置保存失败');
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
  });

  it('does not let the previous account save overwrite or unlock a new account preference read', async () => {
    useAuthStore.getState().updateUser({ role: 'admin' });
    const save = deferred<{ adminMessageBadgeEnabled: boolean }>();
    const nextAccount = deferred<{ adminMessageBadgeEnabled: boolean }>();
    mocks.preferences.mockResolvedValueOnce({ adminMessageBadgeEnabled: true }).mockReturnValueOnce(nextAccount.promise);
    mocks.savePreferences.mockReturnValueOnce(save.promise);
    mount();
    const checkbox = screen.getByRole('checkbox');
    await waitFor(() => expect(checkbox).toBeEnabled());
    await userEvent.click(checkbox);
    act(() => useAuthStore.getState().setAuth({ token: 'new', user: createUserFixture({ id: 'admin-2', role: 'admin' }) }));
    await act(async () => { save.resolve({ adminMessageBadgeEnabled: false }); await save.promise; });
    expect(checkbox).toBeDisabled();
    await act(async () => { nextAccount.resolve({ adminMessageBadgeEnabled: true }); await nextAccount.promise; });
    expect(checkbox).toBeEnabled();
    expect(checkbox).toBeChecked();
  });
});

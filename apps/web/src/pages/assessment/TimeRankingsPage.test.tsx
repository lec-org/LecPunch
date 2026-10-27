import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssessmentLeaderboardView, AssessmentMemberHistory } from '@lecpunch/shared';
import { useAuthStore } from '@/app/store/auth-store';
import { createUserFixture } from '@/test/user-fixture';
import { TimeRankingsPage } from './TimeRankingsPage';
const api = vi.hoisted(() => ({ getAssessmentLeaderboard: vi.fn(), getAssessmentHistory: vi.fn() }));
vi.mock('@/features/assessment/assessment.api', () => api);
const view = (enabled = true): AssessmentLeaderboardView => ({
  enabled, startWeek: enabled ? '2026-10-26' : null, week: '2026-11-02', settlementNote: '周结束后保留五小时打卡结算窗口。',
  items: [
    { memberKey: 'stable-a', displayName: '成员甲', username: 'alpha', enrollYear: 2025, rank: 1, totalDurationSeconds: 100800, recordedDurationSeconds: 99000, manualAdjustmentSeconds: 0, entertainmentSeconds: 1800, weeklyGoalSeconds: 100800, assessmentComplete: true, failedWeeksCount: 2 },
    { memberKey: 'stable-b', displayName: '成员乙', username: 'beta', enrollYear: 2025, rank: 1, totalDurationSeconds: 100800, recordedDurationSeconds: 100800, manualAdjustmentSeconds: 0, entertainmentSeconds: 0, weeklyGoalSeconds: 100800, assessmentComplete: true, failedWeeksCount: 0 },
    { memberKey: 'stable-c', displayName: '成员丙', username: 'gamma', enrollYear: 2025, rank: 3, totalDurationSeconds: -1800, recordedDurationSeconds: 0, manualAdjustmentSeconds: 0, entertainmentSeconds: -1800, weeklyGoalSeconds: 100800, assessmentComplete: false, failedWeeksCount: 1 }
  ]
});
const history = (weekKey = '2026-10-26', nextCursor: string | null = null): AssessmentMemberHistory => ({
  member: { memberKey: 'stable-a', displayName: '成员甲' }, failedWeeksCount: 2, nextCursor,
  items: [{ weekKey, weekEnd: '2026-11-01', goalSeconds: 100800, recordedDurationSeconds: 72000, manualAdjustmentSeconds: -1800, entertainmentSeconds: -1800, totalDurationSeconds: 68400, shortfallSeconds: 32400, settledAt: '2026-11-02T00:00:00.000Z' }]
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  vi.clearAllMocks(); useAuthStore.setState({ auth: { token: 'token', user: createUserFixture() } });
  api.getAssessmentLeaderboard.mockResolvedValue(view()); api.getAssessmentHistory.mockResolvedValue(history());
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open', ''); });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute('open'); });
});
afterEach(cleanup);
describe('TimeRankingsPage historical assessment boundary', () => {
  it('shows an explicit disabled state rather than presenting empty history as zero failures', async () => {
    api.getAssessmentLeaderboard.mockResolvedValue(view(false)); render(<TimeRankingsPage />);
    expect(await screen.findByRole('heading', { name: '历史考核尚未启用' })).toBeInTheDocument();
    expect(screen.getByText(/起算规则待确认，不追罚过去周/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '没有完成 2 周' })).not.toBeInTheDocument();
    expect(screen.queryByText('已结算未完成 0 周')).not.toBeInTheDocument();
    expect(api.getAssessmentHistory).not.toHaveBeenCalled();
  });
  it('keeps server tie ranks, signed comprehensive duration and textual weekly status', async () => {
    render(<TimeRankingsPage />); await screen.findByText('成员甲');
    expect(screen.getAllByLabelText('第1名')).toHaveLength(2);
    expect(screen.getByLabelText('第3名')).toBeInTheDocument();
    expect(screen.getByText('−00:30:00')).toBeInTheDocument();
    expect(screen.getAllByText('本周已完成')).toHaveLength(2);
    expect(screen.getByText('本周未完成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '没有完成 2 周' })).toBeInTheDocument();
  });
  it('opens stable-member history, preserves loaded weeks on pagination error and retries the same cursor', async () => {
    api.getAssessmentHistory.mockResolvedValueOnce(history('2026-10-26', '2026-10-26'))
      .mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(history('2026-10-19'));
    render(<TimeRankingsPage />); await userEvent.click(await screen.findByRole('button', { name: '没有完成 2 周' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); await screen.findByText('考核周日：2026-11-01');
    expect(api.getAssessmentHistory).toHaveBeenNthCalledWith(1, 'stable-a', undefined, expect.any(AbortSignal));
    await userEvent.click(screen.getByRole('button', { name: '加载更早的未完成周' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未完成周详情加载失败');
    expect(screen.getByText('考核周日：2026-11-01')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试加载详情' }));
    await screen.findByText('考核周日：2026-10-25');
    expect(api.getAssessmentHistory).toHaveBeenNthCalledWith(2, 'stable-a', '2026-10-26', expect.any(AbortSignal));
    expect(api.getAssessmentHistory).toHaveBeenNthCalledWith(3, 'stable-a', '2026-10-26', expect.any(AbortSignal));
  });
  it('dismisses history with Escape, restores focus and ignores its later response', async () => {
    const pending = deferred<AssessmentMemberHistory>(); api.getAssessmentHistory.mockReturnValue(pending.promise);
    render(<TimeRankingsPage />); const trigger = await screen.findByRole('button', { name: '没有完成 2 周' });
    await userEvent.click(trigger); await screen.findByRole('dialog');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
    await act(async () => { pending.resolve(history()); });
    expect(screen.queryByText('考核周日：2026-11-01')).not.toBeInTheDocument();
  });
  it('clears previous-account rankings and history while the next account is loading', async () => {
    const next = deferred<AssessmentLeaderboardView>(); api.getAssessmentLeaderboard.mockResolvedValueOnce(view()).mockReturnValueOnce(next.promise);
    render(<TimeRankingsPage />); await userEvent.click(await screen.findByRole('button', { name: '没有完成 2 周' })); await screen.findByRole('dialog');
    act(() => useAuthStore.setState({ auth: { token: 'other', user: createUserFixture({ id: 'other' }) } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByText('成员甲')).not.toBeInTheDocument();
    await act(async () => { next.resolve({ ...view(), items: [] }); });
    expect(await screen.findByText('当前团队暂无可展示的考核成员。')).toBeInTheDocument();
  });
  it('shows a first-load error with retry and preserves a same-account snapshot on refresh failure', async () => {
    api.getAssessmentLeaderboard.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(view()).mockRejectedValueOnce(new Error('offline'));
    render(<TimeRankingsPage />);
    await userEvent.click(await screen.findByRole('button', { name: '重新加载排行' })); await screen.findByText('成员甲');
    await userEvent.click(screen.getByRole('button', { name: '刷新排行' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保留上次成功读取的排行'));
    expect(screen.getByText('成员甲')).toBeInTheDocument();
  });
});

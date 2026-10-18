import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminDurationPage } from './AdminDurationPage';

const mocks = vi.hoisted(() => ({ members: vi.fn(), context: vi.fn(), audit: vi.fn(), adjust: vi.fn() }));
vi.mock('@/features/users/users.api', () => ({ getAdminMembers: mocks.members }));
vi.mock('@/features/attendance/duration-adjustments.api', () => ({
  getAdjustmentContext: mocks.context, getAdjustmentAudit: mocks.audit, adjustDuration: mocks.adjust
}));

describe('AdminDurationPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.members.mockResolvedValue([{ id: 'member-1', username: 'new.handle', displayName: '测试成员', status: 'active', studentNumber: '202500001234' }]);
    mocks.context.mockResolvedValue({ userId: 'member-1', weekKey: '2026-10-12', isoWeek: '2026-W42', recordedDurationSeconds: 600, manualAdjustmentSeconds: 0, totalDurationSeconds: 600 });
    mocks.audit.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it('retries an unknown result with the same stable member ID and request key', async () => {
    mocks.adjust.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ resultingDurationSeconds: 540 });
    render(<AdminDurationPage />);
    const user = userEvent.setup();
    await screen.findByRole('option', { name: /测试成员/ });
    await user.selectOptions(screen.getByRole('combobox', { name: '选择成员' }), 'member-1');
    await screen.findByText(/本周 2026-10-12 起/);
    await user.selectOptions(screen.getByRole('combobox', { name: '增减方式' }), 'subtract');
    await user.type(screen.getByRole('spinbutton', { name: '分钟' }), '1');
    await user.type(screen.getByRole('textbox', { name: '调整原因' }), '核对后调整');
    await user.click(screen.getByRole('button', { name: '确认调整' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: '调整原因' })).toHaveValue('核对后调整');
    await user.click(screen.getByRole('button', { name: '确认调整' }));
    await waitFor(() => expect(mocks.adjust).toHaveBeenCalledTimes(2));
    expect(mocks.adjust.mock.calls[1][0]).toEqual(mocks.adjust.mock.calls[0][0]);
    expect(mocks.adjust.mock.calls[0][0]).toMatchObject({ userId: 'member-1', durationSeconds: 60, operation: 'subtract', expectedWeekKey: '2026-10-12' });
    expect(await screen.findByRole('status')).toHaveTextContent('00:09:00');
  });

  it.each(['context', 'audit'])('never resubmits after a successful adjustment when refreshing %s fails', async failure => {
    mocks.adjust.mockResolvedValue({ resultingDurationSeconds: 660 });
    render(<AdminDurationPage />);
    await screen.findByRole('option', { name: /测试成员/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '选择成员' }), 'member-1');
    await screen.findByText(/本周 2026-10-12 起/);
    await userEvent.type(screen.getByRole('spinbutton', { name: '分钟' }), '1');
    await userEvent.type(screen.getByRole('textbox', { name: '调整原因' }), '补录');
    mocks[failure as 'context' | 'audit'].mockRejectedValueOnce(new Error('refresh failed'));
    await userEvent.click(screen.getByRole('button', { name: '确认调整' }));
    expect(await screen.findByRole('status')).toHaveTextContent('调整成功');
    expect(screen.getByRole('alert')).toHaveTextContent('调整已成功，但刷新数据失败');
    expect(screen.getByRole('spinbutton', { name: '分钟' })).toHaveValue(null);
    await userEvent.type(screen.getByRole('spinbutton', { name: '分钟' }), '1');
    await userEvent.type(screen.getByRole('textbox', { name: '调整原因' }), '误以为未完成');
    expect(screen.getByRole('button', { name: '确认调整' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '仅刷新数据' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '仅刷新数据' })).not.toBeInTheDocument());
    expect(mocks.adjust).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the negative balance and only allows an amount that fully repairs it', async () => {
    mocks.context.mockResolvedValue({ userId: 'member-1', weekKey: '2026-10-12', isoWeek: '2026-W42', recordedDurationSeconds: 0, manualAdjustmentSeconds: -600, totalDurationSeconds: -600 });
    mocks.adjust.mockResolvedValue({ resultingDurationSeconds: 0 });
    render(<AdminDurationPage />);
    await screen.findByRole('option', { name: /测试成员/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '选择成员' }), 'member-1');
    expect(await screen.findByText(/当前合计 -00:10:00/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: '调整原因' }), '核对后补正');
    const minutes = screen.getByRole('spinbutton', { name: '分钟' });
    await userEvent.type(minutes, '9');
    expect(screen.getByRole('button', { name: '确认调整' })).toBeDisabled();
    await userEvent.clear(minutes); await userEvent.type(minutes, '10');
    expect(screen.getByText(/预计调整后：00:00:00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认调整' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '确认调整' }));
    expect(mocks.adjust).toHaveBeenCalledWith(expect.objectContaining({ operation: 'add', durationSeconds: 600 }));
  });

  it.each(['success', 'failure'])('clears old errors and audit rows when changing members: %s', async outcome => {
    mocks.members.mockResolvedValue([
      { id: 'member-1', username: 'alice', displayName: '成员 A', status: 'active' },
      { id: 'member-2', username: 'bob', displayName: '成员 B', status: 'active' }
    ]);
    mocks.audit.mockResolvedValue([{ adjustmentId: 'old', displayName: '成员 A', operation: 'add', durationSeconds: 60, reason: '旧周审计', createdAt: '2026-10-12T10:00:00Z' }]);
    render(<AdminDurationPage />);
    await screen.findByRole('option', { name: /成员 A/ });
    const select = screen.getByRole('combobox', { name: '选择成员' });
    await userEvent.selectOptions(select, 'member-1');
    await screen.findByText('旧周审计');
    mocks.adjust.mockRejectedValueOnce(new Error('旧成员提交失败'));
    await userEvent.type(screen.getByRole('spinbutton', { name: '分钟' }), '1');
    await userEvent.type(screen.getByRole('textbox', { name: '调整原因' }), '补录');
    await userEvent.click(screen.getByRole('button', { name: '确认调整' }));
    await screen.findByRole('alert');
    let resolve!: (value: object) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    mocks.context.mockReturnValueOnce(pending);
    mocks.audit.mockResolvedValueOnce([]);
    await userEvent.selectOptions(select, 'member-2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('旧周审计')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认调整' })).toBeDisabled();
    await act(async () => {
      if (outcome === 'success') resolve({ userId: 'member-2', weekKey: '2026-10-19', isoWeek: '2026-W43', recordedDurationSeconds: 0, manualAdjustmentSeconds: 0, totalDurationSeconds: 0 });
      else reject(new Error('新成员加载失败'));
      await pending.catch(() => {});
    });
    if (outcome === 'success') expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    else { expect(screen.getByRole('alert')).toHaveTextContent('加载调整信息失败'); expect(screen.getByRole('button', { name: '确认调整' })).toBeDisabled(); }
    expect(screen.queryByText('旧周审计')).not.toBeInTheDocument();
  });

  it('clears the team audit when the member selection becomes empty', async () => {
    mocks.audit.mockResolvedValue([{ adjustmentId: 'old', displayName: '成员 A', operation: 'add', durationSeconds: 60, reason: '旧周审计', createdAt: '2026-10-12T10:00:00Z' }]);
    render(<AdminDurationPage />);
    await screen.findByRole('option', { name: /测试成员/ });
    const select = screen.getByRole('combobox', { name: '选择成员' });
    await userEvent.selectOptions(select, 'member-1');
    await screen.findByText('旧周审计');
    await userEvent.selectOptions(select, '');
    expect(screen.queryByText('旧周审计')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认调整' })).toBeDisabled();
  });
});

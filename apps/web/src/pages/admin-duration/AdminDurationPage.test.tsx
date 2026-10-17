import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminDurationPage } from './AdminDurationPage';

const mocks = vi.hoisted(() => ({ members: vi.fn(), context: vi.fn(), audit: vi.fn(), adjust: vi.fn() }));
vi.mock('@/features/users/users.api', () => ({ getAdminMembers: mocks.members }));
vi.mock('@/features/attendance/duration-adjustments.api', () => ({
  getAdjustmentContext: mocks.context, getAdjustmentAudit: mocks.audit, adjustDuration: mocks.adjust
}));

describe('AdminDurationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

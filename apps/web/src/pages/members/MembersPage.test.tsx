import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MembersPage } from './MembersPage';
import { useAuthStore } from '@/app/store/auth-store';
import { createUserFixture } from '@/test/user-fixture';

const mocks = vi.hoisted(() => ({
  getTeamCurrentWeekStats: vi.fn(), getAssessmentMemberSummaries: vi.fn(), getAssessmentHistory: vi.fn()
}));

vi.mock('@/features/assessment/assessment.api', () => ({
  getAssessmentMemberSummaries: mocks.getAssessmentMemberSummaries, getAssessmentHistory: mocks.getAssessmentHistory
}));

vi.mock('@/features/stats/stats.api', () => ({
  getTeamCurrentWeekStats: mocks.getTeamCurrentWeekStats,
  getMyWeeklyStats: vi.fn(),
  getMemberWeeklyStats: vi.fn()
}));

describe('MembersPage', () => {
  const members = [
    { memberKey: 'alpha', displayName: '甲', role: 'member', enrollYear: 2025, totalDurationSeconds: 3600, weeklyGoalSeconds: 7200, sessionsCount: 1, weekKey: '2026-10-26' },
    { memberKey: 'beta', displayName: '乙', role: 'member', enrollYear: 2025, totalDurationSeconds: 7200, weeklyGoalSeconds: 7200, sessionsCount: 2, weekKey: '2026-10-26' }
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ auth: { token: 'test', user: createUserFixture() } });
    mocks.getAssessmentMemberSummaries.mockResolvedValue({ enabled: true, requiredEnrollYears: [2026, 2025], startWeek: '2026-10-26', week: '2026-10-26', items: [] });
    HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open', ''); });
    HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) { this.removeAttribute('open'); });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows gray/green progress, true zero and cumulative failures with Sunday details', async () => {
    mocks.getTeamCurrentWeekStats.mockResolvedValue(members);
    mocks.getAssessmentMemberSummaries.mockResolvedValue({ enabled: true, requiredEnrollYears: [2026, 2025], startWeek: '2026-10-26', week: '2026-11-02', items: [{ memberKey: 'alpha', failedWeeksCount: 2 }, { memberKey: 'beta', failedWeeksCount: 0 }] });
    mocks.getAssessmentHistory.mockResolvedValue({ member: { memberKey: 'alpha', displayName: '甲' }, failedWeeksCount: 2, nextCursor: null, items: [
      { weekKey: '2026-10-26', weekEnd: '2026-11-01T16:00:00.000Z', assessmentDate: '2026-11-01', goalSeconds: 7200, recordedDurationSeconds: 3600, manualAdjustmentSeconds: 0, entertainmentSeconds: 0, totalDurationSeconds: 3600, shortfallSeconds: 3600, settledAt: '2026-11-01T21:00:00.000Z' }
    ] });
    render(<MemoryRouter><MembersPage /></MemoryRouter>);
    expect(await screen.findByText('本周未完成')).toHaveClass('bg-gray-100');
    expect(screen.getByText('本周已完成')).toHaveClass('bg-green-50');
    expect(await screen.findByRole('button', { name: '打卡考核未通过 0 次' })).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: '打卡考核未通过 2 次' });
    await userEvent.click(trigger);
    expect(await screen.findByText('考核周日：2026-11-01')).toBeInTheDocument();
    expect(mocks.getAssessmentHistory).toHaveBeenCalledWith('alpha', undefined, expect.any(AbortSignal));
    await userEvent.click(screen.getByRole('button', { name: '关闭未完成周详情' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  });

  it('does not disguise a failed history request as zero and retries locally', async () => {
    mocks.getTeamCurrentWeekStats.mockResolvedValue(members);
    mocks.getAssessmentMemberSummaries.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ enabled: true, requiredEnrollYears: [2026, 2025], startWeek: '2026-10-26', week: '2026-10-26', items: [{ memberKey: 'alpha', failedWeeksCount: 3 }] });
    render(<MemoryRouter><MembersPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('历史考核读取失败');
    expect(screen.queryByText('打卡考核未通过 0 次')).not.toBeInTheDocument();
    expect(await screen.findByText('甲')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试历史考核' }));
    expect(await screen.findByRole('button', { name: '打卡考核未通过 3 次' })).toBeInTheDocument();
    expect(screen.getByText('历史状态待核实')).toBeInTheDocument();
    expect(mocks.getTeamCurrentWeekStats).toHaveBeenCalledTimes(1);
  });

  it('does not show failure counts when historical settlement is disabled', async () => {
    mocks.getTeamCurrentWeekStats.mockResolvedValue(members);
    mocks.getAssessmentMemberSummaries.mockResolvedValue({ enabled: false, requiredEnrollYears: [2026, 2025], startWeek: null, week: '2026-10-26', items: [] });
    render(<MemoryRouter><MembersPage /></MemoryRouter>);
    expect(await screen.findAllByText('尚未启用')).toHaveLength(2);
    expect(screen.queryByText('打卡考核未通过 0 次')).not.toBeInTheDocument();
  });

  it('clears the previous account table and dialog while the next account is loading', async () => {
    let resolve!: (value: unknown) => void;
    mocks.getTeamCurrentWeekStats.mockResolvedValueOnce(members).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    mocks.getAssessmentMemberSummaries.mockResolvedValueOnce({ enabled: true, requiredEnrollYears: [2026, 2025], startWeek: '2026-10-26', week: '2026-10-26', items: [{ memberKey: 'alpha', failedWeeksCount: 2 }] }).mockReturnValueOnce(new Promise(() => undefined));
    mocks.getAssessmentHistory.mockReturnValue(new Promise(() => undefined));
    render(<MemoryRouter><MembersPage /></MemoryRouter>);
    await userEvent.click(await screen.findByRole('button', { name: '打卡考核未通过 2 次' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => useAuthStore.setState({ auth: { token: 'other', user: createUserFixture({ id: 'other' }) } }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('甲')).not.toBeInTheDocument();
    await act(async () => { resolve([]); });
    expect(await screen.findByText('当前范围和筛选下暂无成员数据')).toBeInTheDocument();
  });

  it('only displays assessment for server-selected freshman and sophomore cohorts', async () => {
    mocks.getTeamCurrentWeekStats.mockResolvedValue([...members, { ...members[0], memberKey: 'senior', displayName: '高年级', enrollYear: 2024 }]);
    mocks.getAssessmentMemberSummaries.mockResolvedValue({ enabled: true, requiredEnrollYears: [2026, 2025], startWeek: '2026-10-26', week: '2026-10-26', items: [
      { memberKey: 'alpha', failedWeeksCount: 0 }, { memberKey: 'beta', failedWeeksCount: 0 }, { memberKey: 'senior', failedWeeksCount: 3 }
    ] });
    render(<MemoryRouter><MembersPage /></MemoryRouter>);
    const row = (await screen.findByText('高年级')).closest('tr')!;
    expect(within(row).getAllByLabelText('非应考年级')).toHaveLength(2);
    expect(within(row).queryByText('本周未完成')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打卡考核未通过 3 次' })).not.toBeInTheDocument();
    expect(await screen.findAllByRole('button', { name: '打卡考核未通过 0 次' })).toHaveLength(2);
  });

  it('follows a later server academic year instead of hardcoding 2025/2026', async () => {
    mocks.getTeamCurrentWeekStats.mockResolvedValue([{ ...members[0], enrollYear: 2025 }, { ...members[1], enrollYear: 2026 }]);
    mocks.getAssessmentMemberSummaries.mockResolvedValue({ enabled: true, requiredEnrollYears: [2027, 2026], startWeek: '2026-10-26', week: '2027-09-06', items: [{ memberKey: 'alpha', failedWeeksCount: 1 }, { memberKey: 'beta', failedWeeksCount: 0 }] });
    render(<MemoryRouter><MembersPage /></MemoryRouter>);
    expect(await screen.findByText(/当前应考年级：2027 级、2026 级/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打卡考核未通过 1 次' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打卡考核未通过 0 次' })).toBeInTheDocument();
  });

  it('shows loading state before member stats resolve', () => {
    mocks.getTeamCurrentWeekStats.mockReturnValue(new Promise(() => undefined));

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/正在加载/i)).toBeInTheDocument();
  });

  it('shows error state when member stats request fails', async () => {
    mocks.getTeamCurrentWeekStats.mockRejectedValue(new Error('boom'));

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/加载成员统计失败/i)).toBeInTheDocument();
  });

  it('renders team members without showing raw ids and keeps the records action', async () => {
    mocks.getTeamCurrentWeekStats.mockResolvedValue([
      {
        memberKey: 'member-key-1',
        displayName: 'Alice',
        realName: 'Alice Zhang',
        username: 'alice.handle',
        avatarUrl: 'https://sso.example.com/avatar.png',
        role: 'member',
        enrollYear: 2024,
        totalDurationSeconds: 7200,
        sessionsCount: 2,
        weekKey: '2026-03-31'
      }
    ]);

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Alice Zhang（alice.handle）')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Alice' })).toHaveAttribute('src', 'https://sso.example.com/avatar.png');
    expect(screen.getByText(/02:00:00/i)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /2024 级/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '筛选' })).toBeInTheDocument();
    expect(screen.getByLabelText('scope-team')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/ID:/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /查看流水/i })).toBeInTheDocument();
  });

  it('supports switching between same-grade and full-team scopes', async () => {
    const user = userEvent.setup();

    mocks.getTeamCurrentWeekStats
      .mockResolvedValueOnce([
        {
          memberKey: 'member-key-1',
          displayName: 'Alice',
          role: 'member',
          enrollYear: 2024,
          totalDurationSeconds: 7200,
          sessionsCount: 2,
          weekKey: '2026-03-31'
        }
      ])
      .mockResolvedValueOnce([
        {
          memberKey: 'member-key-2',
          displayName: 'Bob',
          role: 'member',
          enrollYear: 2025,
          totalDurationSeconds: 3600,
          sessionsCount: 1,
          weekKey: '2026-03-31'
        }
      ]);

    render(
      <MemoryRouter initialEntries={[{ pathname: '/members', state: { scope: 'same-grade' } }]}>
        <MembersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/^Alice$/i)).toBeInTheDocument();
    expect(mocks.getTeamCurrentWeekStats).toHaveBeenNthCalledWith(1, true);

    await user.click(screen.getByLabelText('scope-team'));

    await waitFor(() => {
      expect(mocks.getTeamCurrentWeekStats).toHaveBeenNthCalledWith(2, false);
    });
    expect(await screen.findByText(/^Bob$/i)).toBeInTheDocument();
  });

  it('restores filters and sort state from the URL', async () => {
    mocks.getTeamCurrentWeekStats.mockResolvedValue([
      {
        memberKey: 'member-key-1',
        displayName: 'Alice',
        role: 'member',
        enrollYear: 2024,
        totalDurationSeconds: 7200,
        sessionsCount: 2,
        weekKey: '2026-03-31'
      },
      {
        memberKey: 'member-key-2',
        displayName: 'Bob',
        role: 'member',
        enrollYear: 2025,
        totalDurationSeconds: 3600,
        sessionsCount: 1,
        weekKey: '2026-03-31'
      },
      {
        memberKey: 'member-key-3',
        displayName: 'Bobby',
        role: 'member',
        enrollYear: 2025,
        totalDurationSeconds: 5400,
        sessionsCount: 3,
        weekKey: '2026-03-31'
      }
    ]);

    render(
      <MemoryRouter initialEntries={['/members?scope=same-grade&search=Bo&enrollYear=2025&minHours=1&maxHours=2&sort=count-asc']}>
        <MembersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/^Bob$/)).toBeInTheDocument();
    expect(mocks.getTeamCurrentWeekStats).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText('scope-same-grade')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('member-search')).toHaveValue('Bo');
    expect(screen.getByLabelText('grade-filter')).toHaveValue('2025');
    expect(screen.getByLabelText('minimum-hours-filter')).toHaveValue(1);
    expect(screen.getByLabelText('maximum-hours-filter')).toHaveValue(2);

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    expect(within(firstDataRow).getByText(/^Bob$/i)).toBeInTheDocument();
  });

  it('keeps filters in the card and sorts from the table header controls', async () => {
    const user = userEvent.setup();

    mocks.getTeamCurrentWeekStats.mockResolvedValue([
      {
        memberKey: 'member-key-1',
        displayName: 'Alice',
        role: 'member',
        enrollYear: 2024,
        totalDurationSeconds: 7200,
        sessionsCount: 2,
        weekKey: '2026-03-31'
      },
      {
        memberKey: 'member-key-2',
        displayName: 'Bob',
        role: 'member',
        enrollYear: 2025,
        totalDurationSeconds: 3600,
        sessionsCount: 4,
        weekKey: '2026-03-31'
      }
    ]);

    render(
      <MemoryRouter>
        <MembersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/^Alice$/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('grade-filter'), 'all');
    await user.click(screen.getByLabelText('sort-count'));

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    expect(within(firstDataRow).getByText(/^Bob$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('members-sort')).not.toBeInTheDocument();
  });
});

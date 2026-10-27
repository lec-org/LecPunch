import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WeeklyHistoryPage } from './WeeklyHistoryPage';
import { formatComprehensiveHours } from '@/shared/lib/time';

const mocks = vi.hoisted(() => ({
  getMyWeeklyStats: vi.fn()
}));

vi.mock('@/features/stats/stats.api', () => ({
  getTeamCurrentWeekStats: vi.fn(),
  getMyWeeklyStats: mocks.getMyWeeklyStats,
  getMemberWeeklyStats: vi.fn()
}));

describe('WeeklyHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('retains signed comprehensive values in the table, average and shared chart formatter', async () => {
    mocks.getMyWeeklyStats.mockResolvedValue({ items: [{ weekKey: '2026-10-26', totalDurationSeconds: -900, sessionsCount: 0, weeklyGoalSeconds: 3600 }], weeklyGoalSeconds: 3600 });
    render(<MemoryRouter><WeeklyHistoryPage /></MemoryRouter>);
    expect(await screen.findByText('−00:15:00')).toBeInTheDocument();
    expect(screen.getByText('-0.3h')).toBeInTheDocument();
    expect(formatComprehensiveHours(-900, 2)).toBe('-0.25h');
    expect(screen.getByRole('columnheader', { name: '综合时长' })).toBeInTheDocument();
  });

  it('shows loading state before weekly stats resolve', () => {
    mocks.getMyWeeklyStats.mockReturnValue(new Promise(() => undefined));

    render(
      <MemoryRouter>
        <WeeklyHistoryPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/正在加载/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows error state when weekly stats request fails', async () => {
    mocks.getMyWeeklyStats.mockRejectedValue(new Error('boom'));

    render(
      <MemoryRouter>
        <WeeklyHistoryPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/加载周历史统计失败/i)).toBeInTheDocument();
    expect(screen.queryByText(/统计口径/i)).not.toBeInTheDocument();
  });

  it('renders weekly history rows without the stats guidance card', async () => {
    mocks.getMyWeeklyStats.mockResolvedValue({
      items: [
        {
          weekKey: '2026-03-31',
          totalDurationSeconds: 7200,
          sessionsCount: 2,
          weeklyGoalSeconds: 38 * 3600
        }
      ],
      weeklyGoalSeconds: 38 * 3600
    });

    render(
      <MemoryRouter>
        <WeeklyHistoryPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('2026-03-31')).toBeInTheDocument();
    expect(screen.queryByText(/统计口径/i)).not.toBeInTheDocument();
    expect(screen.getByText('周时长趋势')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-duration-trend-chart')).toBeInTheDocument();
    expect(screen.getByText(/03-31 ~ 04-06/i)).toBeInTheDocument();
    expect(screen.getByText('02:00:00')).toBeInTheDocument();
    expect(screen.getByText(/5% \/ 目标 38:00:00/i)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

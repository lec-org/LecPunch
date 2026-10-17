import { createUserFixture } from '@/test/user-fixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { useAuthStore } from '@/app/store/auth-store';
import { useUIStore } from '@/app/store/ui-store';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), getCurrentAttendance: vi.fn(), getTeamActiveAttendances: vi.fn(), checkInAttendance: vi.fn(), checkOutAttendance: vi.fn(),
  getMyWeeklyStats: vi.fn(), getTeamCurrentWeekStats: vi.fn(), getMyRecords: vi.fn(), getMyNotifications: vi.fn(),
  acknowledgeNotification: vi.fn(), connectNotificationStream: vi.fn(), showToast: vi.fn()
}));

vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')), useNavigate: () => mocks.navigate }));
vi.mock('@/features/attendance/attendance.api', () => ({ getCurrentAttendance: mocks.getCurrentAttendance, getTeamActiveAttendances: mocks.getTeamActiveAttendances, checkInAttendance: mocks.checkInAttendance, checkOutAttendance: mocks.checkOutAttendance }));
vi.mock('@/features/stats/stats.api', () => ({ getMyWeeklyStats: mocks.getMyWeeklyStats, getTeamCurrentWeekStats: mocks.getTeamCurrentWeekStats }));
vi.mock('@/features/records/records.api', () => ({ getMyRecords: mocks.getMyRecords }));
vi.mock('@/features/notifications/notifications.api', () => ({ getMyNotifications: mocks.getMyNotifications, acknowledgeNotification: mocks.acknowledgeNotification, connectNotificationStream: mocks.connectNotificationStream }));
vi.mock('@/shared/ui/toast', () => ({ showToast: mocks.showToast }));

describe('DashboardPage', () => {
  const renderPage = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ selectedWeek: 'current' });
    useAuthStore.setState({ auth: { token: 'token-1', user: createUserFixture({ id: 'user-1', teamId: 'team-1', username: 'alice', displayName: 'Alice', role: 'member', status: 'active', enrollYear: 2024, createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z' }) } });
    mocks.getMyRecords.mockResolvedValue([]);
    mocks.getTeamActiveAttendances.mockResolvedValue([]);
    mocks.getMyNotifications.mockResolvedValue([]);
    mocks.connectNotificationStream.mockResolvedValue(undefined);
    mocks.getMyWeeklyStats.mockResolvedValue({ items: [], weeklyGoalSeconds: 0 });
    mocks.getTeamCurrentWeekStats.mockResolvedValue([]);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('shows the check-in action when there is no active session', async () => {
    mocks.getCurrentAttendance.mockResolvedValue({ hasActiveSession: false, session: null });
    renderPage();
    expect(await screen.findByRole('button', { name: /上卡/i })).toBeInTheDocument();
    expect(screen.getByText(/当前未打卡/i)).toBeInTheDocument();
  });

  it('uses server elapsed time and warns at four hours forty-five minutes', async () => {
    mocks.getCurrentAttendance.mockResolvedValue({ hasActiveSession: true, session: { id: 'session-1', checkInAt: '2026-04-02T00:00:00.000Z', elapsedSeconds: 17100 } });
    renderPage();
    expect(await screen.findByRole('button', { name: /下卡/i })).toBeInTheDocument();
    expect(screen.getByText('04:45:00')).toBeInTheDocument();
    expect(screen.getByText(/还剩 15 分钟将达到 5 小时上限/i)).toBeInTheDocument();
  });

  it('preserves week selection after notifications move to the global layout', async () => {
    mocks.getCurrentAttendance.mockResolvedValue({ hasActiveSession: false, session: null });
    renderPage();
    await screen.findByRole('button', { name: /上卡/i });
    expect(screen.getByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '选择' })).toHaveTextContent('本周');
    act(() => useUIStore.getState().setSelectedWeek('prev1'));
    expect(useUIStore.getState().selectedWeek).toBe('prev1');
    expect(screen.getByRole('combobox', { name: '选择' })).toHaveTextContent('上周');
    expect(screen.queryByRole('button', { name: /上卡|下卡/i })).not.toBeInTheDocument();
  });

  it('does not send heartbeat requests while an active session is running', async () => {
    mocks.getCurrentAttendance.mockResolvedValue({ hasActiveSession: true, session: { id: 'session-1', checkInAt: '2026-04-02T00:00:00.000Z', elapsedSeconds: 30 } });
    renderPage();
    await screen.findByRole('button', { name: /下卡/i });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.getCurrentAttendance).toHaveBeenCalledTimes(1);
  });

  it('submits a check-in and refreshes state', async () => {
    mocks.getCurrentAttendance.mockResolvedValueOnce({ hasActiveSession: false, session: null }).mockResolvedValueOnce({ hasActiveSession: true, session: { id: 'session-2', checkInAt: '2026-04-02T01:00:00.000Z', elapsedSeconds: 0 } });
    mocks.checkInAttendance.mockResolvedValue({ id: 'session-2' });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /上卡/i }));
    await waitFor(() => expect(mocks.checkInAttendance).toHaveBeenCalledTimes(1));
    expect(mocks.getCurrentAttendance).toHaveBeenCalledTimes(2);
  });

  it('renders the read-only active-member monitor', async () => {
    mocks.getCurrentAttendance.mockResolvedValue({ hasActiveSession: false, session: null });
    mocks.getTeamActiveAttendances.mockResolvedValue([{ memberKey: 'member-key-2', displayName: 'Bob', enrollYear: 2023, checkInAt: new Date(Date.now() - 120_000).toISOString(), elapsedSeconds: 120, weekKey: '2026-03-31' }]);
    renderPage();
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('当前打卡中成员')).toBeInTheDocument();
  });
});

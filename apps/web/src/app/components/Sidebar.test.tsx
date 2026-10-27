import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createUserFixture } from '@/test/user-fixture';
import { useAuthStore } from '../store/auth-store';
import { Sidebar } from './Sidebar';
const mocks = vi.hoisted(() => ({ signOut: vi.fn(), checkOut: vi.fn() }));
vi.mock('@/shared/auth/logto', () => ({ signOut: mocks.signOut }));
vi.mock('@/features/attendance/attendance.api', () => ({ checkOutAttendance: mocks.checkOut }));
afterEach(cleanup);
describe('Sidebar logout boundary', () => {
  it('uses consistent icons and active styling for the three administrator features', () => {
    useAuthStore.setState({ auth: { token: 'token', user: createUserFixture({ role: 'admin' }) } });
    render(<MemoryRouter initialEntries={['/admin/messages']}><Sidebar /></MemoryRouter>);
    for (const name of ['增减时长', '成员消息收件箱', '发布通知与已读状态']) {
      const link = screen.getByRole('link', { name });
      expect(link.querySelector('svg')).not.toBeNull();
      expect(link.className).toContain('flex items-center');
    }
    expect(screen.getByRole('link', { name: '成员消息收件箱' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '成员消息收件箱' }).className).toContain('bg-blue-50');
    expect(screen.getByRole('link', { name: '积分与卡牌' })).toHaveAttribute('href', '/cards');
  });

  it('clears login and signs out SSO without completing or invalidating attendance', async () => {
    mocks.signOut.mockResolvedValue(undefined);
    useAuthStore.setState({ auth: { token: 'token', user: createUserFixture() } });
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /退出/ }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    expect(useAuthStore.getState().auth).toEqual({ token: null, user: null });
    expect(mocks.checkOut).not.toHaveBeenCalled();
  });
});

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

import { createUserFixture } from '@/test/user-fixture';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '@/app/store/auth-store';
import { AdminMembersPage } from './AdminMembersPage';

const mocks = vi.hoisted(() => ({
  getAdminMembers: vi.fn(),
  updateAdminMember: vi.fn(),
  deleteAdminMember: vi.fn()
}));

vi.mock('@/features/users/users.api', () => ({
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  getAdminMembers: mocks.getAdminMembers,
  updateAdminMember: mocks.updateAdminMember,
  deleteAdminMember: mocks.deleteAdminMember
}));

describe('AdminMembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      auth: {
        token: 'token',
        user: createUserFixture({
          id: 'admin-1',
          teamId: 'team-1',
          username: 'admin',
          displayName: 'Admin',
          role: 'admin',
          status: 'active',
          enrollYear: 2024,
          createdAt: '2026-04-11T00:00:00.000Z',
          updatedAt: '2026-04-11T00:00:00.000Z'
        })
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders admin members from the API', async () => {
    mocks.getAdminMembers.mockResolvedValue([
      {
        id: 'admin-1',
        teamId: 'team-1',
        username: 'admin',
        displayName: 'Admin',
        role: 'admin',
        status: 'active',
        enrollYear: 2024,
        createdAt: '2026-04-11T00:00:00.000Z',
        updatedAt: '2026-04-11T00:00:00.000Z'
      },
      {
        id: 'member-1',
        teamId: 'team-1',
        username: 'alice',
        displayName: 'Alice',
        role: 'member',
        status: 'active',
        enrollYear: 2025,
        createdAt: '2026-04-11T00:00:00.000Z',
        updatedAt: '2026-04-11T00:00:00.000Z'
      }
    ]);

    render(
      <MemoryRouter>
        <AdminMembersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('本人')).toBeInTheDocument();
    expect(screen.getByText('由 SSO 管理')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设为管理员' })).not.toBeInTheDocument();
  });

  it('prevents self role and status changes', async () => {
    mocks.getAdminMembers.mockResolvedValue([
      {
        id: 'admin-1',
        teamId: 'team-1',
        username: 'admin',
        displayName: 'Admin',
        role: 'admin',
        status: 'active',
        enrollYear: 2024,
        createdAt: '2026-04-11T00:00:00.000Z',
        updatedAt: '2026-04-11T00:00:00.000Z'
      }
    ]);

    render(
      <MemoryRouter>
        <AdminMembersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '降为成员' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '销毁账号' })).toBeDisabled();
  });

  it('changes only the local enabled state, not SSO roles', async () => {
    mocks.getAdminMembers.mockResolvedValue([
      {
        id: 'member-1',
        teamId: 'team-1',
        username: 'alice',
        displayName: 'Alice',
        role: 'member',
        status: 'active',
        enrollYear: 2025,
        createdAt: '2026-04-11T00:00:00.000Z',
        updatedAt: '2026-04-11T00:00:00.000Z'
      }
    ]);
    mocks.updateAdminMember.mockResolvedValue({
      id: 'member-1',
      teamId: 'team-1',
      username: 'alice',
      displayName: 'Alice',
      role: 'member',
      status: 'disabled',
      enrollYear: 2025,
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z'
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminMembersPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: '停用' }));

    await waitFor(() => {
      expect(mocks.updateAdminMember).toHaveBeenCalledWith('member-1', { status: 'disabled' });
    });
    expect(screen.getByText('已停用')).toBeInTheDocument();
  });

  it('requires a typed confirmation before destroying an account', async () => {
    mocks.getAdminMembers.mockResolvedValue([
      {
        id: 'member-1',
        teamId: 'team-1',
        username: 'alice',
        displayName: 'Alice',
        role: 'member',
        status: 'active',
        enrollYear: 2025,
        createdAt: '2026-04-11T00:00:00.000Z',
        updatedAt: '2026-04-11T00:00:00.000Z'
      }
    ]);
    mocks.deleteAdminMember.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AdminMembersPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: '销毁账号' }));

    expect(screen.getByRole('button', { name: '确认销毁' })).toBeDisabled();

    await user.type(screen.getByLabelText('确认语句'), '我确认已知会销毁账号，并清空数据');
    await user.click(screen.getByRole('button', { name: '确认销毁' }));

    await waitFor(() => {
      expect(mocks.deleteAdminMember).toHaveBeenCalledWith('member-1');
    });
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });
});

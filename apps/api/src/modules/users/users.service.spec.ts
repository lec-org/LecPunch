import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import * as bcrypt from 'bcrypt';
import type { AuthUser } from '../auth/types/auth-user.type';

const adminUser: AuthUser = {
  userId: 'admin-1',
  teamId: 'team-1',
  role: 'admin',
  username: 'admin',
  displayName: 'Admin',
  enrollYear: 2024
};

describe('UsersService', () => {
  const findByIdAndUpdate = vi.fn();
  const findByIdAndDelete = vi.fn();
  const findById = vi.fn();
  const find = vi.fn();
  const attendanceDeleteManyExec = vi.fn();
  const attendanceDeleteMany = vi.fn();

  const userModel = {
    create: vi.fn(),
    findOne: vi.fn(),
    findById,
    find,
    findByIdAndUpdate,
    findByIdAndDelete,
  } as any;
  const attendanceModel = {
    deleteMany: attendanceDeleteMany
  } as any;
  const pointsService = {
    deleteUserPoints: vi.fn().mockResolvedValue(undefined)
  } as any;
  const configService = {
    get: vi.fn().mockReturnValue('test-secret')
  } as any;

  let service: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    attendanceDeleteMany.mockReturnValue({ exec: attendanceDeleteManyExec });
    service = new UsersService(userModel, attendanceModel, configService, pointsService);
  });

  describe('updateProfile - avatar mutual exclusion', () => {
    beforeEach(() => {
      findByIdAndUpdate.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'user1' }),
      });
    });

    it('setting avatarBase64 should unset avatarColor and avatarEmoji', async () => {
      await service.updateProfile('user1', { avatarBase64: 'data:image/jpeg;base64,...' });
      expect(findByIdAndUpdate).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({ $unset: { avatarColor: 1, avatarEmoji: 1 } }),
        { new: true },
      );
    });

    it('setting avatarEmoji should unset avatarBase64 and avatarColor', async () => {
      await service.updateProfile('user1', { avatarEmoji: '🦊' });
      expect(findByIdAndUpdate).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({ $unset: { avatarBase64: 1, avatarColor: 1 } }),
        { new: true },
      );
    });

    it('setting avatarColor should unset avatarBase64 and avatarEmoji', async () => {
      await service.updateProfile('user1', { avatarColor: '#6366f1' });
      expect(findByIdAndUpdate).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({ $unset: { avatarBase64: 1, avatarEmoji: 1 } }),
        { new: true },
      );
    });

    it('setting only displayName should not include $unset', async () => {
      await service.updateProfile('user1', { displayName: 'New Name' });
      const updateArg = findByIdAndUpdate.mock.calls[0][1];
      expect(updateArg.$unset).toBeUndefined();
    });
  });

  describe('updatePassword', () => {
    it('should throw BadRequestException with code WRONG_PASSWORD when old password is incorrect', async () => {
      const hash = await bcrypt.hash('correctpassword', 10);
      findById.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'user1', passwordHash: hash }),
      });

      await expect(
        service.updatePassword('user1', 'wrongpassword', 'newpassword123'),
      ).rejects.toThrow(BadRequestException);

      try {
        await service.updatePassword('user1', 'wrongpassword', 'newpassword123');
      } catch (e: any) {
        expect(e.response?.code).toBe('WRONG_PASSWORD');
      }
    });

    it('should update password hash when old password is correct', async () => {
      const hash = await bcrypt.hash('correctpassword', 10);
      findById.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'user1', passwordHash: hash }),
      });
      findByIdAndUpdate.mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });

      await expect(
        service.updatePassword('user1', 'correctpassword', 'newpassword123'),
      ).resolves.not.toThrow();

      expect(findByIdAndUpdate).toHaveBeenCalledWith(
        'user1',
        expect.objectContaining({
          $set: expect.objectContaining({ passwordHash: expect.any(String) }),
        }),
      );
    });
  });

  describe('admin member management', () => {
    it('lists team members sorted from the team query', async () => {
      const rows = [{ id: 'member-1' }];
      const exec = vi.fn().mockResolvedValue(rows);
      const sort = vi.fn().mockReturnValue({ exec });
      find.mockReturnValue({ sort });

      const result = await service.listTeamMembers('team-1');

      expect(find).toHaveBeenCalledWith({ teamId: 'team-1' });
      expect(sort).toHaveBeenCalledWith({ role: 1, status: 1, displayName: 1, username: 1 });
      expect(result).toBe(rows);
    });

    it('rejects cross-team admin updates', async () => {
      findById.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'member-1', teamId: 'team-2', role: 'member', status: 'active' })
      });

      await expect(
        service.adminUpdateMember(adminUser, 'member-1', { status: 'disabled' })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects admins changing their own role or status', async () => {
      findById.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'admin-1', teamId: 'team-1', role: 'admin', status: 'active' })
      });

      await expect(
        service.adminUpdateMember(adminUser, 'admin-1', { role: 'member' })
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates same-team member role or status', async () => {
      findById.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'member-1', teamId: 'team-1', role: 'member', status: 'active' })
      });
      findByIdAndUpdate.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'member-1', role: 'admin', status: 'active' })
      });

      const result = await service.adminUpdateMember(adminUser, 'member-1', { role: 'admin' });

      expect(findByIdAndUpdate).toHaveBeenCalledWith(
        'member-1',
        { $set: { role: 'admin' } },
        { new: true }
      );
      expect(result).toEqual({ id: 'member-1', role: 'admin', status: 'active' });
    });

    it('rejects admins deleting themselves', async () => {
      findById.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'admin-1', teamId: 'team-1', role: 'admin', status: 'active' })
      });

      await expect(service.adminDeleteMember(adminUser, 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes same-team members and their attendance records', async () => {
      findById.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'member-1', teamId: 'team-1', role: 'member', status: 'active' })
      });
      attendanceDeleteManyExec.mockResolvedValue({ acknowledged: true, deletedCount: 3 });
      findByIdAndDelete.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'member-1' })
      });

      await expect(service.adminDeleteMember(adminUser, 'member-1')).resolves.toBeUndefined();

      expect(attendanceDeleteMany).toHaveBeenCalledWith({ userId: 'member-1' });
      expect(pointsService.deleteUserPoints).toHaveBeenCalledWith('team-1', 'member-1');
      expect(findByIdAndDelete).toHaveBeenCalledWith('member-1');
    });
  });

  describe('member key helpers', () => {
    it('generates and resolves a signed member key', async () => {
      const key = service.getMemberKey('member-1');
      findById.mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: 'member-1', displayName: 'Alice' })
      });

      const result = await service.findByMemberKey(key);

      expect(result).toMatchObject({ id: 'member-1', displayName: 'Alice' });
    });

    it('rejects tampered member keys', async () => {
      const key = service.getMemberKey('member-1');
      const tampered = `${key}x`;

      const result = await service.findByMemberKey(tampered);

      expect(result).toBeNull();
      expect(findById).not.toHaveBeenCalled();
    });
  });
});

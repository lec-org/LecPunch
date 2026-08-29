import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ATTENDANCE_KEEPALIVE_TIMEOUT_SECONDS, ATTENDANCE_MAX_SECONDS, ERROR_CODES } from '@lecpunch/shared';
import type { AuthUser } from '../auth/types/auth-user.type';

const user: AuthUser = {
  userId: 'user-1',
  teamId: 'team-1',
  role: 'member',
  username: 'alice',
  displayName: 'Alice',
  enrollYear: 2024
};

describe('AttendanceService', () => {
  const create = vi.fn();
  const findOne = vi.fn();
  const find = vi.fn();
  const findOneAndUpdate = vi.fn();
  const networkPolicyService = {
    assertIpAllowed: vi.fn()
  };
  const usersService = {
    findByIds: vi.fn(),
    getMemberKey: vi.fn((id: string) => `member-key-${id}`)
  };
  const pointsService = {
    syncAttendancePoints: vi.fn().mockResolvedValue(0)
  };

  const attendanceModel = {
    create,
    findOne,
    find,
    findOneAndUpdate
  } as any;

  let service: AttendanceService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    networkPolicyService.assertIpAllowed.mockResolvedValue(undefined);
    service = new AttendanceService(attendanceModel, networkPolicyService as any, usersService as any);
  });

  it('rejects duplicate check-in when an active session already exists', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({ id: 'existing-session' })
    });

    await expect(service.checkIn(user, '127.0.0.1')).rejects.toMatchObject({
      response: {
        code: ERROR_CODES.ATTENDANCE_ALREADY_CHECKED_IN
      }
    });
  });

  it('stores week keys and balanced accounting fields on check-in', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T16:30:00.000Z'));
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null)
    });
    create.mockImplementation(async (payload) => payload);

    const result = await service.checkIn(user, '127.0.0.1');

    expect(networkPolicyService.assertIpAllowed).toHaveBeenCalledWith('team-1', '127.0.0.1');
    expect(result.weekKey).toBe('2026-04-06');
    expect(result.weeklyGoalSecondsSnapshot).toBe(38 * 3600);
    expect(result.creditedSeconds).toBe(0);
    expect(result.segmentsCount).toBe(0);
    expect(result.lastKeepaliveAt).toEqual(new Date('2026-04-05T16:30:00.000Z'));
    expect(result.lastCreditedAt).toEqual(new Date('2026-04-05T16:30:00.000Z'));
  });

  it('returns current session payload with balanced elapsed seconds', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const activeSession = {
      id: 'session-1',
      teamId: 'team-1',
      userId: 'user-1',
      checkInAt: new Date(Date.now() - 120_000),
      lastKeepaliveAt: new Date(),
      lastCreditedAt: new Date(Date.now() - 90_000),
      creditedSeconds: 30,
      status: 'active',
      weekKey: '2026-03-30',
      save
    } as any;

    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(activeSession)
    });

    const result = await service.getCurrentSession(user.userId);

    expect(result).toBeTruthy();
    expect(result?.isPaused).toBe(false);
    expect(typeof result?.elapsedSeconds).toBe('number');
    expect(result?.elapsedSeconds).toBeGreaterThanOrEqual(120);
  });

  it('pauses stale sessions instead of invalidating them when querying current state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:05:00.000Z'));

    const save = vi.fn().mockResolvedValue(undefined);
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        id: 'session-1',
        teamId: 'team-1',
        userId: 'user-1',
        checkInAt: new Date('2026-04-10T00:00:00.000Z'),
        lastKeepaliveAt: new Date('2026-04-10T00:00:00.000Z'),
        lastCreditedAt: new Date('2026-04-10T00:00:00.000Z'),
        creditedSeconds: 120,
        status: 'active',
        weekKey: '2026-04-07',
        save
      })
    });

    const result = await service.getCurrentSession(user.userId);
    expect(result).toMatchObject({
      status: 'active',
      isPaused: true,
      pauseReason: 'heartbeat_timeout',
      creditedSeconds: 120
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('increments credited seconds on keepalive while session stays valid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:01:00.000Z'));

    const save = vi.fn().mockResolvedValue(undefined);
    const activeSession = {
      id: 'session-1',
      teamId: 'team-1',
      userId: 'user-1',
      checkInAt: new Date('2026-04-10T00:00:00.000Z'),
      lastKeepaliveAt: new Date('2026-04-10T00:00:30.000Z'),
      lastCreditedAt: new Date('2026-04-10T00:00:30.000Z'),
      creditedSeconds: 30,
      segmentsCount: 1,
      status: 'active',
      weekKey: '2026-04-07',
      save
    } as any;

    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(activeSession)
    });

    const result = await service.keepAlive(user, '127.0.0.1');

    expect(networkPolicyService.assertIpAllowed).toHaveBeenCalledWith('team-1', '127.0.0.1');
    expect(result.creditedSeconds).toBe(60);
    expect(result.segmentsCount).toBe(2);
    expect(result.pauseReason).toBeUndefined();
    expect(result.lastKeepaliveAt).toEqual(new Date('2026-04-10T00:01:00.000Z'));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('synchronizes one point per fully credited minute during keepalive', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:02:00.000Z'));

    const session = {
      id: 'session-1',
      teamId: 'team-1',
      userId: 'user-1',
      checkInAt: new Date('2026-04-10T00:00:00.000Z'),
      lastKeepaliveAt: new Date('2026-04-10T00:01:00.000Z'),
      lastCreditedAt: new Date('2026-04-10T00:01:00.000Z'),
      creditedSeconds: 119,
      status: 'active',
      weekKey: '2026-04-07',
      save: vi.fn().mockResolvedValue(undefined)
    } as any;
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(session) });
    service = new AttendanceService(attendanceModel, networkPolicyService as any, usersService as any, undefined, pointsService as any);

    await service.keepAlive(user, '127.0.0.1');

    expect(pointsService.syncAttendancePoints).toHaveBeenCalledWith({
      teamId: 'team-1',
      userId: 'user-1',
      attendanceSessionId: 'session-1',
      creditedSeconds: 179,
      isValid: true
    });
  });

  it('stops accumulation when keepalive resumes after heartbeat timeout and does not backfill the gap', async () => {
    vi.useFakeTimers();
    const checkInAt = new Date('2026-04-10T00:00:00.000Z');
    const resumedAt = new Date(checkInAt.getTime() + (ATTENDANCE_KEEPALIVE_TIMEOUT_SECONDS + 1) * 1000);
    vi.setSystemTime(resumedAt);

    const save = vi.fn().mockResolvedValue(undefined);
    const session = {
      id: 'session-1',
      teamId: 'team-1',
      userId: 'user-1',
      checkInAt,
      lastKeepaliveAt: checkInAt,
      lastCreditedAt: checkInAt,
      creditedSeconds: 0,
      status: 'active',
      weekKey: '2026-04-07',
      save
    } as any;

    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(session)
    });

    const result = await service.keepAlive(user, '127.0.0.1');

    expect(result.status).toBe('active');
    expect(result.creditedSeconds).toBe(0);
    expect(result.pauseReason).toBeUndefined();
    expect(result.pausedAt).toBeUndefined();
    expect(result.lastCreditedAt).toEqual(resumedAt);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('pauses accumulation when keepalive request comes from disallowed network', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:01:00.000Z'));

    const save = vi.fn().mockResolvedValue(undefined);
    const session = {
      id: 'session-1',
      teamId: 'team-1',
      userId: 'user-1',
      checkInAt: new Date('2026-04-10T00:00:00.000Z'),
      lastKeepaliveAt: new Date('2026-04-10T00:00:30.000Z'),
      lastCreditedAt: new Date('2026-04-10T00:00:30.000Z'),
      creditedSeconds: 30,
      status: 'active',
      weekKey: '2026-04-07',
      save
    } as any;
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(session)
    });
    networkPolicyService.assertIpAllowed.mockRejectedValueOnce(
      new BadRequestException({
        code: ERROR_CODES.ATTENDANCE_NETWORK_NOT_ALLOWED,
        message: 'Current network is not allowed for attendance'
      })
    );

    await expect(service.keepAlive(user, '203.0.113.1')).rejects.toBeInstanceOf(BadRequestException);
    expect(session.pauseReason).toBe('network_not_allowed');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('completes check-out with wall-clock duration even after keepalive timeout pause', async () => {
    vi.useFakeTimers();
    const checkInAt = new Date('2026-04-10T00:00:00.000Z');
    const lastKeepaliveAt = new Date(checkInAt.getTime() + 10_000);
    const checkOutAt = new Date(lastKeepaliveAt.getTime() + (ATTENDANCE_KEEPALIVE_TIMEOUT_SECONDS + 1) * 1000);
    vi.setSystemTime(checkOutAt);

    const save = vi.fn().mockResolvedValue(undefined);
    const session = {
      id: 'session-1',
      teamId: 'team-1',
      userId: 'user-1',
      checkInAt,
      lastKeepaliveAt,
      lastCreditedAt: lastKeepaliveAt,
      creditedSeconds: 600,
      status: 'active',
      weekKey: '2026-04-07',
      save
    } as any;
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(session)
    });

    const result = await service.checkOut(user, '127.0.0.1');

    expect(result.status).toBe('completed');
    expect(result.durationSeconds).toBe(Math.floor((checkOutAt.getTime() - checkInAt.getTime()) / 1000));
    expect(result.pauseReason).toBe('heartbeat_timeout');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('invalidates a check-out when natural session duration reaches five hours', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const activeSession = {
      id: 'session-1',
      checkInAt: new Date(Date.now() - ATTENDANCE_MAX_SECONDS * 1000),
      lastKeepaliveAt: new Date(),
      lastCreditedAt: new Date(),
      creditedSeconds: ATTENDANCE_MAX_SECONDS,
      status: 'active',
      save
    } as any;

    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(activeSession)
    });

    const result = await service.checkOut(user, '127.0.0.1');

    expect(result.status).toBe('invalidated');
    expect(result.durationSeconds).toBe(0);
    expect(result.invalidReason).toBe('overtime_5h');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('resets attendance points when a session is invalidated', async () => {
    const session = {
      id: 'session-1',
      teamId: 'team-1',
      userId: 'user-1',
      checkInAt: new Date(Date.now() - ATTENDANCE_MAX_SECONDS * 1000),
      lastKeepaliveAt: new Date(),
      lastCreditedAt: new Date(),
      creditedSeconds: ATTENDANCE_MAX_SECONDS - 1,
      status: 'active',
      save: vi.fn().mockResolvedValue(undefined)
    } as any;
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(session) });
    service = new AttendanceService(attendanceModel, networkPolicyService as any, usersService as any, undefined, pointsService as any);

    await service.checkOut(user, '127.0.0.1');

    expect(pointsService.syncAttendancePoints).toHaveBeenCalledWith({
      teamId: 'team-1',
      userId: 'user-1',
      attendanceSessionId: 'session-1',
      creditedSeconds: 0,
      isValid: false
    });
  });

  it('builds record date filters using Asia/Shanghai day boundaries', async () => {
    const exec = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockReturnValue({ exec });
    const skip = vi.fn().mockReturnValue({ limit });
    const sort = vi.fn().mockReturnValue({ skip });
    find.mockReturnValue({ sort });

    await service.listUserRecords(
      user.userId,
      { startDate: '2026-04-09', endDate: '2026-04-10' },
      { page: 1, pageSize: 20 }
    );

    expect(find).toHaveBeenCalledWith({
      userId: 'user-1',
      checkInAt: {
        $gte: new Date('2026-04-08T16:00:00.000Z'),
        $lte: new Date('2026-04-10T15:59:59.999Z')
      }
    });
    expect(sort).toHaveBeenCalledWith({ checkInAt: -1 });
  });

  it('builds team record export date filters using Asia/Shanghai day boundaries', async () => {
    const exec = vi.fn().mockResolvedValue([]);
    const sort = vi.fn().mockReturnValue({ exec });
    find.mockReturnValue({ sort });

    await service.listTeamRecords('team-1', {
      startDate: '2026-04-09',
      endDate: '2026-04-10'
    });

    expect(find).toHaveBeenCalledWith({
      teamId: 'team-1',
      checkInAt: {
        $gte: new Date('2026-04-08T16:00:00.000Z'),
        $lte: new Date('2026-04-10T15:59:59.999Z')
      }
    });
    expect(sort).toHaveBeenCalledWith({ checkInAt: -1 });
  });

  it('lists only non-paused active team sessions enriched with member profiles and elapsed time', async () => {
    const now = Date.now();
    const exec = vi.fn().mockResolvedValue([
      {
        userId: 'user-2',
        checkInAt: new Date(now - 120_000),
        lastKeepaliveAt: new Date(now - 10_000),
        lastCreditedAt: new Date(now - 120_000),
        creditedSeconds: 0,
        weekKey: '2026-04-06',
        save: vi.fn().mockResolvedValue(undefined)
      },
      {
        userId: 'user-3',
        checkInAt: new Date(now - (ATTENDANCE_KEEPALIVE_TIMEOUT_SECONDS * 1000 + 10_000)),
        lastKeepaliveAt: new Date(now - (ATTENDANCE_KEEPALIVE_TIMEOUT_SECONDS * 1000 + 10_000)),
        lastCreditedAt: new Date(now - 30_000),
        creditedSeconds: 60,
        weekKey: '2026-04-06',
        save: vi.fn().mockResolvedValue(undefined)
      }
    ]);
    const sort = vi.fn().mockReturnValue({ exec });
    find.mockReturnValue({ sort });
    usersService.findByIds.mockResolvedValue([
      {
        id: 'user-2',
        displayName: 'Bob',
        enrollYear: 2025,
        avatarColor: '#123456'
      }
    ]);

    const result = await service.listTeamActiveSessions('team-1');

    expect(find).toHaveBeenCalledWith({ teamId: 'team-1', status: 'active' });
    expect(sort).toHaveBeenCalledWith({ checkInAt: 1 });
    expect(result).toEqual([
      expect.objectContaining({
        memberKey: 'member-key-user-2',
        displayName: 'Bob',
        enrollYear: 2025,
        avatarColor: '#123456',
        weekKey: '2026-04-06'
      })
    ]);
    expect(result[0]?.elapsedSeconds).toBeGreaterThanOrEqual(120);
  });

  it('updates marked state for same-team records', async () => {
    const record = { id: 'session-1', teamId: 'team-1', isMarked: true };
    findOneAndUpdate.mockResolvedValue(record);

    await expect(service.setTeamRecordMarked('team-1', 'session-1', true)).resolves.toEqual({
      record,
      changed: true
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'session-1', teamId: 'team-1', isMarked: { $ne: true } },
      { $set: { isMarked: true } },
      { new: true }
    );
  });

  it('returns the existing record without reporting change when the marked state is already current', async () => {
    const existing = { id: 'session-1', teamId: 'team-1', isMarked: true };
    findOneAndUpdate.mockResolvedValue(null);
    findOne.mockReturnValueOnce({
      exec: vi.fn().mockResolvedValue(existing)
    });

    await expect(service.setTeamRecordMarked('team-1', 'session-1', true)).resolves.toEqual({
      record: existing,
      changed: false
    });

    expect(findOne).toHaveBeenCalledWith({ _id: 'session-1', teamId: 'team-1' });
  });

  it('rejects deleting active records', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        id: 'session-1',
        status: 'active'
      })
    });

    await expect(service.deleteCompletedTeamRecord('team-1', 'session-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes finished records for the same team', async () => {
    const deleteOne = vi.fn().mockResolvedValue(undefined);
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        id: 'session-1',
        status: 'completed',
        deleteOne
      })
    });

    await service.deleteCompletedTeamRecord('team-1', 'session-1');

    expect(findOne).toHaveBeenCalledWith({ _id: 'session-1', teamId: 'team-1' });
    expect(deleteOne).toHaveBeenCalledTimes(1);
  });
});

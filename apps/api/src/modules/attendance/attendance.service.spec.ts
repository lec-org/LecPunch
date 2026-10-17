import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ATTENDANCE_MAX_SECONDS, ERROR_CODES } from '@lecpunch/shared';
import { AttendanceService } from './attendance.service';
import type { AuthUser } from '../auth/types/auth-user.type';

const user: AuthUser = { userId: 'user-1', teamId: 'team-1', role: 'member', username: 'alice', displayName: 'Alice', enrollYear: 2024 };

describe('AttendanceService', () => {
  const create = vi.fn();
  const findOne = vi.fn();
  const find = vi.fn();
  const findOneAndUpdate = vi.fn();
  const aggregate = vi.fn();
  const adjustmentCreate = vi.fn();
  const adjustmentAggregate = vi.fn();
  const adjustmentFind = vi.fn();
  const networkPolicyService = { assertIpAllowed: vi.fn() };
  const usersService = {
    findByIds: vi.fn(),
    findByUsername: vi.fn(),
    getMemberKey: vi.fn((id: string) => `member-key-${id}`)
  };
  const pointsService = { syncAttendancePoints: vi.fn().mockResolvedValue(0) };
  const attendanceModel = { create, findOne, find, findOneAndUpdate, aggregate } as any;
  const adjustmentModel = { create: adjustmentCreate, aggregate: adjustmentAggregate, find: adjustmentFind } as any;
  let service: AttendanceService;
  let bucket: { version: number; entries: any[] };
  const bucketUpdate = vi.fn();
  const bucketModel = {
    updateOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
    find: vi.fn(() => ({ lean: () => ({ exec: vi.fn().mockResolvedValue([]) }) })),
    findOne: vi.fn(() => ({ exec: vi.fn().mockImplementation(async () => structuredClone(bucket)) })),
    findOneAndUpdate: bucketUpdate
  };

  const activeSession = (overrides: Record<string, unknown> = {}) => ({
    id: 'session-1', teamId: 'team-1', userId: 'user-1', checkInAt: new Date('2026-04-10T00:00:00.000Z'),
    status: 'active', weekKey: '2026-04-06', save: vi.fn().mockResolvedValue(undefined), ...overrides
  }) as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    bucket = { version: 0, entries: [] };
    bucketUpdate.mockImplementation((_query, update) => ({ exec: async () => {
      bucket.entries.push(update.$push.entries); bucket.version++; return bucket;
    } }));
    networkPolicyService.assertIpAllowed.mockResolvedValue(undefined);
    adjustmentFind.mockReturnValue({ sort: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }) });
    service = new AttendanceService(
      attendanceModel,
      adjustmentModel,
      networkPolicyService as any,
      usersService as any,
      pointsService as any, bucketModel as any
    );
  });

  it('rejects an existing active check-in', async () => {
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(activeSession()) });
    await expect(service.checkIn(user, '127.0.0.1')).rejects.toMatchObject({ response: { code: ERROR_CODES.ATTENDANCE_ALREADY_CHECKED_IN } });
  });

  it('creates an active session without heartbeat accounting fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T16:30:00.000Z'));
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
    create.mockImplementation(async (payload) => payload);
    const result = await service.checkIn(user, '127.0.0.1');
    expect(networkPolicyService.assertIpAllowed).toHaveBeenCalledWith('team-1', '127.0.0.1');
    expect(result).toMatchObject({ status: 'active', weekKey: '2026-04-06', weeklyGoalSecondsSnapshot: 38 * 3600 });
    expect(result).not.toHaveProperty('lastKeepaliveAt');
    expect(result).not.toHaveProperty('creditedSeconds');
  });

  it('maps a concurrent active-session insert conflict to the normal check-in error', async () => {
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
    create.mockRejectedValueOnce({ code: 11000 });
    await expect(service.checkIn(user, '127.0.0.1')).rejects.toMatchObject({ response: { code: ERROR_CODES.ATTENDANCE_ALREADY_CHECKED_IN } });
  });

  it('uses wall-clock elapsed time for the current active session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:02:00.000Z'));
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(activeSession()) });
    await expect(service.getCurrentSession(user.userId)).resolves.toMatchObject({ elapsedSeconds: 120, isPaused: false });
  });

  it('completes check-out with wall-clock duration and one point per completed minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:02:59.000Z'));
    const session = activeSession();
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(session) });
    const result = await service.checkOut(user, '127.0.0.1');
    expect(result).toMatchObject({ status: 'completed', durationSeconds: 179, sourceIpAtCheckOut: '127.0.0.1' });
    expect(pointsService.syncAttendancePoints).toHaveBeenCalledWith({ teamId: 'team-1', userId: 'user-1', attendanceSessionId: 'session-1', weekKey: '2026-04-06', durationSeconds: 179, isValid: true });
  });

  it('invalidates a session when it reaches the five-hour limit', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-10T05:00:00.000Z');
    vi.setSystemTime(now);
    const session = activeSession({ checkInAt: new Date(now.getTime() - ATTENDANCE_MAX_SECONDS * 1000) });
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(session) });
    await expect(service.checkOut(user, '127.0.0.1')).resolves.toMatchObject({ status: 'invalidated', durationSeconds: 0, invalidReason: 'overtime_5h' });
    expect(pointsService.syncAttendancePoints).toHaveBeenCalledWith({ teamId: 'team-1', userId: 'user-1', attendanceSessionId: 'session-1', weekKey: '2026-04-06', durationSeconds: 0, isValid: false });
  });

  it('keeps the legacy keepalive endpoint read-only below the time limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:02:00.000Z'));
    const session = activeSession();
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(session) });
    await expect(service.keepAlive(user)).resolves.toBe(session);
    expect(session.save).not.toHaveBeenCalled();
    expect(networkPolicyService.assertIpAllowed).not.toHaveBeenCalled();
    expect(pointsService.syncAttendancePoints).not.toHaveBeenCalled();
  });

  it('shows every active member until that member reaches the five-hour limit', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-04-10T05:00:00.000Z');
    vi.setSystemTime(now);
    const visible = activeSession({ userId: 'user-2', checkInAt: new Date(now.getTime() - 120_000) });
    const expired = activeSession({ userId: 'user-3', checkInAt: new Date(now.getTime() - ATTENDANCE_MAX_SECONDS * 1000) });
    const exec = vi.fn().mockResolvedValue([visible, expired]);
    find.mockReturnValue({ sort: vi.fn().mockReturnValue({ exec }) });
    usersService.findByIds.mockResolvedValue([{ id: 'user-2', displayName: 'Bob', enrollYear: 2025, avatarColor: '#123456' }]);
    const result = await service.listTeamActiveSessions('team-1');
    expect(result).toEqual([expect.objectContaining({ memberKey: 'member-key-user-2', displayName: 'Bob', elapsedSeconds: 120 })]);
    expect(expired).toMatchObject({ status: 'invalidated', invalidReason: 'overtime_5h' });
  });

  it('keeps record filtering and administrative deletion safeguards', async () => {
    const exec = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockReturnValue({ exec });
    const skip = vi.fn().mockReturnValue({ limit });
    find.mockReturnValue({ sort: vi.fn().mockReturnValue({ skip }) });
    await service.listUserRecords(user.userId, { startDate: '2026-04-09', endDate: '2026-04-10' }, { page: 1, pageSize: 20 });
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
    findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue({ status: 'active' }) });
    await expect(service.deleteCompletedTeamRecord('team-1', 'session-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('includes administrator adjustments in displayed weekly time but not points or daily raw records', async () => {
    aggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { _id: '2026-08-31', focusedSeconds: 3_660, sessions: 2 },
        { _id: '2026-09-02', focusedSeconds: 1_800, sessions: 1 }
      ])
    });

    adjustmentFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([
          {
            id: 'adjustment-1', operation: 'subtract', durationSeconds: 600,
            signedDurationSeconds: -600, reason: '迟到扣减', createdAt: new Date('2026-09-02T00:00:00.000Z')
          }
        ])
      })
    });

    await expect(service.getMyWeeklySummary(user, '2026-W36')).resolves.toEqual({
      week: '2026-W36',
      totalFocusedMinutes: 81,
      totalPoints: 91,
      rawFocusedMinutes: 91,
      adjustedMinutes: -10,
      adjustmentsCount: 1,
      checkedInDays: 2,
      days: [
        { date: '2026-08-31', focusedMinutes: 61, sessions: 2, points: 61 },
        { date: '2026-09-02', focusedMinutes: 30, sessions: 1, points: 30 }
      ],
      adjustments: [
        {
          operation: 'subtract', durationSeconds: 600, reason: '迟到扣减', createdAt: '2026-09-02T00:00:00.000Z'
        }
      ]
    });

    expect(aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: {
            teamId: 'team-1',
            userId: 'user-1',
            weekKey: '2026-08-31',
            status: { $ne: 'active' }
          }
        })
      ])
    );
    expect(adjustmentFind).toHaveBeenCalledWith({ teamId: 'team-1', userId: 'user-1', weekKey: '2026-08-31' });
  });

  it('keeps weekly adjustment audits isolated to the requested Shanghai week', async () => {
    adjustmentFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([
          {
            id: 'adjustment-1', userId: 'user-1', username: 'alice', operation: 'subtract', durationSeconds: 600,
            signedDurationSeconds: -600, reason: '迟到', createdAt: new Date('2026-09-02T00:00:00.000Z')
          }
        ])
      })
    });
    usersService.findByIds.mockResolvedValue([{ id: 'user-1', displayName: 'Alice' }]);

    await expect(service.listTeamWeekDurationAdjustments('team-1', '2026-W36')).resolves.toMatchObject({
      week: '2026-W36',
      items: [{ username: 'alice', signedDurationSeconds: -600, reason: '迟到' }]
    });

    expect(adjustmentFind).toHaveBeenCalledWith({ teamId: 'team-1', weekKey: '2026-08-31' });
  });

  it('returns signed adjustment totals for stats and report aggregates', async () => {
    adjustmentAggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { _id: { userId: 'user-1', weekKey: '2026-08-31' }, totalSeconds: 300, adjustmentsCount: 1 },
        { _id: { userId: 'user-2', weekKey: '2026-08-31' }, totalSeconds: -60, adjustmentsCount: 1 }
      ])
    });

    await expect(service.getManualAdjustmentSummaries('team-1', ['user-1', 'user-2'])).resolves.toEqual(
      new Map([
        ['user-1:2026-08-31', { manualAdjustmentSeconds: 300, adjustmentsCount: 1 }],
        ['user-2:2026-08-31', { manualAdjustmentSeconds: -60, adjustmentsCount: 1 }]
      ])
    );
  });

  it('keeps duration adjustments in a separate audit record without syncing points', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T00:00:00.000Z'));
    usersService.findByUsername.mockResolvedValue({
      id: 'member-1',
      teamId: 'team-1',
      username: 'alice',
      displayName: 'Alice', status: 'active'
    });
    aggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ totalSeconds: 4_200 }]) });
    adjustmentAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
    adjustmentCreate.mockResolvedValue({
      id: 'adjustment-1',
      username: 'alice',
      weekKey: '2026-08-31',
      operation: 'add',
      durationSeconds: 300,
      previousDurationSeconds: 4_200,
      resultingDurationSeconds: 4_500,
      createdAt: new Date('2026-09-02T00:00:00.000Z')
    });

    await expect(
      service.adjustCurrentWeekDuration(
        { ...user, userId: 'admin-1', role: 'admin' },
        { username: 'Alice', operation: 'add', durationSeconds: 300, reason: '补录' }
      )
    ).resolves.toMatchObject({
      adjustmentId: expect.any(String),
      previousDurationSeconds: 4_200,
      resultingDurationSeconds: 4_500
    });

    expect(bucketUpdate).toHaveBeenCalledWith(
      { teamId: 'team-1', userId: 'member-1', weekKey: '2026-08-31', version: 0 },
      { $inc: { version: 1 }, $push: { entries: expect.objectContaining({ operation: 'add', durationSeconds: 300, createdBy: 'admin-1' }) } },
      { new: true }
    );
    expect(adjustmentCreate).not.toHaveBeenCalled();
    expect(pointsService.syncAttendancePoints).not.toHaveBeenCalled();
  });

  it('rejects an adjustment that would reduce original duration plus adjustment history below zero', async () => {
    usersService.findByUsername.mockResolvedValue({
      id: 'member-1',
      teamId: 'team-1',
      username: 'alice',
      displayName: 'Alice', status: 'active'
    });
    aggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ totalSeconds: 120 }]) });
    adjustmentAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ totalSeconds: -30 }]) });

    await expect(
      service.adjustCurrentWeekDuration(
        { ...user, userId: 'admin-1', role: 'admin' },
        { username: 'alice', operation: 'subtract', durationSeconds: 91 }
      )
    ).rejects.toMatchObject({ response: { code: 'ATTENDANCE_DURATION_CANNOT_BE_NEGATIVE' } });

    expect(adjustmentCreate).not.toHaveBeenCalled();
  });

  it('rejects a duration adjustment for a member outside the administrator team', async () => {
    usersService.findByUsername.mockResolvedValue({
      id: 'member-2',
      teamId: 'team-2',
      username: 'other-team-member',
      displayName: 'Other team member'
    });

    await expect(
      service.adjustCurrentWeekDuration(
        { ...user, userId: 'admin-1', role: 'admin' },
        { username: 'other-team-member', operation: 'add', durationSeconds: 60 }
      )
    ).rejects.toMatchObject({ response: { code: ERROR_CODES.ATTENDANCE_CROSS_TEAM_FORBIDDEN } });

    expect(adjustmentCreate).not.toHaveBeenCalled();
  });
});

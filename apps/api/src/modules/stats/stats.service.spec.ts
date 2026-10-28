import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StatsService } from './stats.service';

describe('StatsService', () => {
  const aggregate = vi.fn();
  const attendanceService = {
    getModel: vi.fn(),
    getManualAdjustmentSummaries: vi.fn()
  };
  const usersService = {
    findById: vi.fn(),
    findByIds: vi.fn(),
    findByTeamAndEnrollYear: vi.fn(),
    listTeamMembers: vi.fn(),
    findByMemberKey: vi.fn(),
    getMemberKey: vi.fn((id: string) => `key-${id}`)
  };

  let service: StatsService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    attendanceService.getModel.mockReturnValue({ aggregate });
    attendanceService.getManualAdjustmentSummaries.mockResolvedValue(new Map());
    service = new StatsService(attendanceService as any, usersService as any);
  });

  it('adds signed entertainment and ranks equal comprehensive totals together', async () => {
    aggregate.mockReturnValue({exec: vi.fn().mockResolvedValue([
      {_id: 'user-1', totalDurationSeconds: 600, sessionsCount: 1},
      {_id: 'user-2', totalDurationSeconds: 1200, sessionsCount: 3}
    ])});
    usersService.listTeamMembers.mockResolvedValue([
      {id: 'user-1', displayName: 'A', role: 'member', enrollYear: 2025},
      {id: 'user-2', displayName: 'B', role: 'member', enrollYear: 2025},
      {id: 'user-3', displayName: 'C', role: 'member', enrollYear: 2025}
    ]);
    const cards = {getTeamWeekEntertainment: vi.fn().mockResolvedValue({'user-1': 600, 'user-2': 0, 'user-3': -1800}),
      getTeamInventoryCounts: vi.fn().mockResolvedValue({'user-1': 3, 'user-2': 1})};
    service = new StatsService(attendanceService as any, usersService as any, cards as any);
    const rows = await service.getTeamCurrentWeekStats('team-1');
    expect(rows.map(row => row.totalDurationSeconds)).toEqual([1200, 1200, -1800]);
    expect(rows.map(row => (row as any).rank)).toEqual([1, 1, 3]);
    expect(rows[2]).toMatchObject({recordedDurationSeconds: 0, entertainmentSeconds: -1800, assessmentComplete: false});
    expect(cards.getTeamWeekEntertainment).toHaveBeenCalledWith('team-1', expect.any(String));
    expect(rows.map(row => row.cardCount)).toEqual([1, 3, 0]);
  });

  it('only returns card inventory after validating the signed member key and team', async () => {
    const cards = { getMemberInventory: vi.fn().mockResolvedValue({ total: 3, items: [{ id: 'card-02', quantity: 3 }] }) };
    service = new StatsService(attendanceService as any, usersService as any, cards as any);
    usersService.findByMemberKey.mockResolvedValueOnce(null);
    await expect(service.getMemberCardInventory('team-1', 'invalid')).rejects.toThrow('成员不存在');
    usersService.findByMemberKey.mockResolvedValueOnce({ id: 'user-2', teamId: 'team-2', displayName: 'Other' });
    await expect(service.getMemberCardInventory('team-1', 'foreign')).rejects.toThrow('其他团队');
    expect(cards.getMemberInventory).not.toHaveBeenCalled();
    usersService.findByMemberKey.mockResolvedValueOnce({ id: 'user-1', teamId: 'team-1', displayName: 'Member' });
    expect(await service.getMemberCardInventory('team-1', 'valid')).toMatchObject({ member: { memberKey: 'valid', displayName: 'Member' }, total: 3 });
    expect(cards.getMemberInventory).toHaveBeenCalledWith('team-1', 'user-1');
  });

  it('includes a current card-only week in personal summaries without changing raw time', async () => {
    aggregate.mockReturnValue({exec: vi.fn().mockResolvedValue([])});
    // The card service uses Shanghai Monday keys; freeze to an explicit week.
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    const cards = {getMemberEntertainmentHistory: vi.fn().mockResolvedValue({'2026-10-26': -900})};
    service = new StatsService(attendanceService as any, usersService as any, cards as any);
    const rows = await service.getMyWeeklyStats('team-1', 'user-1', 2025);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({totalDurationSeconds: -900, recordedDurationSeconds: 0, entertainmentSeconds: -900, assessmentComplete: false});
  });

  it('returns every team member, including members without current-week sessions', async () => {
    aggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { _id: 'user-1', totalDurationSeconds: 7200, sessionsCount: 2 }
      ])
    });
    usersService.listTeamMembers.mockResolvedValue([
      { id: 'user-1', displayName: 'Alice', realName: 'Alice Zhang', role: 'member', enrollYear: 2024 },
      { id: 'user-2', displayName: 'Bob', role: 'member', enrollYear: 2025 }
    ]);

    const result = await service.getTeamCurrentWeekStats('team-1');

    expect(result).toEqual([
      {
        memberKey: 'key-user-1',
        totalDurationSeconds: 7200,
        recordedDurationSeconds: 7200,
        manualAdjustmentSeconds: 0,
        adjustmentsCount: 0,
        sessionsCount: 2,
        displayName: 'Alice',
        realName: 'Alice Zhang',
        role: 'member',
        enrollYear: 2024,
        weekKey: expect.any(String)
      },
      {
        memberKey: 'key-user-2',
        totalDurationSeconds: 0,
        recordedDurationSeconds: 0,
        manualAdjustmentSeconds: 0,
        adjustmentsCount: 0,
        sessionsCount: 0,
        displayName: 'Bob',
        role: 'member',
        enrollYear: 2025,
        weekKey: expect.any(String)
      }
    ]);
  });

  it('limits same-grade results to the current member roster before merging weekly stats', async () => {
    aggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
    usersService.findByTeamAndEnrollYear.mockResolvedValue([
      { id: 'user-1', displayName: 'Alice', role: 'member', enrollYear: 2024 },
      { id: 'user-2', displayName: 'Bob', role: 'member', enrollYear: 2024 }
    ]);

    const result = await service.getTeamCurrentWeekStats('team-1', 2024);

    expect(usersService.findByTeamAndEnrollYear).toHaveBeenCalledWith('team-1', 2024);
    expect(usersService.listTeamMembers).not.toHaveBeenCalled();
    expect(aggregate).toHaveBeenCalledWith([
      {
        $match: {
          teamId: 'team-1',
          weekKey: expect.any(String),
          status: { $ne: 'active' },
          userId: { $in: ['user-1', 'user-2'] }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalDurationSeconds: { $sum: { $cond: [{ $and: [
            { $eq: ['$status', 'completed'] }, { $gte: ['$durationSeconds', 0] }, { $lt: ['$durationSeconds', 18000] }
          ] }, '$durationSeconds', 0] } },
          sessionsCount: { $sum: 1 }
        }
      }
    ]);
    expect(result).toEqual([
      expect.objectContaining({ displayName: 'Alice', enrollYear: 2024, totalDurationSeconds: 0, manualAdjustmentSeconds: 0, adjustmentsCount: 0, sessionsCount: 0 }),
      expect.objectContaining({ displayName: 'Bob', enrollYear: 2024, totalDurationSeconds: 0, manualAdjustmentSeconds: 0, adjustmentsCount: 0, sessionsCount: 0 })
    ]);
  });

  it('matches the current week using Asia/Shanghai boundaries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T16:30:00.000Z'));
    aggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([])
    });
    usersService.listTeamMembers.mockResolvedValue([{ id: 'user-1', displayName: 'Alice', role: 'member', enrollYear: 2024 }]);

    await service.getTeamCurrentWeekStats('team-1');

    expect(aggregate).toHaveBeenCalledWith([
      {
        $match: {
          teamId: 'team-1',
          weekKey: '2026-04-06',
          status: { $ne: 'active' },
          userId: { $in: ['user-1'] }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalDurationSeconds: { $sum: { $cond: [{ $and: [
            { $eq: ['$status', 'completed'] }, { $gte: ['$durationSeconds', 0] }, { $lt: ['$durationSeconds', 18000] }
          ] }, '$durationSeconds', 0] } },
          sessionsCount: { $sum: 1 }
        }
      }
    ]);
  });

  it('maps aggregated weekly rows to the shared weekKey contract', async () => {
    aggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        {
          _id: '2026-04-07',
          totalDurationSeconds: 5400,
          sessionsCount: 3,
          weeklyGoalSecondsSnapshot: 38 * 3600
        }
      ])
    });

    const result = await service.getMyWeeklyStats('team-1', 'user-1', 2024);

    expect(result).toEqual([
      {
        weekKey: '2026-04-07',
        totalDurationSeconds: 5400,
        recordedDurationSeconds: 5400,
        manualAdjustmentSeconds: 0,
        adjustmentsCount: 0,
        sessionsCount: 3,
        weeklyGoalSeconds: 38 * 3600
      }
    ]);
  });

  it('falls back to the current enroll-year goal when old rows have no snapshot', async () => {
    aggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([{ _id: '2026-04-07', totalDurationSeconds: 5400, sessionsCount: 3 }])
    });

    const result = await service.getMyWeeklyStats('team-1', 'user-1', 2025);

    expect(result).toEqual([
      {
        weekKey: '2026-04-07',
        totalDurationSeconds: 5400,
        recordedDurationSeconds: 5400,
        manualAdjustmentSeconds: 0,
        adjustmentsCount: 0,
        sessionsCount: 3,
        weeklyGoalSeconds: 28 * 3600
      }
    ]);
  });

  it('applies signed manual adjustments to the displayed ranking without changing session counts', async () => {
    aggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([{ _id: 'user-1', totalDurationSeconds: 7_200, sessionsCount: 2 }])
    });
    attendanceService.getManualAdjustmentSummaries.mockResolvedValue(
      new Map([['user-1:2026-08-31', { manualAdjustmentSeconds: -1_800, adjustmentsCount: 1 }]])
    );
    usersService.listTeamMembers.mockResolvedValue([
      { id: 'user-1', displayName: 'Alice', role: 'member', enrollYear: 2024 }
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T04:00:00.000Z'));

    await expect(service.getTeamCurrentWeekStats('team-1')).resolves.toEqual([
      expect.objectContaining({
        totalDurationSeconds: 5_400,
        recordedDurationSeconds: 7_200,
        manualAdjustmentSeconds: -1_800,
        sessionsCount: 2
      })
    ]);
  });

  it('does not apply an adjustment from a different week to weekly history', async () => {
    aggregate.mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { _id: '2026-08-24', totalDurationSeconds: 3_600, sessionsCount: 1 },
        { _id: '2026-08-31', totalDurationSeconds: 7_200, sessionsCount: 2 }
      ])
    });
    attendanceService.getManualAdjustmentSummaries.mockResolvedValue(
      new Map([
        ['user-1:2026-08-24', { manualAdjustmentSeconds: -600, adjustmentsCount: 1 }],
        ['user-1:2026-08-31', { manualAdjustmentSeconds: 1_200, adjustmentsCount: 1 }]
      ])
    );

    await expect(service.getMyWeeklyStats('team-1', 'user-1', 2024)).resolves.toMatchObject([
      { weekKey: '2026-08-31', totalDurationSeconds: 8_400, manualAdjustmentSeconds: 1_200 },
      { weekKey: '2026-08-24', totalDurationSeconds: 3_000, manualAdjustmentSeconds: -600 }
    ]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PointsService } from './points.service';

describe('PointsService', () => {
  const findOneAndUpdate = vi.fn();
  const aggregate = vi.fn();
  const pointLedgerModel = { findOneAndUpdate, aggregate } as any;
  const legacyAggregate = vi.fn(), bucketAggregate = vi.fn(), attendanceAggregate = vi.fn();
  let service: PointsService;

  beforeEach(() => {
    vi.clearAllMocks();
    attendanceAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
    legacyAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
    bucketAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
    service = new PointsService(pointLedgerModel, { aggregate: legacyAggregate } as any, { aggregate: bucketAggregate } as any, { aggregate: attendanceAggregate } as any);
  });

  it('counts existing current-week additions without checkout or a second credit write', async () => {
    aggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
    bucketAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ _id: { userId: 'user-1', weekKey: '2026-10-26' }, seconds: 7200 }]) });
    expect(await service.getTeamWeekBaseSeconds('team-1', '2026-10-26')).toEqual({ 'user-1': 7200 });
    expect(await service.getTeamWeekBaseSeconds('team-1', '2026-10-26')).toEqual({ 'user-1': 7200 });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(bucketAggregate.mock.calls[0][0][0]).toEqual({ $match: { teamId: 'team-1', weekKey: '2026-10-26' } });
  });

  it('nets legacy and bucket seconds without premature rounding and isolates users', async () => {
    attendanceAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ _id: 'user-1', seconds: 3600 }]) });
    legacyAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ _id: { userId: 'user-1', weekKey: '2026-10-26' }, seconds: 59 }]) });
    bucketAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([
      { _id: { userId: 'user-1', weekKey: '2026-10-26' }, seconds: -3659 },
      { _id: { userId: 'user-2', weekKey: '2026-10-26' }, seconds: 119 }
    ]) });
    expect(await service.getTeamWeekBaseSeconds('team-1', '2026-10-26')).toEqual({ 'user-1': 0, 'user-2': 119 });
    expect(attendanceAggregate.mock.calls[0][0][0]).toEqual({ $match: { teamId: 'team-1', weekKey: '2026-10-26', status: 'completed', durationSeconds: { $gte: 0, $lt: 18000 } } });
  });

  it('keeps sub-minute attendance and adjustments until the final comprehensive calculation', async () => {
    attendanceAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ _id: 'user-1', seconds: 59 }]) });
    bucketAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ _id: { userId: 'user-1', weekKey: '2026-10-26' }, seconds: 59 }]) });
    expect(await service.getTeamWeekBaseSeconds('team-1', '2026-10-26')).toEqual({ 'user-1': 118 });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('updates the compatible points endpoint while keeping historical adjustments out of this week', async () => {
    aggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([{ totalPoints: 0 }]) });
    bucketAggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([
      { _id: { userId: 'user-1', weekKey: '2026-10-26' }, seconds: 3600 },
      { _id: { userId: 'user-1', weekKey: '2026-10-19' }, seconds: 7200 }
    ]) });
    expect(await service.getMyPoints({ teamId: 'team-1', userId: 'user-1' } as any, '2026-W44'))
      .toMatchObject({ totalPoints: 180, weekPoints: 60 });
    expect(legacyAggregate.mock.calls[0][0][0]).toEqual({ $match: { teamId: 'team-1', userId: 'user-1' } });
  });

  it('awards one point for each fully completed attendance minute', async () => {
    findOneAndUpdate.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });

    await expect(
      service.syncAttendancePoints({
        teamId: 'team-1',
        userId: 'user-1',
        attendanceSessionId: 'session-1',
        weekKey: '2026-04-06',
        durationSeconds: 179,
        isValid: true
      })
    ).resolves.toBe(2);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { sourceAttendanceSessionId: 'session-1' },
      {
        $set: {
          teamId: 'team-1',
          userId: 'user-1',
          weekKey: '2026-04-06',
          sourceType: 'attendance',
          points: 2
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });

  it('sets an invalidated attendance session to zero points', async () => {
    findOneAndUpdate.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });

    await expect(
      service.syncAttendancePoints({
        teamId: 'team-1',
        userId: 'user-1',
        attendanceSessionId: 'session-1',
        weekKey: '2026-04-06',
        durationSeconds: 300,
        isValid: false
      })
    ).resolves.toBe(0);

    expect(findOneAndUpdate.mock.calls[0][1].$set.points).toBe(0);
  });

  it('keeps the authenticated points endpoint compatible with all-time and ISO-week totals', async () => {
    aggregate
      .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue([{ totalPoints: 60 }]) })
      .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue([{ totalPoints: 20 }]) });

    await expect(service.getMyPoints({ userId: 'user-1', teamId: 'team-1' } as any, '2026-W15')).resolves.toMatchObject({
      totalPoints: 60,
      week: '2026-W15',
      weekPoints: 20,
      accrualRate: { focusedMinutes: 1, points: 1 }
    });
    expect(aggregate).toHaveBeenNthCalledWith(2, [
      { $match: { teamId: 'team-1', userId: 'user-1', weekKey: '2026-04-06' } },
      { $group: { _id: null, totalPoints: { $sum: '$points' } } }
    ]);
  });

});

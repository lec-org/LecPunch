import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PointsService } from './points.service';

describe('PointsService', () => {
  const findOneAndUpdate = vi.fn();
  const aggregate = vi.fn();
  const pointLedgerModel = { findOneAndUpdate, aggregate } as any;
  let service: PointsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PointsService(pointLedgerModel);
  });

  it('awards one point for each fully credited attendance minute', async () => {
    findOneAndUpdate.mockReturnValue({ exec: vi.fn().mockResolvedValue({}) });

    await expect(
      service.syncAttendancePoints({
        teamId: 'team-1',
        userId: 'user-1',
        attendanceSessionId: 'session-1',
        creditedSeconds: 179,
        isValid: true
      })
    ).resolves.toBe(2);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { sourceAttendanceSessionId: 'session-1' },
      {
        $set: {
          teamId: 'team-1',
          userId: 'user-1',
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
        creditedSeconds: 300,
        isValid: false
      })
    ).resolves.toBe(0);

    expect(findOneAndUpdate.mock.calls[0][1].$set.points).toBe(0);
  });

  it('returns zero when a user has no point ledger entries', async () => {
    aggregate.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });

    await expect(service.getUserPoints('team-1', 'user-1')).resolves.toEqual({ totalPoints: 0 });
    expect(aggregate).toHaveBeenCalledWith([
      { $match: { teamId: 'team-1', userId: 'user-1' } },
      { $group: { _id: null, totalPoints: { $sum: '$points' } } }
    ]);
  });
});

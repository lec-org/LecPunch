import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PointsController } from './points.controller';

describe('PointsController', () => {
  const pointsService = { getMyPoints: vi.fn() };
  const cards = { getWeekPoints: vi.fn() };
  let controller: PointsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PointsController(pointsService as any, cards as any);
  });

  it('uses the authenticated user and optional requested week only', async () => {
    const user = { userId: 'user-1', teamId: 'team-1', role: 'member' } as any;
    pointsService.getMyPoints.mockResolvedValue({ totalPoints: 60, weekPoints: 20, week: '2026-W36', ledgerScope: 'attendance-audit' });
    cards.getWeekPoints.mockResolvedValue({ rule: 'comprehensive-v1', earned: 90, bonus: 0, spent: 60, balance: 30, comprehensiveSeconds: 5400 });

    await expect(controller.getMine(user, { week: '2026-W36' })).resolves.toMatchObject({
      totalPoints: 60, weekPoints: 20, ledgerScope: 'attendance-audit',
      drawPoints: { weekKey: '2026-08-31', rule: 'comprehensive-v1', earned: 90, spent: 60, balance: 30 }
    });
    expect(pointsService.getMyPoints).toHaveBeenCalledWith(user, '2026-W36');
    expect(cards.getWeekPoints).toHaveBeenCalledWith(user, '2026-08-31');
  });
  it('rejects an invalid week before querying card state', async () => {
    pointsService.getMyPoints.mockRejectedValueOnce(new Error('POINTS_WEEK_INVALID'));
    await expect(controller.getMine({} as any, { week: '2026-W99' })).rejects.toThrow('POINTS_WEEK_INVALID');
    expect(cards.getWeekPoints).not.toHaveBeenCalled();
  });
});

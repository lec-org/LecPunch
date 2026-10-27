import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AssessmentService, validateAssessmentStartWeek } from './assessment.service';
import { createAssessmentWeek, observeAssessmentWeek } from './assessment-engine';
import { DateTime } from 'luxon';
import type { AuthUser } from '../auth/types/auth-user.type';

const actor: AuthUser = { teamId: '6a0000000000000000000001', userId: '6a0000000000000000000011', username: 'test.a', displayName: '成员', role: 'member', enrollYear: 2025 };
const q = (value: unknown): any => ({ lean() { return this; }, select() { return this; }, sort() { return this; }, limit() { return this; }, exec: async () => structuredClone(value) });
const at = (value: string) => DateTime.fromISO(value, { zone: 'Asia/Shanghai' }).toMillis();

function fixture(config: Record<string, string> = {}) {
  const weeks = { findOne: vi.fn(() => q(null)), find: vi.fn(() => q([])), updateOne: vi.fn(() => q({ modifiedCount: 1 })), aggregate: vi.fn(() => q([])) };
  const memberships = { find: vi.fn(() => q([])), updateOne: vi.fn(() => q({ modifiedCount: 1 })) };
  const userModel = { distinct: vi.fn(() => q([actor.teamId])), find: vi.fn(() => q([])) };
  const sessions = { find: vi.fn(() => q([])) };
  const member = { id: actor.userId, teamId: actor.teamId, displayName: '成员', enrollYear: 2025 };
  const users = { findByMemberKey: vi.fn(async () => member), getMemberKey: vi.fn((id: string) => `signed-${id}`), findByTeamAndEnrollYear: vi.fn(async () => []), listTeamMembers: vi.fn(async () => [] as typeof member[]) };
  const attendance = { getManualAdjustmentSummaries: vi.fn(async () => new Map()) };
  const cards = { getTeamWeekEntertainment: vi.fn(async () => ({})) };
  const stats = { getTeamCurrentWeekStats: vi.fn(async () => []) };
  const service = new AssessmentService(weeks as any, memberships as any, userModel as any, sessions as any, new ConfigService(config), users as any, attendance as any, cards as any, stats as any);
  return { service, weeks, memberships, userModel, sessions, users, attendance, cards, stats, member };
}

describe('AssessmentService safe opt-in and scoped reads', () => {
  it('remains disabled and performs no observation writes without an explicit start week', async () => {
    const f = fixture(); await f.service.onModuleInit(); await f.service.observeNow(); f.service.onModuleDestroy();
    expect(f.userModel.distinct).not.toHaveBeenCalled();
    expect(f.memberships.updateOne).not.toHaveBeenCalled(); expect(f.weeks.updateOne).not.toHaveBeenCalled();
    expect((await f.service.leaderboard(actor)).enabled).toBe(false);
  });
  it('rejects invalid start configuration rather than implicitly enabling', () => {
    for (const value of ['2026-10-27', '2026-W44', 'bad', '  ', '2026-02-30']) expect(() => validateAssessmentStartWeek(value)).toThrow('ASSESSMENT_START_WEEK');
    expect(validateAssessmentStartWeek('2026-10-26').startWeek).toBe('2026-10-26');
  });
  it('does not observe before its configured start and records honest first-registration evidence', async () => {
    const f = fixture({ ASSESSMENT_START_WEEK: '2026-10-26' });
    await f.service.observeNow(at('2026-10-25T22:00:00')); expect(f.weeks.updateOne).not.toHaveBeenCalled();
    const now = at('2026-10-26T00:01:00');
    f.userModel.find.mockImplementation(() => q([{ _id: actor.userId, createdAt: new Date(at('2026-01-01')), status: 'active', enrollYear: 2025 }]));
    f.memberships.find.mockImplementation(() => q([{ userId: actor.userId, registeredAt: new Date(now) }]));
    await f.service.observeNow(now);
    expect(f.memberships.updateOne.mock.calls[0][1].$setOnInsert.registeredAt).toEqual(new Date(now));
    const created = f.weeks.updateOne.mock.calls[0][1].$setOnInsert.state;
    expect(created.roster[actor.userId].reason).toBe('new_member');
    expect(created.roster[actor.userId].joinedAtSnapshot).toBe(now);
  });
  it('does not finalize with zeroes when a dependency fails or raw durations are malformed', async () => {
    const f = fixture({ ASSESSMENT_START_WEEK: '2026-10-19' });
    const state = createAssessmentWeek('2026-10-19', at('2026-10-19T00:00:00'), [{ userId: actor.userId, enrollYear: 2025, status: 'active', createdAt: at('2026-01-01'), joinedAt: at('2026-01-01'), goalSeconds: 3600 }], at('2026-10-19'));
    state.lastObservedAt = at('2026-10-25T23:59:00');
    f.weeks.find.mockImplementation(() => q([{ teamId: actor.teamId, weekKey: state.weekKey, revision: 0, state }]));
    f.sessions.find.mockImplementation(() => q([{ userId: actor.userId, durationSeconds: 'invalid' }]));
    await expect(f.service.observeNow(at('2026-10-26T06:00:00'))).rejects.toThrow('原始考勤数据无效');
    expect(f.weeks.updateOne.mock.calls.some(call => call[1]?.$set?.state?.outcomes?.[actor.userId]?.status === 'failed')).toBe(false);
    f.sessions.find.mockImplementation(() => q([])); f.cards.getTeamWeekEntertainment.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.service.observeNow(at('2026-10-26T06:00:00'))).rejects.toThrow('database unavailable');
  });
  it('continues observing later teams when the first team cannot read settlement totals', async () => {
    const f = fixture({ ASSESSMENT_START_WEEK: '2026-10-19' });
    const second = '6a0000000000000000000002';
    f.userModel.distinct.mockImplementation(() => q([actor.teamId, second]));
    const state = createAssessmentWeek('2026-10-19', at('2026-10-19'), [{ userId: actor.userId, enrollYear: 2025, status: 'active', createdAt: at('2026-01-01'), joinedAt: at('2026-01-01'), goalSeconds: 3600 }], at('2026-10-19'));
    state.lastObservedAt = at('2026-10-25T23:59:00');
    f.weeks.find.mockImplementation(({ teamId }: any) => q(teamId === actor.teamId ? [{ teamId, weekKey: state.weekKey, revision: 0, state }] : []));
    f.cards.getTeamWeekEntertainment.mockRejectedValueOnce(new Error('first team unavailable'));
    await expect(f.service.observeNow(at('2026-10-26T06:00:00'))).rejects.toThrow('first team unavailable');
    expect(f.weeks.updateOne.mock.calls.some(call => call[0].teamId === second && call[1].$setOnInsert)).toBe(true);
  });
  it('does not repeatedly query totals for permanent observation gaps after week end', async () => {
    const f = fixture({ ASSESSMENT_START_WEEK: '2026-10-19' });
    const state = createAssessmentWeek('2026-10-19', at('2026-10-19T01:00:00'), [{ userId: actor.userId, enrollYear: 2025, status: 'active', createdAt: at('2026-01-01'), joinedAt: at('2026-01-01'), goalSeconds: 3600 }], at('2026-10-19'));
    f.weeks.find.mockImplementation(() => q([{ teamId: actor.teamId, weekKey: state.weekKey, revision: 0, state }]));
    await f.service.observeNow(at('2026-10-26T06:00:00'));
    expect(f.sessions.find).not.toHaveBeenCalled();
    expect(f.cards.getTeamWeekEntertainment).not.toHaveBeenCalled();
  });
  it('rejects invalid existing or persisted cohort data before assessment writes without discarding disabled admission evidence', async () => {
    const f = fixture({ ASSESSMENT_START_WEEK: '2026-10-26' });
    f.userModel.find.mockImplementation(() => q([{ _id: actor.userId, status: 'disabled', enrollYear: 2062 }]));
    await expect(f.service.observeNow(at('2026-10-26T00:01:00'))).rejects.toThrow('Invalid enrollment year');
    expect(f.weeks.updateOne).not.toHaveBeenCalled(); expect(f.memberships.updateOne).not.toHaveBeenCalled();
    f.weeks.aggregate.mockImplementation(() => q([{ latest: 2062, invalid: 1 }]));
    await expect(f.service.memberSummaries(actor)).rejects.toThrow('Invalid persisted cohort');
    f.weeks.aggregate.mockImplementation(() => q([{ latest: 2027, invalid: 0 }]));
    expect((await f.service.memberSummaries(actor)).requiredEnrollYears).toEqual([2027, 2026]);
  });

  it('enforces same-team history and validates pagination', async () => {
    const f = fixture();
    f.users.findByMemberKey.mockResolvedValueOnce({ ...f.member, teamId: 'other-team' });
    await expect(f.service.history(actor, 'other')).rejects.toThrow('不可查看其他团队');
    expect(f.weeks.find).not.toHaveBeenCalled();
    await expect(f.service.history(actor, 'signed-key', '2026-10-27')).rejects.toThrow('before');
    await expect(f.service.history(actor, 'signed-key', undefined, 101)).rejects.toThrow('limit');
    await expect(f.service.history(actor, 'signed-key', undefined, NaN)).rejects.toThrow('limit');
  });
  it('serves only persisted failed outcomes in descending cursor pages', async () => {
    const f = fixture();
    const row = (weekKey: string) => ({ weekKey, state: { endsAt: at(weekKey) + 7 * 86400000, outcomes: { [actor.userId]: { status: 'failed', goalSeconds: 3600, rawSeconds: 1800, manualSeconds: 0, entertainmentSeconds: -600, comprehensiveSeconds: 1200, settledAt: at(weekKey) + 8 * 86400000 } } } });
    f.weeks.find.mockImplementation(() => q([row('2026-10-19'), row('2026-10-12')]));
    f.weeks.aggregate.mockImplementation(() => q([{ _id: actor.userId, count: 3 }]));
    const page = await f.service.history(actor, 'signed-key', '2026-10-26', 1);
    expect(page.failedWeeksCount).toBe(3); expect(page.items).toHaveLength(1); expect(page.nextCursor).toBe('2026-10-19');
    expect(page.items[0].shortfallSeconds).toBe(2400);
    expect(page.items[0].assessmentDate).toBe('2026-10-25');
    expect(f.weeks.find.mock.calls[0][0]).toMatchObject({ teamId: actor.teamId, weekKey: { $lt: '2026-10-26' }, [`state.outcomes.${actor.userId}.status`]: 'failed' });
  });
  it('scopes cohort evidence and failure counts to the authenticated team and preserves zero counts', async () => {
    const f = fixture({ ASSESSMENT_START_WEEK: '2026-10-26' });
    f.users.listTeamMembers.mockResolvedValue([f.member, { ...f.member, id: 'member-b' }]);
    f.weeks.aggregate.mockImplementation((pipeline: any) => q(pipeline.some((stage: any) => stage.$group?.latest) ? [] : [{ _id: actor.userId, count: 2 }]));
    const result = await f.service.memberSummaries(actor);
    expect(result.enabled).toBe(true);
    expect(result.requiredEnrollYears).toEqual([2025, 2024]);
    expect(f.users.listTeamMembers).toHaveBeenCalledWith(actor.teamId);
    expect(f.weeks.aggregate).toHaveBeenCalledTimes(2);
    expect(f.weeks.aggregate.mock.calls[0][0][0]).toEqual({ $match: { teamId: actor.teamId, weekKey: { $lte: result.week } } });
    expect(f.weeks.aggregate.mock.calls[1][0][0]).toEqual({ $match: { teamId: actor.teamId } });
    expect(result.items).toEqual([{ memberKey: `signed-${actor.userId}`, failedWeeksCount: 2 }, { memberKey: 'signed-member-b', failedWeeksCount: 0 }]);
  });
  it.each([['2026-10-26', '2026-11-01'], ['2026-12-28', '2027-01-03']])('uses Sunday for the persisted week %s', async (weekKey, sunday) => {
    const f = fixture();
    f.weeks.find.mockImplementation(() => q([{ weekKey, state: { endsAt: at(weekKey) + 7 * 86400000, outcomes: {
      [actor.userId]: { goalSeconds: 3600, rawSeconds: 0, manualSeconds: 0, entertainmentSeconds: 0, comprehensiveSeconds: 0, settledAt: at(weekKey) + 8 * 86400000 }
    } } }]));
    expect((await f.service.history(actor, 'signed-key')).items[0].assessmentDate).toBe(sunday);
  });
  it('retains the highest actually observed cohort after its last member is removed', async () => {
    const f = fixture(); f.users.listTeamMembers.mockResolvedValue([f.member]);
    f.weeks.aggregate.mockImplementation((pipeline: any) => q(pipeline.some((stage: any) => stage.$group?.latest) ? [{ latest: 2027 }] : []));
    const summary = await f.service.memberSummaries(actor);
    expect(summary.requiredEnrollYears).toEqual([2027, 2026]);
    expect(f.weeks.aggregate.mock.calls[0][0][0]).toEqual({ $match: { teamId: actor.teamId, weekKey: { $lte: summary.week } } });
  });
  it('does not lose an older week cohort written after the next week was created', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-02T08:00:00+08:00'));
    try {
    const f = fixture();
    const members = [2025, 2026].map(year => ({ userId: `member-${year}`, enrollYear: year, goalSeconds: 3600,
      status: 'active' as const, createdAt: at('2026-01-01'), joinedAt: at('2026-01-01') }));
    const old = createAssessmentWeek('2026-10-26', at('2026-10-26'), members, at('2026-10-26'));
    // Worker B creates the new week before worker A's last old-week observation commits.
    const newer = createAssessmentWeek('2026-11-02', at('2026-11-02'), members, at('2026-10-26'), old.requiredEnrollYears);
    const lateOld = observeAssessmentWeek(old, at('2026-11-01T23:59:59'), [...members, {
      ...members[0], userId: 'new-2027', enrollYear: 2027, joinedAt: at('2026-11-01T23:59:00')
    }]);
    expect(lateOld.requiredEnrollYears).toEqual([2027, 2026]);
    expect(newer.requiredEnrollYears).toEqual([2026, 2025]);
    f.users.listTeamMembers.mockResolvedValue([f.member]); // New cohort's last member has since left.
    f.weeks.findOne.mockImplementation(() => q({ state: newer }));
    f.weeks.aggregate.mockImplementation((pipeline: any) => q(pipeline.some((stage: any) => stage.$group?.latest)
      ? [{ _id: null, latest: Math.max(...lateOld.requiredEnrollYears!, ...newer.requiredEnrollYears!) }] : []));
    expect((await f.service.memberSummaries(actor)).requiredEnrollYears).toEqual([2027, 2026]);
    } finally { vi.useRealTimers(); }
  });
  it('does not import a later week cohort into a delayed previous-week observation', async () => {
    const f = fixture({ ASSESSMENT_START_WEEK: '2026-10-26' });
    await f.service.observeNow(at('2026-11-01T23:59:59'));
    expect(f.weeks.aggregate.mock.calls[0][0][0]).toEqual({ $match: { teamId: actor.teamId, weekKey: { $lte: '2026-10-26' } } });
  });
});

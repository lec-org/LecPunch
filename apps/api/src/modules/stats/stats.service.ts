import { Injectable, ForbiddenException, NotFoundException, Optional } from '@nestjs/common';
import { AttendanceService } from '../attendance/attendance.service';
import { UsersService } from '../users/users.service';
import { ERROR_CODES, weeklyGoalSeconds, comprehensiveDurationSeconds } from '@lecpunch/shared';
import { getWeekKey } from '../../common/utils/time.util';
import { CardsService } from '../cards/cards.service';

// Invalidated sessions remain visible in counts but never contribute to the
// comprehensive duration, even if a legacy row retains a nonzero duration.
const validDurationSum = { $sum: { $cond: [{ $and: [
  { $eq: ['$status', 'completed'] }, { $gte: ['$durationSeconds', 0] }, { $lt: ['$durationSeconds', 18000] }
] }, '$durationSeconds', 0] } };

@Injectable()
export class StatsService {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly usersService: UsersService,
    @Optional() private readonly cardsService?: CardsService
  ) {}

  async getMyWeeklyStats(teamId: string, userId: string, enrollYear: number, limit = 6) {
    const model = this.attendanceService.getModel();
    const rows = await model
      .aggregate([
        { $match: { teamId, userId, status: { $ne: 'active' } } },
        {
          $group: {
            _id: '$weekKey',
            totalDurationSeconds: validDurationSum,
            sessionsCount: { $sum: 1 },
            weeklyGoalSecondsSnapshot: { $max: '$weeklyGoalSecondsSnapshot' }
          }
        },
        { $sort: { _id: -1 } }
      ])
      .exec();

    const adjustmentSummaries = await this.attendanceService.getManualAdjustmentSummaries(teamId, [userId]);

    const rowsByWeek = new Map(rows.map((row) => [row._id, row]));
    for (const key of adjustmentSummaries.keys()) {
      const [adjustmentUserId, weekKey] = key.split(':');
      if (adjustmentUserId === userId && !rowsByWeek.has(weekKey)) {
        rowsByWeek.set(weekKey, { _id: weekKey, totalDurationSeconds: 0, sessionsCount: 0 });
      }
    }

    // A card-only week still belongs in the member's time view even without a checkout.
    const currentWeek = this.getCurrentWeekKey();
    const entertainmentHistory = this.cardsService
      ? await this.cardsService.getMemberEntertainmentHistory(teamId, userId)
      : {};
    for (const week of Object.keys(entertainmentHistory)) {
      if (!rowsByWeek.has(week)) rowsByWeek.set(week, { _id: week, totalDurationSeconds: 0, sessionsCount: 0 });
    }
    if (this.cardsService && !rowsByWeek.has(currentWeek)) {
      rowsByWeek.set(currentWeek, { _id: currentWeek, totalDurationSeconds: 0, sessionsCount: 0 });
    }

    return [...rowsByWeek.values()]
      .sort((left, right) => right._id.localeCompare(left._id))
      .slice(0, limit)
      .map((row) => {
      const recordedDurationSeconds = row.totalDurationSeconds ?? 0;
      const adjustmentSummary = adjustmentSummaries.get(`${userId}:${row._id}`);
      const manualAdjustmentSeconds = adjustmentSummary?.manualAdjustmentSeconds ?? 0;
      const entertainmentSeconds = entertainmentHistory[row._id] ?? 0;
      const totalDurationSeconds = comprehensiveDurationSeconds(recordedDurationSeconds, manualAdjustmentSeconds, entertainmentSeconds);
      const goal = row.weeklyGoalSecondsSnapshot ?? weeklyGoalSeconds(enrollYear);
      return {
        weekKey: row._id,
        totalDurationSeconds,
        recordedDurationSeconds,
        manualAdjustmentSeconds,
        adjustmentsCount: adjustmentSummary?.adjustmentsCount ?? 0,
        sessionsCount: row.sessionsCount,
        weeklyGoalSeconds: goal,
        ...(this.cardsService ? { entertainmentSeconds, assessmentComplete: totalDurationSeconds >= goal } : {})
      };
    });
  }

  async getTeamCurrentWeekStats(teamId: string, enrollYear?: number) {
    const weekKey = this.getCurrentWeekKey();
    const model = this.attendanceService.getModel();

    const members =
      enrollYear === undefined
        ? await this.usersService.listTeamMembers(teamId)
        : await this.usersService.findByTeamAndEnrollYear(teamId, enrollYear);

    if (members.length === 0) {
      return [];
    }

    const memberIds = members.map((member) => member.id);
    const matchStage: Record<string, unknown> = {
      teamId,
      weekKey,
      status: { $ne: 'active' },
      userId: { $in: memberIds }
    };

    const rows = await model
      .aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$userId',
            totalDurationSeconds: validDurationSum,
            sessionsCount: { $sum: 1 }
          }
        }
      ])
      .exec();

    const [adjustmentSummaries] = await Promise.all([
      this.attendanceService.getManualAdjustmentSummaries(teamId, memberIds)
    ]);
    const statsByUserId = new Map(rows.map((row) => [row._id, row]));
    const entertainment = await this.cardsService?.getTeamWeekEntertainment(teamId, weekKey) ?? {};

    const items = members
      .map((member) => {
        const stats = statsByUserId.get(member.id);
        const recordedDurationSeconds = stats?.totalDurationSeconds ?? 0;
        const adjustmentSummary = adjustmentSummaries.get(`${member.id}:${weekKey}`);
        const manualAdjustmentSeconds = adjustmentSummary?.manualAdjustmentSeconds ?? 0;
        const entertainmentSeconds = entertainment[member.id] ?? 0;
        const goal = weeklyGoalSeconds(member.enrollYear);
        const totalDurationSeconds = comprehensiveDurationSeconds(recordedDurationSeconds, manualAdjustmentSeconds, entertainmentSeconds);
        return {
          memberKey: this.usersService.getMemberKey(member.id),
          totalDurationSeconds,
          ...(this.cardsService ? { entertainmentSeconds, weeklyGoalSeconds: goal, assessmentComplete: totalDurationSeconds >= goal } : {}),
          recordedDurationSeconds,
          manualAdjustmentSeconds,
          adjustmentsCount: adjustmentSummary?.adjustmentsCount ?? 0,
          sessionsCount: stats?.sessionsCount ?? 0,
          displayName: member.displayName,
          username: member.username,
          avatarUrl: member.avatarUrl,
          realName: member.realName,
          role: member.role,
          enrollYear: member.enrollYear,
          avatarColor: member.avatarColor,
          avatarEmoji: member.avatarEmoji,
          avatarBase64: member.avatarBase64,
          weekKey
        };
      })
      .sort(
        (left, right) =>
          right.totalDurationSeconds - left.totalDurationSeconds ||
          right.sessionsCount - left.sessionsCount ||
          left.displayName.localeCompare(right.displayName)
      );
    let previous: number | undefined, rank = 0;
    return this.cardsService ? items.map((item, index) => {
      if (item.totalDurationSeconds !== previous) rank = index + 1;
      previous = item.totalDurationSeconds;
      return { ...item, rank };
    }) : items;
  }

  async getMemberWeeklyStats(currentUserTeamId: string, memberKey: string, limit = 6) {
    const member = await this.usersService.findByMemberKey(memberKey);
    if (!member) {
      throw new NotFoundException({ message: '成员不存在' });
    }
    if (member.teamId !== currentUserTeamId) {
      throw new ForbiddenException({
        code: ERROR_CODES.ATTENDANCE_CROSS_TEAM_FORBIDDEN,
        message: '不可查看其他团队成员'
      });
    }

    const items = await this.getMyWeeklyStats(currentUserTeamId, member.id, member.enrollYear, limit);
    return {
      member: {
        memberKey,
        displayName: member.displayName,
        role: member.role
      },
      items
    };
  }

  getWeeklyGoalSeconds(enrollYear: number): number {
    return weeklyGoalSeconds(enrollYear);
  }

  private getCurrentWeekKey() {
    return getWeekKey(new Date());
  }
}

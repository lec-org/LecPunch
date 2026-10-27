import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DateTime } from 'luxon';
import { assessmentEnrollYears, isValidEnrollmentYear, requiresWeeklyAssessment, weeklyGoalSeconds, type AssessmentLeaderboardView, type AssessmentMemberHistory, type AssessmentMemberSummaries } from '@lecpunch/shared';
import type { AuthUser } from '../auth/types/auth-user.type';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AttendanceSession, AttendanceSessionDocument } from '../attendance/schemas/attendance-session.schema';
import { AttendanceService } from '../attendance/attendance.service';
import { CardsService } from '../cards/cards.service';
import { StatsService } from '../stats/stats.service';
import { getWeekKey } from '../../common/utils/time.util';
import { AssessmentMembership, AssessmentMembershipDocument, AssessmentWeek, AssessmentWeekDocument } from './schemas/assessment.schema';
import { createAssessmentWeek, finalizeAssessmentWeek, observeAssessmentWeek, type AssessmentMemberSnapshot, type AssessmentTotals, type AssessmentWeekState } from './assessment-engine';

type WeekSnapshot = { teamId: string; weekKey: string; revision: number; state: AssessmentWeekState };
export function validateAssessmentStartWeek(value: unknown): { startWeek: string | null; enabledAt: number | null } {
  if (value === undefined || value === null || value === '') return { startWeek: null, enabledAt: null };
  if (typeof value !== 'string') throw new Error('ASSESSMENT_START_WEEK 必须为北京时间周一 yyyy-MM-dd，留空表示关闭');
  const monday = DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: 'Asia/Shanghai' }).startOf('day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !monday.isValid || monday.weekday !== 1 || monday.toFormat('yyyy-MM-dd') !== value) {
    throw new Error('ASSESSMENT_START_WEEK 必须为北京时间周一 yyyy-MM-dd，不能隐式启用');
  }
  return { startWeek: value, enabledAt: monday.toMillis() };
}

@Injectable()
export class AssessmentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssessmentService.name);
  private readonly settings: ReturnType<typeof validateAssessmentStartWeek>;
  private timer?: NodeJS.Timeout;
  private observing = false;
  constructor(
    @InjectModel(AssessmentWeek.name) private readonly weeks: Model<AssessmentWeekDocument>,
    @InjectModel(AssessmentMembership.name) private readonly memberships: Model<AssessmentMembershipDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AttendanceSession.name) private readonly sessions: Model<AttendanceSessionDocument>,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly attendance: AttendanceService,
    private readonly cards: CardsService,
    private readonly stats: StatsService
  ) { this.settings = validateAssessmentStartWeek(config.get('ASSESSMENT_START_WEEK')); }

  async onModuleInit() {
    if (!this.settings.startWeek) return;
    await this.observeSafely();
    this.timer = setInterval(() => { void this.observeSafely(); }, 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async observeSafely() {
    if (this.observing) return;
    this.observing = true;
    try { await this.observeNow(); }
    catch (error) { this.logger.error(`考核观测未完成，不结算失败：${(error as Error).message}`); }
    finally { this.observing = false; }
  }

  async observeNow(now = Date.now()): Promise<void> {
    const { startWeek, enabledAt } = this.settings;
    const currentWeek = getWeekKey(new Date(now));
    if (!startWeek || enabledAt === null || currentWeek < startWeek) return;
    const teams = await this.userModel.distinct('teamId').exec();
    const failures: Error[] = [];
    for (const teamId of teams) {
      if (typeof teamId !== 'string' || !/^[a-f\d]{24}$/i.test(teamId)) continue;
      try { await this.observeTeam(teamId, now, startWeek, enabledAt, currentWeek); }
      catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        failures.push(failure);
        this.logger.error(`Team ${teamId}: ${failure.message}`);
      }
    }
    if (failures.length) throw Object.assign(new Error(failures.map(error => error.message).join('; ')), { errors: failures });
  }

  private async observeTeam(teamId: string, now: number, startWeek: string, enabledAt: number, currentWeek: string) {
    const members = await this.userModel.find({ teamId }).lean().exec();
    this.assertEnrollmentYears(members.map(member => member.enrollYear), currentWeek);
    const requiredYears = await this.observedRequiredYears(teamId, members.map(member => member.enrollYear), currentWeek);
    // Eligibility starts from a real registration observed by this module, never user.createdAt alone.
    for (const member of members) if (member.status === 'active') {
      try { await this.memberships.updateOne({ teamId, userId: String(member._id) }, {
        $setOnInsert: { teamId, userId: String(member._id), registeredAt: new Date(now) }
      }, { upsert: true }).exec(); }
      catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    }
    const admissions = await this.memberships.find({ teamId }).lean().exec();
    const admitted = new Map(admissions.map(member => [member.userId, new Date(member.registeredAt).getTime()]));
    const snapshots: AssessmentMemberSnapshot[] = members.map(member => ({
      userId: String(member._id), enrollYear: member.enrollYear, goalSeconds: this.goal(member.enrollYear),
      createdAt: member.createdAt ? new Date(member.createdAt).getTime() : null,
      joinedAt: admitted.get(String(member._id)) ?? null,
      status: member.status === 'active' || member.status === 'disabled' ? member.status : 'unknown'
    }));
    try { await this.weeks.updateOne({ teamId, weekKey: currentWeek }, { $setOnInsert: {
      teamId, weekKey: currentWeek, revision: 0, state: createAssessmentWeek(currentWeek, now, snapshots, enabledAt, requiredYears)
    } }, { upsert: true }).exec(); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    await this.updateWeek(teamId, currentWeek, state => observeAssessmentWeek(state, now, snapshots, requiredYears));
    const past = await this.weeks.find({ teamId, weekKey: { $lt: currentWeek, $gte: startWeek } }).lean().exec();
    for (const week of past) {
      if (now < week.state.endsAt + 5 * 3_600_000) continue;
      if (Object.keys(week.state.roster).every(id => week.state.outcomes[id] && week.state.outcomes[id].status !== 'pending')) continue;
      // Determine immutable observation failures without querying duration dependencies every minute.
      const preliminary = finalizeAssessmentWeek(observeAssessmentWeek(week.state, now, []), now, {});
      const needsTotals = Object.values(preliminary.outcomes).some(outcome => outcome.status === 'pending' && outcome.reason === 'invalid_totals');
      const totals = needsTotals ? await this.totals(teamId, week.weekKey, Object.keys(week.state.roster)) : {};
      await this.updateWeek(teamId, week.weekKey, state => finalizeAssessmentWeek(observeAssessmentWeek(state, now, []), now, totals));
    }
  }

  private assertEnrollmentYears(years: unknown[], week: string) {
    if (years.some(year => !isValidEnrollmentYear(year, Number(week.slice(0, 4))))) {
      throw new Error('Invalid enrollment year: correct member data before assessment; historical snapshots were not rewritten');
    }
  }

  private goal(year: number) { try { return Number.isInteger(year) ? weeklyGoalSeconds(year) : null; } catch { return null; } }

  private async updateWeek(teamId: string, weekKey: string, change: (state: AssessmentWeekState) => AssessmentWeekState) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const snapshot = await this.weeks.findOne({ teamId, weekKey }).lean().exec() as unknown as WeekSnapshot | null;
      if (!snapshot) return;
      const state = change(snapshot.state);
      if (JSON.stringify(state) === JSON.stringify(snapshot.state)) return;
      const saved = await this.weeks.updateOne({ teamId, weekKey, revision: snapshot.revision }, { $set: { state }, $inc: { revision: 1 } }).exec();
      if (saved.modifiedCount === 1) return;
    }
    throw new Error('考核观测并发冲突，保留上次可信快照');
  }

  private async totals(teamId: string, weekKey: string, userIds: string[]): Promise<Record<string, AssessmentTotals>> {
    const [raw, adjustments, entertainment] = await Promise.all([
      this.sessions.find({ teamId, weekKey, status: 'completed', userId: { $in: userIds } }).select('userId durationSeconds').lean().exec(),
      this.attendance.getManualAdjustmentSummaries(teamId, userIds),
      this.cards.getTeamWeekEntertainment(teamId, weekKey)
    ]);
    const values = new Map<string, number>();
    for (const row of raw) {
      if (!Number.isSafeInteger(row.durationSeconds) || row.durationSeconds! < 0 || row.durationSeconds! >= 18000) throw new Error('原始考勤数据无效');
      values.set(row.userId, (values.get(row.userId) ?? 0) + row.durationSeconds!);
    }
    return Object.fromEntries(userIds.map(id => {
      const rawSeconds = values.get(id) ?? 0;
      const adjustmentKey = `${id}:${weekKey}`;
      const manualSeconds = adjustments.has(adjustmentKey) ? adjustments.get(adjustmentKey)!.manualAdjustmentSeconds : 0;
      const entertainmentSeconds = Object.prototype.hasOwnProperty.call(entertainment, id) ? entertainment[id] : 0;
      if (![rawSeconds, manualSeconds, entertainmentSeconds].every(Number.isSafeInteger)) throw new Error('考核时长数据无效');
      return [id, { rawSeconds, manualSeconds, entertainmentSeconds }];
    }));
  }

  private async failedCounts(teamId: string, userIds: string[]) {
    if (!userIds.length) return new Map<string, number>();
    const rows = await this.weeks.aggregate<{ _id: string; count: number }>([
      { $match: { teamId } }, { $project: { outcomes: { $objectToArray: '$state.outcomes' } } }, { $unwind: '$outcomes' },
      { $match: { 'outcomes.k': { $in: userIds }, 'outcomes.v.status': 'failed' } },
      { $group: { _id: '$outcomes.k', count: { $sum: 1 } } }
    ]).exec();
    return new Map(rows.map(row => [row._id, row.count]));
  }

  private async observedRequiredYears(teamId: string, enrollYears: Array<number | null | undefined>, throughWeek: string) {
    // A previous week's final observation can commit after the next week was created.
    // Read the team-wide high-water mark, rather than assuming the latest week contains it.
    this.assertEnrollmentYears(enrollYears, throughWeek);
    const maximum = Number(throughWeek.slice(0, 4)) + 1;
    const rows = await this.weeks.aggregate<{ latest: number; invalid?: number }>([
      { $match: { teamId, weekKey: { $lte: throughWeek } } }, { $unwind: '$state.requiredEnrollYears' },
      { $group: { _id: null, latest: { $max: '$state.requiredEnrollYears' }, invalid: { $sum: { $cond: [{ $and: [
        { $gte: ['$state.requiredEnrollYears', 2000] }, { $lte: ['$state.requiredEnrollYears', maximum] },
        { $eq: ['$state.requiredEnrollYears', { $trunc: '$state.requiredEnrollYears' }] }
      ] }, 0, 1] } } } }
    ]).exec();
    if (rows.some(row => row.invalid || !isValidEnrollmentYear(row.latest, maximum - 1))) {
      throw new Error('Invalid persisted cohort evidence: audited correction required; assessment remains pending');
    }
    return assessmentEnrollYears(enrollYears, rows.length ? [rows[0].latest] : [], maximum - 1);
  }

  async memberSummaries(user: AuthUser): Promise<AssessmentMemberSummaries> {
    const week = getWeekKey(new Date());
    const members = await this.users.listTeamMembers(user.teamId);
    const requiredEnrollYears = await this.observedRequiredYears(user.teamId, members.map(member => member.enrollYear), week);
    const counts = await this.failedCounts(user.teamId, members.map(member => member.id));
    return {
      enabled: Boolean(this.settings.startWeek), startWeek: this.settings.startWeek, week,
      requiredEnrollYears,
      items: members.map(member => ({ memberKey: this.users.getMemberKey(member.id), failedWeeksCount: counts.get(member.id) ?? 0 }))
    };
  }

  async leaderboard(user: AuthUser): Promise<AssessmentLeaderboardView> {
    const summary = await this.memberSummaries(user);
    const rows = (await this.stats.getTeamCurrentWeekStats(user.teamId, user.enrollYear)).filter(row => requiresWeeklyAssessment(row.enrollYear, summary.requiredEnrollYears ?? []));
    const members = await this.users.findByTeamAndEnrollYear(user.teamId, user.enrollYear);
    const ids = new Map(members.map(member => [this.users.getMemberKey(member.id), member.id]));
    const counts = await this.failedCounts(user.teamId, members.map(member => member.id));
    let previous: number | undefined, rank = 0;
    const items = rows.map((row, index) => {
      if (previous !== row.totalDurationSeconds) rank = index + 1; previous = row.totalDurationSeconds;
      const goal = weeklyGoalSeconds(row.enrollYear);
      return { memberKey: row.memberKey, displayName: row.displayName, username: row.username, enrollYear: row.enrollYear,
        rank, totalDurationSeconds: row.totalDurationSeconds, recordedDurationSeconds: row.recordedDurationSeconds,
        manualAdjustmentSeconds: row.manualAdjustmentSeconds, entertainmentSeconds: row.entertainmentSeconds ?? 0,
        weeklyGoalSeconds: goal, assessmentComplete: row.totalDurationSeconds >= goal, failedWeeksCount: counts.get(ids.get(row.memberKey) ?? '') ?? 0 };
    });
    return { enabled: Boolean(this.settings.startWeek), startWeek: this.settings.startWeek, week: getWeekKey(new Date()),
      settlementNote: this.settings.startWeek ? '从启用后首次登记参与；首次登记当周免考，因此最早下一个完整周产生结果。停用成员豁免，缺少完整观测保持待核实，周结束五小时后结算。' : '历史考核尚未启用，不记录未完成周；等待确认起算周。', items };
  }

  async history(user: AuthUser, memberKey: string, before?: string, limit = 20): Promise<AssessmentMemberHistory> {
    const member = await this.users.findByMemberKey(memberKey);
    if (!member) throw new NotFoundException('成员不存在');
    if (member.teamId !== user.teamId) throw new ForbiddenException('不可查看其他团队成员考核');
    if (before) { try { validateAssessmentStartWeek(before); } catch { throw new BadRequestException('before 必须为北京时间周一 yyyy-MM-dd'); } }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit 必须为 1 至 100 的整数');
    const match = { teamId: user.teamId, ...(before ? { weekKey: { $lt: before } } : {}), [`state.outcomes.${member.id}.status`]: 'failed' };
    const rows = await this.weeks.find(match).sort({ weekKey: -1 }).limit(limit + 1).lean().exec();
    const counts = await this.failedCounts(user.teamId, [member.id]);
    const items = rows.slice(0, limit).map(row => {
      const outcome = row.state.outcomes[member.id];
      return { weekKey: row.weekKey, weekEnd: new Date(row.state.endsAt).toISOString(),
        assessmentDate: DateTime.fromISO(row.weekKey, { zone: 'Asia/Shanghai' }).plus({ days: 6 }).toFormat('yyyy-MM-dd'), goalSeconds: outcome.goalSeconds!,
        recordedDurationSeconds: outcome.rawSeconds!, manualAdjustmentSeconds: outcome.manualSeconds!, entertainmentSeconds: outcome.entertainmentSeconds!,
        totalDurationSeconds: outcome.comprehensiveSeconds!, shortfallSeconds: outcome.goalSeconds! - outcome.comprehensiveSeconds!, settledAt: new Date(outcome.settledAt!).toISOString() };
    });
    return { member: { memberKey, displayName: member.displayName }, failedWeeksCount: counts.get(member.id) ?? 0, items,
      nextCursor: rows.length > limit ? items[items.length - 1].weekKey : null };
  }

  myHistory(user: AuthUser, before?: string, limit?: number) { return this.history(user, this.users.getMemberKey(user.userId), before, limit); }
}

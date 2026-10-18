import { ConflictException, ServiceUnavailableException, Injectable, BadRequestException, ForbiddenException, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { AttendanceAdjustmentBucket, AttendanceAdjustmentBucketDocument } from './schemas/attendance-adjustment-bucket.schema';
import { AttendanceSession, AttendanceSessionDocument } from './schemas/attendance-session.schema';
import {
  AttendanceDurationAdjustment,
  AttendanceDurationAdjustmentDocument,
  type AttendanceDurationAdjustmentOperation
} from './schemas/attendance-duration-adjustment.schema';
import { NetworkPolicyService } from '../network-policy/network-policy.service';
import { UsersService } from '../users/users.service';
import {
  ERROR_CODES,
  ATTENDANCE_MAX_SECONDS,
  weeklyGoalSeconds
} from '@lecpunch/shared';
import { getShanghaiDateRange, getWeekKey, getIsoWeekKey, parseIsoWeekKey } from '../../common/utils/time.util';
import type { AuthUser } from '../auth/types/auth-user.type';
import { PointsService } from '../points/points.service';
import type { AdjustCurrentWeekDurationDto } from './dto/adjust-current-week-duration.dto';

type DurationAdjustmentSummaryItem = {
  adjustmentId: string;
  operation: AttendanceDurationAdjustmentOperation;
  durationSeconds: number;
  signedDurationSeconds: number;
  reason: string | null;
  createdAt: string;
};

type DurationAdjustmentAggregate = {
  manualAdjustmentSeconds: number;
  adjustmentsCount: number;
};

@Injectable()
export class AttendanceService {


  constructor(
    @InjectModel(AttendanceSession.name)
    private readonly attendanceModel: Model<AttendanceSessionDocument>,
    @InjectModel(AttendanceDurationAdjustment.name)
    private readonly attendanceDurationAdjustmentModel: Model<AttendanceDurationAdjustmentDocument>,
    private readonly networkPolicyService: NetworkPolicyService,
    private readonly usersService: UsersService,
    @Optional() private readonly pointsService?: PointsService,
    @Optional() @InjectModel(AttendanceAdjustmentBucket.name)
    private readonly adjustmentBucketModel?: Model<AttendanceAdjustmentBucketDocument>
  ) {}

  async getCurrentSession(userId: string) {
    const session = await this.findActiveSession(userId);
    if (!session) {
      return null;
    }

    const now = new Date();
    const isOvertime = await this.invalidateSessionIfOvertime(session, now);
    if (isOvertime) {
      return null;
    }

    const baseSession = typeof session.toObject === 'function' ? session.toObject() : session;

    return {
      ...baseSession,
      id: session.id,
      isPaused: false,
      elapsedSeconds: this.getElapsedSeconds(session, now)
    };
  }

  async checkIn(user: AuthUser, clientIp: string) {
    await this.networkPolicyService.assertIpAllowed(user.teamId, clientIp);
    const existing = await this.findActiveSession(user.userId);
    if (existing) {
      throw new BadRequestException({
        code: ERROR_CODES.ATTENDANCE_ALREADY_CHECKED_IN,
        message: '当前已有进行中的打卡'
      });
    }

    const now = new Date();
    let session: AttendanceSessionDocument;
    try {
      session = await this.attendanceModel.create({
        teamId: user.teamId,
        userId: user.userId,
        checkInAt: now,
        status: 'active',
        sourceIpAtCheckIn: clientIp,
        weekKey: getWeekKey(now),
        weeklyGoalSecondsSnapshot: weeklyGoalSeconds(user.enrollYear)
      });
    } catch (error) {
      // A second request may pass findActiveSession before the first insert is
      // visible. MongoDB's partial unique index is the source of truth here.
      if (this.isDuplicateActiveSessionError(error)) {
        throw new BadRequestException({
          code: ERROR_CODES.ATTENDANCE_ALREADY_CHECKED_IN,
          message: '当前已有进行中的打卡'
        });
      }
      throw error;
    }

    return session;
  }

  async checkOut(user: AuthUser, clientIp: string) {
    const session = await this.findActiveSession(user.userId);
    if (!session) {
      throw new BadRequestException({
        code: ERROR_CODES.ATTENDANCE_NO_ACTIVE_SESSION,
        message: '当前没有进行中的打卡'
      });
    }

    const checkOutAt = new Date();

    await this.networkPolicyService.assertIpAllowed(user.teamId, clientIp);

    const isOvertime = await this.invalidateSessionIfOvertime(session, checkOutAt, clientIp);
    if (isOvertime) {
      return session;
    }

    const durationSeconds = this.getElapsedSeconds(session, checkOutAt);
    session.status = 'completed';
    session.durationSeconds = durationSeconds;
    session.checkOutAt = checkOutAt;
    session.sourceIpAtCheckOut = clientIp;
    await session.save();
    await this.syncSessionPoints(session, durationSeconds);
    return session;
  }

  /**
   * Kept temporarily for older clients. It is deliberately a read-only
   * compatibility endpoint: attendance duration and active status no longer
   * depend on browser or desktop heartbeats.
   */
  async keepAlive(user: AuthUser) {
    const session = await this.findActiveSession(user.userId);
    if (!session) {
      throw new BadRequestException({
        code: ERROR_CODES.ATTENDANCE_NO_ACTIVE_SESSION,
        message: '当前没有进行中的打卡'
      });
    }

    const now = new Date();
    const isOvertime = await this.invalidateSessionIfOvertime(session, now);
    if (isOvertime) {
      throw this.createSessionInvalidatedException();
    }
    return session;
  }

  async getMyWeeklySummary(user: AuthUser, isoWeekKey: string) {
    const monday = parseIsoWeekKey(isoWeekKey);
    if (!monday) {
      throw new BadRequestException({
        code: 'ATTENDANCE_WEEK_INVALID',
        message: 'week must be a valid ISO week in YYYY-Www format'
      });
    }

    const attendanceWeekKey = monday.toFormat('yyyy-LL-dd');
    const [rows, adjustments] = await Promise.all([
      this.attendanceModel
      .aggregate<{ _id: string; focusedSeconds: number; sessions: number }>([
        {
          $match: {
            teamId: user.teamId,
            userId: user.userId,
            weekKey: attendanceWeekKey,
            status: { $ne: 'active' }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$checkInAt',
                timezone: 'Asia/Shanghai'
              }
            },
            focusedSeconds: { $sum: { $ifNull: ['$durationSeconds', 0] } },
            sessions: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
      .exec(),
      this.listWeekDurationAdjustments(user.teamId, user.userId, attendanceWeekKey)
    ]);

    const days = rows.map((row) => ({
      date: row._id,
      focusedMinutes: Math.floor((row.focusedSeconds ?? 0) / 60),
      sessions: row.sessions ?? 0,
      points: Math.floor((row.focusedSeconds ?? 0) / 60)
    }));

    const recordedFocusedSeconds = rows.reduce((total, row) => total + (row.focusedSeconds ?? 0), 0);
    const manualAdjustmentSeconds = adjustments.reduce(
      (total, adjustment) => total + adjustment.signedDurationSeconds,
      0
    );
    const effectiveFocusedSeconds = Math.max(0, recordedFocusedSeconds + manualAdjustmentSeconds);
    const totalFocusedMinutes = Math.floor(effectiveFocusedSeconds / 60);

    return {
      week: isoWeekKey,
      totalFocusedMinutes,
      totalPoints: Math.floor(recordedFocusedSeconds / 60),
      rawFocusedMinutes: Math.floor(recordedFocusedSeconds / 60),
      adjustedMinutes: Math.trunc(manualAdjustmentSeconds / 60),
      adjustmentsCount: adjustments.length,
      checkedInDays: days.length,
      days,
      adjustments: adjustments.map(({ adjustmentId: _adjustmentId, signedDurationSeconds: _signed, ...item }) => item)
    };
  }

  private async adjustmentTarget(currentUser: AuthUser, input: { userId?: string; username?: string }) {
    const target = input.userId ? await this.usersService.findById(input.userId)
      : input.username ? await this.usersService.findByUsername(input.username.trim().toLowerCase()) : null;
    if (!target) throw new NotFoundException({ code: 'ATTENDANCE_ADJUSTMENT_USER_NOT_FOUND', message: '请选择有效成员' });
    if (target.teamId !== currentUser.teamId) throw new ForbiddenException({ code: ERROR_CODES.ATTENDANCE_CROSS_TEAM_FORBIDDEN, message: '不可调整其他团队成员' });
    if (input.userId && input.username && target.username !== input.username.trim().toLowerCase()) throw new BadRequestException('成员 ID 与用户名不一致');
    if (target.status !== 'active') throw new BadRequestException('不可调整已停用成员');
    return target;
  }

  async adjustmentContext(currentUser: AuthUser, userId: string) {
    const target = await this.adjustmentTarget(currentUser, { userId });
    const now = new Date();
    const weekKey = getWeekKey(now);
    const [recorded, adjustment] = await Promise.all([
      this.getRecordedWeekDurationSeconds(currentUser.teamId, target.id, weekKey),
      this.getManualAdjustmentSeconds(currentUser.teamId, target.id, weekKey)
    ]);
    return { userId: target.id, weekKey, isoWeek: getIsoWeekKey(now), recordedDurationSeconds: recorded, manualAdjustmentSeconds: adjustment,
      totalDurationSeconds: recorded + adjustment };
  }

  async adjustCurrentWeekDuration(currentUser: AuthUser, input: AdjustCurrentWeekDurationDto) {
    if (!this.adjustmentBucketModel) throw new ServiceUnavailableException('时长调整存储尚未配置');
    const target = await this.adjustmentTarget(currentUser, input);
    const weekKey = getWeekKey(new Date());
    if (input.expectedWeekKey && input.expectedWeekKey !== weekKey) throw new ConflictException('周次已变化，请刷新后重新确认');
    if (input.requestKey && !input.reason?.trim()) throw new BadRequestException('调整原因不能为空');
    const key = `${currentUser.userId}:${input.requestKey ?? randomUUID()}`;
    const hash = createHash('sha256').update(JSON.stringify({ operation: input.operation, seconds: input.durationSeconds,
      reason: input.reason?.trim() ?? '' })).digest('hex');
    const scope = { teamId: currentUser.teamId, userId: target.id, weekKey };
    try {
      await this.adjustmentBucketModel.updateOne(scope, { $setOnInsert: { version: 0, entries: [] } }, { upsert: true }).exec();
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    for (let attempt = 0; attempt < 20; attempt++) {
      const bucket = await this.adjustmentBucketModel.findOne(scope).exec();
      if (!bucket) throw new ServiceUnavailableException('时长调整状态不可用');
      const previous = bucket.entries.find(entry => entry.requestKey === key);
      if (previous) {
        if (previous.requestHash !== hash) throw new ConflictException('同一请求标识不能提交不同调整');
        return { ...previous, adjustmentId: previous.id, userId: target.id, displayName: target.displayName, weekKey };
      }
      if (bucket.entries.length >= 2000) throw new BadRequestException('本周调整次数达到上限，请联系维护者');
      const [recorded, legacy] = await Promise.all([
        this.getRecordedWeekDurationSeconds(scope.teamId, target.id, weekKey),
        this.getLegacyAdjustmentSeconds(scope.teamId, target.id, weekKey)
      ]);
      const before = recorded + legacy + bucket.entries.reduce((n, e) => n + e.signedDurationSeconds, 0);
      if (before < 0 && input.operation !== 'add') throw new ConflictException('余额异常，只能增加时长补正至非负');
      const delta = input.operation === 'add' ? input.durationSeconds : -input.durationSeconds;
      if (before + delta < 0) throw new BadRequestException({ code: 'ATTENDANCE_DURATION_CANNOT_BE_NEGATIVE', message: '扣减后的当前周打卡时长不能低于 0' });
      const entry = { id: new Types.ObjectId().toString(), requestKey: key, requestHash: hash,
        username: target.username, operation: input.operation, durationSeconds: input.durationSeconds,
        signedDurationSeconds: delta, previousDurationSeconds: before, resultingDurationSeconds: before + delta,
        reason: input.reason?.trim(), createdBy: currentUser.userId, createdAt: new Date() };
      // Effective adjustment, audit and retry result are committed in one standalone-Mongo write.
      const saved = await this.adjustmentBucketModel.findOneAndUpdate({ ...scope, version: bucket.version },
        { $inc: { version: 1 }, $push: { entries: entry } }, { new: true }).exec();
      if (saved) return { ...entry, adjustmentId: entry.id, userId: target.id, displayName: target.displayName, weekKey };
    }
    throw new ConflictException('其他管理员正在调整，请使用原请求重试');
  }

  private async newAdjustments(match: Record<string, unknown>) {
    if (!this.adjustmentBucketModel) return [];
    const buckets = await this.adjustmentBucketModel.find(match).lean().exec();
    return buckets.flatMap(bucket => bucket.entries.map(entry => ({ ...entry, userId: bucket.userId,
      teamId: bucket.teamId, weekKey: bucket.weekKey })));
  }

  async setTeamRecordMarked(
    teamId: string,
    recordId: string,
    isMarked: boolean
  ): Promise<{ record: AttendanceSessionDocument; changed: boolean }> {
    const updated = await this.attendanceModel.findOneAndUpdate(
      { _id: recordId, teamId, isMarked: { $ne: isMarked } },
      { $set: { isMarked } },
      { new: true }
    );

    if (updated) {
      return { record: updated, changed: true };
    }

    const record = await this.attendanceModel.findOne({ _id: recordId, teamId }).exec();
    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    return { record, changed: false };
  }

  async deleteCompletedTeamRecord(teamId: string, recordId: string) {
    const record = await this.attendanceModel.findOne({ _id: recordId, teamId }).exec();

    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    if (record.status === 'active') {
      throw new BadRequestException({
        code: 'ADMIN_ACTIVE_RECORD_DELETE_FORBIDDEN',
        message: 'Active attendance records cannot be deleted'
      });
    }

    await record.deleteOne();
  }

  listUserRecords(
    userId: string,
    filters: { weekKey?: string; startDate?: string; endDate?: string },
    options: { page: number; pageSize: number }
  ) {
    const query: Record<string, unknown> = { userId };
    if (filters.weekKey) {
      query.weekKey = filters.weekKey;
    } else if (filters.startDate || filters.endDate) {
      query.checkInAt = getShanghaiDateRange(filters.startDate, filters.endDate);
    }

    const { page, pageSize } = options;
    return this.attendanceModel
      .find(query)
      .sort({ checkInAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .exec();
  }

  listTeamRecords(teamId: string, filters: { weekKey?: string; startDate?: string; endDate?: string }) {
    const query: Record<string, unknown> = { teamId };
    if (filters.weekKey) {
      query.weekKey = filters.weekKey;
    } else if (filters.startDate || filters.endDate) {
      query.checkInAt = getShanghaiDateRange(filters.startDate, filters.endDate);
    }
    return this.attendanceModel.find(query).sort({ checkInAt: -1 }).exec();
  }

  async listTeamActiveSessions(teamId: string) {
    const sessions = await this.attendanceModel.find({ teamId, status: 'active' }).sort({ checkInAt: 1 }).exec();
    const now = new Date();
    const checkedSessions = await Promise.all(
      sessions.map(async (session) => ((await this.invalidateSessionIfOvertime(session, now)) ? null : session))
    );
    const activeSessions = checkedSessions.filter(Boolean) as AttendanceSessionDocument[];

    const users = await this.usersService.findByIds(activeSessions.map((session) => session.userId));
    const userMap = new Map(users.map((user) => [user.id, user]));

    return activeSessions.map((session) => {
      const user = userMap.get(session.userId);

      return {
        memberKey: this.usersService.getMemberKey(session.userId),
        displayName: user?.displayName ?? '未知成员',
        username: user?.username,
        realName: user?.realName,
        avatarUrl: user?.avatarUrl,
        enrollYear: user?.enrollYear ?? 0,
        avatarColor: user?.avatarColor,
        avatarEmoji: user?.avatarEmoji,
        avatarBase64: user?.avatarBase64,
        checkInAt: session.checkInAt,
        elapsedSeconds: this.getElapsedSeconds(session, now),
        weekKey: session.weekKey
      };
    });
  }

  getModel() {
    return this.attendanceModel;
  }

  private async getRecordedWeekDurationSeconds(teamId: string, userId: string, weekKey: string) {
    const rows = await this.attendanceModel
      .aggregate<{ totalSeconds: number }>([
        { $match: { teamId, userId, weekKey, status: { $ne: 'active' } } },
        {
          $group: {
            _id: null,
            totalSeconds: { $sum: { $ifNull: ['$durationSeconds', 0] } }
          }
        }
      ])
      .exec();

    return rows[0]?.totalSeconds ?? 0;
  }

  private async getManualAdjustmentSeconds(teamId: string, userId: string, weekKey: string) {
    const [legacy, entries] = await Promise.all([this.getLegacyAdjustmentSeconds(teamId, userId, weekKey), this.newAdjustments({ teamId, userId, weekKey })]);
    return legacy + entries.reduce((n, entry) => n + entry.signedDurationSeconds, 0);
  }

  private async getLegacyAdjustmentSeconds(teamId: string, userId: string, weekKey: string) {
    const rows = await this.attendanceDurationAdjustmentModel
      .aggregate<{ totalSeconds: number }>([
        { $match: { teamId, userId, weekKey } },
        {
          $group: {
            _id: null,
            totalSeconds: {
              $sum: {
                $cond: [
                  { $eq: ['$operation', 'add'] },
                  '$durationSeconds',
                  { $multiply: ['$durationSeconds', -1] }
                ]
              }
            }
          }
        }
      ])
      .exec();

    return rows[0]?.totalSeconds ?? 0;
  }

  /**
   * Returns signed adjustment totals without changing the immutable attendance
   * sessions. Every display/report aggregate must add this value to the raw
   * attendance duration; points deliberately continue to use raw duration.
   */
  async getManualAdjustmentSummaries(teamId: string, userIds?: string[]) {
    const match: Record<string, unknown> = { teamId };
    if (userIds?.length) {
      match.userId = { $in: userIds };
    }

    const rows = await this.attendanceDurationAdjustmentModel
      .aggregate<{ _id: { userId: string; weekKey: string }; totalSeconds: number; adjustmentsCount: number }>([
        { $match: match },
        {
          $group: {
            _id: { userId: '$userId', weekKey: '$weekKey' },
            totalSeconds: { $sum: '$signedDurationSeconds' },
            adjustmentsCount: { $sum: 1 }
          }
        }
      ])
      .exec();

    const result = new Map<string, DurationAdjustmentAggregate>(
      rows.map((row) => [
        `${row._id.userId}:${row._id.weekKey}`,
        { manualAdjustmentSeconds: row.totalSeconds, adjustmentsCount: row.adjustmentsCount }
      ])
    );
    for (const entry of await this.newAdjustments(match)) {
      const key = `${entry.userId}:${entry.weekKey}`;
      const current = result.get(key) ?? { manualAdjustmentSeconds: 0, adjustmentsCount: 0 };
      result.set(key, { manualAdjustmentSeconds: current.manualAdjustmentSeconds + entry.signedDurationSeconds, adjustmentsCount: current.adjustmentsCount + 1 });
    }
    return result;
  }

  private async listWeekDurationAdjustments(
    teamId: string,
    userId: string,
    weekKey: string
  ): Promise<DurationAdjustmentSummaryItem[]> {
    const adjustments = await this.attendanceDurationAdjustmentModel
      .find({ teamId, userId, weekKey })
      .sort({ createdAt: 1 })
      .exec();

    const combined = [...adjustments, ...await this.newAdjustments({ teamId, userId, weekKey })];
    return combined.sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()).map((adjustment) => ({
      adjustmentId: adjustment.id,
      operation: adjustment.operation as AttendanceDurationAdjustmentOperation,
      durationSeconds: adjustment.durationSeconds,
      signedDurationSeconds: adjustment.signedDurationSeconds,
      reason: adjustment.reason ?? null,
      createdAt: adjustment.createdAt?.toISOString() ?? ''
    }));
  }

  async getWeekDurationAdjustmentsForUsers(teamId: string, userIds: string[], weekKey: string) {
    if (userIds.length === 0) {
      return new Map<string, DurationAdjustmentSummaryItem[]>();
    }

    const adjustments = await this.attendanceDurationAdjustmentModel
      .find({ teamId, userId: { $in: userIds }, weekKey })
      .sort({ createdAt: 1 })
      .exec();
    const itemsByUserId = new Map<string, DurationAdjustmentSummaryItem[]>();

    for (const adjustment of [...adjustments, ...await this.newAdjustments({ teamId, userId: { $in: userIds }, weekKey })]) {
      const items = itemsByUserId.get(adjustment.userId) ?? [];
      items.push({
        adjustmentId: adjustment.id,
        operation: adjustment.operation as AttendanceDurationAdjustmentOperation,
        durationSeconds: adjustment.durationSeconds,
        signedDurationSeconds: adjustment.signedDurationSeconds,
        reason: adjustment.reason ?? null,
        createdAt: adjustment.createdAt?.toISOString() ?? ''
      });
      itemsByUserId.set(adjustment.userId, items);
    }

    return itemsByUserId;
  }

  async listTeamWeekDurationAdjustments(teamId: string, isoWeekKey: string) {
    const monday = parseIsoWeekKey(isoWeekKey);
    if (!monday) {
      throw new BadRequestException({
        code: 'ATTENDANCE_WEEK_INVALID',
        message: 'week must be a valid ISO week in YYYY-Www format'
      });
    }
    const weekKey = monday.toFormat('yyyy-LL-dd');
    const adjustments = await this.attendanceDurationAdjustmentModel
      .find({ teamId, weekKey })
      .sort({ createdAt: -1 })
      .exec();
    const combined = [...adjustments, ...await this.newAdjustments({ teamId, weekKey })];
    combined.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    const users = await this.usersService.findByIds([...new Set(combined.flatMap((item) => [item.userId, item.createdBy]))]);
    const userById = new Map(users.map((item) => [item.id, item]));

    return {
      week: isoWeekKey,
      items: combined.map((adjustment) => {
        const member = userById.get(adjustment.userId);
        return {
          adjustmentId: adjustment.id,
          userId: adjustment.userId,
          username: adjustment.username,
          displayName: member?.displayName ?? adjustment.username,
          operation: adjustment.operation as AttendanceDurationAdjustmentOperation,
          durationSeconds: adjustment.durationSeconds,
          signedDurationSeconds: adjustment.signedDurationSeconds,
          reason: adjustment.reason ?? null,
          createdBy: adjustment.createdBy,
          createdByDisplayName: userById.get(adjustment.createdBy)?.displayName ?? '历史管理员',
          createdAt: adjustment.createdAt?.toISOString() ?? ''
        };
      })
    };
  }

  private findActiveSession(userId: string) {
    return this.attendanceModel.findOne({ userId, status: 'active' }).exec();
  }

  private getElapsedSeconds(session: AttendanceSessionDocument, at = new Date()) {
    return Math.max(0, Math.floor((at.getTime() - session.checkInAt.getTime()) / 1000));
  }

  private hasExceededMaxNaturalDuration(session: AttendanceSessionDocument, now: Date) {
    const naturalDurationSeconds = Math.max(0, Math.floor((now.getTime() - session.checkInAt.getTime()) / 1000));
    return naturalDurationSeconds >= ATTENDANCE_MAX_SECONDS;
  }

  private async invalidateSessionIfOvertime(
    session: AttendanceSessionDocument,
    now: Date,
    sourceIpAtCheckOut?: string
  ) {
    if (!this.hasExceededMaxNaturalDuration(session, now)) {
      return false;
    }

    session.status = 'invalidated';
    session.durationSeconds = 0;
    session.invalidReason = 'overtime_5h';
    session.checkOutAt ??= now;
    if (sourceIpAtCheckOut) {
      session.sourceIpAtCheckOut = sourceIpAtCheckOut;
    }
    await session.save();
    await this.syncSessionPoints(session, 0);
    return true;
  }

  private createSessionInvalidatedException() {
    return new BadRequestException({
      code: ERROR_CODES.ATTENDANCE_SESSION_INVALIDATED,
      message: '当前打卡已失效，请重新上卡'
    });
  }

  private isDuplicateActiveSessionError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      Number((error as { code?: unknown }).code) === 11000
    );
  }

  private async syncSessionPoints(session: AttendanceSessionDocument, durationSeconds: number) {
    await this.pointsService?.syncAttendancePoints({
      teamId: session.teamId,
      userId: session.userId,
      attendanceSessionId: session.id,
      weekKey: session.weekKey,
      durationSeconds,
      isValid: session.status === 'completed'
    });
  }
}

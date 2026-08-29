import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AttendanceSession, AttendanceSessionDocument } from './schemas/attendance-session.schema';
import { NetworkPolicyService } from '../network-policy/network-policy.service';
import { UsersService } from '../users/users.service';
import {
  ERROR_CODES,
  ATTENDANCE_KEEPALIVE_TIMEOUT_SECONDS,
  ATTENDANCE_MAX_SECONDS,
  weeklyGoalSeconds,
  type AttendancePauseReason
} from '@lecpunch/shared';
import { getShanghaiDateRange, getWeekKey } from '../../common/utils/time.util';
import type { AuthUser } from '../auth/types/auth-user.type';
import { PointsService } from '../points/points.service';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectModel(AttendanceSession.name)
    private readonly attendanceModel: Model<AttendanceSessionDocument>,
    private readonly networkPolicyService: NetworkPolicyService,
    private readonly usersService: UsersService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly pointsService?: PointsService
  ) {}

  async getCurrentSession(userId: string) {
    const session = await this.findActiveSession(userId);
    if (!session) {
      return null;
    }

    if (!this.isBalancedAccountingEnabled()) {
      const activeSession = await this.invalidateStaleSessionIfNeeded(session);
      if (!activeSession) {
        return null;
      }

      const baseSession = typeof activeSession.toObject === 'function' ? activeSession.toObject() : activeSession;
      return {
        ...baseSession,
        id: activeSession.id,
        elapsedSeconds: this.getLegacyElapsedSeconds(activeSession)
      };
    }

    const now = new Date();
    const isOvertime = await this.invalidateSessionIfOvertime(session, now);
    if (isOvertime) {
      return null;
    }

    const changed = this.pauseForHeartbeatTimeoutIfNeeded(session, now);
    if (changed) {
      await session.save();
    }

    const baseSession = typeof session.toObject === 'function' ? session.toObject() : session;

    return {
      ...baseSession,
      id: session.id,
      isPaused: this.isSessionPaused(session),
      elapsedSeconds: this.getBalancedDisplayElapsedSeconds(session)
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
    const session = await this.attendanceModel.create({
      teamId: user.teamId,
      userId: user.userId,
      checkInAt: now,
      lastKeepaliveAt: now,
      lastCreditedAt: now,
      creditedSeconds: 0,
      segmentsCount: 0,
      status: 'active',
      sourceIpAtCheckIn: clientIp,
      weekKey: getWeekKey(now),
      weeklyGoalSecondsSnapshot: weeklyGoalSeconds(user.enrollYear)
    });

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

    if (!this.isBalancedAccountingEnabled()) {
      await this.networkPolicyService.assertIpAllowed(user.teamId, clientIp);
      const activeSession = await this.invalidateStaleSessionIfNeeded(session);
      if (!activeSession) {
        throw this.createSessionInvalidatedException();
      }

      const durationSeconds = Math.floor((checkOutAt.getTime() - activeSession.checkInAt.getTime()) / 1000);
      if (durationSeconds >= ATTENDANCE_MAX_SECONDS) {
        activeSession.status = 'invalidated';
        activeSession.durationSeconds = 0;
        activeSession.invalidReason = 'overtime_5h';
      } else {
        activeSession.status = 'completed';
        activeSession.durationSeconds = durationSeconds;
      }

      activeSession.checkOutAt = checkOutAt;
      activeSession.sourceIpAtCheckOut = clientIp;
      await activeSession.save();
      await this.syncSessionPoints(activeSession, durationSeconds);
      return activeSession;
    }

    await this.assertIpAllowedAndPauseOnFailure(user, clientIp, session);

    const isOvertime = await this.invalidateSessionIfOvertime(session, checkOutAt, clientIp);
    if (isOvertime) {
      return session;
    }

    this.pauseForHeartbeatTimeoutIfNeeded(session, checkOutAt);
    if (!this.isSessionPaused(session)) {
      this.creditSlice(session, checkOutAt);
    }

    const durationSeconds = Math.max(0, Math.floor((checkOutAt.getTime() - session.checkInAt.getTime()) / 1000));
    session.status = 'completed';
    session.durationSeconds = durationSeconds;
    session.checkOutAt = checkOutAt;
    session.sourceIpAtCheckOut = clientIp;
    await session.save();
    await this.syncSessionPoints(session, this.getCreditedSeconds(session));
    return session;
  }

  async keepAlive(user: AuthUser, clientIp: string) {
    const session = await this.findActiveSession(user.userId);
    if (!session) {
      throw new BadRequestException({
        code: ERROR_CODES.ATTENDANCE_NO_ACTIVE_SESSION,
        message: '当前没有进行中的打卡'
      });
    }

    if (!this.isBalancedAccountingEnabled()) {
      await this.networkPolicyService.assertIpAllowed(user.teamId, clientIp);
      const activeSession = await this.invalidateStaleSessionIfNeeded(session);
      if (!activeSession) {
        throw this.createSessionInvalidatedException();
      }

      activeSession.lastKeepaliveAt = new Date();
      await activeSession.save();
      return activeSession;
    }

    const now = new Date();

    const isOvertime = await this.invalidateSessionIfOvertime(session, now);
    if (isOvertime) {
      throw this.createSessionInvalidatedException();
    }

    await this.assertIpAllowedAndPauseOnFailure(user, clientIp, session);

    const pausedByTimeout = this.pauseForHeartbeatTimeoutIfNeeded(session, now);
    const wasPaused = pausedByTimeout || this.isSessionPaused(session);

    if (wasPaused) {
      this.clearPauseState(session);
      this.setLastCreditedAt(session, now);
    } else {
      this.creditSlice(session, now);
    }

    session.lastKeepaliveAt = now;
    await session.save();
    await this.syncSessionPoints(session, this.getCreditedSeconds(session));
    return session;
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
    let activeSessions: AttendanceSessionDocument[] = [];

    if (!this.isBalancedAccountingEnabled()) {
      const legacySessions = await Promise.all(sessions.map((session) => this.invalidateStaleSessionIfNeeded(session)));
      activeSessions = legacySessions.filter(Boolean) as AttendanceSessionDocument[];
    } else {
      const balancedSessions = await Promise.all(
        sessions.map(async (session) => {
          const now = new Date();
          const overtime = await this.invalidateSessionIfOvertime(session, now);
          if (overtime) {
            return null;
          }

          const changed = this.pauseForHeartbeatTimeoutIfNeeded(session, now);
          if (changed) {
            await session.save();
          }

          if (this.isSessionPaused(session)) {
            return null;
          }

          return session;
        })
      );
      activeSessions = balancedSessions.filter(Boolean) as AttendanceSessionDocument[];
    }

    const users = await this.usersService.findByIds(activeSessions.map((session) => session.userId));
    const userMap = new Map(users.map((user) => [user.id, user]));

    return activeSessions.map((session) => {
      const user = userMap.get(session.userId);

      return {
        memberKey: this.usersService.getMemberKey(session.userId),
        displayName: user?.displayName ?? '未知成员',
        enrollYear: user?.enrollYear ?? 0,
        avatarColor: user?.avatarColor,
        avatarEmoji: user?.avatarEmoji,
        avatarBase64: user?.avatarBase64,
        checkInAt: session.checkInAt,
        elapsedSeconds: this.isBalancedAccountingEnabled()
          ? this.getBalancedDisplayElapsedSeconds(session)
          : this.getLegacyElapsedSeconds(session),
        weekKey: session.weekKey
      };
    });
  }

  getModel() {
    return this.attendanceModel;
  }

  private findActiveSession(userId: string) {
    return this.attendanceModel.findOne({ userId, status: 'active' }).exec();
  }

  private getLegacyElapsedSeconds(session: AttendanceSessionDocument) {
    return Math.max(0, Math.floor((Date.now() - session.checkInAt.getTime()) / 1000));
  }

  private getBalancedDisplayElapsedSeconds(session: AttendanceSessionDocument) {
    const creditedSeconds = this.getCreditedSeconds(session);
    if (this.isSessionPaused(session)) {
      return creditedSeconds;
    }

    const lastCreditedAt = this.getLastCreditedAt(session);
    const liveSliceSeconds = Math.max(0, Math.floor((Date.now() - lastCreditedAt.getTime()) / 1000));
    return creditedSeconds + liveSliceSeconds;
  }

  private async invalidateStaleSessionIfNeeded(session: AttendanceSessionDocument) {
    const lastKeepaliveAt = session.lastKeepaliveAt ?? session.checkInAt;
    const timeoutMs = ATTENDANCE_KEEPALIVE_TIMEOUT_SECONDS * 1000;

    if (Date.now() - lastKeepaliveAt.getTime() < timeoutMs) {
      return session;
    }

    session.status = 'invalidated';
    session.durationSeconds = 0;
    session.invalidReason = 'heartbeat_timeout';
    session.checkOutAt ??= new Date();
    await session.save();
    await this.syncSessionPoints(session, 0);
    return null;
  }

  private isBalancedAccountingEnabled() {
    return this.configService?.get<boolean>('ATTENDANCE_BALANCED_ACCOUNTING_ENABLED', true) ?? true;
  }

  private getCreditedSeconds(session: AttendanceSessionDocument) {
    return Math.max(0, session.creditedSeconds ?? 0);
  }

  private setLastCreditedAt(session: AttendanceSessionDocument, at: Date) {
    session.lastCreditedAt = at;
  }

  private getLastCreditedAt(session: AttendanceSessionDocument) {
    return session.lastCreditedAt ?? session.checkInAt;
  }

  private isSessionPaused(session: AttendanceSessionDocument) {
    return Boolean(session.pauseReason || session.pausedAt);
  }

  private pauseForHeartbeatTimeoutIfNeeded(session: AttendanceSessionDocument, now: Date) {
    if (this.isSessionPaused(session)) {
      return false;
    }

    const timeoutMs = ATTENDANCE_KEEPALIVE_TIMEOUT_SECONDS * 1000;
    const lastKeepaliveAt = session.lastKeepaliveAt ?? session.checkInAt;
    if (now.getTime() - lastKeepaliveAt.getTime() <= timeoutMs) {
      return false;
    }

    return this.markPaused(session, 'heartbeat_timeout', now);
  }

  private markPaused(session: AttendanceSessionDocument, reason: AttendancePauseReason, pausedAt: Date) {
    let changed = false;
    if (session.pauseReason !== reason) {
      session.pauseReason = reason;
      changed = true;
    }
    if (!session.pausedAt) {
      session.pausedAt = pausedAt;
      changed = true;
    }
    return changed;
  }

  private clearPauseState(session: AttendanceSessionDocument) {
    let changed = false;
    if (session.pauseReason !== undefined) {
      session.pauseReason = undefined;
      changed = true;
    }
    if (session.pausedAt !== undefined) {
      session.pausedAt = undefined;
      changed = true;
    }
    return changed;
  }

  private creditSlice(session: AttendanceSessionDocument, now: Date) {
    const lastCreditedAt = this.getLastCreditedAt(session);
    const deltaSeconds = Math.max(0, Math.floor((now.getTime() - lastCreditedAt.getTime()) / 1000));
    if (deltaSeconds > 0) {
      session.creditedSeconds = this.getCreditedSeconds(session) + deltaSeconds;
      session.segmentsCount = (session.segmentsCount ?? 0) + 1;
    }

    this.setLastCreditedAt(session, now);
    return deltaSeconds;
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

  private async assertIpAllowedAndPauseOnFailure(user: AuthUser, clientIp: string, session: AttendanceSessionDocument) {
    try {
      await this.networkPolicyService.assertIpAllowed(user.teamId, clientIp);
    } catch (error) {
      if (this.markPaused(session, 'network_not_allowed', new Date())) {
        await session.save();
      }
      throw error;
    }
  }

  private createSessionInvalidatedException() {
    return new BadRequestException({
      code: ERROR_CODES.ATTENDANCE_SESSION_INVALIDATED,
      message: '当前打卡已失效，请重新上卡'
    });
  }

  private async syncSessionPoints(session: AttendanceSessionDocument, creditedSeconds: number) {
    await this.pointsService?.syncAttendancePoints({
      teamId: session.teamId,
      userId: session.userId,
      attendanceSessionId: session.id,
      creditedSeconds,
      isValid: session.status === 'completed' || session.status === 'active'
    });
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PointLedgerEntry, PointLedgerEntryDocument } from './schemas/point-ledger-entry.schema';
import { getIsoWeekKey, parseIsoWeekKey } from '../../common/utils/time.util';
import { AttendanceDurationAdjustment, AttendanceDurationAdjustmentDocument } from '../attendance/schemas/attendance-duration-adjustment.schema';
import { AttendanceAdjustmentBucket, AttendanceAdjustmentBucketDocument } from '../attendance/schemas/attendance-adjustment-bucket.schema';
import type { AuthUser } from '../auth/types/auth-user.type';

const ATTENDANCE_POINTS_PER_MINUTE = 1;
const SECONDS_PER_MINUTE = 60;

export interface SyncAttendancePointsInput {
  teamId: string;
  userId: string;
  attendanceSessionId: string;
  weekKey: string;
  durationSeconds: number;
  isValid: boolean;
}

@Injectable()
export class PointsService {
  constructor(
    @InjectModel(PointLedgerEntry.name)
    private readonly pointLedgerModel: Model<PointLedgerEntryDocument>,
    @InjectModel(AttendanceDurationAdjustment.name)
    private readonly adjustments: Model<AttendanceDurationAdjustmentDocument>,
    @InjectModel(AttendanceAdjustmentBucket.name)
    private readonly buckets: Model<AttendanceAdjustmentBucketDocument>
  ) {}

  /**
   * A session's ledger row is the source of truth for attendance points. Updating
   * the row rather than incrementing a user balance makes checkout retries
   * idempotent and lets invalidated sessions be reset to zero safely.
   */
  async syncAttendancePoints(input: SyncAttendancePointsInput): Promise<number> {
    const points = input.isValid
      ? Math.floor(Math.max(0, input.durationSeconds) / SECONDS_PER_MINUTE) * ATTENDANCE_POINTS_PER_MINUTE
      : 0;

    await this.pointLedgerModel
      .findOneAndUpdate(
        { sourceAttendanceSessionId: input.attendanceSessionId },
        {
          $set: {
            teamId: input.teamId,
            userId: input.userId,
            weekKey: input.weekKey,
            sourceType: 'attendance',
            points
          }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
      .exec();

    return points;
  }

  // Read the immutable adjustment audit instead of issuing a second credit write.
  // Existing adjustments immediately count; retries cannot mint duplicate points.
  private async manualPoints(teamId: string, userId?: string, weekKey?: string) {
    const match = { teamId, ...(userId ? { userId } : {}), ...(weekKey ? { weekKey } : {}) };
    const group = { _id: { userId: '$userId', weekKey: '$weekKey' }, seconds: { $sum: '$signedDurationSeconds' } };
    type Total = { _id: { userId: string; weekKey: string }; seconds: number };
    const [legacy, buckets] = await Promise.all([
      this.adjustments.aggregate<Total>([{ $match: match }, { $group: group }]).exec(),
      this.buckets.aggregate<Total>([{ $match: match }, { $unwind: '$entries' },
        { $group: { ...group, seconds: { $sum: '$entries.signedDurationSeconds' } } }]).exec()
    ]);
    const totals = new Map<string, Total>();
    for (const row of [...legacy, ...buckets]) {
      const key = JSON.stringify(row._id);
      const current = totals.get(key);
      const seconds = (current?.seconds ?? 0) + row.seconds;
      if (!Number.isSafeInteger(seconds)) throw new Error('Invalid manual adjustment duration');
      totals.set(key, { _id: row._id, seconds });
    }
    return [...totals.values()].map(row => ({ ...row._id, points: Math.trunc(row.seconds / SECONDS_PER_MINUTE) }));
  }

  async getTeamWeekEarnedPoints(teamId: string, weekKey: string): Promise<Record<string, number>> {
    const [earned, manual] = await Promise.all([
      this.pointLedgerModel.aggregate<{ _id: string; points: number }>([
        { $match: { teamId, weekKey, sourceType: 'attendance' } },
        { $group: { _id: '$userId', points: { $sum: '$points' } } }
      ]).exec(),
      this.manualPoints(teamId, undefined, weekKey)
    ]);
    const totals = new Map(earned.map(row => [row._id, row.points]));
    for (const row of manual) totals.set(row.userId, (totals.get(row.userId) ?? 0) + row.points);
    return Object.fromEntries([...totals].map(([id, points]) => [id, Math.max(0, points)]));
  }

  async getMyPoints(user: AuthUser, requestedWeek?: string) {
    const week = requestedWeek ?? getIsoWeekKey(new Date());
    const monday = parseIsoWeekKey(week);
    if (!monday) {
      throw new BadRequestException({
        code: 'POINTS_WEEK_INVALID',
        message: 'week must be a valid ISO week in YYYY-Www format'
      });
    }

    const baseMatch = { teamId: user.teamId, userId: user.userId };
    const [allTimeRows, weeklyRows, manual] = await Promise.all([
      this.pointLedgerModel.aggregate<{ totalPoints: number }>([
        { $match: baseMatch },
        { $group: { _id: null, totalPoints: { $sum: '$points' } } }
      ]).exec(),
      this.pointLedgerModel.aggregate<{ totalPoints: number }>([
        { $match: { ...baseMatch, weekKey: monday.toFormat('yyyy-LL-dd') } },
        { $group: { _id: null, totalPoints: { $sum: '$points' } } }
      ]).exec(),
      this.manualPoints(user.teamId, user.userId)
    ]);

    return {
      totalPoints: Math.max(0, (allTimeRows[0]?.totalPoints ?? 0) + manual.reduce((sum, row) => sum + row.points, 0)),
      week,
      weekPoints: Math.max(0, (weeklyRows[0]?.totalPoints ?? 0) + manual.filter(row => row.weekKey === monday.toFormat('yyyy-LL-dd')).reduce((sum, row) => sum + row.points, 0)),
      accrualRate: { focusedMinutes: 1, points: 1 },
      calculatedAt: new Date().toISOString()
    };
  }

  async deleteUserPoints(teamId: string, userId: string): Promise<void> {
    await this.pointLedgerModel.deleteMany({ teamId, userId }).exec();
  }

}

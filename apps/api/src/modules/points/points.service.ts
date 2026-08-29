import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PointLedgerEntry, PointLedgerEntryDocument } from './schemas/point-ledger-entry.schema';

const ATTENDANCE_POINTS_PER_MINUTE = 1;
const SECONDS_PER_MINUTE = 60;

export interface SyncAttendancePointsInput {
  teamId: string;
  userId: string;
  attendanceSessionId: string;
  creditedSeconds: number;
  isValid: boolean;
}

@Injectable()
export class PointsService {
  constructor(
    @InjectModel(PointLedgerEntry.name)
    private readonly pointLedgerModel: Model<PointLedgerEntryDocument>
  ) {}

  /**
   * A session's ledger row is the source of truth for attendance points. Updating
   * the row rather than incrementing a user balance makes repeated keepalive
   * requests idempotent and lets invalidated sessions be reset to zero safely.
   */
  async syncAttendancePoints(input: SyncAttendancePointsInput): Promise<number> {
    const points = input.isValid
      ? Math.floor(Math.max(0, input.creditedSeconds) / SECONDS_PER_MINUTE) * ATTENDANCE_POINTS_PER_MINUTE
      : 0;

    await this.pointLedgerModel
      .findOneAndUpdate(
        { sourceAttendanceSessionId: input.attendanceSessionId },
        {
          $set: {
            teamId: input.teamId,
            userId: input.userId,
            sourceType: 'attendance',
            points
          }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
      .exec();

    return points;
  }

  async getUserPoints(teamId: string, userId: string) {
    const [summary] = await this.pointLedgerModel
      .aggregate<{ totalPoints: number }>([
        { $match: { teamId, userId } },
        { $group: { _id: null, totalPoints: { $sum: '$points' } } }
      ])
      .exec();

    return { totalPoints: summary?.totalPoints ?? 0 };
  }

  async deleteUserPoints(teamId: string, userId: string): Promise<void> {
    await this.pointLedgerModel.deleteMany({ teamId, userId }).exec();
  }
}

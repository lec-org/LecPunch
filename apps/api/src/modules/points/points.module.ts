import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';
import { PointLedgerEntry, PointLedgerEntrySchema } from './schemas/point-ledger-entry.schema';
import { AttendanceDurationAdjustment, AttendanceDurationAdjustmentSchema } from '../attendance/schemas/attendance-duration-adjustment.schema';
import { AttendanceAdjustmentBucket, AttendanceAdjustmentBucketSchema } from '../attendance/schemas/attendance-adjustment-bucket.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { name: PointLedgerEntry.name, schema: PointLedgerEntrySchema },
    { name: AttendanceDurationAdjustment.name, schema: AttendanceDurationAdjustmentSchema },
    { name: AttendanceAdjustmentBucket.name, schema: AttendanceAdjustmentBucketSchema }
  ])],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService]
})
export class PointsModule {}

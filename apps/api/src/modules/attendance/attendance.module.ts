import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceSession, AttendanceSessionSchema } from './schemas/attendance-session.schema';
import {
  AttendanceDurationAdjustment,
  AttendanceDurationAdjustmentSchema
} from './schemas/attendance-duration-adjustment.schema';
import { AttendanceAdjustmentBucket, AttendanceAdjustmentBucketSchema } from './schemas/attendance-adjustment-bucket.schema';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { NetworkPolicyModule } from '../network-policy/network-policy.module';
import { UsersModule } from '../users/users.module';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [
    NetworkPolicyModule,
    UsersModule,
    PointsModule,
    MongooseModule.forFeature([
      { name: AttendanceSession.name, schema: AttendanceSessionSchema },
      { name: AttendanceAdjustmentBucket.name, schema: AttendanceAdjustmentBucketSchema },
      { name: AttendanceDurationAdjustment.name, schema: AttendanceDurationAdjustmentSchema }
    ])
  ],
  providers: [AttendanceService],
  controllers: [AttendanceController],
  exports: [AttendanceService]
})
export class AttendanceModule {}

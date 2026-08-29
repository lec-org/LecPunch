import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceSession, AttendanceSessionSchema } from './schemas/attendance-session.schema';
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
    MongooseModule.forFeature([{ name: AttendanceSession.name, schema: AttendanceSessionSchema }])
  ],
  providers: [AttendanceService],
  controllers: [AttendanceController],
  exports: [AttendanceService]
})
export class AttendanceModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { AttendanceSession, AttendanceSessionSchema } from '../attendance/schemas/attendance-session.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PointsModule } from '../points/points.module';

@Module({
  imports: [
    ConfigModule,
    PointsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AttendanceSession.name, schema: AttendanceSessionSchema }
    ])
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}

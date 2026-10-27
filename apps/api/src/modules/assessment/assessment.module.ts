import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssessmentMembership, AssessmentMembershipSchema, AssessmentWeek, AssessmentWeekSchema } from './schemas/assessment.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AttendanceSession, AttendanceSessionSchema } from '../attendance/schemas/attendance-session.schema';
import { UsersModule } from '../users/users.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CardsModule } from '../cards/cards.module';
import { StatsService } from '../stats/stats.service';
import { AssessmentService } from './assessment.service';
import { AssessmentController } from './assessment.controller';
@Module({
  imports: [UsersModule, AttendanceModule, CardsModule, MongooseModule.forFeature([
    { name: AssessmentWeek.name, schema: AssessmentWeekSchema }, { name: AssessmentMembership.name, schema: AssessmentMembershipSchema },
    { name: User.name, schema: UserSchema }, { name: AttendanceSession.name, schema: AttendanceSessionSchema }
  ])],
  // StatsModule deliberately has no public provider export. Reuse the unchanged read service in this isolated module.
  providers: [AssessmentService, StatsService], controllers: [AssessmentController], exports: [AssessmentService]
})
export class AssessmentModule {}

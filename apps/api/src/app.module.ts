import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validationSchema } from './config/env.validation';
import { DatabaseModule } from './modules/database/database.module';
import { UsersModule } from './modules/users/users.module';
import { TeamsModule } from './modules/teams/teams.module';
import { AuthModule } from './modules/auth/auth.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { RecordsModule } from './modules/records/records.module';
import { StatsModule } from './modules/stats/stats.module';
import { DemoSeedModule } from './modules/demo-seed/demo-seed.module';
import { NetworkPolicyModule } from './modules/network-policy/network-policy.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MemberEligibilityModule } from './modules/member-eligibility/member-eligibility.module';
import { TeamEventsModule } from './modules/team-events/team-events.module';
import { TeamLedgerModule } from './modules/team-ledger/team-ledger.module';
import { ReportsModule } from './modules/reports/reports.module';
import { GitHubSourcesModule } from './modules/github-sources/github-sources.module';
import { WeeklyReportsModule } from './modules/weekly-reports/weekly-reports.module';
import { PointsModule } from './modules/points/points.module';
import { MeetModule } from './modules/meet/meet.module';
import { CardsModule } from './modules/cards/cards.module';
import { AssessmentModule } from './modules/assessment/assessment.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validationSchema
    }),
    DatabaseModule,
    UsersModule,
    TeamsModule,
    AuthModule,
    NetworkPolicyModule,
    MemberEligibilityModule,
    TeamEventsModule,
    TeamLedgerModule,
    ReportsModule,
    GitHubSourcesModule,
    WeeklyReportsModule,
    PointsModule,
    CardsModule,
    AssessmentModule,
    MeetModule,
    AttendanceModule,
    RecordsModule,
    StatsModule,
    NotificationsModule,
    DemoSeedModule
  ]
})
export class AppModule {}

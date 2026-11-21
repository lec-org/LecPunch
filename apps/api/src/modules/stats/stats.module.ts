import { Module } from '@nestjs/common';
import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';
import { AttendanceModule } from '../attendance/attendance.module';
import { UsersModule } from '../users/users.module';
import { CardsModule } from '../cards/cards.module';
import { TitlesModule } from '../titles/titles.module';

@Module({
  imports: [AttendanceModule, UsersModule, CardsModule, TitlesModule],
  providers: [StatsService],
  controllers: [StatsController]
})
export class StatsModule {}

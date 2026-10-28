import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { TeamCurrentWeekQueryDto } from './dto/team-current-week-query.dto';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('me/weekly')
  async myWeeklyStats(@CurrentUser() user: AuthUser) {
    const items = await this.statsService.getMyWeeklyStats(user.teamId, user.userId, user.enrollYear);
    return { items, weeklyGoalSeconds: this.statsService.getWeeklyGoalSeconds(user.enrollYear) };
  }

  @Get('team/current-week')
  async teamCurrentWeek(
    @CurrentUser() user: AuthUser,
    @Query() query: TeamCurrentWeekQueryDto
  ) {
    const enrollYear = query.sameGrade === 'true' ? user.enrollYear : undefined;
    const items = await this.statsService.getTeamCurrentWeekStats(user.teamId, enrollYear);
    return { items };
  }

  @Get('member/:memberKey/weekly')
  async memberWeeklyStats(@CurrentUser() user: AuthUser, @Param('memberKey') memberKey: string) {
    return this.statsService.getMemberWeeklyStats(user.teamId, memberKey);
  }

  @Get('member/:memberKey/cards')
  async memberCardInventory(@CurrentUser() user: AuthUser, @Param('memberKey') memberKey: string) {
    return this.statsService.getMemberCardInventory(user.teamId, memberKey);
  }
}

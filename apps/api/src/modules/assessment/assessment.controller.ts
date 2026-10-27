import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { AssessmentService } from './assessment.service';
@Controller('assessment')
@UseGuards(JwtAuthGuard)
export class AssessmentController {
  constructor(private readonly assessment: AssessmentService) {}
  @Get('leaderboard') leaderboard(@CurrentUser() user: AuthUser) { return this.assessment.leaderboard(user); }
  @Get('member-summaries') summaries(@CurrentUser() user: AuthUser) { return this.assessment.memberSummaries(user); }
  @Get('me/history') mine(@CurrentUser() user: AuthUser, @Query('before') before?: string, @Query('limit') limit = '20') {
    return this.assessment.myHistory(user, before, Number(limit));
  }
  @Get('members/:memberKey/history') history(@CurrentUser() user: AuthUser, @Param('memberKey') key: string, @Query('before') before?: string, @Query('limit') limit = '20') {
    return this.assessment.history(user, key, before, Number(limit));
  }
}

import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, UseGuards, Req } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { NetworkPolicyService } from '../network-policy/network-policy.service';
import type { Request } from 'express';
import { AdjustCurrentWeekDurationDto } from './dto/adjust-current-week-duration.dto';
import { WeeklySummaryQueryDto } from './dto/weekly-summary-query.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly networkPolicyService: NetworkPolicyService
  ) {}

  @Get('current')
  async getCurrent(@CurrentUser() user: AuthUser) {
    const session = await this.attendanceService.getCurrentSession(user.userId);
    return {
      hasActiveSession: Boolean(session),
      session: session ? this.mapSession(session) : null
    };
  }

  @Get('team-active')
  async getTeamActive(@CurrentUser() user: AuthUser) {
    const items = await this.attendanceService.listTeamActiveSessions(user.teamId);
    return { items };
  }

  @Get('me/weekly-summary')
  getMyWeeklySummary(@CurrentUser() user: AuthUser, @Query() query: WeeklySummaryQueryDto) {
    return this.attendanceService.getMyWeeklySummary(user, query.week);
  }

  @Post('check-in')
  async checkIn(@CurrentUser() user: AuthUser, @Req() request: Request) {
    const ip = await this.networkPolicyService.getClientIp(user.teamId, request);
    const session = await this.attendanceService.checkIn(user, ip);
    return this.mapSession(session);
  }

  @Post('check-out')
  async checkOut(@CurrentUser() user: AuthUser, @Req() request: Request) {
    const ip = await this.networkPolicyService.getClientIp(user.teamId, request);
    const session = await this.attendanceService.checkOut(user, ip);
    return this.mapSession(session);
  }

  @Post('keepalive')
  async keepAlive(@CurrentUser() user: AuthUser) {
    const session = await this.attendanceService.keepAlive(user);
    return this.mapSession(session);
  }

  @Get('admin/current-week-adjustment-context')
  adjustmentContext(@CurrentUser() user: AuthUser, @Query('userId') userId: string) {
    this.assertAdmin(user);
    if (!/^[a-fA-F0-9]{24}$/.test(userId ?? '')) throw new BadRequestException('Invalid member id');
    return this.attendanceService.adjustmentContext(user, userId);
  }

  @Post('admin/current-week-duration-adjustments')
  async adjustCurrentWeekDuration(
    @CurrentUser() user: AuthUser,
    @Body() dto: AdjustCurrentWeekDurationDto
  ) {
    this.assertAdmin(user);
    return this.attendanceService.adjustCurrentWeekDuration(user, dto);
  }

  @Get('admin/weekly-adjustments')
  getAdminWeeklyAdjustments(@CurrentUser() user: AuthUser, @Query() query: WeeklySummaryQueryDto) {
    this.assertAdmin(user);
    return this.attendanceService.listTeamWeekDurationAdjustments(user.teamId, query.week);
  }

  private assertAdmin(user: AuthUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only admins can adjust attendance duration');
    }
  }

  private mapSession(session: any) {
    return {
      id: session.id,
      teamId: session.teamId,
      userId: session.userId,
      checkInAt: session.checkInAt,
      checkOutAt: session.checkOutAt,
      lastKeepaliveAt: session.lastKeepaliveAt,
      lastCreditedAt: session.lastCreditedAt,
      creditedSeconds: session.creditedSeconds,
      pausedAt: session.pausedAt,
      pauseReason: session.pauseReason,
      isPaused: false,
      segmentsCount: session.segmentsCount,
      durationSeconds: session.durationSeconds,
      elapsedSeconds: session.elapsedSeconds,
      status: session.status,
      invalidReason: session.invalidReason,
      weekKey: session.weekKey
    };
  }
}

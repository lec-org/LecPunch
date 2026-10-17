import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { NotificationsService } from './notifications.service';
import { UsersService } from '../users/users.service';
import { NotificationPreferenceDto } from './dto/notification-preference.dto';
import { CreateNoticeDto } from './dto/create-notice.dto';
import type { Request, Response } from 'express';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService, private readonly usersService: UsersService) {}

  @Get('me')
  async listMyNotifications(@CurrentUser() user: AuthUser, @Query('status') status?: 'unacked' | 'all',
    @Query('limit') limit = '20', @Query('before') before?: string) {
    const items = await this.notificationsService.listForUser(user.teamId, user.userId,
      { status, limit: Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100), before }, user.role);
    return { items, nextCursor: items[items.length - 1]?.id ?? null };
  }

  @Get('preferences')
  async preferences(@CurrentUser() user: AuthUser) {
    const member = await this.usersService.findById(user.userId);
    return { adminMessageBadgeEnabled: member?.adminMessageBadgeEnabled !== false };
  }

  @Patch('preferences')
  setPreferences(@CurrentUser() user: AuthUser, @Body() input: NotificationPreferenceDto) {
    return this.usersService.setAdminMessageBadge(user.userId, input.adminMessageBadgeEnabled);
  }

  @Get('me/unread-count')
  async unreadCount(@CurrentUser() user: AuthUser) {
    const [count, member] = await Promise.all([this.notificationsService.unreadCount(user), this.usersService.findById(user.userId)]);
    const badgeCount = member?.adminMessageBadgeEnabled === false ? await this.notificationsService.unreadCount(user, true) : count;
    return { count, badgeCount };
  }

  @Patch(':notificationId/ack')
  acknowledgeNotification(@CurrentUser() user: AuthUser, @Param('notificationId') notificationId: string) {
    return this.notificationsService.acknowledge(user.teamId, user.userId, notificationId, user.role);
  }

  @Post('admin/notices')
  createNotice(@CurrentUser() user: AuthUser, @Body() input: CreateNoticeDto) {
    this.assertAdmin(user); return this.notificationsService.createNotice(user, input);
  }

  @Get('admin/sent')
  listSent(@CurrentUser() user: AuthUser) { this.assertAdmin(user); return this.notificationsService.listSent(user); }

  @Get('admin/:notificationId/read-status')
  readStatus(@CurrentUser() user: AuthUser, @Param('notificationId') id: string) {
    this.assertAdmin(user); return this.notificationsService.readStatus(user, id);
  }

  @Get('stream')
  streamNotifications(@CurrentUser() user: AuthUser, @Req() request: Request, @Res() response: Response) {
    const remainingMs = (user.tokenExpiresAt ?? 0) * 1000 - Date.now();
    if (remainingMs <= 0) { response.status(401).end(); return; }
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    let closed = false, checking = false;
    const unsubscribe = this.notificationsService.subscribe(user, event => {
      if (!closed) this.writeEvent(response, event.event, event.data);
    });
    const close = () => {
      if (closed) return;
      closed = true; clearInterval(heartbeat); clearTimeout(expiry); unsubscribe(); response.end();
    };
    const heartbeat = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      void this.usersService.findById(user.userId).then(member => {
        if (!member || member.status !== 'active' || member.teamId !== user.teamId) close();
        else if (!closed) this.writeEvent(response, 'heartbeat', {});
      }).catch(() => close()).finally(() => { checking = false; });
    }, 30_000);
    const expiry = setTimeout(close, Math.min(remainingMs, 2_147_483_647));
    request.on('close', close);
    this.writeEvent(response, 'connected', {});
  }

  private assertAdmin(user: AuthUser) {
    if (user.role !== 'admin') throw new ForbiddenException('需要 SSO 管理员权限');
  }
  private writeEvent(response: Response, event: string, data: unknown) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

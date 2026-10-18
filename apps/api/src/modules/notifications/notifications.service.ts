import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NotificationItem, NotificationPayloadMap, NotificationSourceType, NotificationType } from '@lecpunch/shared';
import { Model, Types } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { NotificationReceipt, NotificationReceiptDocument } from './schemas/notification-receipt.schema';
import { UsersService } from '../users/users.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import type { CreateNoticeDto } from './dto/create-notice.dto';

export interface CreateNotificationInput<T extends NotificationType = NotificationType> {
  teamId: string; userId: string; type: T; title: string; message: string;
  payload: NotificationPayloadMap[T]; sourceType: NotificationSourceType; sourceId: string; createdBy: string;
}
export interface ListNotificationsOptions { status?: 'unacked' | 'all'; limit?: number; before?: string }
export interface CreateAttendanceRecordMarkedNotificationInput {
  teamId: string; userId: string; sourceId: string; memberKey: string; weekKey: string; createdBy: string;
}
export interface CreateReportSubmittedNotificationsInput {
  teamId: string; reportId: string; reporterUserId: string; reporterDisplayName: string;
  imageCount: number; imagesExpireAt: Date | null;
}
export type NotificationStreamEventName = 'connected' | 'notifications.changed' | 'heartbeat';
export interface NotificationStreamEvent { event: NotificationStreamEventName; data: unknown }
type Subscriber = { user: AuthUser; send: (event: NotificationStreamEvent) => void };

@Injectable()
export class NotificationsService {
  private readonly subscribers = new Set<Subscriber>();
  constructor(
    @InjectModel(Notification.name) private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(NotificationReceipt.name) private readonly receiptModel: Model<NotificationReceiptDocument>,
    private readonly usersService: UsersService
  ) {}

  createModel(input: CreateNotificationInput) {
    return new this.notificationModel({ ...input, audience: 'user', acknowledgedAt: null });
  }

  async createForAttendanceRecordMarked(input: CreateAttendanceRecordMarkedNotificationInput) {
    const notification = await this.notificationModel.create({
      teamId: input.teamId, userId: input.userId, audience: 'user', type: 'attendance.record_marked',
      title: '打卡记录已被标记', message: '管理员标记了一条你的打卡记录，请进入记录页查看详情。',
      payload: { recordId: input.sourceId, memberKey: input.memberKey, weekKey: input.weekKey },
      sourceType: 'attendance_record', sourceId: input.sourceId, createdBy: input.createdBy, acknowledgedAt: null
    });
    this.publish(input.teamId, input.userId);
    return this.toNotificationItem(notification);
  }

  async createForReportSubmitted(input: CreateReportSubmittedNotificationsInput) {
    // Stable delivery key makes the report outbox safe to replay after a crash.
    const key = `report:${input.teamId}:${input.reportId}`;
    const notification = await this.notificationModel.findOneAndUpdate({ deliveryKey: key }, { $setOnInsert: {
      teamId: input.teamId, audience: 'team_admin', type: 'report.submitted',
      title: '收到成员消息', message: '有新的成员消息，请到管理员收件箱查看。',
      payload: { reportId: input.reportId, reporterUserId: input.reporterUserId,
        reporterDisplayName: input.reporterDisplayName, imageCount: input.imageCount,
        imagesExpireAt: input.imagesExpireAt?.toISOString() ?? null },
      sourceType: 'report', sourceId: input.reportId, createdBy: input.reporterUserId,
      acknowledgedAt: null
    } }, { upsert: true, new: true }).exec();
    this.publish(input.teamId, undefined, true);
    return this.toNotificationItem(notification!);
  }

  private scope(teamId: string, userId: string, role: string) {
    const own = { userId, audience: { $nin: ['team_admin', 'team_members'] } };
    return { teamId, ...(role === 'admin' ? {} : { type: { $ne: 'report.submitted' } }),
      $or: [own, { audience: 'team_members', recipientUserIds: userId },
        ...(role === 'admin' ? [{ audience: 'team_admin' }] : [])] };
  }

  private receiptStages(userId: string) {
    return [
      { $lookup: { from: 'notification_receipts', let: { notificationId: { $toString: '$_id' } },
        pipeline: [{ $match: { userId, $expr: { $eq: ['$notificationId', '$$notificationId'] } } }], as: 'receipts' } },
      { $set: { acknowledgedAt: { $ifNull: [{ $arrayElemAt: ['$receipts.readAt', 0] }, '$acknowledgedAt'] } } }
    ];
  }

  async listForUser(teamId: string, userId: string, options: ListNotificationsOptions = {}, role = 'member') {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const match = this.scope(teamId, userId, role);
    const cursor = options.before;
    if (cursor && !Types.ObjectId.isValid(cursor)) throw new BadRequestException('Invalid notification cursor');
    const items = await this.notificationModel.aggregate([
      { $match: { ...match, ...(cursor ? { _id: { $lt: new Types.ObjectId(cursor) } } : {}) } },
      ...this.receiptStages(userId),
      ...((options.status ?? 'unacked') === 'unacked' ? [{ $match: { acknowledgedAt: null } }] : []),
      { $sort: { _id: -1 } }, { $limit: limit }
    ]).exec();
    return items.map(item => this.toNotificationItem({ ...item, id: String(item._id) }));
  }

  async unreadCount(user: AuthUser, excludeAdminMessages = false) {
    const rows = await this.notificationModel.aggregate([
      { $match: { $and: [this.scope(user.teamId, user.userId, user.role), ...(excludeAdminMessages ? [{ type: { $ne: 'report.submitted' } }] : [])] } }, ...this.receiptStages(user.userId),
      { $match: { acknowledgedAt: null } }, { $count: 'count' }
    ]).exec();
    return rows[0]?.count ?? 0;
  }

  async acknowledge(teamId: string, userId: string, notificationId: string, role = 'member') {
    if (!Types.ObjectId.isValid(notificationId)) throw new NotFoundException('Notification not found');
    const notification = await this.notificationModel.findOne({ _id: notificationId, ...this.scope(teamId, userId, role) }).exec();
    if (!notification) throw new NotFoundException('Notification not found');
    const receipt = await this.receiptModel.findOneAndUpdate({ notificationId, userId }, {
      $setOnInsert: { teamId, readAt: new Date() }
    }, { upsert: true, new: true }).exec();
    // Retain the old personal ack contract. Group notifications never share a read flag.
    if (notification.userId === userId && !notification.acknowledgedAt) {
      await this.notificationModel.updateOne({ _id: notificationId, acknowledgedAt: null }, { $set: { acknowledgedAt: receipt!.readAt } }).exec();
    }
    this.publish(teamId, userId);
    return { ...this.toNotificationItem(notification), acknowledgedAt: (notification.acknowledgedAt ?? receipt!.readAt).toISOString() };
  }

  async createNotice(user: AuthUser, input: CreateNoticeDto) {
    const title = input.title.trim(), message = input.message.trim();
    if (!title || !message) throw new BadRequestException('通知标题和内容不能为空');
    const deliveryKey = `notice:${user.teamId}:${user.userId}:${input.requestKey}`;
    const requestHash = createHash('sha256').update(JSON.stringify({ title, message })).digest('hex');
    let existing = await this.notificationModel.findOne({ deliveryKey }).exec();
    if (!existing) {
      const members = await this.usersService.listTeamMembers(user.teamId);
      const recipientUserIds = members.filter(m => m.status === 'active' && m.logtoUserId).map(m => m.id);
      try {
        existing = await this.notificationModel.create({
          teamId: user.teamId, audience: 'team_members', recipientUserIds, deliveryKey, requestHash,
          type: 'admin.notice', title, message, payload: { noticeId: randomUUID() },
          sourceType: 'admin_notice', sourceId: input.requestKey, createdBy: user.userId, acknowledgedAt: null
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        existing = await this.notificationModel.findOne({ deliveryKey }).exec();
      }
    }
    if (!existing || existing.requestHash !== requestHash) throw new ConflictException('同一请求标识不能发布不同内容');
    this.publish(user.teamId);
    return this.toNotificationItem(existing);
  }

  async listSent(user: AuthUser) {
    const rows = await this.notificationModel.find({ teamId: user.teamId, createdBy: user.userId,
      type: { $in: ['admin.notice', 'attendance.record_marked'] } }).sort({ _id: -1 }).limit(100).exec();
    return rows.map(row => this.toNotificationItem(row));
  }

  async readStatus(user: AuthUser, notificationId: string) {
    if (!Types.ObjectId.isValid(notificationId)) throw new NotFoundException('Notification not found');
    const notice = await this.notificationModel.findOne({ _id: notificationId, teamId: user.teamId,
      type: { $in: ['admin.notice', 'attendance.record_marked'] } }).exec();
    if (!notice) throw new NotFoundException('Notification not found');
    const recipientIds = notice.audience === 'team_members' ? notice.recipientUserIds ?? [] : [notice.userId!];
    const [members, receipts] = await Promise.all([
      this.usersService.findByIds(recipientIds),
      this.receiptModel.find({ notificationId, teamId: user.teamId }).exec()
    ]);
    const readByUser = new Map(receipts.map(r => [r.userId, r.readAt]));
    return recipientIds.map(userId => ({ userId,
      displayName: members.find(m => m.id === userId && m.teamId === user.teamId)?.displayName ?? '已移除成员',
      readAt: (readByUser.get(userId) ?? (userId === notice.userId ? notice.acknowledgedAt : null))?.toISOString() ?? null
    }));
  }

  subscribe(user: AuthUser, send: Subscriber['send']) {
    const subscriber = { user, send };
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  private publish(teamId: string, userId?: string, adminOnly = false) {
    for (const s of this.subscribers) {
      if (s.user.teamId !== teamId || (userId && s.user.userId !== userId) || (adminOnly && s.user.role !== 'admin')) continue;
      if (!s.user.tokenExpiresAt || s.user.tokenExpiresAt <= Date.now() / 1000) continue;
      // SSE carries no message metadata. The authenticated read endpoint checks access again.
      try { s.send({ event: 'notifications.changed', data: {} }); } catch { this.subscribers.delete(s); }
    }
  }

  createConnectedEvent(): NotificationStreamEvent { return { event: 'connected', data: {} }; }
  createHeartbeatEvent(): NotificationStreamEvent { return { event: 'heartbeat', data: {} }; }

  toNotificationItem(document: Pick<NotificationDocument, 'id' | 'teamId' | 'userId' | 'audience' | 'type' | 'title' | 'message' | 'payload' | 'sourceType' | 'sourceId' | 'createdBy' | 'createdAt' | 'acknowledgedAt'>): NotificationItem {
    return { id: document.id, teamId: document.teamId, userId: document.userId, audience: document.audience,
      type: document.type, title: document.title, message: document.message, payload: document.payload,
      sourceType: document.sourceType, sourceId: document.sourceId, createdBy: document.createdBy,
      createdAt: document.createdAt.toISOString(), acknowledgedAt: document.acknowledgedAt?.toISOString() ?? null } as NotificationItem;
  }
}

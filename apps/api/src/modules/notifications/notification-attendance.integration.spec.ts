import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection, type Connection, type Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { NotificationSchema } from './schemas/notification.schema';
import { NotificationReceiptSchema } from './schemas/notification-receipt.schema';
import { UserSchema } from '../users/schemas/user.schema';
import { AttendanceSessionSchema } from '../attendance/schemas/attendance-session.schema';
import { AttendanceDurationAdjustmentSchema } from '../attendance/schemas/attendance-duration-adjustment.schema';
import { AttendanceAdjustmentBucketSchema } from '../attendance/schemas/attendance-adjustment-bucket.schema';
import { ReportSchema } from '../reports/schemas/report.schema';
import { UsersService } from '../users/users.service';
import { NotificationsService } from './notifications.service';
import { AttendanceService } from '../attendance/attendance.service';
import { ReportsService } from '../reports/reports.service';
import type { AuthUser } from '../auth/types/auth-user.type';
import { getIsoWeekKey, getWeekKey } from '../../common/utils/time.util';

const uri = process.env.LECPUNCH_TEST_MONGO_URI;
// Explicitly opt in to a disposable localhost database. Never accepts a production host.
if (uri && !/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri)) throw new Error('Integration tests require a disposable localhost Mongo URI');
const suite = uri ? describe : describe.skip;
suite('Notification, message and adjustment integration on standalone Mongo', () => {
  let connection: Connection, directory: string;
  let users: Model<any>, notifications: Model<any>, receipts: Model<any>, sessions: Model<any>, legacy: Model<any>, buckets: Model<any>, reports: Model<any>;
  let notificationService: NotificationsService, attendanceService: AttendanceService, reportsService: ReportsService;
  let admin: AuthUser, member: AuthUser, other: AuthUser;
  const points = { syncAttendancePoints: vi.fn(), deleteUserPoints: vi.fn() };
  beforeAll(async () => {
    connection = await createConnection(uri!, { dbName: `lecpunch_local_${randomUUID().replace(/-/g, '')}` }).asPromise();
    users = connection.model('User', UserSchema);
    notifications = connection.model('Notification', NotificationSchema);
    receipts = connection.model('NotificationReceipt', NotificationReceiptSchema);
    sessions = connection.model('AttendanceSession', AttendanceSessionSchema);
    legacy = connection.model('AttendanceDurationAdjustment', AttendanceDurationAdjustmentSchema);
    buckets = connection.model('AttendanceAdjustmentBucket', AttendanceAdjustmentBucketSchema);
    reports = connection.model('Report', ReportSchema);
    await Promise.all([users, notifications, receipts, sessions, legacy, buckets, reports].map(m => m.init()));
    directory = await mkdtemp(join(tmpdir(), 'lecpunch-integration-'));
    const userService = new UsersService(users, sessions, {} as any, points as any);
    notificationService = new NotificationsService(notifications, receipts, userService);
    attendanceService = new AttendanceService(sessions, legacy, { assertIpAllowed: vi.fn() } as any, userService, points as any, buckets);
    reportsService = new ReportsService(reports, notificationService, { get: (key: string) => key === 'REPORT_IMAGES_DIR' ? directory : undefined } as any);
  });
  beforeEach(async () => {
    await Promise.all([users, notifications, receipts, sessions, legacy, buckets, reports].map(m => m.deleteMany({})));
    points.syncAttendancePoints.mockClear();
    const makeUser = async (username: string, teamId = 'team-a') => {
      const user = await users.create({ username, teamId, displayName: username, logtoUserId: `sso-${username}`, enrollYear: 2025, status: 'active', role: 'admin' });
      return { userId: user.id, teamId, username, displayName: username, enrollYear: 2025, role: 'member', tokenExpiresAt: Date.now() / 1000 + 300 } as AuthUser;
    };
    admin = { ...await makeUser('administrator'), role: 'admin' };
    member = await makeUser('ordinary-member'); // Deliberately stale Mongo admin.
    other = { ...await makeUser('other-team', 'team-b'), role: 'admin' };
  });
  afterAll(async () => {
    reportsService?.onModuleDestroy();
    if (connection) {
      if (!connection.name.startsWith('lecpunch_local_')) throw new Error('Refusing to drop an unscoped database');
      await connection.dropDatabase(); await connection.close();
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('blocks legacy admin metadata for ordinary members, and checks the same rule on acknowledgement', async () => {
    const legacyNotice = await notifications.create({ teamId: member.teamId, userId: member.userId,
      type: 'report.submitted', title: 'private', message: 'metadata', payload: {}, sourceType: 'report', sourceId: 'old-report', createdBy: admin.userId });
    expect(await notificationService.listForUser(member.teamId, member.userId)).toEqual([]);
    expect(await notificationService.unreadCount(member)).toBe(0);
    await expect(notificationService.acknowledge(member.teamId, member.userId, legacyNotice.id)).rejects.toMatchObject({ status: 404 });
    const allowed = await notificationService.listForUser(member.teamId, member.userId, {}, 'admin');
    expect(allowed.map(n => n.id)).toEqual([legacyNotice.id]);
  });

  it('replays report delivery once, shares it only with current team admins, and keeps each receipt private', async () => {
    const input = { teamId: member.teamId, reportId: 'report-a', reporterUserId: member.userId, reporterDisplayName: 'Reporter', imageCount: 0, imagesExpireAt: null };
    const first = await notificationService.createForReportSubmitted(input);
    await notificationService.createForReportSubmitted(input);
    expect(await notifications.countDocuments({ type: 'report.submitted' })).toBe(1);
    expect(await notificationService.unreadCount(member)).toBe(0);
    expect(await notificationService.unreadCount(other)).toBe(0);
    expect(await notificationService.unreadCount(admin)).toBe(1);
    await Promise.all([1, 2].map(() => notificationService.acknowledge(admin.teamId, admin.userId, first.id, 'admin')));
    expect(await notificationService.unreadCount(admin)).toBe(0);
    expect(await notificationService.unreadCount({ ...member, role: 'admin' })).toBe(1);
  });

  it('records member read status for administrator notices and counts more than one loaded page', async () => {
    const input = { title: 'Team notice', message: 'Please confirm', requestKey: randomUUID() };
    const notice = await notificationService.createNotice(admin, input);
    expect((await notificationService.createNotice(admin, input)).id).toBe(notice.id);
    await expect(notificationService.createNotice(admin, { ...input, message: 'different' })).rejects.toMatchObject({ status: 409 });
    expect((await notificationService.readStatus(admin, notice.id)).find(r => r.userId === member.userId)?.readAt).toBeNull();
    await notificationService.acknowledge(member.teamId, member.userId, notice.id);
    expect((await notificationService.readStatus(admin, notice.id)).find(r => r.userId === member.userId)?.readAt).toBeTruthy();
    await expect(notificationService.readStatus(other, notice.id)).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 25; i++) await notificationService.createForAttendanceRecordMarked({ teamId: member.teamId, userId: member.userId, sourceId: String(i), memberKey: 'key', weekKey: '2026-10-12', createdBy: admin.userId });
    expect(await notificationService.unreadCount(member)).toBe(25);
    const page = await notificationService.listForUser(member.teamId, member.userId, { limit: 20 });
    expect(page).toHaveLength(20);
    const next = await notificationService.listForUser(member.teamId, member.userId, { limit: 20, before: page[19].id });
    expect(next).toHaveLength(5);
    expect(new Set([...page, ...next].map(n => n.id)).size).toBe(25);
  });

  it('stores messages despite notification failure, retries durably and rejects changed-content retries', async () => {
    const delivery = vi.spyOn(notificationService, 'createForReportSubmitted').mockRejectedValueOnce(new Error('simulated delivery outage'));
    const input = { description: 'A member message', requestKey: randomUUID() };
    const result = await reportsService.createReport(member, input, []);
    expect(await reports.countDocuments({})).toBe(1);
    expect((await reports.findById(result.id)).notificationPending).toBe(true);
    delivery.mockRestore();
    const recreated = new ReportsService(reports, notificationService, { get: (key: string) => key === 'REPORT_IMAGES_DIR' ? directory : undefined } as any);
    await recreated.deliverPendingNotifications();
    expect((await reports.findById(result.id)).notificationPending).toBe(false);
    expect((await reportsService.createReport(member, input, [])).id).toBe(result.id);
    await expect(reportsService.createReport(member, { ...input, description: 'changed' }, [])).rejects.toMatchObject({ status: 409 });
    expect(await reports.countDocuments({})).toBe(1);
    expect(await notifications.countDocuments({ type: 'report.submitted' })).toBe(1);
  });

  it('serializes concurrent decrements atomically, preserves history and does not award points', async () => {
    const weekKey = getWeekKey(new Date());
    await sessions.create({ userId: member.userId, teamId: member.teamId, checkInAt: new Date(), sourceIpAtCheckIn: '127.0.0.1', status: 'completed', durationSeconds: 120, weekKey });
    const input = { userId: member.userId, operation: 'subtract' as const, durationSeconds: 90, reason: 'correction', expectedWeekKey: weekKey };
    const results = await Promise.allSettled([1, 2].map(() => attendanceService.adjustCurrentWeekDuration(admin, { ...input, requestKey: randomUUID() })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await attendanceService.adjustmentContext(admin, member.userId)).totalDurationSeconds).toBe(30);
    const bucket = await buckets.findOne({ userId: member.userId });
    expect(bucket.entries).toHaveLength(1);
    expect(bucket.entries[0].createdBy).toBe(admin.userId);
    expect((await attendanceService.listTeamWeekDurationAdjustments(admin.teamId, getIsoWeekKey(new Date()))).items).toHaveLength(1);
    expect((await sessions.findOne({ userId: member.userId })).durationSeconds).toBe(120);
    expect(points.syncAttendancePoints).not.toHaveBeenCalled();
  });

  it('replays the same adjustment once across service restarts and merges legacy audit totals', async () => {
    const weekKey = getWeekKey(new Date());
    await legacy.create({ teamId: member.teamId, userId: member.userId, username: 'old-handle', weekKey,
      operation: 'add', durationSeconds: 120, signedDurationSeconds: 120, previousDurationSeconds: 0, resultingDurationSeconds: 120, createdBy: admin.userId });
    const input = { userId: member.userId, operation: 'add' as const, durationSeconds: 60, reason: 'correct', requestKey: randomUUID() };
    const results = await Promise.all([1, 2, 3].map(() => attendanceService.adjustCurrentWeekDuration(admin, input)));
    expect(new Set(results.map(r => r.adjustmentId)).size).toBe(1);
    expect((await buckets.findOne({ userId: member.userId })).entries).toHaveLength(1);
    const restarted = new AttendanceService(sessions, legacy, {} as any, {} as any, points as any, buckets);
    const summaries = await restarted.getManualAdjustmentSummaries(member.teamId, [member.userId]);
    expect(summaries.get(`${member.userId}:${weekKey}`)).toEqual({ manualAdjustmentSeconds: 180, adjustmentsCount: 2 });
    await expect(attendanceService.adjustCurrentWeekDuration(admin, { ...input, durationSeconds: 61 })).rejects.toMatchObject({ status: 409 });
    await expect(attendanceService.adjustCurrentWeekDuration(other, input)).rejects.toMatchObject({ status: 403 });
  });
});

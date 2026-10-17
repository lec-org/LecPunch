export type NotificationType = 'attendance.record_marked' | 'report.submitted' | 'admin.notice';
export type NotificationSourceType = 'attendance_record' | 'report' | 'admin_notice';

export interface AttendanceRecordMarkedNotificationPayload {
  recordId: string;
  memberKey: string;
  weekKey: string;
}

export interface ReportSubmittedNotificationPayload {
  reportId: string;
  reporterUserId: string;
  reporterDisplayName: string;
  imageCount: number;
  imagesExpireAt: string | null;
}

export interface NotificationPayloadMap {
  'attendance.record_marked': AttendanceRecordMarkedNotificationPayload;
  'report.submitted': ReportSubmittedNotificationPayload;
  'admin.notice': { noticeId: string };
}

export type NotificationPayload<T extends NotificationType = NotificationType> = NotificationPayloadMap[T];

export type NotificationItem<T extends NotificationType = NotificationType> = T extends NotificationType ? {
  id: string;
  teamId: string;
  userId?: string;
  audience?: 'user' | 'team_admin' | 'team_members';
  type: T;
  title: string;
  message: string;
  payload: NotificationPayloadMap[T];
  sourceType: NotificationSourceType;
  sourceId: string;
  createdBy: string;
  createdAt: string;
  acknowledgedAt: string | null;
} : never;

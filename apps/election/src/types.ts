export interface ElectionUser {
  id: string;
  displayName: string;
  username: string;
  role: 'member' | 'admin';
  teamId: string;
  status?: 'active' | 'disabled';
  enrollYear?: number;
  studentId?: string;
  realName?: string;
  avatarBase64?: string;
  avatarColor?: string;
  avatarEmoji?: string;
}

export interface AttendanceSnapshot {
  hasActiveSession: boolean;
  session: null | {
    checkInAt: string;
    elapsedSeconds: number;
    creditedSeconds?: number;
    isPaused?: boolean;
  };
}

export interface WeeklyReportItem {
  studentId: string;
  displayName: string;
  status: 'generated' | 'missing' | 'pending';
  dailyCount: number;
  summary: string;
  url?: string;
}

export interface WeeklyReportFeed {
  weekKey: string;
  generatedAt?: string;
  members: WeeklyReportItem[];
}

export interface TeamWeeklyStat {
  memberKey: string;
  displayName: string;
  realName?: string;
  enrollYear?: number;
  role: 'member' | 'admin';
  totalDurationSeconds: number;
  sessionsCount: number;
  weekKey: string;
}

export interface TeamWeeklyStatsResponse {
  items: TeamWeeklyStat[];
}

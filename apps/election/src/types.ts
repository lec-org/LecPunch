export interface ElectionUser {
  id: string;
  displayName: string;
  username: string;
  role: 'member' | 'admin';
  teamId: string;
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

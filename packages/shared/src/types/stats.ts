export interface WeeklyStatItem {
  weekKey: string;
  /** Effective duration shown to members: recorded attendance plus approved manual adjustments. */
  totalDurationSeconds: number;
  /** Immutable wall-clock attendance duration, before any administrator adjustment. */
  recordedDurationSeconds: number;
  /** Signed administrator adjustment applied to the displayed duration. */
  manualAdjustmentSeconds: number;
  /** Number of administrator adjustment records included in this week. */
  adjustmentsCount: number;
  sessionsCount: number;
  weeklyGoalSeconds: number;
  /** Signed card effects, separate from immutable attendance and admin adjustments. */
  entertainmentSeconds?: number;
  /** Based on settled comprehensive time; active sessions do not count until checkout. */
  assessmentComplete?: boolean;
}

export interface TeamWeeklyStatItem extends WeeklyStatItem {
  rank?: number;
  memberKey: string;
  displayName: string;
  username?: string;
  realName?: string;
  role: 'member' | 'admin';
  enrollYear: number;
  avatarColor?: string;
  avatarEmoji?: string;
  avatarUrl?: string;
  avatarBase64?: string;
}

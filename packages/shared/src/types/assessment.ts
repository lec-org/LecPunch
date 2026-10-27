export interface AssessmentLeaderboardView {
  enabled: boolean;
  startWeek: string | null;
  week: string;
  settlementNote: string;
  items: Array<{
    memberKey: string; displayName: string; username: string; enrollYear: number; rank: number;
    totalDurationSeconds: number; recordedDurationSeconds: number; manualAdjustmentSeconds: number;
    entertainmentSeconds: number; weeklyGoalSeconds: number; assessmentComplete: boolean; failedWeeksCount: number;
  }>;
}
export interface AssessmentMemberSummaries {
  enabled: boolean;
  requiredEnrollYears: number[];
  startWeek: string | null;
  week: string;
  items: Array<{ memberKey: string; failedWeeksCount: number }>;
}
export interface AssessmentMemberHistory {
  member: { memberKey: string; displayName: string };
  failedWeeksCount: number;
  items: Array<{
    weekKey: string; weekEnd: string; assessmentDate?: string; goalSeconds: number; recordedDurationSeconds: number;
    manualAdjustmentSeconds: number; entertainmentSeconds: number; totalDurationSeconds: number;
    shortfallSeconds: number; settledAt: string;
  }>;
  nextCursor: string | null;
}

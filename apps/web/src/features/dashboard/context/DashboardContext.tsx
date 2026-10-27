import { createContext, useContext, type ReactNode } from 'react';
import type { TeamActiveAttendanceItem, TeamWeeklyStatItem } from '@lecpunch/shared';
import type { AttendanceRecordItem } from '@/features/records/records.api';

export interface DashboardContextValue {
  loading: boolean;
  weekLabel: string;
  isCurrentWeek: boolean;
  teamStats: TeamWeeklyStatItem[];
  activeMembers: TeamActiveAttendanceItem[];
  records: AttendanceRecordItem[];
  isCheckedIn: boolean;
  currentDuration: number;
  selectedWeekDuration: number;
  selectedWeekRecordedDuration: number;
  selectedWeekManualAdjustment: number;
  selectedWeekEntertainment?: number;
  selectedWeekAdjustmentsCount: number;
  selectedWeekSessionsCount: number;
  weeklyGoalSeconds: number;
  submitting: boolean;
  isWarning: boolean;
  isNearLimit: boolean;
  onAttendanceAction: () => void;
  onOpenMember: (member: TeamWeeklyStatItem) => void;
  onOpenActiveMember: (member: TeamActiveAttendanceItem) => void;
  onOpenMembers: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

interface DashboardContextProviderProps {
  value: DashboardContextValue;
  children: ReactNode;
}

export const DashboardContextProvider = ({ value, children }: DashboardContextProviderProps) => {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
};

export const useDashboardContext = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboardContext must be used within DashboardContextProvider');
  }
  return context;
};

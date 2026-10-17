import { apiClient } from '@/shared/http/api-client';
export interface AdjustmentContext { userId: string; weekKey: string; isoWeek: string; recordedDurationSeconds: number; manualAdjustmentSeconds: number; totalDurationSeconds: number }
export interface AdjustmentAudit { adjustmentId: string; userId: string; displayName: string; operation: 'add' | 'subtract'; durationSeconds: number; reason: string | null; createdBy?: string; createdByDisplayName?: string; createdAt: string }
export const getAdjustmentContext = async (userId: string) => (await apiClient.get<AdjustmentContext>('/attendance/admin/current-week-adjustment-context', { params: { userId } })).data;
export const getAdjustmentAudit = async (week: string) => (await apiClient.get<{ items: AdjustmentAudit[] }>('/attendance/admin/weekly-adjustments', { params: { week } })).data.items;
export const adjustDuration = async (input: { userId: string; operation: 'add' | 'subtract'; durationSeconds: number; reason: string; requestKey: string; expectedWeekKey: string }) => (await apiClient.post('/attendance/admin/current-week-duration-adjustments', input)).data;

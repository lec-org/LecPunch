import type { AssessmentLeaderboardView, AssessmentMemberHistory, AssessmentMemberSummaries } from '@lecpunch/shared';
import { apiClient } from '@/shared/http/api-client';

export const getAssessmentLeaderboard = async (signal?: AbortSignal) =>
  (await apiClient.get<AssessmentLeaderboardView>('/assessment/leaderboard', { signal })).data;
export const getAssessmentMemberSummaries = async (signal?: AbortSignal) =>
  (await apiClient.get<AssessmentMemberSummaries>('/assessment/member-summaries', { signal })).data;
export const getAssessmentHistory = async (memberKey: string, before?: string, signal?: AbortSignal) =>
  (await apiClient.get<AssessmentMemberHistory>(`/assessment/members/${encodeURIComponent(memberKey)}/history`, { params: { limit: 20, ...(before ? { before } : {}) }, signal })).data;

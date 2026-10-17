import { apiClient } from '@/shared/http/api-client';
export interface MemberMessage {
  id: string; description: string; createdAt: string; imagesExpireAt: string | null;
  reporter: { userId: string; username: string; displayName: string };
  images: { id: string; downloadPath: string; contentType: string; sizeBytes: number }[];
  processingStatus: 'open' | 'processed'; processingNote: string; processedBy: string | null; processedByDisplayName: string | null; processedAt: string | null;
}
export interface MessageSubmissionReceipt { id: string; createdAt: string; status: 'submitted' }
export const submitMessage = async (description: string, images: File[], requestKey: string) => {
  const data = new FormData(); data.append('description', description); data.append('requestKey', requestKey);
  images.forEach(image => data.append('images', image));
  return (await apiClient.post<MessageSubmissionReceipt>('/reports', data)).data;
};
export const getAdminMessages = async (page = 1) => (await apiClient.get<{ items: MemberMessage[]; total: number }>('/reports/admin', { params: { page, pageSize: 20 } })).data;
export const processMessage = async (id: string, status: 'open' | 'processed', note: string) => (await apiClient.patch<MemberMessage>(`/reports/admin/${id}`, { status, note })).data;
export const downloadMessageImage = async (path: string) => (await apiClient.get<Blob>(path, { responseType: 'blob' })).data;

import type { CardGameActionInput, CardGameActionResponse, CardGameView } from '@lecpunch/shared';
import { apiClient } from '@/shared/http/api-client';

export const getCardGame = async (signal?: AbortSignal) =>
  (await apiClient.get<CardGameView>('/cards/me', { signal })).data;
export const performCardAction = async (input: CardGameActionInput) =>
  (await apiClient.post<CardGameActionResponse>('/cards/actions', input)).data;
export const getCardAction = async (requestKey: string) =>
  (await apiClient.get<CardGameActionResponse>(`/cards/actions/${encodeURIComponent(requestKey)}`)).data;
export const getCardArt = async (id: string, signal: AbortSignal) =>
  (await apiClient.get<Blob>(`/cards/art/${encodeURIComponent(id)}`, { responseType: 'blob', signal })).data;

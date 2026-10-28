import type { CardGameActionInput, CardGameActionResponse, CardGameView, MemberCardInventory } from '@lecpunch/shared';
import { apiClient, getCurrentAccountKey } from '@/shared/http/api-client';

const forAccount = (signal?: AbortSignal) => ({ accountScope: getCurrentAccountKey(), signal });

export const getCardGame = async (signal?: AbortSignal) =>
  (await apiClient.get<CardGameView>('/cards/me', forAccount(signal))).data;
export const performCardAction = async (input: CardGameActionInput) =>
  (await apiClient.post<CardGameActionResponse>('/cards/actions', input, forAccount())).data;
export const getCardAction = async (requestKey: string) =>
  (await apiClient.get<CardGameActionResponse>(`/cards/actions/${encodeURIComponent(requestKey)}`, forAccount())).data;
export const acknowledgeCardGifts = async (ids: string[]) =>
  (await apiClient.post<{ acknowledged: number }>('/cards/gifts/ack', { ids }, forAccount())).data;
export const acknowledgeCardDefenses = async (ids: string[]) =>
  (await apiClient.post<{ acknowledged: number }>('/cards/defenses/ack', { ids }, forAccount())).data;
export const acknowledgeCardInteractions = async (ids: string[]) =>
  (await apiClient.post<{ acknowledged: number }>('/cards/interactions/ack', { ids }, forAccount())).data;
export const getMemberCardInventory = async (memberKey: string, signal?: AbortSignal) =>
  (await apiClient.get<MemberCardInventory>(`/stats/member/${encodeURIComponent(memberKey)}/cards`, forAccount(signal))).data;
export const getCardArt = async (id: string, signal: AbortSignal) =>
  (await apiClient.get<Blob>(`/cards/art/${encodeURIComponent(id)}`, { ...forAccount(signal), responseType: 'blob' })).data;

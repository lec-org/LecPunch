import { AxiosError, AxiosHeaders, isCancel, type AxiosAdapter } from 'axios';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/app/store/auth-store';
import { createUserFixture } from '@/test/user-fixture';
import { apiClient, setNavigateToLogin } from '@/shared/http/api-client';
import { acknowledgeCardGifts, acknowledgeCardDefenses, acknowledgeCardInteractions, getCardGame, performCardAction } from './cards.api';

const auth = vi.hoisted(() => ({ getAccessToken: vi.fn() }));
vi.mock('@/shared/auth/logto', () => auth);
const originalAdapter = apiClient.defaults.adapter;
const login = (id: string, teamId = 'team-1') => useAuthStore.getState().setAuth({ token: `token-${id}`, user: createUserFixture({ id, teamId }) });
const adapter = vi.fn<AxiosAdapter>();
beforeEach(() => {
  vi.clearAllMocks(); login('member-a'); auth.getAccessToken.mockResolvedValue('token-a');
  apiClient.defaults.adapter = adapter;
  adapter.mockImplementation(async config => ({ config, data: { acknowledged: 1 }, status: 200, statusText: 'OK', headers: new AxiosHeaders() }));
});
afterEach(() => { apiClient.defaults.adapter = originalAdapter; vi.restoreAllMocks(); });

describe('card request account ownership', () => {
  it.each([
    ['gift acknowledgement', () => acknowledgeCardGifts(['a'.repeat(64)])],
    ['defense acknowledgement', () => acknowledgeCardDefenses(['a'.repeat(64)])],
    ['interaction acknowledgement', () => acknowledgeCardInteractions(['a'.repeat(64)])],
    ['card action', () => performCardAction({ action: 'draw', requestKey: '00000000-0000-4000-8000-000000000001' })]
  ] as const)('cancels an old %s if the account changes while obtaining a token', async (_name, send) => {
    let resolve!: (token: string) => void;
    auth.getAccessToken.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const settled = send().catch(error => error);
    await waitFor(() => expect(auth.getAccessToken).toHaveBeenCalledTimes(1));
    login('member-b'); resolve('token-b');
    expect(isCancel(await settled)).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
    expect(useAuthStore.getState().auth.user?.id).toBe('member-b');
  });
  it('does not sign out the new account when an old card read returns 401', async () => {
    let reject!: (error: AxiosError) => void;
    adapter.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const navigate = vi.fn(); setNavigateToLogin(navigate);
    const settled = getCardGame().catch(error => error);
    await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
    const config = adapter.mock.calls[0][0];
    login('member-b');
    reject(new AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, undefined,
      { config, data: {}, status: 401, statusText: 'Unauthorized', headers: new AxiosHeaders() }));
    await settled;
    expect(useAuthStore.getState().auth.user?.id).toBe('member-b');
    expect(navigate).not.toHaveBeenCalled();
  });
  it('still handles a genuine 401 for the current card account', async () => {
    const navigate = vi.fn(); setNavigateToLogin(navigate);
    adapter.mockImplementationOnce(async config => { throw new AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, undefined,
      { config, data: {}, status: 401, statusText: 'Unauthorized', headers: new AxiosHeaders() }); });
    await expect(getCardGame()).rejects.toBeInstanceOf(AxiosError);
    expect(useAuthStore.getState().auth.user).toBeNull(); expect(navigate).toHaveBeenCalledTimes(1);
  });
  it('does not sign out the new account when the old token lookup fails without request metadata', async () => {
    let reject!: (error: unknown) => void;
    auth.getAccessToken.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const navigate = vi.fn(); setNavigateToLogin(navigate);
    const settled = getCardGame().catch(error => error);
    await waitFor(() => expect(auth.getAccessToken).toHaveBeenCalledTimes(1));
    login('member-b'); reject({ response: { status: 401 } });
    expect(isCancel(await settled)).toBe(true);
    expect(adapter).not.toHaveBeenCalled();
    expect(useAuthStore.getState().auth.user?.id).toBe('member-b'); expect(navigate).not.toHaveBeenCalled();
  });
  it('also cancels a request if the same user switches teams during token lookup', async () => {
    let resolve!: (token: string) => void;
    auth.getAccessToken.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
    const settled = getCardGame().catch(error => error);
    await waitFor(() => expect(auth.getAccessToken).toHaveBeenCalledTimes(1));
    login('member-a', 'team-2'); resolve('new-team-token');
    expect(isCancel(await settled)).toBe(true); expect(adapter).not.toHaveBeenCalled();
  });
  it('rejects a successful old response rather than delivering it to a new account', async () => {
    let resolve!: (response: Awaited<ReturnType<AxiosAdapter>>) => void;
    adapter.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const settled = getCardGame().catch(error => error);
    await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
    const config = adapter.mock.calls[0][0]; login('member-b');
    resolve({ config, data: { privateOldAccountData: true }, status: 200, statusText: 'OK', headers: new AxiosHeaders() });
    expect(isCancel(await settled)).toBe(true);
  });
  it('allows token renewal for the same account without adding identity metadata to HTTP headers', async () => {
    auth.getAccessToken.mockResolvedValue('renewed-token');
    await acknowledgeCardInteractions(['a'.repeat(64)]);
    const config = adapter.mock.calls[0][0];
    expect(config.headers.get('Authorization')).toBe('Bearer renewed-token');
    expect(config.headers.has('accountScope')).toBe(false);
    expect(config.data).toBe(JSON.stringify({ ids: ['a'.repeat(64)] }));
  });
});

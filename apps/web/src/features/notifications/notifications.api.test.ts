import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({ getAccessToken: vi.fn(), refreshAccessToken: vi.fn() }));
vi.mock('@/shared/auth/logto', () => authMocks);

describe('notifications.api', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    authMocks.getAccessToken.mockResolvedValue('token-1');
    authMocks.refreshAccessToken.mockReset().mockResolvedValue('fresh');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('parses SSE events from the notification stream', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [
              'event: connected',
              'data: {"connectedAt":"2026-04-16T00:00:00.000Z"}',
              '',
              'event: notification.created',
              'data: {"id":"notification-1","title":"打卡记录已被标记"}',
              '',
              'event: heartbeat',
              'data: {"timestamp":"2026-04-16T00:00:30.000Z"}',
              '',
            ].join('\n')
          )
        );
        controller.close();
      }
    });

    vi.mocked(fetch).mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream'
        }
      })
    );

    const { connectNotificationStream } = await import('./notifications.api');
    const onEvent = vi.fn();
    const onError = vi.fn();

    await connectNotificationStream('token-1', {
      signal: new AbortController().signal,
      onEvent,
      onError
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/notifications/stream', {
      headers: {
        Authorization: 'Bearer token-1',
        Accept: 'text/event-stream'
      },
      signal: expect.any(AbortSignal)
    });
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      event: 'connected',
      data: { connectedAt: '2026-04-16T00:00:00.000Z' }
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      event: 'notification.created',
      data: { id: 'notification-1', title: '打卡记录已被标记' }
    });
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      event: 'heartbeat',
      data: { timestamp: '2026-04-16T00:00:30.000Z' }
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
  it('reacquires the SDK token when reconnecting instead of reusing the login snapshot', async () => {
    const { connectNotificationStream } = await import('./notifications.api');
    authMocks.getAccessToken.mockResolvedValueOnce('refreshed-1').mockResolvedValueOnce('refreshed-2');
    vi.mocked(fetch).mockImplementation(async () => new Response('event: heartbeat\ndata: {}\n\n'));
    for (let i = 0; i < 2; i += 1) {
      await connectNotificationStream('expired-login-token', {
        signal: new AbortController().signal, onEvent: vi.fn(), onError: vi.fn()
      });
    }
    expect(fetch).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer refreshed-1' })
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer refreshed-2' })
    }));
  });

  it('refreshes once after 401 and keeps the business login when the retry succeeds', async () => {
    const { useAuthStore } = await import('@/app/store/auth-store');
    useAuthStore.getState().setAuth({ token: 'login-snapshot', user: null });
    const { connectNotificationStream } = await import('./notifications.api');
    authMocks.getAccessToken.mockResolvedValueOnce('old');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response('event: connected\ndata: {}\n\n'));
    await connectNotificationStream('snapshot', { signal: new AbortController().signal, onEvent: vi.fn(), onError: vi.fn() });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(authMocks.getAccessToken).toHaveBeenCalledOnce();
    expect(authMocks.refreshAccessToken).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fresh' }) }));
    expect(useAuthStore.getState().auth.token).toBe('login-snapshot');
  });

  it('reports connection errors without an unhandled rejection or clearing a valid login', async () => {
    const { useAuthStore } = await import('@/app/store/auth-store');
    useAuthStore.getState().setAuth({ token: 'valid', user: null });
    const { connectNotificationStream } = await import('./notifications.api');
    vi.mocked(fetch).mockRejectedValue(new TypeError('network down'));
    const onError = vi.fn();
    await expect(connectNotificationStream('snapshot', { signal: new AbortController().signal, onEvent: vi.fn(), onError })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce(); expect(useAuthStore.getState().auth.token).toBe('valid');
  });

  it('does not retry permission failures inside the credential refresh loop', async () => {
    const { connectNotificationStream } = await import('./notifications.api');
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 403 }));
    const onError = vi.fn();
    await connectNotificationStream('snapshot', { signal: new AbortController().signal, onEvent: vi.fn(), onError });
    expect(fetch).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    expect(authMocks.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('clears local authentication only after a second confirmed 401, with one refresh', async () => {
    const { useAuthStore } = await import('@/app/store/auth-store');
    useAuthStore.getState().setAuth({ token: 'valid', user: null });
    const { connectNotificationStream } = await import('./notifications.api');
    vi.mocked(fetch).mockImplementation(async () => new Response('', { status: 401 }));
    const onError = vi.fn();
    await connectNotificationStream('snapshot', { signal: new AbortController().signal, onEvent: vi.fn(), onError });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(authMocks.refreshAccessToken).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().auth.token).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it.each(['network', 'missing'])('retains authentication when SDK refresh fails: %s', async (failure) => {
    const { useAuthStore } = await import('@/app/store/auth-store');
    useAuthStore.getState().setAuth({ token: 'valid', user: null });
    const { connectNotificationStream } = await import('./notifications.api');
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }));
    if (failure === 'network') authMocks.refreshAccessToken.mockRejectedValue(new TypeError('network down'));
    else authMocks.refreshAccessToken.mockResolvedValue(undefined);
    const onError = vi.fn();
    await connectNotificationStream('snapshot', { signal: new AbortController().signal, onEvent: vi.fn(), onError });
    expect(fetch).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().auth.token).toBe('valid');
  });

  it('does not reconnect if aborted while refreshing', async () => {
    const { connectNotificationStream } = await import('./notifications.api');
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }));
    authMocks.refreshAccessToken.mockImplementation(async () => { controller.abort(); return 'fresh'; });
    const onError = vi.fn();
    await connectNotificationStream('snapshot', { signal: controller.signal, onEvent: vi.fn(), onError });
    expect(fetch).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not clear a new login when an aborted connection returns a late second 401', async () => {
    const { useAuthStore } = await import('@/app/store/auth-store');
    const { connectNotificationStream } = await import('./notifications.api');
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 })).mockImplementationOnce(async () => {
      controller.abort();
      useAuthStore.getState().setAuth({ token: 'new-login', user: null });
      return new Response('', { status: 401 });
    });
    await connectNotificationStream('old-login', { signal: controller.signal, onEvent: vi.fn(), onError: vi.fn() });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().auth.token).toBe('new-login');
  });

});

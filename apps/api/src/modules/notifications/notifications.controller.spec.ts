import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsController } from './notifications.controller';
const member = { userId: 'user-1', teamId: 'team-1', role: 'member', tokenExpiresAt: 0 } as any;
describe('NotificationsController', () => {
  const service = { listForUser: vi.fn(), acknowledge: vi.fn(), subscribe: vi.fn(), createNotice: vi.fn(), listSent: vi.fn(), readStatus: vi.fn() };
  const users = { findById: vi.fn() };
  let controller: NotificationsController;
  beforeEach(() => { vi.clearAllMocks(); controller = new NotificationsController(service as any, users as any); });
  afterEach(() => { vi.useRealTimers(); });
  it('passes the verified role to bounded notification reads and acknowledgements', async () => {
    service.listForUser.mockResolvedValue([{ id: 'id' }]);
    await controller.listMyNotifications(member, 'all', '999');
    expect(service.listForUser).toHaveBeenCalledWith(member.teamId, member.userId, { status: 'all', limit: 100, before: undefined }, 'member');
    controller.acknowledgeNotification(member, 'notice-id');
    expect(service.acknowledge).toHaveBeenCalledWith(member.teamId, member.userId, 'notice-id', 'member');
  });
  it('rejects all admin notification endpoints for ordinary access', () => {
    expect(() => controller.createNotice(member, {} as any)).toThrow();
    expect(() => controller.listSent(member)).toThrow();
    expect(() => controller.readStatus(member, 'id')).toThrow();
    expect(service.createNotice).not.toHaveBeenCalled();
    expect(service.readStatus).not.toHaveBeenCalled();
  });
  const response = () => { const res = { setHeader: vi.fn(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn(), status: vi.fn() }; res.status.mockReturnValue(res); return res; };
  it('closes a stream exactly at token expiry and cleans up once', async () => {
    vi.useFakeTimers(); const unsubscribe = vi.fn(); service.subscribe.mockReturnValue(unsubscribe);
    const res = response(); let close: (() => void) | undefined;
    controller.streamNotifications({ ...member, tokenExpiresAt: Date.now() / 1000 + 2 }, { on: (_: string, fn: () => void) => { close = fn; } } as any, res as any);
    expect(res.write).toHaveBeenCalledWith('event: connected\ndata: {}\n\n');
    await vi.advanceTimersByTimeAsync(2000);
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(res.end).toHaveBeenCalledOnce();
    close?.(); expect(res.end).toHaveBeenCalledOnce();
  });
  it('closes an existing stream when the local account is disabled without signing out attendance', async () => {
    vi.useFakeTimers(); const unsubscribe = vi.fn(); service.subscribe.mockReturnValue(unsubscribe);
    users.findById.mockResolvedValue({ teamId: member.teamId, status: 'disabled' });
    const res = response();
    controller.streamNotifications({ ...member, tokenExpiresAt: Date.now() / 1000 + 300 }, { on: vi.fn() } as any, res as any);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(res.end).toHaveBeenCalledOnce();
  });
  it('does not subscribe a token with no remaining lifetime', () => {
    const res = response(); controller.streamNotifications(member, { on: vi.fn() } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(401); expect(service.subscribe).not.toHaveBeenCalled();
  });
});

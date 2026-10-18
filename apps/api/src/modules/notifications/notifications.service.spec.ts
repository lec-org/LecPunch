import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';
const user = { userId: 'user-1', teamId: 'team-1', role: 'member', tokenExpiresAt: Date.now() / 1000 + 300 } as any;
describe('NotificationsService delivery boundary', () => {
  const create = vi.fn(), findOneAndUpdate = vi.fn();
  let service: NotificationsService;
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockImplementation(async (input: any) => ({ ...input, id: 'notice-1', createdAt: new Date() }));
    findOneAndUpdate.mockReturnValue({ exec: vi.fn().mockResolvedValue({ id: 'report-notice', teamId: 'team-1', type: 'report.submitted', createdAt: new Date() }) });
    service = new NotificationsService({ create, findOneAndUpdate } as any, {} as any, {} as any);
  });
  it('retains the attendance payload while streams contain only an invalidation hint', async () => {
    const send = vi.fn(); service.subscribe(user, send);
    const result = await service.createForAttendanceRecordMarked({ teamId: user.teamId, userId: user.userId, sourceId: 'record-1', memberKey: 'key', weekKey: '2026-10-12', createdBy: 'admin-1' });
    expect(result.payload).toEqual({ recordId: 'record-1', memberKey: 'key', weekKey: '2026-10-12' });
    expect(send).toHaveBeenCalledWith({ event: 'notifications.changed', data: {} });
    expect(JSON.stringify(send.mock.calls)).not.toContain('record-1');
  });
  it('does not send admin hints to members, other teams, expired sessions or disconnected subscribers', async () => {
    const allowed = vi.fn(), member = vi.fn(), expired = vi.fn(), other = vi.fn(), disconnected = vi.fn();
    service.subscribe({ ...user, role: 'admin' }, allowed);
    service.subscribe(user, member);
    service.subscribe({ ...user, role: 'admin', tokenExpiresAt: 1 }, expired);
    service.subscribe({ ...user, role: 'admin', teamId: 'team-2' }, other);
    service.subscribe({ ...user, role: 'admin' }, disconnected)();
    await service.createForReportSubmitted({ teamId: user.teamId, reportId: 'r', reporterUserId: user.userId, reporterDisplayName: 'Reporter', imageCount: 0, imagesExpireAt: null });
    expect(allowed).toHaveBeenCalledOnce();
    for (const denied of [member, expired, other, disconnected]) expect(denied).not.toHaveBeenCalled();
    expect(findOneAndUpdate).toHaveBeenCalledWith({ deliveryKey: 'report:team-1:r' }, expect.objectContaining({ $setOnInsert: expect.objectContaining({ audience: 'team_admin' }) }), expect.anything());
  });
});

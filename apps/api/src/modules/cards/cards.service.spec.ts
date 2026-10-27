import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { CardsService, cardActionHash, seededCardRandom } from './cards.service';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/types/auth-user.type';

const actor: AuthUser = { userId: '6a0000000000000000000011', teamId: '6a0000000000000000000001', role: 'member', username: 'test.alpha', displayName: '测试成员', enrollYear: 2025 };
const query = (get: () => unknown): any => ({ lean() { return this; }, select() { return this; }, exec: async () => structuredClone(get()) });

function fixture() {
  let document: any = null;
  const games = {
    findOne: ({ teamId }: any) => query(() => document?.teamId === teamId ? document : null),
    updateOne: (where: any, update: any) => ({ exec: async () => {
      if (!document && update.$setOnInsert) { document = structuredClone(update.$setOnInsert); return { modifiedCount: 0 }; }
      if (where.revision !== undefined && document?.revision !== where.revision) return { modifiedCount: 0 };
      if (update.$set) Object.assign(document, structuredClone(update.$set));
      if (update.$inc) document.revision += update.$inc.revision;
      return { modifiedCount: update.$set ? 1 : 0 };
    } })
  };
  const members = [{ _id: actor.userId, username: actor.username, displayName: actor.displayName, enrollYear: 2025 }];
  const users = { find: () => query(() => members) };
  const ledger = { aggregate: () => query(() => [{ _id: actor.userId, points: 60 }]) };
  let attendanceRows: any[] = [];
  let attendanceFilter: any;
  const attendance = { find: (filter: unknown) => { attendanceFilter = filter; return query(() => attendanceRows); } };
  const config = new ConfigService({ AUTH_SECRET: 'local-test-signing-key-of-sufficient-length' });
  const service = new CardsService(games as any, users as any, ledger as any, attendance as any, config);
  return { service, document: () => document, members,
    setAttendance: (rows: any[]) => { attendanceRows = rows; }, attendanceFilter: () => attendanceFilter };
}

describe('CardsService atomic actions and private collection', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });

  it('reads pending previous-week checkouts before returning old entertainment history', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T16:01:00Z'));
    try {
      const current = await f.service.getMe(actor);
      f.document().state.members[actor.userId].weeks['2026-10-19'] = {
        entertainmentSeconds: 0, mintedSeconds: 0, spentPoints: 0, freeUsed: 2, bonusDraws: 0,
        accelerationAt: Date.parse('2026-10-25T15:40:00Z')
      };
      f.setAttendance([{_id:'sunday-checkout',userId:actor.userId,weekKey:'2026-10-19',
        checkOutAt:new Date('2026-10-25T15:50:00Z'),durationSeconds:600}]);
      expect(await f.service.getTeamWeekEntertainment(actor.teamId,'2026-10-19')).toEqual({[actor.userId]:90});
      expect(f.attendanceFilter().weekKey.$in).toContain('2026-10-19');
      expect((await f.service.getMe(actor)).points.bonus).toBe(0);
      expect((await f.service.getTeamWeekEntertainment(actor.teamId,'2026-10-19'))[actor.userId]).toBe(90);
      expect(f.document().state.members[actor.userId].weeks[current.week].mintedSeconds).toBe(0);
    } finally { clock.mockRestore(); }
  });

  it('returns opaque locked identities without names or rules', async () => {
    const view = await f.service.getMe(actor);
    expect(view.collection).toHaveLength(21);
    expect(view.collection.every(card => /^card-\d{2}$/.test(card.id) && !card.unlocked && card.quantity === 0 && !card.name && !card.effect)).toBe(true);
    expect(view.freeRemaining).toBe(2);
    expect(view.points.balance).toBe(60);
    expect(view.entertainmentSeconds).toBe(0);
  });

  it('commits inventory, discovery, free usage and receipt once for replayed request', async () => {
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const first = await f.service.action(actor, input), replay = await f.service.action(actor, input);
    expect(replay.result).toEqual(first.result);
    expect(first.result.gainedCardIds).toEqual([first.result.gainedCardId]);
    expect(['blue', 'purple', 'gold']).toContain(first.result.drawAnimation);
    expect(first.result.ssrPity).toBe(false);
    expect(replay.state.freeRemaining).toBe(1);
    expect(replay.state.collection.reduce((n, card) => n + card.quantity, 0)).toBe(1);
    expect(replay.state.collection.filter(card => card.unlocked)).toHaveLength(1);
    expect(Object.keys(f.document().receipts)).toHaveLength(1);
    await expect(f.service.action(actor, { ...input, action: 'use', cardId: 'card-01' })).rejects.toThrow('同一操作编号不能用于不同请求');
  });

  it('persists opaque dual SSR outcomes and animation across retries and status queries', async () => {
    await f.service.getMe(actor);
    f.document().state.members[actor.userId].pitySSR = 49;
    let input = { requestKey: randomUUID(), action: 'draw' as const };
    // Pick an operation key with the intended server-seeded branch; no production RNG is replaced.
    for (let i = 0; i < 200; i++) {
      const receiptKey = createHash('sha256').update(`${actor.userId}:${input.requestKey}`).digest('hex');
      const seed = `${actor.teamId}:${receiptKey}:${cardActionHash(input)}`;
      const random = seededCardRandom('local-test-signing-key-of-sufficient-length', seed);
      if (random() < 0.3 && Math.floor(random() * 3) === Math.floor(random() * 3)) break;
      input = { ...input, requestKey: randomUUID() };
    }
    const first = await f.service.action(actor, input);
    expect(first.result.drawAnimation).toBe('radiance');
    expect(first.result.ssrPity).toBe(true);
    expect(first.result.gainedCardIds).toHaveLength(2);
    expect(first.result.gainedCardIds![0]).toBe(first.result.gainedCardIds![1]);
    expect(first.result.gainedCardIds!.every(id => /^card-\d{2}$/.test(id))).toBe(true);
    expect(first.result.gainedCardId).toBe(first.result.gainedCardIds![0]);
    expect(first.state.collection.reduce((n, card) => n + card.quantity, 0)).toBe(2);
    expect(first.state.collection.filter(card => card.unlocked)).toHaveLength(1);
    expect(first.state.freeRemaining).toBe(1);
    const replay = await f.service.action(actor, input);
    const status = await f.service.actionStatus(actor, input.requestKey);
    expect(replay.result).toEqual(first.result);
    expect(status.result).toEqual(first.result);
    expect(status.state.collection.reduce((n, card) => n + card.quantity, 0)).toBe(2);
    expect(Object.keys(f.document().receipts)).toHaveLength(1);
    expect(JSON.stringify(first.result)).not.toContain('ssr-');
  });

  it('serializes concurrent draws and debits the third draw once', async () => {
    const inputs = Array.from({ length: 3 }, () => ({ requestKey: randomUUID(), action: 'draw' as const }));
    await Promise.all(inputs.map(input => f.service.action(actor, input)));
    const view = await f.service.getMe(actor);
    expect(view.freeRemaining).toBe(0);
    expect(view.points).toMatchObject({ earned: 60, spent: 60, balance: 0 });
    expect(view.collection.reduce((n, card) => n + card.quantity, 0)).toBe(3);
    await expect(f.service.action(actor, { requestKey: randomUUID(), action: 'draw' })).rejects.toThrow();
    expect((await f.service.getMe(actor)).collection.reduce((n, card) => n + card.quantity, 0)).toBe(3);
  });

  it('checks the authenticated active participant and protects locked artwork', async () => {
    await expect(f.service.getMe({ ...actor, userId: '6a0000000000000000000099' })).rejects.toThrow('当前账号不可参与');
    await expect(f.service.artwork(actor, 'card-01')).rejects.toThrow('尚未发现');
    await expect(f.service.actionStatus(actor, randomUUID())).rejects.toThrow('尚未确认');
  });

  it('does not initialize gameplay or unknown historical weeks merely from stats reads', async () => {
    expect(await f.service.getTeamWeekEntertainment(actor.teamId, '2026-01-01')).toEqual({});
    expect(f.document()).toBeNull();
    await f.service.getMe(actor);
    const before = JSON.stringify(f.document());
    expect(await f.service.getTeamWeekEntertainment(actor.teamId, '2026-01-01')).toEqual({ [actor.userId]: 0 });
    expect(JSON.stringify(f.document())).toBe(before);
  });

  it('reads member entertainment weeks without creating a game or inventing history', async () => {
    expect(await f.service.getMemberEntertainmentHistory(actor.teamId, actor.userId)).toEqual({});
    expect(f.document()).toBeNull();
    const view = await f.service.getMe(actor);
    f.document().state.members[actor.userId].weeks['2026-10-19'] = { entertainmentSeconds: -1800, mintedSeconds: 0, spentPoints: 0, freeUsed: 2, bonusDraws: 0 };
    expect(await f.service.getMemberEntertainmentHistory(actor.teamId, actor.userId)).toEqual({ [view.week]: 0, '2026-10-19': -1800 });
    expect(await f.service.getMemberEntertainmentHistory(actor.teamId, 'unknown-member')).toEqual({});
  });

  it('keeps random outcomes stable across CAS retry and request hashes canonical', () => {
    const one = seededCardRandom('secret', 'key'), two = seededCardRandom('secret', 'key');
    expect(Array.from({ length: 12 }, one)).toEqual(Array.from({ length: 12 }, two));
    expect(cardActionHash({ action: 'draw' })).toBe(cardActionHash({ action: 'draw', cardId: undefined }));
    expect(cardActionHash({ action: 'use', cardId: 'card-01' })).not.toBe(cardActionHash({ action: 'gift', cardId: 'card-01' }));
  });

  it('rejects new writes at capacity without discarding receipts or breaking read access', async () => {
    const view = await f.service.getMe(actor);
    delete f.document().state.members[actor.userId].weeks[view.week];
    f.document().receipts.padding = { actorId: 'another-user', requestKey: 'original', hash: 'old-hash', at: new Date().toISOString(), result: { message: 'x'.repeat(8 * 1024 * 1024) } };
    expect((await f.service.getMe(actor)).capacityLimited).toBe(true);
    await expect(f.service.action(actor, { requestKey: randomUUID(), action: 'draw' })).rejects.toThrow('安全容量');
    expect(f.document().receipts.padding.requestKey).toBe('original');
    expect(Object.keys(f.document().receipts)).toHaveLength(1);
    expect((await f.service.getMe(actor)).collection.every(card => card.quantity === 0)).toBe(true);
  });
});

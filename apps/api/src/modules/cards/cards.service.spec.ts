import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { CardsService, cardActionHash, seededCardRandom } from './cards.service';
import { CardCapacityException, CardStorageService } from './card-storage.service';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/types/auth-user.type';

const actor: AuthUser = { userId: '6a0000000000000000000011', teamId: '6a0000000000000000000001', role: 'member', username: 'test.alpha', displayName: '测试成员', enrollYear: 2025 };
const query = (get: () => any): any => {
  let limit = Infinity, sort: any;
  return { lean() { return this; }, select() { return this; }, sort(value: any) { sort = value; return this; }, limit(value: number) { limit = value; return this; }, exec: async () => {
    let result = structuredClone(get());
    if (Array.isArray(result)) {
      if (sort) result.sort((a, b) => b.at.localeCompare(a.at) || a.receiptKey.localeCompare(b.receiptKey));
      result = result.slice(0, limit);
    }
    return result;
  } };
};
function archiveModel(keyFields: string[]) {
  const rows = new Map<string, any>(); let fail = false;
  const match = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
  const model: any = {
    init: async () => undefined,
    findOne: (where: any) => query(() => [...rows.values()].find(row => match(row, where)) ?? null),
    find: (where: any) => query(() => [...rows.values()].filter(row => match(row, where))),
    updateOne: (where: any, update: any) => ({ exec: async () => {
      if (fail) throw new Error('archive unavailable');
      const key = keyFields.map(k => where[k]).join(':');
      const old = rows.get(key);
      if (old && !match(old, where)) throw Object.assign(new Error('duplicate archive'), { code: 11000 });
      if (!old) rows.set(key, structuredClone(update.$setOnInsert));
      return { modifiedCount: old ? 0 : 1 };
    } }),
    bulkWrite: async (operations: any[]) => { for (const { updateOne: op } of operations) await model.updateOne(op.filter, op.update).exec(); }
  };
  return { model, rows, setFailure: (value: boolean) => { fail = value; } };
}

function fixture() {
  let document: any = null;
  const games = {
    init: async () => undefined,
    findOne: ({ teamId }: any) => query(() => document?.teamId === teamId ? document : null),
    updateOne: (where: any, update: any) => ({ exec: async () => {
      if (!document && update.$setOnInsert) { document = structuredClone(update.$setOnInsert); return { modifiedCount: 0 }; }
      if (where.revision !== undefined && document?.revision !== where.revision) return { modifiedCount: 0 };
      if (where.pendingWrite?.$exists === false && document?.pendingWrite) return { modifiedCount: 0 };
      if (update.$set) Object.assign(document, structuredClone(update.$set));
      if (update.$inc) document.revision += update.$inc.revision;
      for (const key of Object.keys(update.$unset ?? {})) {
        if (key.startsWith('receipts.')) delete document.receipts[key.slice(9)];
        else delete document[key];
      }
      return { modifiedCount: update.$set ? 1 : 0 };
    } })
  };
  const members = [{ _id: actor.userId, username: actor.username, displayName: actor.displayName, enrollYear: 2025 }];
  const users = { find: () => query(() => members) };
  const points = { getTeamWeekEarnedPoints: vi.fn(async () => ({ [actor.userId]: 60 })) };
  let attendanceRows: any[] = [];
  let attendanceFilter: any;
  const attendance = { find: (filter: any) => { attendanceFilter = filter; return query(() => attendanceRows.filter(row => filter.weekKey.$in.includes(row.weekKey))); } };
  const config = new ConfigService({ AUTH_SECRET: 'local-test-signing-key-of-sufficient-length' });
  const receipts = archiveModel(['teamId', 'receiptKey']), weeks = archiveModel(['teamId', 'userId', 'weekKey']);
  const storage = new CardStorageService(games as any, receipts.model, weeks.model);
  const service = new CardsService(games as any, users as any, points as any, attendance as any, config, storage);
  return { service, storage, games, receipts, weeks, points, document: () => document, members,
    setAttendance: (rows: any[]) => { attendanceRows = rows; }, attendanceFilter: () => attendanceFilter };
}

describe('CardsService atomic actions and private collection', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('uses adjusted earnings for paid draws and retains spent points after a deduction', async () => {
    f.points.getTeamWeekEarnedPoints.mockResolvedValue({ [actor.userId]: 120 });
    const first = await f.service.getMe(actor);
    f.document().state.members[actor.userId].weeks[first.week].freeUsed = 2;
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const drawn = await f.service.action(actor, input);
    expect(drawn.state.points).toMatchObject({ earned: 120, spent: 60, balance: 60 });
    expect((await f.service.action(actor, input)).state.points.spent).toBe(60);
    f.points.getTeamWeekEarnedPoints.mockResolvedValue({ [actor.userId]: 30 });
    expect((await f.service.getMe(actor)).points).toMatchObject({ earned: 30, spent: 60, balance: 0 });
    await expect(f.service.action(actor, { requestKey: randomUUID(), action: 'draw' })).rejects.toThrow('积分不足');
    f.points.getTeamWeekEarnedPoints.mockResolvedValue({ [actor.userId]: 120 });
    expect((await f.service.getMe(actor)).points.balance).toBe(60);
    expect(f.points.getTeamWeekEarnedPoints).toHaveBeenCalledWith(actor.teamId, first.week);
  });

  it.each(['2026-10-25T16:01:00Z', '2026-10-25T22:01:00Z'])('reconciles previous-week acceleration before reading or archiving at %s', async now => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
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

  it('reloads attendance context after a CAS conflict introduces a previous-week acceleration', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-26T06:01:00+08:00'));
    try {
      const view = await f.service.getMe(actor);
      delete f.document().state.members[actor.userId].weeks[view.week];
      f.setAttendance([{ _id: 'last-sunday', userId: actor.userId, weekKey: '2026-10-19',
        checkOutAt: new Date('2026-10-25T23:50:00+08:00'), durationSeconds: 600 }]);
      vi.spyOn(f.storage, 'commit').mockImplementationOnce(async () => {
        f.document().state.members[actor.userId].weeks['2026-10-19'] = { entertainmentSeconds: 0, mintedSeconds: 0,
          spentPoints: 0, freeUsed: 2, bonusDraws: 0, accelerationAt: Date.parse('2026-10-25T23:40:00+08:00') };
        f.document().revision++;
        return false;
      });
      await f.service.getMe(actor);
      expect((await f.service.getTeamWeekEntertainment(actor.teamId, '2026-10-19'))[actor.userId]).toBe(90);
      expect((await f.service.getMe(actor)).points.bonus).toBe(0);
    } finally { vi.useRealTimers(); }
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
    expect(f.receipts.rows.size).toBe(1);
    expect(Object.keys(f.document().receipts)).toHaveLength(0);
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
    expect(f.receipts.rows.size).toBe(1);
    expect(Object.keys(f.document().receipts)).toHaveLength(0);
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
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const confirmed = await f.service.action(actor, input);
    const activeMember = f.members.pop()!;
    await expect(f.service.action(actor, input)).rejects.toThrow('当前账号不可参与');
    await expect(f.service.actionStatus(actor, input.requestKey)).rejects.toThrow('当前账号不可参与');
    expect(f.receipts.rows.size).toBe(1);
    f.members.push(activeMember);
    expect((await f.service.action(actor, input)).result).toEqual(confirmed.result);
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

  it('recovers a committed draw after receipt archival fails without spending or granting twice', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    f.receipts.setFailure(true);
    await expect(f.service.action(actor, input)).rejects.toThrow('archive unavailable');
    expect(f.document().pendingWrite.receipt.value.requestKey).toBe(input.requestKey);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ message: 'Pending card write recovery failed', teamId: actor.teamId,
      receiptKey: f.document().pendingWrite.receipt.receiptKey, archivedWeeks: [] }));
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.requestKey);
    expect(f.document().state.members[actor.userId].weeks[Object.keys(f.document().state.members[actor.userId].weeks)[0]].freeUsed).toBe(1);
    f.receipts.setFailure(false);
    const replay = await f.service.action(actor, input);
    expect(replay.state.freeRemaining).toBe(1);
    expect(replay.state.collection.reduce((n, card) => n + card.quantity, 0)).toBe(1);
    expect(f.document().pendingWrite).toBeUndefined();
    expect(f.receipts.rows.size).toBe(1);
    expect((await f.service.actionStatus(actor, input.requestKey)).result).toEqual(replay.result);
  });

  it('archives old receipts before removing their legacy copy and preserves old replay', async () => {
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const first = await f.service.action(actor, input);
    const [key, record] = [...f.receipts.rows.entries()][0];
    const { teamId, receiptKey, contentHash, ...value } = record;
    f.document().receipts[receiptKey] = value; f.receipts.rows.clear();
    f.receipts.setFailure(true);
    await expect(f.service.getMe(actor)).rejects.toThrow('archive unavailable');
    expect(f.document().receipts[receiptKey]).toBeDefined();
    f.receipts.setFailure(false);
    expect((await f.service.action(actor, input)).result).toEqual(first.result);
    expect(f.document().receipts[receiptKey]).toBeUndefined();
    expect(f.receipts.rows.get(key).requestKey).toBe(input.requestKey);
  });

  it('keeps closed signed entertainment history outside live state and retains permanent inventory and pity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-02T06:00:00+08:00'));
    try {
      await f.service.getMe(actor);
      const member = f.document().state.members[actor.userId];
      member.inventory['r-add'] = 3; member.pitySSR = 12;
      member.weeks['2026-10-26'] = { entertainmentSeconds: -900, mintedSeconds: 0, spentPoints: 60, freeUsed: 2, bonusDraws: 0 };
      await f.service.getMe(actor);
      expect(f.document().state.members[actor.userId].weeks['2026-10-26']).toBeUndefined();
      expect(f.weeks.rows.size).toBe(1);
      expect(await f.service.getTeamWeekEntertainment(actor.teamId, '2026-10-26')).toEqual({ [actor.userId]: -900 });
      expect((await f.service.getMemberEntertainmentHistory(actor.teamId, actor.userId))['2026-10-26']).toBe(-900);
      expect(f.document().state.members[actor.userId]).toMatchObject({ inventory: { 'r-add': 3 }, pitySSR: 12 });
    } finally { vi.useRealTimers(); }
  });

  it('never returns a false zero while a committed history archive awaits recovery', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await f.service.getMe(actor);
    f.document().state.members[actor.userId].weeks['2026-01-05'] = { entertainmentSeconds: 1800, mintedSeconds: 0, spentPoints: 0, freeUsed: 2, bonusDraws: 0 };
    f.weeks.setFailure(true);
    await expect(f.service.getMemberEntertainmentHistory(actor.teamId, actor.userId)).rejects.toThrow('archive unavailable');
    expect(f.document().pendingWrite.weeks).toHaveLength(1);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ teamId: actor.teamId, archivedWeeks: [{ userId: actor.userId, weekKey: '2026-01-05' }] }));
    await expect(f.service.getTeamWeekEntertainment(actor.teamId, '2026-01-05')).rejects.toThrow('archive unavailable');
    f.weeks.setFailure(false);
    expect(await f.service.getTeamWeekEntertainment(actor.teamId, '2026-01-05')).toEqual({ [actor.userId]: 1800 });
  });

  it('rejects genuinely oversized live state without deleting receipts or breaking read access', async () => {
    const first = await f.service.action(actor, { requestKey: randomUUID(), action: 'draw' });
    const view = await f.service.getMe(actor);
    delete f.document().state.members[actor.userId].weeks[view.week];
    f.document().state.members[actor.userId].discovered.push('x'.repeat(8 * 1024 * 1024));
    expect((await f.service.getMe(actor)).capacityLimited).toBe(true);
    const capacity = vi.spyOn(f.storage, 'commit').mockRejectedValue(new CardCapacityException('Different localized capacity message'));
    expect((await f.service.getMe(actor)).capacityLimited).toBe(true);
    capacity.mockRestore();
    await expect(f.service.action(actor, { requestKey: randomUUID(), action: 'draw' })).rejects.toThrow('安全容量');
    expect(f.receipts.rows.size).toBe(1);
    await expect(f.service.getMemberEntertainmentHistory(actor.teamId, actor.userId)).rejects.toThrow('可信结算');
    expect((await f.service.getMe(actor)).collection.reduce((sum, card) => sum + card.quantity, 0)).toBe(1);
  });
});

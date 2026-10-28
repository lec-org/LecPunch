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
  const match = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    const actual = key.split('.').reduce((item, part) => item?.[part], row);
    if (value && typeof value === 'object' && '$exists' in value) return (actual !== undefined) === value.$exists;
    if (value && typeof value === 'object' && '$in' in value) return value.$in.includes(actual);
    return actual === value;
  });
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
    updateMany: (where: any, update: any) => ({ exec: async () => {
      if (fail) throw new Error('archive unavailable');
      let modifiedCount = 0;
      for (const row of rows.values()) if (match(row, where)) { Object.assign(row, structuredClone(update.$set)); modifiedCount++; }
      return { modifiedCount };
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
  const points = { getTeamWeekBaseSeconds: vi.fn(async () => ({ [actor.userId]: 3600 })) };
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

  it('accepts an identical receipt inserted by concurrent recovery after the upsert started', async () => {
    const original = f.receipts.model.updateOne.bind(f.receipts.model);
    vi.spyOn(f.receipts.model, 'updateOne').mockImplementationOnce(((where: any, update: any) => ({ exec: async () => {
      await original(where, update).exec();
      throw Object.assign(new Error('concurrent duplicate'), { code: 11000 });
    } })) as any);
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const first = await f.service.action(actor, input);
    expect((await f.service.action(actor, input)).result).toEqual(first.result);
    expect(f.receipts.rows.size).toBe(1);
    expect(first.state.freeRemaining).toBe(1);
  });
  it('does not swallow a duplicate whose saved receipt has different content', async () => {
    const original = f.receipts.model.updateOne.bind(f.receipts.model);
    vi.spyOn(f.receipts.model, 'updateOne').mockImplementationOnce(((where: any, update: any) => ({ exec: async () => {
      await original(where, { $setOnInsert: { ...update.$setOnInsert, contentHash: 'different-confirmed-content' } }).exec();
      throw Object.assign(new Error('conflicting duplicate'), { code: 11000 });
    } })) as any);
    await expect(f.service.action(actor, { requestKey: randomUUID(), action: 'draw' })).rejects.toThrow('conflicting duplicate');
    expect(f.document().pendingWrite).toBeDefined();
  });

  it('returns stable target names and the card name in the use receipt', async () => {
    const other = { _id: '6a0000000000000000000012', username: 'test.other', displayName: '其他成员', enrollYear: 2025 };
    f.members.push(other); await f.service.getMe(actor);
    f.document().state.members[actor.userId].inventory['n-reduce'] = 1;
    const input = { requestKey: randomUUID(), action: 'use' as const, cardId: 'card-02' };
    const response = await f.service.action(actor, input);
    expect(response.result.actionCard?.name).toBe('减时长');
    expect(response.result.effects?.[0]).toMatchObject({ target: { id: other._id, username: other.username, displayName: other.displayName }, outcome: 'applied', deltaSeconds: -1800 });
    expect(response.result.message).toContain('其他成员（test.other）');
    other.displayName = '改名后的成员';
    expect((await f.service.action(actor, input)).result).toEqual(response.result);
    expect(f.document().state.members[actor.userId].inventory['n-reduce']).toBe(0);
  });
  it('delivers a gift notice once and lets only its recipient acknowledge it without granting again', async () => {
    const other = { _id: '6a0000000000000000000012', username: 'test.other', displayName: '其他成员', enrollYear: 2025 };
    f.members.push(other); await f.service.getMe(actor);
    f.document().state.members[actor.userId].inventory['n-reduce'] = 1;
    f.document().state.members[actor.userId].discovered.push('n-reduce');
    const input = { requestKey: randomUUID(), action: 'gift' as const, cardId: 'card-02', targetId: other._id };
    const sent = await f.service.action(actor, input);
    const receiver = { ...actor, userId: other._id, username: other.username };
    const inbox = (await f.service.getMe(receiver)).incomingGifts!;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ sender: { username: actor.username }, card: { id: 'card-02', name: '减时长' } });
    expect(await f.service.acknowledgeGifts(actor, [inbox[0].id])).toEqual({ acknowledged: 0 });
    expect(await f.service.acknowledgeGifts(receiver, [inbox[0].id])).toEqual({ acknowledged: 1 });
    expect(await f.service.acknowledgeGifts(receiver, [inbox[0].id])).toEqual({ acknowledged: 0 });
    expect((await f.service.getMe(receiver)).incomingGifts).toEqual([]);
    expect(f.document().state.members[other._id].inventory['n-reduce']).toBe(1);
    expect((await f.service.action(actor, input)).result).toEqual(sent.result);
  });
  it.each([[], ['bad'], Array(21).fill('a'.repeat(64))])('rejects invalid gift acknowledgement IDs', async ids => {
    await expect(f.service.acknowledgeGifts(actor, ids)).rejects.toThrow('有效赠卡通知');
    expect(f.receipts.rows.size).toBe(0);
  });

  it('exposes one comprehensive quota, ignores old minted credits and retains spent debt', async () => {
    const initial = await f.service.getMe(actor);
    Object.assign(f.document().state.members[actor.userId].weeks[initial.week], { entertainmentSeconds: -2700, mintedSeconds: 7200, spentPoints: 30 });
    const view = await f.service.getMe(actor);
    expect(view.points).toMatchObject({ rule: 'comprehensive-v1', comprehensiveSeconds: 900, earned: 15, bonus: 0, spent: 30, balance: 0 });
    expect(await f.service.getWeekPoints(actor, view.week)).toEqual(view.points);
    f.points.getTeamWeekBaseSeconds.mockResolvedValue({ [actor.userId]: 5400 });
    expect((await f.service.getMe(actor)).points).toMatchObject({ earned: 45, spent: 30, balance: 15 });
  });

  it('reads historical consumption and signed time from immutable week archives', async () => {
    await f.service.getMe(actor);
    f.weeks.rows.set('history', { teamId: actor.teamId, userId: actor.userId, weekKey: '2026-01-05',
      week: { entertainmentSeconds: -900, mintedSeconds: 99999, spentPoints: 60, freeUsed: 2, bonusDraws: 0 } });
    f.points.getTeamWeekBaseSeconds.mockResolvedValue({ [actor.userId]: 7200 });
    expect(await f.service.getWeekPoints(actor, '2026-01-05')).toMatchObject({ earned: 105, spent: 60, balance: 45, comprehensiveSeconds: 6300 });
    expect(f.points.getTeamWeekBaseSeconds).toHaveBeenCalledWith(actor.teamId, '2026-01-05');
  });

  it('reports the 30/70 limits while preserving already accumulated pity progress', async () => {
    await f.service.getMe(actor);
    Object.assign(f.document().state.members[actor.userId], { pitySR: 9, pitySSR: 49 });
    expect((await f.service.getMe(actor)).pity).toEqual({ sinceSR: 9, sinceSSR: 49, srRemaining: 21, ssrRemaining: 21 });
  });

  it('stores one ten-draw receipt and replays the entire batch without extra payment or rewards', async () => {
    f.points.getTeamWeekBaseSeconds.mockResolvedValue({ [actor.userId]: 36000 });
    const input = { requestKey: randomUUID(), action: 'draw' as const, count: 10 as const };
    const first = await f.service.action(actor, input);
    const replay = await f.service.action(actor, input);
    const status = await f.service.actionStatus(actor, input.requestKey);
    expect(first.result.drawCount).toBe(10);
    expect(first.result.gainedCardIds!.length).toBeGreaterThanOrEqual(10);
    expect(first.result.gainedCardIds!.every(id => /^card-\d{2}$/.test(id))).toBe(true);
    expect(replay.result).toEqual(first.result); expect(status.result).toEqual(first.result);
    expect(replay.state.points.spent).toBe(480); expect(f.receipts.rows.size).toBe(1);
    expect(replay.state.collection.reduce((sum, card) => sum + card.quantity, 0)).toBe(first.result.gainedCardIds!.length);
    await expect(f.service.action(actor, { ...input, count: 1 })).rejects.toThrow('同一操作编号');
    expect(cardActionHash({ action: 'draw' })).toBe(cardActionHash({ action: 'draw', count: 1 }));
    expect(cardActionHash({ action: 'draw', count: 10 })).not.toBe(cardActionHash({ action: 'draw' }));
  });

  it('uses adjusted earnings for paid draws and retains spent points after a deduction', async () => {
    f.points.getTeamWeekBaseSeconds.mockResolvedValue({ [actor.userId]: 7200 });
    const first = await f.service.getMe(actor);
    f.document().state.members[actor.userId].weeks[first.week].freeUsed = 2;
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const drawn = await f.service.action(actor, input);
    expect(drawn.state.points).toMatchObject({ earned: 120, spent: 60, balance: 60 });
    expect((await f.service.action(actor, input)).state.points.spent).toBe(60);
    f.points.getTeamWeekBaseSeconds.mockResolvedValue({ [actor.userId]: 1800 });
    expect((await f.service.getMe(actor)).points).toMatchObject({ earned: 30, spent: 60, balance: 0 });
    await expect(f.service.action(actor, { requestKey: randomUUID(), action: 'draw' })).rejects.toThrow('积分不足');
    f.points.getTeamWeekBaseSeconds.mockResolvedValue({ [actor.userId]: 7200 });
    expect((await f.service.getMe(actor)).points.balance).toBe(60);
    expect(f.points.getTeamWeekBaseSeconds).toHaveBeenCalledWith(actor.teamId, first.week);
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

  it('persists a ten-card radiance result, including its replacement, across retries and status queries', async () => {
    f.points.getTeamWeekBaseSeconds.mockResolvedValue({ [actor.userId]: 36000 });
    await f.service.getMe(actor); f.document().state.members[actor.userId].pitySSR = 69;
    let input = { requestKey: randomUUID(), action: 'draw' as const, count: 10 as const };
    for (let attempt = 0; attempt < 1000; attempt++) {
      const receiptKey = createHash('sha256').update(`${actor.userId}:${input.requestKey}`).digest('hex');
      const random = seededCardRandom('local-test-signing-key-of-sufficient-length', `${actor.teamId}:${receiptKey}:${cardActionHash(input)}`);
      if (random() < 0.3) break;
      input = { ...input, requestKey: randomUUID() };
    }
    const first = await f.service.action(actor, input);
    expect(first.result).toMatchObject({ drawAnimation: 'radiance', ssrPity: true, drawCount: 10 });
    expect(first.result.gainedCardIds).toHaveLength(10);
    expect(first.result.gainedCardIds!.filter(id => first.state.collection.find(card => card.id === id)!.rarity === 'SSR').length).toBeGreaterThanOrEqual(2);
    expect(first.state.collection.reduce((sum, card) => sum + card.quantity, 0)).toBe(10);
    expect(first.state.points.spent).toBe(480);
    expect((await f.service.action(actor, input)).result).toEqual(first.result);
    expect((await f.service.actionStatus(actor, input.requestKey)).result).toEqual(first.result);
    expect(f.receipts.rows.size).toBe(1); expect(JSON.stringify(first.result)).not.toContain('ssr-');
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

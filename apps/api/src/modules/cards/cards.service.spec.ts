import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { CardsService, cardActionHash, seededCardRandom } from './cards.service';
import { CardCapacityException, CardStorageService } from './card-storage.service';
import { createHash, randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/types/auth-user.type';
import { getWeekKey } from '../../common/utils/time.util';

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
  const valuesAt = (row: any, parts: string[]): any[] => {
    if (Array.isArray(row)) return row.flatMap(item => valuesAt(item, parts));
    if (!parts.length) return [row];
    return valuesAt(row?.[parts[0]], parts.slice(1));
  };
  const match = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    const actual = valuesAt(row, key.split('.'));
    if (value && typeof value === 'object' && '$exists' in value) return actual.some(item => item !== undefined) === value.$exists;
    if (value && typeof value === 'object' && '$in' in value) return actual.some(item => value.$in.includes(item));
    if (value && typeof value === 'object' && '$ne' in value) return !actual.includes(value.$ne);
    return actual.includes(value);
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
      for (const row of rows.values()) if (match(row, where)) {
        Object.assign(row, structuredClone(update.$set ?? {}));
        for (const [key, value] of Object.entries(update.$addToSet ?? {})) row[key] = [...new Set([...(row[key] ?? []), value])];
        modifiedCount++;
      }
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
  let cohortEvidence: any[] = [];
  let cohortError: unknown;
  const service = new CardsService(games as any, users as any, points as any, attendance as any, config, storage, { aggregate: () => query(() => {
    if (cohortError) throw cohortError;
    return cohortEvidence;
  }) } as any);
  return { service, storage, games, receipts, weeks, points, document: () => document, members,
    setCohortEvidence: (rows: any[]) => { cohortEvidence = rows; },
    setCohortError: (error: unknown) => { cohortError = error; },
    setAttendance: (rows: any[]) => { attendanceRows = rows; }, attendanceFilter: () => attendanceFilter };
}

describe('CardsService atomic actions and private collection', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('keeps card reads, actions, acknowledgement and weekly totals available with an invalid member year', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    f.members.push({ _id: '6a0000000000000000000099', username: 'bad.year', displayName: 'Bad', enrollYear: 2062 });
    const view = await f.service.getMe(actor);
    expect(view.requiredEnrollYears).toEqual([2025, 2024]);
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const first = await f.service.action(actor, input);
    expect((await f.service.action(actor, input)).result).toEqual(first.result);
    expect(await f.service.acknowledgeInteractions(actor, ['a'.repeat(64)])).toEqual({ acknowledged: 0 });
    expect((await f.service.getWeekPoints(actor, view.week)).balance).toBe(60);
    expect((await f.service.getTeamWeekEntertainment(actor.teamId, view.week))[actor.userId]).toBe(0);
  });
  it('keeps ordinary cards available but blocks assessment-target cards when saved cohort evidence is malformed', async () => {
    const log = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const other = { _id: '6a0000000000000000000012', username: 'receiver', displayName: 'Receiver', enrollYear: 2025 };
    f.members.push(other); await f.service.getMe(actor);
    Object.assign(f.document().state.members[actor.userId].inventory, { 'r-skip': 1, 'r-add': 1 });
    f.setCohortEvidence([{ latest: 2062, invalid: 1 }]);
    expect((await f.service.getMe(actor)).requiredEnrollYears).toEqual([]);
    await expect(f.service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-10', targetId: other._id })).rejects.toThrow('请选择当前应考成员');
    expect(f.document().state.members[actor.userId].inventory['r-skip']).toBe(1);
    await f.service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-05', targetId: other._id });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ teamId: actor.teamId, source: 'persisted' }));
  });
  it.each([new Error('cohort database unavailable'), new ServiceUnavailableException('database service unavailable')])('propagates cohort database failures rather than treating them as invalid data: %s', async failure => {
    f.setCohortError(failure);
    await expect(f.service.getMe(actor)).rejects.toBe(failure);
    await expect(f.service.getTeamWeekEntertainment(actor.teamId, getWeekKey(new Date()))).rejects.toBe(failure);
  });

  it.each([['r-charity', 'card-09'], ['r-skip', 'card-10'], ['r-thief', 'card-11'], ['sr-famine', 'card-16'], ['sr-redking', 'card-18']])('notifies the affected members of %s and confirms without applying it again', async (cardId, publicCard) => {
    const receiver = { _id: '6a0000000000000000000012', username: 'test.receiver', displayName: 'Receiver', enrollYear: 2026 };
    const donor = { _id: '6a0000000000000000000013', username: 'test.donor', displayName: 'Donor', enrollYear: 2025 };
    f.members.push(receiver, donor); const start = await f.service.getMe(actor);
    f.document().state.members[actor.userId].inventory[cardId] = 1;
    for (const id of [actor.userId, donor._id]) f.document().state.members[id].weeks[start.week].entertainmentSeconds = 6000;
    const input = { requestKey: randomUUID(), action: 'use' as const, cardId: publicCard, ...(cardId !== 'r-charity' ? { targetId: receiver._id } : {}) };
    const first = await f.service.action(actor, input);
    const recipient = { ...actor, userId: receiver._id }, notice = (await f.service.getMe(recipient)).incomingInteractions![0];
    expect(notice.sender.username).toBe(actor.username); expect(notice.card.id).toBe(publicCard);
    expect(notice.randomlySelected).not.toBe(true);
    expect(notice.effects.some(effect => effect.target.id === receiver._id && effect.outcome === 'applied')).toBe(true);
    const before = structuredClone(f.document().state), savedHash = [...f.receipts.rows.values()][0].contentHash;
    expect(await f.service.acknowledgeInteractions(actor, [notice.id])).toEqual({ acknowledged: 0 });
    expect(await f.service.acknowledgeInteractions(recipient, [notice.id])).toEqual({ acknowledged: 1 });
    expect(await f.service.acknowledgeInteractions(recipient, [notice.id])).toEqual({ acknowledged: 0 });
    expect((await f.service.getMe(recipient)).incomingInteractions).toEqual([]);
    expect((await f.service.getMe(recipient)).events.some(event => event.message.includes(notice.card.name))).toBe(true);
    expect((await f.service.action(actor, input)).result).toEqual(first.result);
    expect(f.document().state).toEqual(before); expect([...f.receipts.rows.values()][0].contentHash).toBe(savedHash);
    if (cardId === 'r-thief') {
      const donorNotice = (await f.service.getMe({ ...actor, userId: donor._id })).incomingInteractions![0];
      expect(donorNotice.effects[0].deltaSeconds).toBe(-1800);
      expect(donorNotice.randomlySelected).toBe(true);
      expect(donorNotice.sender.username).toBe(actor.username);
    }
    if (cardId === 'sr-famine') {
      expect(notice.effects[0]).toMatchObject({ kind: 'status', detail: '暂停获得新卡 3 小时' });
      const locked = await f.service.getMe(recipient);
      expect(locked.statuses.starvedUntil).not.toBeNull();
      await expect(f.service.action(recipient, { requestKey: randomUUID(), action: 'draw' })).rejects.toThrow('兵粮寸断');
    }
  });

  it('reports lightning misses and a hit blocked by a ward to the two judged members', async () => {
    const receiver = { _id: '6a0000000000000000000012', username: 'test.b', displayName: 'B', enrollYear: 2025 };
    const second = { _id: '6a0000000000000000000013', username: 'test.c', displayName: 'C', enrollYear: 2025 };
    f.members.push(receiver, second); const initial = await f.service.getMe(actor);
    f.document().state.members[actor.userId].inventory['sr-lightning'] = 1;
    f.document().state.members[second._id].weeks[initial.week].immuneUntil = Date.now() + 86400000;
    const original = (f.service as any).context.bind(f.service), rolls = [0.9, 0];
    vi.spyOn(f.service as any, 'context').mockImplementation(async (...args: any[]) => ({ ...await original(...args), random: () => rolls.shift() ?? 0 }));
    await f.service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-14' });
    const miss = (await f.service.getMe({ ...actor, userId: receiver._id })).incomingInteractions![0];
    const hit = (await f.service.getMe({ ...actor, userId: second._id })).incomingInteractions![0];
    expect(miss.effects[0].detail).toContain('未命中');
    expect(miss).toMatchObject({ randomlySelected: true, sender: { username: actor.username } });
    expect(hit).toMatchObject({ randomlySelected: true, sender: { username: actor.username } });
    expect(hit.effects[0].detail).toContain('判定命中'); expect(hit.effects[1].outcome).toBe('blocked');
    expect((await f.service.getMe({ ...actor, userId: second._id })).entertainmentSeconds).toBe(0);
  });

  it('uses persisted assessment cohort evidence and exposes the right targeting scope', async () => {
    f.setCohortEvidence([{ latest: 2026, invalid: 0 }]);
    const initial = await f.service.getMe(actor);
    f.document().state.members[actor.userId].discovered = ['r-skip', 'r-steal'];
    const view = await f.service.getMe(actor);
    expect(view.requiredEnrollYears).toEqual([2026, 2025]);
    expect(view.collection.find(card => card.id === 'card-10')).toMatchObject({ targetMode: 'other', targetScope: 'assessment' });
    expect(view.collection.find(card => card.id === 'card-06')).toMatchObject({ targetMode: 'other', targetScope: 'same-grade' });
    expect(initial.week).toBe(view.week);
    f.setCohortEvidence([{ latest: 2062, invalid: 1 }]);
    expect((await f.service.getMe(actor)).requiredEnrollYears).toEqual([]);
  });

  it.each([['n-reduce', 'card-02', true], ['r-steal', 'card-06', false], ['sr-invasion', 'card-17', false], ['ssr-arrows', 'card-21', false]] as const)(
    'delivers the user and settled effect of %s even without a passive defense', async (cardId, publicCard, randomTarget) => {
      const other = { _id: '6a0000000000000000000012', username: 'test.victim', displayName: 'Victim', enrollYear: 2025 };
      f.members.push(other); const initial = await f.service.getMe(actor);
      f.document().state.members[actor.userId].inventory[cardId] = 1;
      f.document().state.members[other._id].weeks[initial.week].entertainmentSeconds = 6000;
      await f.service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: publicCard, targetId: other._id });
      const view = await f.service.getMe({ ...actor, userId: other._id });
      expect(view.incomingDefenses).toEqual([]);
      expect(view.incomingInteractions).toHaveLength(1);
      const notice = view.incomingInteractions![0];
      expect(notice.sender.username).toBe(actor.username); expect(notice.card.id).toBe(publicCard);
      expect(Boolean(notice.randomlySelected)).toBe(randomTarget);
      expect(notice.effects.some(effect => effect.kind === 'time' && effect.deltaSeconds! < 0)).toBe(true);
    });

  it.each([['n-shield', '仁王盾'], ['r-blade', '名刀司命'], ['sr-reflect', '反弹']])('persists %s automatic defense notices and acknowledges only the recipient without using a second card', async (defenseId, defenseName) => {
    const other = { _id: '6a0000000000000000000012', username: 'test.defender', displayName: 'Defender', enrollYear: 2025 };
    f.members.push(other); await f.service.getMe(actor);
    const defender = { ...actor, userId: other._id };
    f.document().state.members[actor.userId].inventory['n-reduce'] = 1;
    f.document().state.members[other._id].inventory[defenseId] = 1;
    const input = { requestKey: randomUUID(), action: 'use' as const, cardId: 'card-02' };
    const action = await f.service.action(actor, input);
    const view = await f.service.getMe(defender), notices = view.incomingDefenses!;
    expect(notices).toHaveLength(1);
    expect(notices[0].randomlySelected).toBe(true);
    expect(view.incomingInteractions).toEqual([]);
    expect(notices[0].events[0]).toMatchObject({ attacker: { username: actor.username }, attackCard: { name: '减时长' },
      defenseCard: { name: defenseName }, outcome: defenseId === 'sr-reflect' ? 'reflected' : 'blocked' });
    expect((await f.service.getMe(actor)).incomingDefenses).toEqual([]);
    expect(f.document().state.members[other._id].inventory[defenseId]).toBe(0);
    const savedHash = [...f.receipts.rows.values()][0].contentHash;
    expect(await f.service.acknowledgeDefenses(actor, [notices[0].id])).toEqual({ acknowledged: 0 });
    expect(await f.service.acknowledgeDefenses(defender, [notices[0].id])).toEqual({ acknowledged: 1 });
    expect(await f.service.acknowledgeDefenses(defender, [notices[0].id])).toEqual({ acknowledged: 0 });
    expect((await f.service.getMe(defender)).incomingDefenses).toEqual([]);
    expect((await f.service.getMe(defender)).events.some(event => event.message.includes(defenseName) && event.message.includes(actor.username))).toBe(true);
    expect([...f.receipts.rows.values()][0].contentHash).toBe(savedHash);
    expect((await f.service.action(actor, input)).result).toEqual(action.result);
    expect(f.document().state.members[other._id].inventory[defenseId]).toBe(0);
    expect(f.receipts.rows.size).toBe(1);
  });

  it('keeps the random label on the original victim rather than the user hit by reflection', async () => {
    const other = { _id: '6a0000000000000000000012', username: 'test.reflector', displayName: 'Reflector', enrollYear: 2025 };
    f.members.push(other); await f.service.getMe(actor);
    Object.assign(f.document().state.members[actor.userId].inventory, { 'n-reduce': 1, 'r-blade': 1 });
    f.document().state.members[other._id].inventory['sr-reflect'] = 1;
    await f.service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-02' });
    const victimNotice = (await f.service.getMe({ ...actor, userId: other._id })).incomingDefenses![0];
    const returnedNotice = (await f.service.getMe(actor)).incomingDefenses![0];
    expect(victimNotice).toMatchObject({ randomlySelected: true, events: [{ attacker: { username: actor.username }, outcome: 'reflected' }] });
    expect(returnedNotice.randomlySelected).not.toBe(true);
    expect(returnedNotice.events[0]).toMatchObject({ attacker: { username: other.username }, defenseCard: { name: '名刀司命' } });
  });

  it.each([false, true])('attributes a chained deduction to the inactive linker, with reflection=%s', async (reflect) => {
    const victim = { _id: '6a0000000000000000000012', username: 'test.victim', displayName: 'Victim', enrollYear: 2025 };
    const linked = { _id: '6a0000000000000000000013', username: 'test.linked', displayName: 'Linked', enrollYear: 2025 };
    const linker = { _id: '6a0000000000000000000014', username: 'test.linker', displayName: 'Linker', enrollYear: 2025 };
    f.members.push(victim, linked, linker); const initial = await f.service.getMe(actor);
    f.document().state.members[actor.userId].inventory['r-steal'] = 1;
    if (reflect) f.document().state.members[linked._id].inventory['sr-reflect'] = 1;
    f.document().state.links.push({ a: victim._id, b: linked._id, week: initial.week, createdBy: linker._id });
    const original = (f.service as any).context.bind(f.service);
    vi.spyOn(f.service as any, 'context').mockImplementation(async (...args: any[]) => {
      const ctx = await original(...args); return { ...ctx, players: ctx.players.filter((player: { id: string }) => player.id !== linker._id) };
    });
    await f.service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-06', targetId: victim._id });
    const linkedView = await f.service.getMe({ ...actor, userId: linked._id });
    const notice = reflect ? linkedView.incomingDefenses![0] : linkedView.incomingInteractions![0];
    expect(notice).toMatchObject({ effects: [{ source: { user: { username: linker.username }, card: { name: '铁索连环' } }, deltaSeconds: -1800 }] });
    if (reflect) expect(linkedView.incomingDefenses![0].events[0]).toMatchObject({ attacker: { username: linker.username }, outcome: 'reflected' });
    else expect(notice).toMatchObject({ sender: { username: linker.username }, card: { name: '铁索连环' } });
    expect(notice.randomlySelected).not.toBe(true);
    expect((await f.service.getMe({ ...actor, userId: victim._id })).incomingInteractions![0].sender.username).toBe(actor.username);
  });

  it('keeps the active ward for repeated attacks and does not create passive-consumption notices', async () => {
    const other = { _id: '6a0000000000000000000012', username: 'test.defender', displayName: 'Defender', enrollYear: 2025 };
    f.members.push(other); await f.service.getMe(actor);
    const defender = { ...actor, userId: other._id };
    f.document().state.members[other._id].inventory['ssr-invincible'] = 1;
    const activation = await f.service.action(defender, { requestKey: randomUUID(), action: 'use', cardId: 'card-20' });
    const immuneUntil = activation.state.statuses.immuneUntil;
    expect(new Date(immuneUntil!).getTime() - Date.parse([...f.receipts.rows.values()][0].at)).toBe(86400000);
    f.document().state.members[actor.userId].inventory['sr-redking'] = 2;
    f.document().state.members[other._id].inventory['sr-reflect'] = 1;
    for (let i = 0; i < 2; i++) await f.service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-18', targetId: other._id });
    const view = await f.service.getMe(defender);
    expect(view.statuses.immuneUntil).toBe(immuneUntil);
    expect(view.entertainmentSeconds).toBe(0);
    expect(view.incomingDefenses).toEqual([]);
    expect(f.document().state.members[other._id].inventory['sr-reflect']).toBe(1);
    await expect(f.service.acknowledgeDefenses(defender, [])).rejects.toThrow('1 至 20');
  });

  it('retains received gift history after the popup has been acknowledged', async () => {
    const other = { _id: '6a0000000000000000000012', username: 'test.receiver', displayName: 'Receiver', enrollYear: 2025 };
    f.members.push(other); await f.service.getMe(actor); f.document().state.members[actor.userId].inventory['n-reduce'] = 1;
    await f.service.action(actor, { requestKey: randomUUID(), action: 'gift', cardId: 'card-02', targetId: other._id });
    const receiver = { ...actor, userId: other._id }, view = await f.service.getMe(receiver);
    await f.service.acknowledgeGifts(receiver, view.incomingGifts!.map(gift => gift.id));
    const refreshed = await f.service.getMe(receiver);
    expect(refreshed.incomingGifts).toEqual([]);
    expect(refreshed.events.some(event => event.message.includes('收到') && event.message.includes(actor.username) && event.message.includes('减时长'))).toBe(true);
  });
  it('recovers an identical archived week inserted by another recovery', async () => {
    await f.service.getMe(actor);
    f.document().state.members[actor.userId].weeks['2026-01-05'] = { entertainmentSeconds: -900, mintedSeconds: 0, spentPoints: 0, freeUsed: 0, bonusDraws: 0 };
    const original = f.weeks.model.updateOne.bind(f.weeks.model);
    vi.spyOn(f.weeks.model, 'updateOne').mockImplementationOnce(((where: any, update: any) => ({ exec: async () => {
      await original(where, update).exec(); throw Object.assign(new Error('week concurrent duplicate'), { code: 11000 });
    } })) as any);
    expect(await f.service.getMemberEntertainmentHistory(actor.teamId, actor.userId)).toHaveProperty('2026-01-05', -900);
    expect(f.document().pendingWrite).toBeUndefined();
  });

  it('reports physical copies including duplicates without exposing unowned cards or unlocking the viewer', async () => {
    await f.service.getMe(actor);
    Object.assign(f.document().state.members[actor.userId].inventory, { 'n-reduce': 3, 'sr-reflect': 2, 'r-add': 0 });
    const discovered = [...f.document().state.members[actor.userId].discovered];
    const view = await f.service.getMemberInventory(actor.teamId, actor.userId);
    expect(view.total).toBe(5);
    expect(view.items.map(card => [card.id, card.name, card.quantity])).toEqual([['card-02', '减时长', 3], ['card-15', '反弹', 2]]);
    expect(await f.service.getTeamInventoryCounts(actor.teamId)).toEqual({ [actor.userId]: 5 });
    expect(f.document().state.members[actor.userId].discovered).toEqual(discovered);
  });

  it('preserves the pending week when a concurrent archive has conflicting contents', async () => {
    await f.service.getMe(actor);
    f.document().state.members[actor.userId].weeks['2026-01-05'] = { entertainmentSeconds: -900, mintedSeconds: 0, spentPoints: 0, freeUsed: 0, bonusDraws: 0 };
    const original = f.weeks.model.updateOne.bind(f.weeks.model);
    vi.spyOn(f.weeks.model, 'updateOne').mockImplementationOnce(((where: any, update: any) => ({ exec: async () => {
      await original(where, { $setOnInsert: { ...update.$setOnInsert, contentHash: 'different-week' } }).exec();
      throw Object.assign(new Error('conflicting archived week'), { code: 11000 });
    } })) as any);
    await expect(f.service.getMemberEntertainmentHistory(actor.teamId, actor.userId)).rejects.toThrow('conflicting archived week');
    expect(f.document().pendingWrite.weeks).toHaveLength(1);
    expect([...f.weeks.rows.values()][0].contentHash).toBe('different-week');
  });

  it.each([false, true])('only clears a legacy receipt after an identical concurrent bulk archive (conflict=%s)', async conflict => {
    await f.service.getMe(actor);
    const key = 'a'.repeat(64);
    const value = { actorId: actor.userId, requestKey: randomUUID(), hash: 'input-hash', at: new Date().toISOString(), result: { message: 'legacy result' } };
    f.document().receipts[key] = value;
    const original = f.receipts.model.bulkWrite.bind(f.receipts.model);
    vi.spyOn(f.receipts.model, 'bulkWrite').mockImplementationOnce((async (operations: any[]) => {
      await original(operations);
      if (conflict) [...f.receipts.rows.values()][0].contentHash = 'different-legacy-result';
      throw Object.assign(new Error('legacy concurrent duplicate'), { code: 11000 });
    }) as any);
    if (conflict) {
      await expect(f.service.getMe(actor)).rejects.toThrow('legacy concurrent duplicate');
      expect(f.document().receipts[key]).toEqual(value);
    } else {
      await f.service.getMe(actor);
      expect(f.document().receipts[key]).toBeUndefined();
      expect(f.receipts.rows.size).toBe(1);
    }
  });

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
    expect(view.points).toMatchObject({ rule: 'comprehensive-v1', comprehensiveSeconds: 900, earned: 15, bonus: 0, spent: 30, balance: -15 });
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
    expect((await f.service.getMe(actor)).points).toMatchObject({ earned: 30, spent: 60, balance: -30 });
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

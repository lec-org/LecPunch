import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection, Types, type Connection, type Model } from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { AssessmentService } from '../assessment/assessment.service';
import { AssessmentWeekSchema } from '../assessment/schemas/assessment.schema';
import { CardGameSchema } from './schemas/card-game.schema';
import { CardActionArchiveSchema, CardWeekArchiveSchema } from './schemas/card-archive.schema';
import { UserSchema } from '../users/schemas/user.schema';
import { AttendanceSessionSchema } from '../attendance/schemas/attendance-session.schema';
import { PointLedgerEntrySchema } from '../points/schemas/point-ledger-entry.schema';
import { PointsService } from '../points/points.service';
import { AttendanceDurationAdjustmentSchema } from '../attendance/schemas/attendance-duration-adjustment.schema';
import { AttendanceAdjustmentBucketSchema } from '../attendance/schemas/attendance-adjustment-bucket.schema';
import { CardStorageService } from './card-storage.service';
import { CardsService } from './cards.service';
import { CARD_CATALOG } from './card-catalog';
import { PointsController } from '../points/points.controller';
import { StatsService } from '../stats/stats.service';
import type { AuthUser } from '../auth/types/auth-user.type';

const uri = process.env.LECPUNCH_TEST_MONGO_URI;
if (uri && !/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri)) throw new Error('Only a disposable localhost Mongo URI is allowed');
const suite = uri ? describe : describe.skip;
suite('Card outbox and immutable archives on standalone Mongo', () => {
  let connection: Connection;
  let games: Model<any>, receipts: Model<any>, weeks: Model<any>, users: Model<any>, attendance: Model<any>, ledger: Model<any>, assessmentWeeks: Model<any>;
  let service: CardsService;
  let points: PointsService;
  let legacyAdjustments: Model<any>, adjustmentBuckets: Model<any>;
  const actor: AuthUser = { userId: '6a0000000000000000000011', teamId: '6a0000000000000000000001', username: 'test.cards', displayName: 'Cards', role: 'member', enrollYear: 2026 };
  beforeAll(async () => {
    connection = await createConnection(uri!, { dbName: `lecpunch_local_cards_${randomUUID().replace(/-/g, '')}` }).asPromise();
    games = connection.model('CardGame', CardGameSchema);
    receipts = connection.model('CardActionArchive', CardActionArchiveSchema);
    weeks = connection.model('CardWeekArchive', CardWeekArchiveSchema);
    users = connection.model('User', UserSchema);
    attendance = connection.model('AttendanceSession', AttendanceSessionSchema);
    ledger = connection.model('PointLedgerEntry', PointLedgerEntrySchema);
    assessmentWeeks = connection.model('AssessmentWeek', AssessmentWeekSchema);
    legacyAdjustments = connection.model('AttendanceDurationAdjustment', AttendanceDurationAdjustmentSchema);
    adjustmentBuckets = connection.model('AttendanceAdjustmentBucket', AttendanceAdjustmentBucketSchema);
    await Promise.all([games, receipts, weeks, users, attendance, ledger, assessmentWeeks].map(model => model.init()));
    const storage = new CardStorageService(games, receipts, weeks);
    await Promise.all([legacyAdjustments.init(), adjustmentBuckets.init()]);
    points = new PointsService(ledger, legacyAdjustments, adjustmentBuckets, attendance);
    service = new CardsService(games, users, points, attendance, new ConfigService({ AUTH_SECRET: 'isolated-local-integration-key' }), storage, assessmentWeeks);
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([games, receipts, weeks, users, attendance, ledger, assessmentWeeks, legacyAdjustments, adjustmentBuckets].map(model => model.deleteMany({})));
    await users.create({ _id: actor.userId, teamId: actor.teamId, username: actor.username, displayName: actor.displayName, enrollYear: actor.enrollYear });
  });
  it('spends existing manual-adjustment earnings without attendance or a point-ledger migration', async () => {
    const { getWeekKey } = await import('../../common/utils/time.util');
    const weekKey = getWeekKey(new Date());
    await adjustmentBuckets.create({ teamId: actor.teamId, userId: actor.userId, weekKey, entries: [{ signedDurationSeconds: 7200 }] });
    const before = await service.getMe(actor);
    expect(before.points.earned).toBe(120);
    for (let i = 0; i < 4; i++) await service.action(actor, { requestKey: randomUUID(), action: 'draw' });
    expect((await service.getMe(actor)).points).toMatchObject({ earned: 120, spent: 120, balance: 0 });
    expect(await ledger.countDocuments()).toBe(0);
    await adjustmentBuckets.updateOne({ teamId: actor.teamId, userId: actor.userId, weekKey }, { $push: { entries: { signedDurationSeconds: -3600 } } });
    expect((await service.getMe(actor)).points.balance).toBe(0);
  });
  it('atomically recovers gift delivery and concurrent retries into exactly one card and notice', async () => {
    const receiver = { ...actor, userId: '6a0000000000000000000012', username: 'test.receiver', displayName: 'Receiver' };
    await users.create({ _id: receiver.userId, teamId: actor.teamId, username: receiver.username, displayName: receiver.displayName, enrollYear: actor.enrollYear });
    await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.inventory.n-reduce`]: 1, [`state.members.${actor.userId}.discovered`]: ['n-reduce'] } });
    const input = { requestKey: randomUUID(), action: 'gift' as const, cardId: 'card-02', targetId: receiver.userId };
    vi.spyOn(receipts, 'updateOne').mockImplementationOnce(() => { throw new Error('gift archive interrupted'); });
    await expect(service.action(actor, input)).rejects.toThrow('gift archive interrupted');
    const results = await Promise.all([service.action(actor, input), service.action(actor, input)]);
    expect(results[0].result).toEqual(results[1].result);
    const view = await service.getMe(receiver), gifts = view.incomingGifts!;
    expect(gifts).toHaveLength(1);
    expect(view.collection.find(card => card.id === 'card-02')).toMatchObject({ unlocked: true, quantity: 1 });
    expect((await service.getMe(actor)).incomingGifts).toEqual([]);
    const before = await receipts.findOne({ receiptKey: gifts[0].id }).lean();
    expect(await service.acknowledgeGifts(actor, [gifts[0].id])).toEqual({ acknowledged: 0 });
    expect(await service.acknowledgeGifts(receiver, [gifts[0].id])).toEqual({ acknowledged: 1 });
    expect(await service.acknowledgeGifts(receiver, [gifts[0].id])).toEqual({ acknowledged: 0 });
    const after = await receipts.findOne({ receiptKey: gifts[0].id }).lean();
    expect(after.contentHash).toBe(before.contentHash); expect(after.result).toEqual(before.result);
    expect((await service.getMe(receiver)).incomingGifts).toEqual([]);
    expect((await service.getMe(receiver)).collection.find(card => card.id === 'card-02')?.quantity).toBe(1);
    expect((await service.action(actor, input)).result).toEqual(results[0].result);
  });
  it('recovers a random attack notice with its user and selection flag without a second deduction', async () => {
    const victim = { ...actor, userId: '6a0000000000000000000012', username: 'test.victim', displayName: 'Victim' };
    await users.create({ _id: victim.userId, teamId: actor.teamId, username: victim.username, displayName: victim.displayName, enrollYear: actor.enrollYear });
    await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.inventory.n-reduce`]: 1 } });
    const input = { requestKey: randomUUID(), action: 'use' as const, cardId: 'card-02' };
    vi.spyOn(receipts, 'updateOne').mockImplementationOnce(() => { throw new Error('attack notice archive interrupted'); });
    await expect(service.action(actor, input)).rejects.toThrow('attack notice archive interrupted');
    const view = await service.getMe(victim), notice = view.incomingInteractions![0];
    expect(view.entertainmentSeconds).toBe(-1800);
    expect(view.incomingInteractions).toHaveLength(1);
    expect(notice).toMatchObject({ randomlySelected: true, sender: { username: actor.username }, card: { name: '减时长' } });
    const saved = await receipts.findOne({ receiptKey: notice.id }).lean();
    const replay = await service.action(actor, input);
    expect(replay.result.effects![0]).toMatchObject({ randomTarget: true, deltaSeconds: -1800 });
    expect(await service.acknowledgeInteractions(victim, [notice.id])).toEqual({ acknowledged: 1 });
    const confirmed = await service.getMe(victim);
    expect(confirmed.incomingInteractions).toEqual([]);
    expect(confirmed.entertainmentSeconds).toBe(-1800);
    expect((await receipts.findOne({ receiptKey: notice.id }).lean()).contentHash).toBe(saved.contentHash);
    expect(await receipts.countDocuments()).toBe(1);
  });

  it('does not expose gifts to another team and does not filter unread notices by current week', async () => {
    const other = { ...actor, userId: '6a0000000000000000000014', teamId: '6a0000000000000000000002', username: 'test.foreign' };
    await users.create({ _id: other.userId, teamId: other.teamId, username: other.username, displayName: other.displayName, enrollYear: other.enrollYear });
    const id = 'a'.repeat(64), at = '2026-01-05T00:00:00Z';
    await receipts.create({ teamId: actor.teamId, receiptKey: id, contentHash: 'test-only', actorId: 'sender', requestKey: randomUUID(), hash: 'hash', at,
      result: { message: 'old local gift' }, gift: { recipientId: actor.userId, notice: { at, sender: { id: 'sender', username: 'test.sender', displayName: 'Sender' }, card: { id: 'card-02', name: '减时长', rarity: 'N' } } } });
    expect((await service.getMe(actor)).incomingGifts?.map(gift => gift.id)).toEqual([id]);
    expect((await service.getMe(other)).incomingGifts).toEqual([]);
    expect(await service.acknowledgeGifts(other, [id])).toEqual({ acknowledged: 0 });
    expect((await service.getMe(actor)).incomingGifts).toHaveLength(1);
  });
  it('durably recovers defense notices, pages them, and confirms without consuming another defense', async () => {
    const defender = { ...actor, userId: '6a0000000000000000000012', username: 'test.defender', displayName: 'Defender' };
    await users.create({ _id: defender.userId, teamId: actor.teamId, username: defender.username, displayName: defender.displayName, enrollYear: actor.enrollYear });
    await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.inventory.n-reduce`]: 21,
      [`state.members.${defender.userId}.inventory.n-shield`]: 21 } });
    const input = { requestKey: randomUUID(), action: 'use' as const, cardId: 'card-02' };
    vi.spyOn(receipts, 'updateOne').mockImplementationOnce(() => { throw new Error('defense archive interrupted'); });
    await expect(service.action(actor, input)).rejects.toThrow('defense archive interrupted');
    const retries = await Promise.all([service.action(actor, input), service.action(actor, input)]);
    expect(retries[0].result).toEqual(retries[1].result);
    expect((await service.getMe(defender)).incomingDefenses).toHaveLength(1);
    for (let i = 0; i < 20; i++) await service.action(actor, { ...input, requestKey: randomUUID() });
    const view = await service.getMe(defender), notices = view.incomingDefenses!;
    expect(notices).toHaveLength(20);
    expect(notices.every(notice => notice.events.length === 1 && notice.events[0].defenseCard.name === '仁王盾')).toBe(true);
    expect(notices.every(notice => notice.randomlySelected && notice.events[0].attacker.username === actor.username)).toBe(true);
    const before = await receipts.findOne({ receiptKey: notices[0].id }).lean();
    expect(await service.acknowledgeDefenses(actor, notices.map(notice => notice.id))).toEqual({ acknowledged: 0 });
    expect(await service.acknowledgeDefenses(defender, notices.map(notice => notice.id))).toEqual({ acknowledged: 20 });
    expect(await service.acknowledgeDefenses(defender, notices.map(notice => notice.id))).toEqual({ acknowledged: 0 });
    const remaining = (await service.getMe(defender)).incomingDefenses!;
    expect(remaining).toHaveLength(1);
    await service.acknowledgeDefenses(defender, remaining.map(notice => notice.id));
    const confirmed = await service.getMe(defender);
    expect(confirmed.incomingDefenses).toEqual([]);
    expect(confirmed.events).toHaveLength(20);
    expect(confirmed.events.every(event => event.message.includes('自动消耗「仁王盾」'))).toBe(true);
    expect((await service.getMemberInventory(actor.teamId, defender.userId)).total).toBe(0);
    expect(await receipts.countDocuments()).toBe(21);
    const after = await receipts.findOne({ receiptKey: notices[0].id }).lean();
    expect(after.contentHash).toBe(before.contentHash); expect(after.defenses).toEqual(before.defenses);
    expect(after.defenseReadBy).toEqual([defender.userId]);
    await expect(service.acknowledgeDefenses(defender, Array(21).fill(notices[0].id))).rejects.toThrow('1 至 20');
  });
  it('keeps per-recipient acknowledgements separate when reflection consumes defenses on both sides', async () => {
    const defender = { ...actor, userId: '6a0000000000000000000012', username: 'test.defender', displayName: 'Defender' };
    await users.create({ _id: defender.userId, teamId: actor.teamId, username: defender.username, displayName: defender.displayName, enrollYear: actor.enrollYear });
    await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.inventory.n-reduce`]: 1,
      [`state.members.${actor.userId}.inventory.n-shield`]: 1, [`state.members.${defender.userId}.inventory.sr-reflect`]: 1 } });
    await service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-02' });
    const original = (await service.getMe(actor)).incomingDefenses!, reflected = (await service.getMe(defender)).incomingDefenses!;
    expect(original).toHaveLength(1); expect(reflected).toHaveLength(1);
    expect(original[0].id).toBe(reflected[0].id);
    expect(original[0].events[0]).toMatchObject({ attacker: { username: defender.username }, defenseCard: { name: '仁王盾' }, outcome: 'blocked' });
    expect(reflected[0].events[0]).toMatchObject({ attacker: { username: actor.username }, defenseCard: { name: '反弹' }, outcome: 'reflected' });
    await service.acknowledgeDefenses(defender, [reflected[0].id]);
    expect((await service.getMe(actor)).incomingDefenses).toHaveLength(1);
    expect((await service.getMe(defender)).incomingDefenses).toEqual([]);
    await service.acknowledgeDefenses(actor, [original[0].id]);
    expect((await service.getMe(actor)).incomingDefenses).toEqual([]);
  });
  it('preserves cross-week defense notices and rejects reads or acknowledgements from another team', async () => {
    const foreign = { ...actor, userId: '6a0000000000000000000014', teamId: '6a0000000000000000000002', username: 'test.foreign' };
    await users.create({ _id: foreign.userId, teamId: foreign.teamId, username: foreign.username, displayName: foreign.displayName, enrollYear: foreign.enrollYear });
    const id = 'b'.repeat(64), at = '2026-01-05T00:00:00Z';
    await receipts.create({ teamId: actor.teamId, receiptKey: id, contentHash: 'isolated-old-defense', actorId: 'old-sender', requestKey: randomUUID(), hash: 'hash', at,
      result: { message: 'old defense test' }, defenses: [{ recipientId: actor.userId, notice: { at, events: [{
        attacker: { id: 'old-sender', username: 'test.attacker', displayName: 'Attacker' },
        attackCard: { id: 'card-02', name: '减时长', rarity: 'N' }, defenseCard: { id: 'card-04', name: '仁王盾', rarity: 'N' }, outcome: 'blocked'
      }] } }] });
    expect((await service.getMe(actor)).incomingDefenses?.map(notice => notice.id)).toEqual([id]);
    expect((await service.getMe(foreign)).incomingDefenses).toEqual([]);
    expect(await service.acknowledgeDefenses(foreign, [id])).toEqual({ acknowledged: 0 });
    expect((await service.getMe(actor)).incomingDefenses).toHaveLength(1);
    await service.acknowledgeDefenses(actor, [id]);
    expect((await service.getMe(actor)).incomingDefenses).toEqual([]);
    expect((await service.getMe(actor)).events.some(event => event.message.includes('test.attacker') && event.message.includes('仁王盾'))).toBe(true);
  });
  it('recovers and pages interaction notices without reapplying status or changing receipt hashes', async () => {
    const receiver = { ...actor, userId: '6a0000000000000000000012', username: 'test.receiver', displayName: 'Receiver', enrollYear: 2025 };
    await users.create({ _id: receiver.userId, teamId: actor.teamId, username: receiver.username, displayName: receiver.displayName, enrollYear: receiver.enrollYear });
    await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.inventory.r-skip`]: 21 } });
    const input = { requestKey: randomUUID(), action: 'use' as const, cardId: 'card-10', targetId: receiver.userId };
    vi.spyOn(receipts, 'updateOne').mockImplementationOnce(() => { throw new Error('interaction archive interrupted'); });
    await expect(service.action(actor, input)).rejects.toThrow('interaction archive interrupted');
    const retries = await Promise.all([service.action(actor, input), service.action(actor, input)]);
    expect(retries[0].result).toEqual(retries[1].result);
    expect((await service.getMe(receiver)).incomingInteractions).toHaveLength(1);
    for (let i = 0; i < 20; i++) await service.action(actor, { ...input, requestKey: randomUUID() });
    const view = await service.getMe(receiver), notices = view.incomingInteractions!;
    expect(notices).toHaveLength(20); expect(view.requiredEnrollYears).toEqual([2026, 2025]);
    expect(notices.every(notice => notice.card.name === '乐不思蜀' && notice.effects[0].detail?.includes('1 小时'))).toBe(true);
    const saved = await receipts.findOne({ receiptKey: notices[0].id }).lean();
    const statusUntil = view.statuses.lockedUntil;
    expect(await service.acknowledgeInteractions(actor, notices.map(notice => notice.id))).toEqual({ acknowledged: 0 });
    expect(await service.acknowledgeInteractions(receiver, notices.map(notice => notice.id))).toEqual({ acknowledged: 20 });
    expect(await service.acknowledgeInteractions(receiver, notices.map(notice => notice.id))).toEqual({ acknowledged: 0 });
    const rest = (await service.getMe(receiver)).incomingInteractions!; expect(rest).toHaveLength(1);
    await service.acknowledgeInteractions(receiver, rest.map(notice => notice.id));
    const after = await service.getMe(receiver);
    expect(after.incomingInteractions).toEqual([]); expect(after.statuses.lockedUntil).toBe(statusUntil);
    expect(after.events).toHaveLength(20); expect(after.events.every(event => event.message.includes('乐不思蜀'))).toBe(true);
    expect((await receipts.findOne({ receiptKey: notices[0].id }).lean()).contentHash).toBe(saved.contentHash);
    expect(await receipts.countDocuments()).toBe(21);
  });
  it('uses the shared cohort high-water mark, without widening steal or gift scope', async () => {
    const receiver = { ...actor, userId: '6a0000000000000000000012', username: 'test.receiver', displayName: 'Receiver', enrollYear: 2025 };
    await users.create({ _id: receiver.userId, teamId: actor.teamId, username: receiver.username, displayName: receiver.displayName, enrollYear: receiver.enrollYear });
    await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.inventory.r-skip`]: 2, [`state.members.${actor.userId}.inventory.r-steal`]: 1 } });
    await service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-10', targetId: receiver.userId });
    await expect(service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-06', targetId: receiver.userId })).rejects.toThrow('同年级');
    await expect(service.action(actor, { requestKey: randomUUID(), action: 'gift', cardId: 'card-10', targetId: receiver.userId })).rejects.toThrow('同年级');
    await assessmentWeeks.create({ teamId: actor.teamId, weekKey: (await service.getMe(actor)).week, revision: 0,
      state: { requiredEnrollYears: [2027, 2026] } });
    expect((await service.getMe(actor)).requiredEnrollYears).toEqual([2027, 2026]);
    await expect(service.action(actor, { requestKey: randomUUID(), action: 'use', cardId: 'card-10', targetId: receiver.userId })).rejects.toThrow('当前应考');
    expect((await service.getMemberInventory(actor.teamId, actor.userId)).items.find(card => card.id === 'card-10')?.quantity).toBe(1);
  });
  it('keeps old interaction notifications scoped to their recipient and team across weeks', async () => {
    const foreign = { ...actor, userId: '6a0000000000000000000014', teamId: '6a0000000000000000000002', username: 'test.foreign' };
    await users.create({ _id: foreign.userId, teamId: foreign.teamId, username: foreign.username, displayName: foreign.displayName, enrollYear: foreign.enrollYear });
    const id = 'c'.repeat(64), at = '2026-01-05T00:00:00Z';
    await receipts.create({ teamId: actor.teamId, receiptKey: id, contentHash: 'old-interaction', actorId: 'old-sender', requestKey: randomUUID(), hash: 'hash', at,
      result: { message: 'old lightning test' }, interactions: [{ recipientId: actor.userId, notice: { at,
        sender: { id: 'old-sender', username: 'test.attacker', displayName: 'Attacker' }, card: { id: 'card-14', name: '雷电', rarity: 'SR' },
        effects: [{ target: { id: actor.userId, username: actor.username, displayName: actor.displayName }, kind: 'judgement', outcome: 'no-effect', detail: '雷电判定未命中' }]
      } }] });
    expect((await service.getMe(actor)).incomingInteractions?.map(notice => notice.id)).toEqual([id]);
    expect((await service.getMe(foreign)).incomingInteractions).toEqual([]);
    expect(await service.acknowledgeInteractions(foreign, [id])).toEqual({ acknowledged: 0 });
    await service.acknowledgeInteractions(actor, [id]);
    expect((await service.getMe(actor)).incomingInteractions).toEqual([]);
    expect((await service.getMe(actor)).events.some(event => event.message.includes('判定未命中'))).toBe(true);
  });
  it('transfers all 21 card types with durable sender/receiver history, paged notices and inventory counts', async () => {
    const receiver = { ...actor, userId: '6a0000000000000000000012', username: 'test.receiver', displayName: 'Receiver' };
    await users.create({ _id: receiver.userId, teamId: actor.teamId, username: receiver.username, displayName: receiver.displayName, enrollYear: actor.enrollYear });
    await service.getMe(actor);
    await games.updateOne({}, { $set: {
      [`state.members.${actor.userId}.inventory`]: Object.fromEntries(CARD_CATALOG.map(card => [card.id, 1])),
      [`state.members.${actor.userId}.discovered`]: CARD_CATALOG.map(card => card.id)
    } });
    const collection = (await service.getMe(actor)).collection;
    expect((await service.getTeamInventoryCounts(actor.teamId))[actor.userId]).toBe(21);
    for (const card of collection) {
      const input = { requestKey: randomUUID(), action: 'gift' as const, cardId: card.id, targetId: receiver.userId };
      const first = await service.action(actor, input);
      expect((await service.action(actor, input)).result).toEqual(first.result);
      expect(first.result.message).toContain(receiver.displayName);
    }
    expect(await service.getTeamInventoryCounts(actor.teamId)).toMatchObject({ [actor.userId]: 0, [receiver.userId]: 21 });
    const inventory = await service.getMemberInventory(actor.teamId, receiver.userId);
    expect(inventory.total).toBe(21); expect(inventory.items).toHaveLength(21);
    expect(inventory.items.every(card => card.quantity === 1)).toBe(true);
    const firstPage = await service.getMe(receiver);
    expect(firstPage.collection.every(card => card.unlocked)).toBe(true);
    expect(firstPage.incomingGifts).toHaveLength(20);
    expect(firstPage.events).toHaveLength(20);
    expect(firstPage.events.every(event => event.message.includes(actor.username) && event.message.includes('收到'))).toBe(true);
    await service.acknowledgeGifts(receiver, firstPage.incomingGifts!.map(gift => gift.id));
    const secondPage = await service.getMe(receiver);
    expect(secondPage.incomingGifts).toHaveLength(1);
    await service.acknowledgeGifts(receiver, secondPage.incomingGifts!.map(gift => gift.id));
    const acknowledged = await service.getMe(receiver);
    expect(acknowledged.incomingGifts).toEqual([]); expect(acknowledged.events).toHaveLength(20);
    expect((await service.getMemberInventory(actor.teamId, receiver.userId)).total).toBe(21);
    expect(await receipts.countDocuments()).toBe(21);
  });

  it('concurrently recovers one archived week without losing negative entertainment time', async () => {
    await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.weeks.2026-01-05`]: {
      entertainmentSeconds: -1800, mintedSeconds: 0, spentPoints: 0, freeUsed: 0, bonusDraws: 0
    } } });
    const histories = await Promise.all(Array.from({ length: 5 }, () => service.getMemberEntertainmentHistory(actor.teamId, actor.userId)));
    expect(histories.every(history => history['2026-01-05'] === -1800)).toBe(true);
    expect(await weeks.countDocuments({ teamId: actor.teamId, userId: actor.userId, weekKey: '2026-01-05' })).toBe(1);
    expect((await games.findOne().lean()).pendingWrite).toBeUndefined();
  });
  it('combines real attendance and audited seconds before rounding, and both endpoints agree', async () => {
    const { getWeekKey, getIsoWeekKey } = await import('../../common/utils/time.util');
    const weekKey = getWeekKey(new Date());
    await attendance.create({ teamId: actor.teamId, userId: actor.userId, weekKey, status: 'completed', durationSeconds: 59,
      checkInAt: new Date(), checkOutAt: new Date(), sourceIpAtCheckIn: '127.0.0.1' });
    await attendance.create({ teamId: actor.teamId, userId: actor.userId, weekKey, status: 'invalidated', durationSeconds: 1200,
      checkInAt: new Date(), sourceIpAtCheckIn: '127.0.0.1' });
    await legacyAdjustments.create({ teamId: actor.teamId, userId: actor.userId, weekKey, operation: 'add', durationSeconds: 59,
      signedDurationSeconds: 59, username: actor.username, previousDurationSeconds: 59, resultingDurationSeconds: 118,
      createdBy: actor.userId, reason: 'isolated test' });
    const initial = await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.weeks.${weekKey}.entertainmentSeconds`]: 2,
      [`state.members.${actor.userId}.weeks.${weekKey}.mintedSeconds`]: 99999 } });
    const view = await service.getMe(actor);
    expect(view.points).toMatchObject({ earned: 2, balance: 2, bonus: 0, comprehensiveSeconds: 120 });
    const response = await new PointsController(points, service).getMine(actor, { week: getIsoWeekKey(new Date()) });
    expect(response.drawPoints).toEqual({ weekKey: initial.week, ...view.points });
    expect(response.ledgerScope).toBe('attendance-audit');
    const stats = new StatsService({ getModel: () => attendance,
      getManualAdjustmentSummaries: async () => new Map([[`${actor.userId}:${weekKey}`, { manualAdjustmentSeconds: 59 }]]) } as any,
      { listTeamMembers: async () => [{ id: actor.userId, enrollYear: actor.enrollYear, displayName: actor.displayName }],
        getMemberKey: () => 'opaque-member' } as any, service);
    const rows = await stats.getTeamCurrentWeekStats(actor.teamId);
    expect(rows[0].totalDurationSeconds).toBe(view.points.comprehensiveSeconds);
    expect(rows[0].sessionsCount).toBe(2);
  });
  it('allows only one of two concurrent paid draws when exactly sixty points remain', async () => {
    const initial = await service.getMe(actor);
    await adjustmentBuckets.create({ teamId: actor.teamId, userId: actor.userId, weekKey: initial.week, entries: [{ signedDurationSeconds: 3600 }] });
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.weeks.${initial.week}.freeUsed`]: 2 } });
    const results = await Promise.allSettled([1, 2].map(() => service.action(actor, { requestKey: randomUUID(), action: 'draw' })));
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(row => row.status === 'rejected')).toHaveLength(1);
    const view = await service.getMe(actor);
    expect(view.points).toMatchObject({ earned: 60, spent: 60, balance: 0 });
    expect(view.collection.reduce((sum, card) => sum + card.quantity, 0)).toBe(1);
    expect(await receipts.countDocuments()).toBe(1);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (connection) {
      if (!connection.name.startsWith('lecpunch_local_cards_')) throw new Error('Refusing to drop an unscoped database');
      await connection.dropDatabase(); await connection.close();
    }
  });
  it('serializes concurrent draws and permanently replays their archived results', async () => {
    const inputs = Array.from({ length: 2 }, () => ({ requestKey: randomUUID(), action: 'draw' as const }));
    const results = await Promise.all(inputs.map(input => service.action(actor, input)));
    const view = await service.getMe(actor);
    expect(view.freeRemaining).toBe(0);
    expect(view.collection.reduce((sum, card) => sum + card.quantity, 0)).toBe(2);
    expect(await receipts.countDocuments()).toBe(2);
    expect((await games.findOne().lean())?.pendingWrite).toBeUndefined();
    expect((await service.action(actor, inputs[0])).result).toEqual(results[0].result);
    await expect(service.action(actor, { ...inputs[0], action: 'gift', cardId: 'card-01', targetId: actor.userId })).rejects.toThrow('同一操作编号');
  });
  it('commits concurrent ten-draw retries once and recovers the complete batch after an archival failure', async () => {
    const { getWeekKey } = await import('../../common/utils/time.util');
    await adjustmentBuckets.create({ teamId: actor.teamId, userId: actor.userId, weekKey: getWeekKey(new Date()), entries: [{ signedDurationSeconds: 36000 }] });
    const input = { requestKey: randomUUID(), action: 'draw' as const, count: 10 as const };
    vi.spyOn(receipts, 'updateOne').mockImplementationOnce(() => { throw new Error('batch archive interrupted'); });
    await expect(service.action(actor, input)).rejects.toThrow('batch archive interrupted');
    const results = await Promise.all([service.action(actor, input), service.action(actor, input)]);
    expect(results[0].result).toEqual(results[1].result);
    expect(results[0].result.drawCount).toBe(10); expect(await receipts.countDocuments()).toBe(1);
    const view = await service.getMe(actor);
    expect(view.points.spent).toBe(480); expect(view.freeRemaining).toBe(0);
    expect(view.collection.reduce((sum, card) => sum + card.quantity, 0)).toBe(results[0].result.gainedCardIds!.length);
    expect((await games.findOne().lean())?.pendingWrite).toBeUndefined();
  });
  it('recovers a crash after state commit but before receipt archival without a second debit', async () => {
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    vi.spyOn(receipts, 'updateOne').mockImplementationOnce(() => { throw new Error('injected archive failure'); });
    await expect(service.action(actor, input)).rejects.toThrow('injected archive failure');
    const committed = await games.findOne().lean();
    expect(committed?.pendingWrite.receipt.value.requestKey).toBe(input.requestKey);
    expect(await receipts.countDocuments()).toBe(0);
    const retried = await service.action(actor, input);
    expect(retried.state.freeRemaining).toBe(1);
    expect(retried.state.collection.reduce((sum, card) => sum + card.quantity, 0)).toBe(1);
    expect(await receipts.countDocuments()).toBe(1);
  });
  it('recovers after receipt insertion succeeds but clearing the outbox fails', async () => {
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const original = games.updateOne.bind(games);
    let interrupted = false;
    const spy = vi.spyOn(games, 'updateOne').mockImplementation(((...args: any[]) => {
      if (!interrupted && args[1]?.$unset?.pendingWrite) { interrupted = true; throw new Error('clear interrupted'); }
      return (original as any)(...args);
    }) as any);
    await expect(service.action(actor, input)).rejects.toThrow('clear interrupted');
    spy.mockRestore();
    expect(await receipts.countDocuments()).toBe(1);
    expect((await games.findOne().lean())?.pendingWrite).toBeDefined();
    const replay = await service.action(actor, input);
    expect(replay.state.freeRemaining).toBe(1);
    expect(await receipts.countDocuments()).toBe(1);
    expect((await games.findOne().lean())?.pendingWrite).toBeUndefined();
  });
  it('keeps receipt history outside the live document and reads only the last twenty actor events', async () => {
    await service.getMe(actor);
    const rows = Array.from({ length: 250 }, (_, index) => ({
      teamId: actor.teamId, actorId: actor.userId, receiptKey: createHash('sha256').update(String(index)).digest('hex'),
      requestKey: randomUUID(), hash: 'action-hash', contentHash: 'immutable-test-copy',
      at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), result: { message: `event-${index}` }
    }));
    await receipts.insertMany(rows);
    const view = await service.getMe(actor);
    expect(view.events).toHaveLength(20);
    expect(view.events[0].message).toBe('event-249');
    expect(Object.keys((await games.findOne().lean())!.receipts)).toHaveLength(0);
  });

  it('archives legacy embedded receipts without losing replay or overwriting confirmed copies', async () => {
    const input = { requestKey: randomUUID(), action: 'draw' as const };
    const first = await service.action(actor, input);
    const stored = await receipts.findOne().lean();
    const { actorId, requestKey, hash, at, result } = stored!;
    const key = createHash('sha256').update(`${actor.userId}:${input.requestKey}`).digest('hex');
    await games.updateOne({}, { $set: { receipts: { [key]: { actorId, requestKey, hash, at, result } } } });
    await receipts.deleteMany({});
    expect((await service.action(actor, input)).result).toEqual(first.result);
    expect(Object.keys((await games.findOne().lean())!.receipts)).toHaveLength(0);
    expect(await receipts.countDocuments()).toBe(1);
  });
  it('keeps signed weekly history queryable after pruning it from live state', async () => {
    await service.getMe(actor);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.weeks.2026-01-05`]: {
      entertainmentSeconds: -900, mintedSeconds: 0, spentPoints: 0, freeUsed: 2, bonusDraws: 0
    } } });
    vi.spyOn(weeks, 'updateOne').mockImplementationOnce(() => { throw new Error('injected week archive failure'); });
    await expect(service.getMemberEntertainmentHistory(actor.teamId, actor.userId)).rejects.toThrow('injected week archive failure');
    const row = await games.findOne().lean();
    expect(row?.pendingWrite.weeks).toHaveLength(1);
    expect((await service.getTeamWeekEntertainment(actor.teamId, '2026-01-05'))[actor.userId]).toBe(-900);
    expect((await service.getMemberEntertainmentHistory(actor.teamId, actor.userId))['2026-01-05']).toBe(-900);
    expect(await weeks.countDocuments()).toBe(1);
  });
  it.each([2062, '2062', 'invalid', 2026.5, null])('returns typed unavailable for malformed saved cohort evidence %s', async year => {
    const log = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await assessmentWeeks.collection.insertOne({ teamId: actor.teamId, weekKey: '2026-01-05', state: { requiredEnrollYears: [year] } });
    const before = await assessmentWeeks.findOne().lean();
    const view = await service.getMe(actor);
    expect(view.requiredEnrollYears).toEqual([]);
    await service.action(actor, { requestKey: randomUUID(), action: 'draw' });
    expect((await service.getTeamWeekEntertainment(actor.teamId, view.week))[actor.userId]).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ teamId: actor.teamId, source: 'persisted' }));
    const memberService = { listTeamMembers: async () => [{ id: actor.userId, enrollYear: actor.enrollYear }] };
    const assessment = new AssessmentService(assessmentWeeks, {} as any, users, attendance, new ConfigService(), memberService as any, {} as any, service, {} as any);
    await expect(assessment.memberSummaries(actor)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await assessmentWeeks.countDocuments()).toBe(1);
    expect(await assessmentWeeks.findOne().lean()).toEqual(before);
  });

  it('keeps current member statistics and cards readable with a disabled legacy invalid-year row while assessment stays strict', async () => {
    const log = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await users.collection.insertOne({ _id: new Types.ObjectId('6a0000000000000000000099'), teamId: actor.teamId,
      username: 'bad.legacy', displayName: 'Legacy', status: 'disabled', role: 'member', enrollYear: 2062 });
    const view = await service.getMe(actor);
    expect(view.requiredEnrollYears).toEqual([2026, 2025]);
    expect(view.players.some(player => player.username === 'bad.legacy')).toBe(false);
    await games.updateOne({}, { $set: { [`state.members.${actor.userId}.weeks.${view.week}.entertainmentSeconds`]: 1234 } });
    const members = (await users.find({ teamId: actor.teamId }).lean()).map(member => ({ id: String(member._id),
      displayName: member.displayName, role: member.role, enrollYear: member.enrollYear }));
    const memberService = { listTeamMembers: async () => members, getMemberKey: (id: string) => `opaque-${id}` };
    const stats = new StatsService({ getModel: () => attendance, getManualAdjustmentSummaries: async () => new Map() } as any, memberService as any, service);
    const rows = await stats.getTeamCurrentWeekStats(actor.teamId);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.memberKey === `opaque-${actor.userId}`)?.entertainmentSeconds).toBe(1234);
    const assessment = new AssessmentService(assessmentWeeks, {} as any, users, attendance, new ConfigService(), memberService as any, {} as any, service, stats);
    await expect(assessment.memberSummaries(actor)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await assessmentWeeks.countDocuments()).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ teamId: actor.teamId, source: 'members' }));
  });

  it('rejects invalid enrollment years at the real model boundary', async () => {
    await expect(users.create({ teamId: actor.teamId, username: 'invalid', displayName: 'Invalid', enrollYear: 2062 })).rejects.toThrow('入学年级无效');
    expect(await users.countDocuments()).toBe(1);
  });
});

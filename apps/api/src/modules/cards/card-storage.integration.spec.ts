import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnection, type Connection, type Model } from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
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
    service = new CardsService(games, users, points, attendance, new ConfigService({ AUTH_SECRET: 'isolated-local-integration-key' }), storage);
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
    await assessmentWeeks.collection.insertOne({ teamId: actor.teamId, weekKey: '2026-01-05', state: { requiredEnrollYears: [year] } });
    const memberService = { listTeamMembers: async () => [{ id: actor.userId, enrollYear: actor.enrollYear }] };
    const assessment = new AssessmentService(assessmentWeeks, {} as any, users, attendance, new ConfigService(), memberService as any, {} as any, service, {} as any);
    await expect(assessment.memberSummaries(actor)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await assessmentWeeks.countDocuments()).toBe(1);
  });

  it('rejects invalid enrollment years at the real model boundary', async () => {
    await expect(users.create({ teamId: actor.teamId, username: 'invalid', displayName: 'Invalid', enrollYear: 2062 })).rejects.toThrow('入学年级无效');
    expect(await users.countDocuments()).toBe(1);
  });
});

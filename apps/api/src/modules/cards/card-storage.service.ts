import { ConflictException, Injectable, Logger, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { CardGame, CardGameDocument, type CardActionReceipt, type PendingCardWrite } from './schemas/card-game.schema';
import { CardActionArchive, CardWeekArchive } from './schemas/card-archive.schema';
import { createGameState, type GameState } from './card-engine';

export type CardSnapshot = {
  teamId: string; revision: number; startWeek: string; state: GameState;
  receipts: Record<string, CardActionReceipt>; pendingWrite?: PendingCardWrite; capacityLimited?: boolean;
};
const MAX_BYTES = 8 * 1024 * 1024;
export class CardCapacityException extends ConflictException {}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');

/** Single-document state + durable outbox: works on standalone Mongo without two-document transactions. */
@Injectable()
export class CardStorageService implements OnModuleInit {
  private readonly logger = new Logger(CardStorageService.name);
  private readiness?: Promise<unknown>;
  constructor(
    @InjectModel(CardGame.name) private readonly games: Model<CardGameDocument>,
    @InjectModel(CardActionArchive.name) private readonly actions: Model<CardActionArchive>,
    @InjectModel(CardWeekArchive.name) private readonly weeks: Model<CardWeekArchive>
  ) {}

  private ensureReady() {
    return this.readiness ??= Promise.all([this.games.init(), this.actions.init(), this.weeks.init()]);
  }

  async onModuleInit() { await this.ensureReady(); }

  needsArchive(game: CardSnapshot, now: number): boolean {
    return Object.values(game.state.members).some(member => Object.entries(member.weeks).some(([key, value]) =>
      value.accelerationAt === undefined && now >= DateTime.fromISO(key, { zone: 'Asia/Shanghai' }).plus({ days: 7, hours: 5 }).toMillis()));
  }

  private async saveReceipt(teamId: string, receiptKey: string, value: CardActionReceipt) {
    // A conflicting immutable copy must fail closed, never overwrite an already confirmed result.
    const contentHash = digest(value);
    await this.actions.updateOne({ teamId, receiptKey, contentHash }, {
      $setOnInsert: { teamId, receiptKey, contentHash, ...value }
    }, { upsert: true }).exec();
  }

  async load(teamId: string, week: string): Promise<CardSnapshot> {
    await this.ensureReady();
    try {
      await this.games.updateOne({ teamId }, { $setOnInsert: {
        teamId, revision: 0, startWeek: week, state: createGameState(), receipts: {}
      } }, { upsert: true }).exec();
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = await this.games.findOne({ teamId }).lean().exec();
      if (!row) throw new ServiceUnavailableException('卡牌存储暂时不可用');
      const game = row as unknown as CardSnapshot;
      game.receipts ??= {};
      if (game.pendingWrite) {
        const pending = game.pendingWrite;
        try {
          if (pending.receipt) await this.saveReceipt(teamId, pending.receipt.receiptKey, pending.receipt.value);
          for (const archived of pending.weeks) {
            const contentHash = digest(archived.week);
            await this.weeks.updateOne({ teamId, userId: archived.userId, weekKey: archived.weekKey, contentHash }, {
              $setOnInsert: { teamId, ...archived, contentHash }
            }, { upsert: true }).exec();
          }
          const cleared = await this.games.updateOne({ teamId, revision: game.revision }, {
            $unset: { pendingWrite: 1 }, $inc: { revision: 1 }
          }).exec();
          if (!cleared.modifiedCount) continue;
          game.revision++; delete game.pendingWrite;
        } catch (error) {
          this.logger.error({
            message: 'Pending card write recovery failed', teamId, revision: game.revision,
            receiptKey: pending.receipt?.receiptKey,
            archivedWeeks: pending.weeks.map(({ userId, weekKey }) => ({ userId, weekKey })),
            errorName: error instanceof Error ? error.name : typeof error,
            errorCode: error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
          });
          throw error;
        }
      }
      // Compatibility: archive a bounded batch only after its immutable copies exist.
      const legacy = Object.entries(game.receipts).slice(0, 100);
      if (legacy.length) {
        if (legacy.some(([key]) => !/^[a-f\d]{64}$/.test(key))) throw new ConflictException('旧卡牌回执标识无效，需审计后修复');
        await this.actions.bulkWrite(legacy.map(([receiptKey, value]) => ({ updateOne: {
          filter: { teamId, receiptKey, contentHash: digest(value) },
          update: { $setOnInsert: { teamId, receiptKey, contentHash: digest(value), ...value } }, upsert: true
        } })), { ordered: false });
        const migrated = await this.games.updateOne({ teamId, revision: game.revision }, {
          $unset: Object.fromEntries(legacy.map(([key]) => [`receipts.${key}`, 1])), $inc: { revision: 1 }
        }).exec();
        if (!migrated.modifiedCount) continue;
        game.revision++; for (const [key] of legacy) delete game.receipts[key];
      }
      return game;
    }
    throw new ConflictException('卡牌归档正在更新，请保留操作编号重试');
  }

  async commit(game: CardSnapshot, next: GameState, now: number, receipt?: PendingCardWrite['receipt']): Promise<boolean> {
    const state = structuredClone(next);
    const weeks: PendingCardWrite['weeks'] = [];
    // Reconciliation runs before commit. Keep the current week and the five-hour closing window live.
    for (const [userId, member] of Object.entries(state.members)) {
      for (const [weekKey, week] of Object.entries(member.weeks)) {
        const end = DateTime.fromISO(weekKey, { zone: 'Asia/Shanghai' }).plus({ days: 7 }).toMillis();
        if (weeks.length < 100 && Number.isFinite(end) && now >= end + 5 * 3_600_000 && week.accelerationAt === undefined) {
          weeks.push({ userId, weekKey, week }); delete member.weeks[weekKey];
        }
      }
    }
    const pendingWrite = receipt || weeks.length ? { ...(receipt ? { receipt } : {}), weeks } : undefined;
    if (Buffer.byteLength(JSON.stringify({ state, receipts: game.receipts, pendingWrite }), 'utf8') > MAX_BYTES) {
      throw new CardCapacityException('卡牌状态达到安全容量，请联系维护者；已有卡片及操作记录保持可查询');
    }
    const saved = await this.games.updateOne({ teamId: game.teamId, revision: game.revision, pendingWrite: { $exists: false } }, {
      $set: { state, ...(pendingWrite ? { pendingWrite } : {}) }, $inc: { revision: 1 }
    }).exec();
    return saved.modifiedCount === 1;
  }

  async receipt(game: CardSnapshot, receiptKey: string): Promise<CardActionReceipt | undefined> {
    return game.receipts[receiptKey] ?? (await this.actions.findOne({ teamId: game.teamId, receiptKey }).lean().exec() ?? undefined);
  }

  async events(game: CardSnapshot, actorId: string) {
    const rows = await this.actions.find({ teamId: game.teamId, actorId }).sort({ at: -1, receiptKey: 1 }).limit(20).lean().exec();
    const combined = new Map<string, CardActionReceipt & { receiptKey: string }>(rows.map(row => [row.receiptKey, row]));
    for (const [key, receipt] of Object.entries(game.receipts)) if (receipt.actorId === actorId) combined.set(key, { ...receipt, receiptKey: key });
    return [...combined.values()].sort((a, b) => b.at.localeCompare(a.at) || a.receiptKey.localeCompare(b.receiptKey)).slice(0, 20)
      .map(row => ({ id: row.receiptKey, at: row.at, message: row.result.message }));
  }

  archivedWeeks(teamId: string, filter: { userId?: string; weekKey?: string }) {
    return this.weeks.find({ teamId, ...filter }).select('userId weekKey week').lean().exec();
  }
}

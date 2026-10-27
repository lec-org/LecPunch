import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, createHmac } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CardGameActionInput, CardGameActionResponse, CardGameView } from '@lecpunch/shared';
import { getWeekKey } from '../../common/utils/time.util';
import type { AuthUser } from '../auth/types/auth-user.type';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AttendanceSession, AttendanceSessionDocument } from '../attendance/schemas/attendance-session.schema';
import { PointLedgerEntry, PointLedgerEntryDocument } from '../points/schemas/point-ledger-entry.schema';
import { CardGame, CardGameDocument, type CardActionReceipt } from './schemas/card-game.schema';
import { CARD_CATALOG } from './card-catalog';
import { advanceGameState, applyGameAction, getPlayerWeek, type GameContext } from './card-engine';

import { CardCapacityException, CardStorageService, type CardSnapshot as Snapshot } from './card-storage.service';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicId = (id: string) => `card-${String(CARD_CATALOG.findIndex(card => card.id === id) + 1).padStart(2, '0')}`;
const privateId = (id?: string) => CARD_CATALOG.find(card => publicId(card.id) === id)?.id;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function cardActionHash(input: Omit<CardGameActionInput, 'requestKey'>): string {
  return hash(JSON.stringify({ action: input.action, cardId: input.cardId ?? null, targetId: input.targetId ?? null, secondTargetId: input.secondTargetId ?? null }));
}
export function seededCardRandom(secret: string, key: string): () => number {
  let counter = 0;
  return () => createHmac('sha256', secret).update(`${key}:${counter++}`).digest().readUInt32BE(0) / 0x100000000;
}

@Injectable()
export class CardsService {
  constructor(
    @InjectModel(CardGame.name) private readonly games: Model<CardGameDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(PointLedgerEntry.name) private readonly ledger: Model<PointLedgerEntryDocument>,
    @InjectModel(AttendanceSession.name) private readonly attendance: Model<AttendanceSessionDocument>,
    private readonly config: ConfigService,
    private readonly storage: CardStorageService
  ) {}

  private async context(teamId: string, random: () => number = () => { throw new Error('Randomness requires an action'); }): Promise<GameContext> {
    const now = Date.now(), week = getWeekKey(new Date(now));
    const game = await this.games.findOne({ teamId }).select('state').lean().exec();
    const sessionWeeks = new Set([week]);
    for (const member of Object.values(game?.state?.members ?? {})) {
      for (const [key, value] of Object.entries(member.weeks)) {
        if (key <= week && value.accelerationAt !== undefined) sessionWeeks.add(key);
      }
    }
    const [members, earned, sessions] = await Promise.all([
      this.users.find({ teamId, status: 'active' }).lean().exec(),
      this.ledger.aggregate<{ _id: string; points: number }>([
        { $match: { teamId, weekKey: week, sourceType: 'attendance' } },
        { $group: { _id: '$userId', points: { $sum: '$points' } } }
      ]).exec(),
      this.attendance.find({ teamId, weekKey: { $in: [...sessionWeeks] }, status: 'completed', durationSeconds: { $gt: 0, $lt: 18000 } })
        .select('_id userId weekKey checkOutAt durationSeconds').lean().exec()
    ]);
    return { now, week, random,
      players: members.map(member => ({ id: String(member._id), username: member.username, name: member.displayName, enrollYear: member.enrollYear })),
      earnedPoints: Object.fromEntries(earned.map(row => [row._id, Math.max(0, row.points)])),
      sessions: sessions.filter(session => session.checkOutAt).map(session => ({ id: String(session._id), userId: session.userId, weekKey: session.weekKey, checkOutAt: new Date(session.checkOutAt!).getTime(), durationSeconds: session.durationSeconds! }))
    };
  }

  private assertActor(user: AuthUser, context: GameContext) {
    if (!context.players.some(player => player.id === user.userId)) throw new ForbiddenException('当前账号不可参与卡牌活动');
  }

  private async view(game: Snapshot, user: AuthUser, ctx: GameContext): Promise<CardGameView> {
    const week = getPlayerWeek(game.state, user.userId, ctx.week);
    const player = game.state.members[user.userId];
    const earned = ctx.earnedPoints[user.userId] ?? 0, bonus = Math.floor(week.mintedSeconds / 60);
    const own = ctx.players.find(member => member.id === user.userId)!;
    const targetMode = (id: string): 'none' | 'self-or-other' | 'other' | 'two' | 'recipient' =>
      id === 'r-add' ? 'self-or-other' : id === 'sr-chain' ? 'two' : id === 'r-thief' ? 'recipient' :
      ['r-skip', 'sr-famine', 'sr-redking', 'ssr-arrows'].includes(id) ? 'other' : 'none';
    return {
      capacityLimited: game.capacityLimited === true,
      entertainmentSeconds: week.entertainmentSeconds,
      week: ctx.week, points: { earned, bonus, spent: week.spentPoints, balance: Math.max(0, earned + bonus - week.spentPoints) },
      freeRemaining: Math.max(0, 2 - week.freeUsed), giftDraws: week.bonusDraws,
      pity: { sinceSR: player.pitySR, sinceSSR: player.pitySSR, srRemaining: Math.max(1, 10 - player.pitySR), ssrRemaining: Math.max(1, 50 - player.pitySSR) },
      collection: CARD_CATALOG.map(card => {
        const unlocked = player.discovered.includes(card.id);
        return { id: publicId(card.id), rarity: card.rarity, unlocked, quantity: player.inventory[card.id] ?? 0,
          ...(unlocked ? { name: card.name, type: card.type, stat: card.stat, summary: card.summary, effect: card.effect, detail: card.detail,
            targetMode: targetMode(card.id), usable: !['n-shield', 'r-blade', 'sr-reflect'].includes(card.id) } : {}) };
      }),
      players: ctx.players.filter(member => member.enrollYear === own.enrollYear).map(member => ({ id: member.id, username: member.username, displayName: member.name, enrollYear: member.enrollYear })),
      statuses: { acceleration: week.accelerationAt !== undefined, immuneUntil: this.futureDate(week.immuneUntil, ctx.now), lockedUntil: this.futureDate(week.lockedUntil, ctx.now), starvedUntil: this.futureDate(week.starvedUntil, ctx.now) },
      events: await this.storage.events(game, user.userId)
    };
  }

  private futureDate(timestamp: number | undefined, now: number) { return timestamp && timestamp > now ? new Date(timestamp).toISOString() : null; }

  private async refresh(teamId: string): Promise<{ game: Snapshot; ctx: GameContext }> {
    const ctx = await this.context(teamId);
    for (let attempt = 0; attempt < 8; attempt++) {
      const game = await this.storage.load(teamId, ctx.week), state = structuredClone(game.state);
      advanceGameState(state, ctx);
      if (JSON.stringify(state) === JSON.stringify(game.state) && !this.storage.needsArchive(game, ctx.now)) return { game, ctx };
      try {
        if (await this.storage.commit(game, state, ctx.now)) return { game: await this.storage.load(teamId, ctx.week), ctx };
      } catch (error) {
        if (error instanceof CardCapacityException) return { game: { ...game, capacityLimited: true }, ctx };
        throw error;
      }
    }
    throw new ConflictException('卡牌状态正在更新，请刷新后重试');
  }

  async getMe(user: AuthUser): Promise<CardGameView> {
    const { game, ctx } = await this.refresh(user.teamId); this.assertActor(user, ctx);
    return this.view(game, user, ctx);
  }

  async action(user: AuthUser, input: CardGameActionInput): Promise<CardGameActionResponse> {
    if (!UUID.test(input.requestKey)) throw new BadRequestException('操作编号必须为 UUID v4');
    const receiptKey = hash(`${user.userId}:${input.requestKey}`), requestHash = cardActionHash(input);
    const privateCardId = input.cardId ? privateId(input.cardId) : undefined;
    if (input.cardId && !privateCardId) throw new BadRequestException('卡片不存在');
    if (input.action === 'draw' && (input.cardId || input.targetId || input.secondTargetId)) throw new BadRequestException('抽卡不能指定卡片或目标');
    const seed = `${user.teamId}:${receiptKey}:${requestHash}`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const ctx = await this.context(user.teamId, seededCardRandom(this.config.getOrThrow<string>('AUTH_SECRET'), seed));
      this.assertActor(user, ctx);
      const game = await this.storage.load(user.teamId, ctx.week), previous = await this.storage.receipt(game, receiptKey);
      if (previous) {
        if (previous.hash !== requestHash) throw new ConflictException('同一操作编号不能用于不同请求');
        const refreshed = await this.getMe(user);
        return { result: previous.result, state: refreshed };
      }
      const state = structuredClone(game.state);
      let result;
      try {
        result = applyGameAction(state, user.userId, { action: input.action, cardId: privateCardId, targetId: input.targetId, secondTargetId: input.secondTargetId }, ctx);
      } catch (error) { throw new BadRequestException((error as Error).message); }
      const resultView = {
        message: result.message,
        ...(result.gainedCardId ? { gainedCardId: publicId(result.gainedCardId) } : {}),
        ...(result.gainedCardIds ? { gainedCardIds: result.gainedCardIds.map(publicId) } : {}),
        ...(result.drawAnimation ? { drawAnimation: result.drawAnimation } : {}),
        ...(result.ssrPity !== undefined ? { ssrPity: result.ssrPity } : {})
      };
      const receipt: CardActionReceipt = { actorId: user.userId, requestKey: input.requestKey, hash: requestHash, at: new Date(ctx.now).toISOString(), result: resultView };
      if (await this.storage.commit(game, state, ctx.now, { receiptKey, value: receipt })) {
        const saved = await this.storage.load(user.teamId, ctx.week);
        return { result: resultView, state: await this.view(saved, user, ctx) };
      }
    }
    throw new ConflictException('多人操作冲突，请使用原操作编号重试');
  }

  async actionStatus(user: AuthUser, requestKey: string): Promise<CardGameActionResponse> {
    if (!UUID.test(requestKey)) throw new BadRequestException('操作编号格式不正确');
    const { game, ctx } = await this.refresh(user.teamId); this.assertActor(user, ctx);
    const receipt = await this.storage.receipt(game, hash(`${user.userId}:${requestKey}`));
    if (!receipt) throw new NotFoundException('该操作尚未确认，请使用原操作编号重试');
    return { result: receipt.result, state: await this.view(game, user, ctx) };
  }

  async artwork(user: AuthUser, id: string): Promise<string> {
    const cardId = privateId(id);
    if (!cardId) throw new NotFoundException('卡片不存在');
    const { game, ctx } = await this.refresh(user.teamId); this.assertActor(user, ctx);
    if (!game.state.members[user.userId].discovered.includes(cardId)) throw new ForbiddenException('尚未发现这张卡片');
    const directory = this.config.get<string>('LEC_CARD_ASSETS_DIR');
    if (!directory) throw new ServiceUnavailableException('卡牌图片目录尚未配置');
    const file = resolve(directory, `${cardId}.png`);
    try { await access(file); } catch { throw new NotFoundException('卡牌图片暂不可用'); }
    return file;
  }

  async getTeamWeekEntertainment(teamId: string, weekKey: string): Promise<Record<string, number>> {
    let game = await this.games.findOne({ teamId }).lean().exec() as unknown as Snapshot | null;
    if (!game) return {};
    if (weekKey === getWeekKey(new Date()) ||
      Object.values(game.state.members).some(member => member.weeks[weekKey]?.accelerationAt !== undefined)) {
      game = (await this.refresh(teamId)).game;
      if (game.capacityLimited) throw new ServiceUnavailableException('娱乐时长尚未完成可信结算，请联系维护者');
    }
    game = await this.storage.load(teamId, getWeekKey(new Date()));
    const archived = await this.storage.archivedWeeks(teamId, { weekKey });
    const values = Object.fromEntries(archived.map(row => [row.userId, row.week.entertainmentSeconds]));
    for (const [id, member] of Object.entries(game.state.members)) {
      if (member.weeks[weekKey]) values[id] = member.weeks[weekKey].entertainmentSeconds;
      else values[id] ??= 0;
    }
    return values;
  }

  async getTeamGameStartWeek(teamId: string): Promise<string | null> {
    const game = await this.games.findOne({ teamId }).select('startWeek').lean().exec();
    return game?.startWeek ?? null;
  }

  async getMemberEntertainmentHistory(teamId: string, userId: string): Promise<Record<string, number>> {
    const existing = await this.games.findOne({ teamId }).select('teamId').lean().exec();
    if (!existing) return {};
    const { game } = await this.refresh(teamId);
    if (game.capacityLimited) throw new ServiceUnavailableException('娱乐时长尚未完成可信结算，请联系维护者');
    const member = game.state.members[userId];
    const archived = await this.storage.archivedWeeks(teamId, { userId });
    return { ...Object.fromEntries(archived.map(row => [row.weekKey, row.week.entertainmentSeconds])),
      ...Object.fromEntries(Object.entries(member?.weeks ?? {}).map(([week, value]) => [week, value.entertainmentSeconds])) };
  }
}

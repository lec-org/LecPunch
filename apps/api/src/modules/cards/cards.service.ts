import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, createHmac } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CardGameActionInput, CardGameActionResponse, CardGameView } from '@lecpunch/shared';
import { CARD_PITY_LIMITS, weeklyDrawPoints } from '@lecpunch/shared';
import { getWeekKey } from '../../common/utils/time.util';
import type { AuthUser } from '../auth/types/auth-user.type';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AttendanceSession, AttendanceSessionDocument } from '../attendance/schemas/attendance-session.schema';
import { PointsService } from '../points/points.service';
import { CardGame, CardGameDocument, type CardActionReceipt } from './schemas/card-game.schema';
import { ASSESSMENT_TARGET_CARDS, CARD_CATALOG } from './card-catalog';
import { AssessmentWeek, type AssessmentWeekDocument } from '../assessment/schemas/assessment.schema';
import { readAssessmentCohorts } from '../assessment/assessment-cohorts';
import { advanceGameState, applyGameAction, getPlayerWeek, type GameContext } from './card-engine';

import { CardCapacityException, CardStorageService, type CardSnapshot as Snapshot } from './card-storage.service';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicId = (id: string) => `card-${String(CARD_CATALOG.findIndex(card => card.id === id) + 1).padStart(2, '0')}`;
const privateId = (id?: string) => CARD_CATALOG.find(card => publicId(card.id) === id)?.id;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function cardActionHash(input: Omit<CardGameActionInput, 'requestKey'>): string {
  return hash(JSON.stringify({ action: input.action, cardId: input.cardId ?? null, targetId: input.targetId ?? null, secondTargetId: input.secondTargetId ?? null,
    ...(input.count !== undefined && input.count !== 1 ? { count: input.count } : {}) }));
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
    private readonly points: PointsService,
    @InjectModel(AttendanceSession.name) private readonly attendance: Model<AttendanceSessionDocument>,
    private readonly config: ConfigService,
    private readonly storage: CardStorageService,
    @InjectModel(AssessmentWeek.name) private readonly assessmentWeeks: Model<AssessmentWeekDocument>
  ) {}

  private async context(teamId: string, game: Snapshot, random: () => number = () => { throw new Error('Randomness requires an action'); }): Promise<GameContext> {
    const now = Date.now(), week = getWeekKey(new Date(now));
    const sessionWeeks = new Set([week]);
    for (const member of Object.values(game?.state?.members ?? {})) {
      for (const [key, value] of Object.entries(member.weeks)) {
        if (key <= week && value.accelerationAt !== undefined) sessionWeeks.add(key);
      }
    }
    const [members, allMembers, earned, sessions] = await Promise.all([
      this.users.find({ teamId, status: 'active' }).lean().exec(),
      this.users.find({ teamId }).select('enrollYear').lean().exec(),
      this.points.getTeamWeekBaseSeconds(teamId, week),
      this.attendance.find({ teamId, weekKey: { $in: [...sessionWeeks] }, status: 'completed', durationSeconds: { $gt: 0, $lt: 18000 } })
        .select('_id userId weekKey checkOutAt durationSeconds').lean().exec()
    ]);
    const assessmentYears = await readAssessmentCohorts(this.assessmentWeeks, teamId, allMembers.map(member => member.enrollYear), week);
    return { now, week, random, assessmentYears,
      players: members.map(member => ({ id: String(member._id), username: member.username, name: member.displayName, enrollYear: member.enrollYear })),
      baseSeconds: earned,
      sessions: sessions.filter(session => session.checkOutAt).map(session => ({ id: String(session._id), userId: session.userId, weekKey: session.weekKey, checkOutAt: new Date(session.checkOutAt!).getTime(), durationSeconds: session.durationSeconds! }))
    };
  }

  private assertActor(user: AuthUser, context: GameContext) {
    if (!context.players.some(player => player.id === user.userId)) throw new ForbiddenException('当前账号不可参与卡牌活动');
  }

  private async view(game: Snapshot, user: AuthUser, ctx: GameContext): Promise<CardGameView> {
    const week = getPlayerWeek(game.state, user.userId, ctx.week);
    const player = game.state.members[user.userId];
    const [events, incomingGifts, incomingDefenses, incomingInteractions] = await Promise.all([this.storage.events(game, user.userId), this.storage.incomingGifts(user.teamId, user.userId), this.storage.incomingDefenses(user.teamId, user.userId), this.storage.incomingInteractions(user.teamId, user.userId)]);
    const targetMode = (id: string): 'none' | 'self-or-other' | 'other' | 'two' | 'recipient' =>
      id === 'r-add' ? 'self-or-other' : id === 'sr-chain' ? 'two' : id === 'r-thief' ? 'recipient' :
      ['r-steal', 'r-skip', 'sr-famine', 'sr-redking', 'ssr-arrows'].includes(id) ? 'other' : 'none';
    return {
      capacityLimited: game.capacityLimited === true,
      entertainmentSeconds: week.entertainmentSeconds,
      week: ctx.week, points: weeklyDrawPoints(ctx.baseSeconds[user.userId] ?? 0, week.entertainmentSeconds, week.spentPoints),
      freeRemaining: Math.max(0, 2 - week.freeUsed), giftDraws: week.bonusDraws,
      pity: { sinceSR: player.pitySR, sinceSSR: player.pitySSR, srRemaining: Math.max(1, CARD_PITY_LIMITS.sr - player.pitySR), ssrRemaining: Math.max(1, CARD_PITY_LIMITS.ssr - player.pitySSR) },
      collection: CARD_CATALOG.map(card => {
        const unlocked = player.discovered.includes(card.id);
        return { id: publicId(card.id), rarity: card.rarity, unlocked, quantity: player.inventory[card.id] ?? 0,
          ...(unlocked ? { name: card.name, type: card.type, stat: card.stat, summary: card.summary, effect: card.effect, detail: card.detail,
            targetMode: targetMode(card.id), targetScope: ASSESSMENT_TARGET_CARDS.includes(card.id) ? 'assessment' as const : 'same-grade' as const,
            usable: !['n-shield', 'r-blade', 'sr-reflect'].includes(card.id) } : {}) };
      }),
      players: ctx.players.map(member => ({ id: member.id, username: member.username, displayName: member.name, enrollYear: member.enrollYear })),
      requiredEnrollYears: ctx.assessmentYears,
      statuses: { acceleration: week.accelerationAt !== undefined, immuneUntil: this.futureDate(week.immuneUntil, ctx.now), lockedUntil: this.futureDate(week.lockedUntil, ctx.now), starvedUntil: this.futureDate(week.starvedUntil, ctx.now) },
      events, incomingGifts, incomingDefenses, incomingInteractions
    };
  }

  private futureDate(timestamp: number | undefined, now: number) { return timestamp && timestamp > now ? new Date(timestamp).toISOString() : null; }

  private async refresh(teamId: string): Promise<{ game: Snapshot; ctx: GameContext }> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const game = await this.storage.load(teamId, getWeekKey(new Date()));
      const ctx = await this.context(teamId, game), state = structuredClone(game.state);
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

  async acknowledgeGifts(user: AuthUser, ids: string[]) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^[a-f\d]{64}$/.test(id))) {
      throw new BadRequestException('一次只能确认 1 至 20 条有效赠卡通知');
    }
    const { ctx } = await this.refresh(user.teamId); this.assertActor(user, ctx);
    return this.storage.acknowledgeGifts(user.teamId, user.userId, [...new Set(ids)]);
  }

  async acknowledgeDefenses(user: AuthUser, ids: string[]) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^[a-f\d]{64}$/.test(id))) {
      throw new BadRequestException('一次只能确认 1 至 20 条有效防御通知');
    }
    const { ctx } = await this.refresh(user.teamId); this.assertActor(user, ctx);
    return this.storage.acknowledgeDefenses(user.teamId, user.userId, [...new Set(ids)]);
  }

  async acknowledgeInteractions(user: AuthUser, ids: string[]) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^[a-f\d]{64}$/.test(id))) {
      throw new BadRequestException('一次只能确认 1 至 20 条有效卡牌互动通知');
    }
    const { ctx } = await this.refresh(user.teamId); this.assertActor(user, ctx);
    return this.storage.acknowledgeInteractions(user.teamId, user.userId, [...new Set(ids)]);
  }

  async getWeekPoints(user: AuthUser, weekKey: string) {
    const { game, ctx } = await this.refresh(user.teamId);
    this.assertActor(user, ctx);
    if (game.capacityLimited) throw new ServiceUnavailableException('综合时长尚未完成可信结算，请联系维护者');
    const live = game.state.members[user.userId]?.weeks[weekKey];
    const week = live ?? (await this.storage.archivedWeeks(user.teamId, { userId: user.userId, weekKey }))[0]?.week;
    const base = weekKey === ctx.week ? ctx.baseSeconds : await this.points.getTeamWeekBaseSeconds(user.teamId, weekKey);
    return weeklyDrawPoints(base[user.userId] ?? 0, week?.entertainmentSeconds ?? 0, week?.spentPoints ?? 0);
  }

  private inventoryItems(game: Snapshot | null, userId: string) {
    const inventory = game?.state.members[userId]?.inventory ?? {};
    if (Object.entries(inventory).some(([id, quantity]) => !Number.isSafeInteger(quantity) || quantity < 0 ||
      (quantity > 0 && !CARD_CATALOG.some(card => card.id === id)))) throw new ServiceUnavailableException('卡牌库存数据待核实');
    return CARD_CATALOG.filter(card => (inventory[card.id] ?? 0) > 0).map(card => ({
      id: publicId(card.id), name: card.name, rarity: card.rarity, quantity: inventory[card.id], type: card.type, effect: card.effect, detail: card.detail
    }));
  }

  private async inventorySnapshot(teamId: string) {
    const existing = await this.games.findOne({ teamId }).select('teamId').lean().exec();
    return existing ? this.storage.load(teamId, getWeekKey(new Date())) : null;
  }

  async getMemberInventory(teamId: string, userId: string) {
    const items = this.inventoryItems(await this.inventorySnapshot(teamId), userId);
    const total = items.reduce((sum, card) => sum + card.quantity, 0);
    if (!Number.isSafeInteger(total)) throw new ServiceUnavailableException('卡牌库存数量待核实');
    return { total, items };
  }

  async getTeamInventoryCounts(teamId: string) {
    const game = await this.inventorySnapshot(teamId);
    return Object.fromEntries(Object.keys(game?.state.members ?? {}).map(userId => {
      const total = this.inventoryItems(game, userId).reduce((sum, card) => sum + card.quantity, 0);
      if (!Number.isSafeInteger(total)) throw new ServiceUnavailableException('卡牌库存数量待核实');
      return [userId, total];
    }));
  }

  async action(user: AuthUser, input: CardGameActionInput): Promise<CardGameActionResponse> {
    if (!UUID.test(input.requestKey)) throw new BadRequestException('操作编号必须为 UUID v4');
    if (input.count !== undefined && (input.action !== 'draw' || ![1, 10].includes(input.count))) throw new BadRequestException('仅抽卡支持 1 次或 10 次抽取');
    const receiptKey = hash(`${user.userId}:${input.requestKey}`), requestHash = cardActionHash(input);
    const privateCardId = input.cardId ? privateId(input.cardId) : undefined;
    if (input.cardId && !privateCardId) throw new BadRequestException('卡片不存在');
    if (input.action === 'draw' && (input.cardId || input.targetId || input.secondTargetId)) throw new BadRequestException('抽卡不能指定卡片或目标');
    const seed = `${user.teamId}:${receiptKey}:${requestHash}`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const game = await this.storage.load(user.teamId, getWeekKey(new Date()));
      const ctx = await this.context(user.teamId, game, seededCardRandom(this.config.getOrThrow<string>('AUTH_SECRET'), seed));
      this.assertActor(user, ctx);
      const previous = await this.storage.receipt(game, receiptKey);
      if (previous) {
        if (previous.hash !== requestHash) throw new ConflictException('同一操作编号不能用于不同请求');
        const refreshed = await this.getMe(user);
        return { result: previous.result, state: refreshed };
      }
      const state = structuredClone(game.state);
      let result;
      try {
        result = applyGameAction(state, user.userId, { action: input.action, count: input.count, cardId: privateCardId, targetId: input.targetId, secondTargetId: input.secondTargetId }, ctx);
      } catch (error) { throw new BadRequestException((error as Error).message); }
      const person = (id: string) => {
        const member = ctx.players.find(player => player.id === id);
        if (!member) throw new BadRequestException('结算对象不在当前团队');
        return { id, username: member.username, displayName: member.name || member.username };
      };
      const historicalSourceIds = [...new Set((result.effects ?? []).flatMap(effect => effect.sourceId && !ctx.players.some(player => player.id === effect.sourceId) ? [effect.sourceId] : []))];
      const historicalSources = historicalSourceIds.length ? await this.users.find({ teamId: user.teamId, _id: { $in: historicalSourceIds } })
        .select('_id username displayName').lean().exec() : [];
      const sourcePerson = (id: string) => {
        if (ctx.players.some(player => player.id === id)) return person(id);
        const member = historicalSources.find(item => String(item._id) === id);
        return { id, username: member?.username ?? `历史成员 ID: ${id}`, displayName: member?.displayName || member?.username || '原连环施卡者' };
      };
      const effects = result.effects?.map(({ targetId, actualTargetId, sourceId, sourceCardId, ...effect }) => {
        const sourceCard = sourceCardId ? CARD_CATALOG.find(item => item.id === sourceCardId) : undefined;
        return { ...effect, target: person(targetId), ...(actualTargetId ? { actualTarget: sourcePerson(actualTargetId) } : {}),
          ...(sourceId && sourceCard ? { source: { user: sourcePerson(sourceId), card: { id: publicId(sourceCard.id), name: sourceCard.name, rarity: sourceCard.rarity } } } : {}) };
      });
      const card = privateCardId ? CARD_CATALOG.find(item => item.id === privateCardId)! : undefined;
      const actionCard = card ? { id: publicId(card.id), name: card.name, rarity: card.rarity } : undefined;
      const descriptions = effects?.map(effect => {
        const name = `${effect.target.displayName}（${effect.target.username}）`;
        if (effect.outcome === 'blocked') return `${name}：被防御或免疫抵消`;
        if (effect.outcome === 'no-effect') return `${name}：${effect.detail ?? '未产生时长变化'}`;
        const outcome = effect.kind === 'time' ? `${effect.deltaSeconds! < 0 ? '扣除' : '增加'} ${Math.abs(effect.deltaSeconds!) / 60} 分钟` : effect.detail;
        return `${name}：${effect.outcome === 'reflected' ? `反弹至 ${effect.actualTarget!.displayName}（${effect.actualTarget!.username}），` : ''}${outcome}`;
      });
      const resultView = {
        action: input.action,
        message: actionCard ? `${input.action === 'gift' ? '已赠送' : '已使用'}「${actionCard.name}」。${descriptions?.join('；') ?? ''}` : result.message,
        ...(actionCard ? { actionCard } : {}), ...(effects ? { effects } : {}),
        ...(result.gainedCardId ? { gainedCardId: publicId(result.gainedCardId) } : {}),
        ...(result.gainedCardIds ? { gainedCardIds: result.gainedCardIds.map(publicId) } : {}),
        ...(result.drawAnimation ? { drawAnimation: result.drawAnimation } : {}),
        ...(result.ssrPity !== undefined ? { ssrPity: result.ssrPity } : {}),
        ...(result.drawCount ? { drawCount: result.drawCount, radianceCount: result.radianceCount } : {})
      };
      const at = new Date(ctx.now).toISOString();
      const defenseByRecipient = new Map<string, NonNullable<CardActionReceipt['defenses']>[number]>();
      const noticeCard = (id: string) => {
        const entry = CARD_CATALOG.find(item => item.id === id)!;
        return { id: publicId(id), name: entry.name, rarity: entry.rarity };
      };
      for (const defense of result.defenses ?? []) {
        const delivery = defenseByRecipient.get(defense.userId) ?? { recipientId: defense.userId, notice: { at, events: [] } };
        delivery.notice.events.push({ attacker: sourcePerson(defense.attackerId), attackCard: noticeCard(defense.attackCardId),
          defenseCard: noticeCard(defense.defenseCardId), outcome: defense.outcome });
        defenseByRecipient.set(defense.userId, delivery);
      }
      const interactions: NonNullable<CardActionReceipt['interactions']> = [];
      if (input.action === 'use' && actionCard) {
        const recipients = new Set((effects ?? []).flatMap(effect => [effect.target.id, effect.actualTarget?.id])
          .filter((id): id is string => Boolean(id && id !== user.userId)));
        for (const recipientId of new Set([...recipients, ...defenseByRecipient.keys()])) {
          const ownEffects = effects?.filter(effect => effect.target.id === recipientId || effect.actualTarget?.id === recipientId) ?? [];
          // Selection belongs to the original target, never to a reflected recipient.
          const selection = ownEffects.some(effect => effect.target.id === recipientId && effect.randomTarget) ? { randomlySelected: true } : {};
          const defended = defenseByRecipient.get(recipientId);
          if (defended) Object.assign(defended.notice, selection, { effects: ownEffects });
          else {
            const source = ownEffects[0]?.source;
            const sameSource = source && ownEffects.every(effect => effect.source?.user.id === source.user.id && effect.source.card.id === source.card.id);
            interactions.push({ recipientId, notice: { at, sender: sameSource ? source.user : person(user.userId),
              card: sameSource ? source.card : actionCard, ...selection, effects: ownEffects } });
          }
        }
      }
      const receipt: CardActionReceipt = { actorId: user.userId, requestKey: input.requestKey, hash: requestHash, at, result: resultView,
        ...(input.action === 'gift' && actionCard ? { gift: { recipientId: input.targetId!, notice: { at, sender: person(user.userId), card: actionCard } } } : {}),
        ...(defenseByRecipient.size ? { defenses: [...defenseByRecipient.values()] } : {}),
        ...(interactions.length ? { interactions } : {}) };
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

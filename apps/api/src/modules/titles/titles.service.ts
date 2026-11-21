import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TIMEZONE } from '@lecpunch/shared';
import { DateTime } from 'luxon';
import { Model } from 'mongoose';
import { getWeekKey } from '../../common/utils/time.util';
import { AttendanceService } from '../attendance/attendance.service';
import { CardsService } from '../cards/cards.service';
import { CardActionArchive } from '../cards/schemas/card-archive.schema';
import { CardGame, type CardActionReceipt } from '../cards/schemas/card-game.schema';
import { UsersService } from '../users/users.service';
import { TITLE_BY_ID, type MemberTitleBadge } from './title-catalog';
import {
  evaluateTeamTitles,
  type MemberTitleEvaluation,
  type TitleEngineCardInteraction,
  type TitleEngineSession
} from './title-engine';

const NEGATIVE_CARD_NAMES = new Set([
  '减时长',
  '顺手牵羊',
  '乐不思蜀',
  '铁索连环',
  '雷电',
  '兵粮寸断',
  '南蛮入侵',
  '红桃 K',
  '万箭穿心'
]);

const TEAM_CACHE_TTL_MS = 30_000;

interface CachedTeamTitles {
  computedAt: number;
  weekKey: string;
  byUserId: Map<string, MemberTitleEvaluation>;
}

/** 将一条卡牌回执解析为跨人正/负面交互事件列表（用于「吕洞宾」称号判定）。 */
export function extractCardInteractionsFromReceipt(
  receipt: Pick<CardActionReceipt, 'actorId' | 'at' | 'result' | 'gift'>
): TitleEngineCardInteraction[] {
  const actorId = receipt.actorId;
  if (!actorId) return [];
  const atMs = Date.parse(receipt.at);
  if (Number.isNaN(atMs)) return [];

  const events: TitleEngineCardInteraction[] = [];
  if (receipt.gift?.recipientId && receipt.gift.recipientId !== actorId) {
    events.push({
      actorId,
      targetId: receipt.gift.recipientId,
      polarity: 'positive',
      atMs
    });
  }

  const result = receipt.result;
  if (!result || result.action !== 'use' || !Array.isArray(result.effects)) {
    return events;
  }

  const cardName = result.actionCard?.name ?? '';
  for (const effect of result.effects) {
    const targetId = effect.target?.id;
    if (!targetId || targetId === actorId) continue;

    if (effect.kind === 'time') {
      const delta = effect.deltaSeconds ?? 0;
      if (delta > 0) {
        events.push({ actorId, targetId, polarity: 'positive', atMs });
        continue;
      }
      if (delta < 0) {
        events.push({ actorId, targetId, polarity: 'negative', atMs });
        continue;
      }
    }

    if (cardName === '五谷丰登' && effect.outcome === 'applied') {
      events.push({ actorId, targetId, polarity: 'positive', atMs });
      continue;
    }

    if (NEGATIVE_CARD_NAMES.has(cardName)) {
      events.push({ actorId, targetId, polarity: 'negative', atMs });
    }
  }

  return events;
}

@Injectable()
export class TitlesService {
  private readonly teamCache = new Map<string, CachedTeamTitles>();

  constructor(
    private readonly usersService: UsersService,
    private readonly attendanceService: AttendanceService,
    @Optional() private readonly cardsService?: CardsService,
    @Optional() @InjectModel(CardActionArchive.name) private readonly cardArchiveModel?: Model<CardActionArchive>,
    @Optional() @InjectModel(CardGame.name) private readonly cardGameModel?: Model<CardGame>
  ) {}

  invalidateTeamCache(teamId: string): void {
    this.teamCache.delete(teamId);
  }

  async getMyTitles(teamId: string, userId: string) {
    const snapshot = await this.computeTeamSnapshot(teamId, true);
    const mine = snapshot.byUserId.get(userId);
    return {
      weekKey: snapshot.weekKey,
      equippedTitleId: mine?.equippedTitleId ?? null,
      displayTitles: mine?.displayTitles ?? [],
      catalog: mine?.catalog ?? []
    };
  }

  async equipTitle(teamId: string, userId: string, rawTitleId?: string | null) {
    const trimmed = typeof rawTitleId === 'string' ? rawTitleId.trim() : '';
    const titleId = trimmed.length > 0 ? trimmed : null;

    if (titleId !== null) {
      const def = TITLE_BY_ID.get(titleId);
      if (!def) {
        throw new BadRequestException('指定的称号不存在');
      }
      if (def.forced) {
        throw new BadRequestException('状态类称号由系统自动亮牌，无需手动佩戴');
      }
      const current = await this.computeTeamSnapshot(teamId, true);
      const mine = current.byUserId.get(userId);
      const item = mine?.catalog.find((entry) => entry.id === titleId);
      if (!item?.unlocked) {
        throw new BadRequestException(`尚未解锁「${def.name}」称号`);
      }
    }

    await this.usersService.setEquippedTitle(userId, titleId);
    this.invalidateTeamCache(teamId);
    return this.getMyTitles(teamId, userId);
  }

  async getTeamDisplayTitlesByUserId(teamId: string): Promise<Map<string, MemberTitleBadge[]>> {
    const snapshot = await this.computeTeamSnapshot(teamId, false);
    const result = new Map<string, MemberTitleBadge[]>();
    for (const [userId, evalResult] of snapshot.byUserId.entries()) {
      result.set(userId, evalResult.displayTitles);
    }
    return result;
  }

  async getTeamDisplayTitlesByMemberKey(teamId: string): Promise<Record<string, MemberTitleBadge[]>> {
    const snapshot = await this.computeTeamSnapshot(teamId, false);
    const result: Record<string, MemberTitleBadge[]> = {};
    for (const [userId, evalResult] of snapshot.byUserId.entries()) {
      result[this.usersService.getMemberKey(userId)] = evalResult.displayTitles;
    }
    return result;
  }

  private async computeTeamSnapshot(teamId: string, bypassCache: boolean): Promise<CachedTeamTitles> {
    const now = new Date();
    const weekKey = getWeekKey(now);
    const cached = this.teamCache.get(teamId);
    if (!bypassCache && cached && cached.weekKey === weekKey && Date.now() - cached.computedAt < TEAM_CACHE_TTL_MS) {
      return cached;
    }

    const members = await this.usersService.listTeamMembers(teamId);
    if (members.length === 0) {
      const empty: CachedTeamTitles = { computedAt: Date.now(), weekKey, byUserId: new Map() };
      this.teamCache.set(teamId, empty);
      return empty;
    }

    const nowDt = DateTime.fromJSDate(now, { zone: TIMEZONE });
    // 回溯至上个月 1 号前一天，同时覆盖全勤之王（上月+本月）与最近两周卡点王
    const lookbackStart = nowDt.startOf('month').minus({ months: 1, days: 1 }).toJSDate();
    const currentWeekStart = DateTime.fromISO(weekKey, { zone: TIMEZONE }).startOf('day');
    const prevWeek1Key = currentWeekStart.minus({ days: 7 }).toFormat('yyyy-LL-dd');
    const prevWeek2Key = currentWeekStart.minus({ days: 14 }).toFormat('yyyy-LL-dd');

    const memberIds = members.map((m) => m.id);
    const attendanceModel = this.attendanceService.getModel();

    const [rawSessions, adjustmentSummaries, curEnt, prev1Ent, prev2Ent, cardInteractions] = await Promise.all([
      attendanceModel
        .find({
          teamId,
          status: { $ne: 'invalidated' },
          checkInAt: { $gte: lookbackStart }
        })
        .select('userId checkInAt checkOutAt durationSeconds status weekKey')
        .lean()
        .exec(),
      this.attendanceService.getManualAdjustmentSummaries(teamId, memberIds),
      this.cardsService?.getTeamWeekEntertainment(teamId, weekKey) ?? Promise.resolve<Record<string, number>>({}),
      this.cardsService?.getTeamWeekEntertainment(teamId, prevWeek1Key) ?? Promise.resolve<Record<string, number>>({}),
      this.cardsService?.getTeamWeekEntertainment(teamId, prevWeek2Key) ?? Promise.resolve<Record<string, number>>({}),
      this.loadCurrentWeekCardInteractions(teamId, currentWeekStart.toISO()!)
    ]);

    const manualAdjustmentsByUserWeek = new Map<string, number>();
    for (const [k, v] of adjustmentSummaries.entries()) {
      manualAdjustmentsByUserWeek.set(k, v.manualAdjustmentSeconds);
    }

    const entertainmentByUserWeek = new Map<string, number>();
    for (const [uid, secs] of Object.entries(curEnt)) {
      entertainmentByUserWeek.set(`${uid}:${weekKey}`, secs);
    }
    for (const [uid, secs] of Object.entries(prev1Ent)) {
      entertainmentByUserWeek.set(`${uid}:${prevWeek1Key}`, secs);
    }
    for (const [uid, secs] of Object.entries(prev2Ent)) {
      entertainmentByUserWeek.set(`${uid}:${prevWeek2Key}`, secs);
    }

    const sessions: TitleEngineSession[] = rawSessions.map((s) => ({
      userId: String(s.userId),
      checkInAt: new Date(s.checkInAt),
      checkOutAt: s.checkOutAt ? new Date(s.checkOutAt) : undefined,
      durationSeconds: typeof s.durationSeconds === 'number' ? s.durationSeconds : undefined,
      status: s.status as TitleEngineSession['status'],
      weekKey: String(s.weekKey)
    }));

    const byUserId = evaluateTeamTitles({
      now,
      members: members.map((m) => ({
        id: m.id,
        enrollYear: m.enrollYear,
        createdAt: m.createdAt,
        equippedTitleId: m.equippedTitleId ?? null
      })),
      sessions,
      manualAdjustmentsByUserWeek,
      entertainmentByUserWeek,
      currentWeekCardInteractions: cardInteractions
    });

    const snapshot: CachedTeamTitles = {
      computedAt: Date.now(),
      weekKey,
      byUserId
    };
    this.teamCache.set(teamId, snapshot);
    return snapshot;
  }

  private async loadCurrentWeekCardInteractions(
    teamId: string,
    weekStartIso: string
  ): Promise<TitleEngineCardInteraction[]> {
    const weekStartMs = Date.parse(weekStartIso);
    const interactions: TitleEngineCardInteraction[] = [];
    const seenReceiptKeys = new Set<string>();

    if (this.cardArchiveModel) {
      const archived = await this.cardArchiveModel
        .find({ teamId, at: { $gte: weekStartIso } })
        .select('receiptKey actorId at result gift')
        .lean()
        .exec();
      for (const item of archived) {
        if (item.receiptKey) seenReceiptKeys.add(item.receiptKey);
        interactions.push(...extractCardInteractionsFromReceipt(item));
      }
    }

    if (this.cardGameModel) {
      const game = await this.cardGameModel.findOne({ teamId }).select('receipts').lean().exec();
      if (game?.receipts && typeof game.receipts === 'object') {
        for (const [key, receipt] of Object.entries(game.receipts)) {
          if (seenReceiptKeys.has(key) || !receipt?.at) continue;
          const atMs = Date.parse(receipt.at);
          if (Number.isNaN(atMs) || atMs < weekStartMs) continue;
          interactions.push(...extractCardInteractionsFromReceipt(receipt));
        }
      }
    }

    return interactions;
  }
}

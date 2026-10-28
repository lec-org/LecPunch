import { CARD_CATALOG, CardDefinition, CardRarity } from './card-catalog';
import { DateTime } from 'luxon';
import { CARD_DRAW_WEIGHTS, CARD_DRAW_WEIGHT_TOTAL, CARD_PITY_LIMITS, weeklyDrawPoints } from '@lecpunch/shared';

export interface PlayerWeek {
  entertainmentSeconds: number; /** Legacy audit only; never credited under comprehensive-v1. */ mintedSeconds: number; spentPoints: number;
  freeUsed: number; bonusDraws: number; accelerationAt?: number;
  immuneUntil?: number; lockedUntil?: number; starvedUntil?: number; boostedSessionIds?: string[];
}
export interface PlayerState {
  inventory: Record<string, number>; discovered: string[]; pitySR: number; pitySSR: number;
  weeks: Record<string, PlayerWeek>;
}
export interface GameLink { a: string; b: string; week: string; createdBy: string }
export interface GameState { version: 1; members: Record<string, PlayerState>; links: GameLink[] }
export type TeamGameState = GameState;
export interface GameContext {
  week: string; now: number;
  players: { id: string; username: string; name: string; enrollYear: number }[];
  baseSeconds: Record<string, number>;
  sessions?: { id: string; userId: string; checkOutAt: number; durationSeconds: number; weekKey: string }[];
  random: () => number;
}
export interface GameAction { action: 'draw' | 'use' | 'gift'; count?: 1 | 10; cardId?: string; targetId?: string; secondTargetId?: string }
export interface GameActionResult {
  message: string; gainedCardId?: string; gainedCardIds?: string[];
  drawAnimation?: 'blue' | 'purple' | 'gold' | 'radiance'; ssrPity?: boolean;
  drawCount?: 10; radianceCount?: number;
  affectedUserIds: string[];
}

const rarityValue: Record<CardRarity, number> = { N: 0, R: 1, SR: 2, SSR: 3 };
const getCard = (id: string) => {
  const card = CARD_CATALOG.find(item => item.id === id);
  if (!card) throw new Error('卡片不存在');
  return card;
};
export const createGameState = (): GameState => ({ version: 1, members: {}, links: [] });
export function getPlayerWeek(state: GameState, id: string, week: string): PlayerWeek {
  const member = state.members[id] ??= { inventory: {}, discovered: [], pitySR: 0, pitySSR: 0, weeks: {} };
  return member.weeks[week] ??= { entertainmentSeconds: 0, mintedSeconds: 0, spentPoints: 0, freeUsed: 0, bonusDraws: 0 };
}
function take(state: GameState, id: string, cardId: string) {
  const bag = state.members[id].inventory;
  if (!(bag[cardId] > 0)) throw new Error('没有这张卡片');
  bag[cardId]--;
}
function receive(state: GameState, id: string, cardId: string) {
  const member = state.members[id];
  member.inventory[cardId] = (member.inventory[cardId] ?? 0) + 1;
  if (!member.discovered.includes(cardId)) member.discovered.push(cardId);
}
function pick<T>(items: T[], context: GameContext): T {
  if (!items.length) throw new Error('没有可选目标');
  return items[Math.min(items.length - 1, Math.floor(context.random() * items.length))];
}
function drawCard(context: GameContext, minimum: CardRarity = 'N', excludeMystery = false) {
  const roll = Math.floor(context.random() * CARD_DRAW_WEIGHT_TOTAL);
  let rarity: CardRarity = 'SSR', cumulative = 0;
  for (const [level, weight] of Object.entries(CARD_DRAW_WEIGHTS)) {
    cumulative += weight;
    if (roll < cumulative) { rarity = level as CardRarity; break; }
  }
  if (rarityValue[rarity] < rarityValue[minimum]) rarity = minimum;
  return pick(CARD_CATALOG.filter(card => card.rarity === rarity && (!excludeMystery || card.id !== 'r-mystery')), context);
}

/** A zero/positive/no-op outcome never consumes a defensive card. */
function resolveTarget(state: GameState, context: GameContext, actor: string, target: string,
  card: CardDefinition, harmful: boolean, single: boolean, reflected = false): string | null {
  const week = getPlayerWeek(state, target, context.week);
  const inventory = state.members[target].inventory;
  const pierces = card.id === 'sr-redking';
  if (!pierces && actor !== target && (week.immuneUntil ?? 0) > context.now) return null;
  if (harmful && !pierces) {
    if (card.rarity === 'N' && inventory['n-shield'] > 0) { take(state, target, 'n-shield'); return null; }
    if (rarityValue[card.rarity] <= rarityValue.R && inventory['r-blade'] > 0) { take(state, target, 'r-blade'); return null; }
  }
  if (harmful && single && actor !== target && !reflected && inventory['sr-reflect'] > 0) {
    take(state, target, 'sr-reflect');
    // The return is a new direction, but must not recurse into another reflection.
    return resolveTarget(state, context, target, actor, card, true, true, true);
  }
  return target;
}

function change(state: GameState, context: GameContext, target: string, delta: number, source: string,
  card: CardDefinition, single: boolean, sync = true, positiveBalanceOnly = false,
  directTransferDebit = false): { target: string | null; delta: number } {
  delta = Math.trunc(delta);
  if (!delta) return { target, delta: 0 };
  const resolved = directTransferDebit ? target : resolveTarget(state, context, source, target, card, delta < 0, single);
  if (!resolved) return { target: null, delta: 0 };
  const week = getPlayerWeek(state, resolved, context.week);
  if (positiveBalanceOnly && delta < 0) delta = -Math.min(-delta, Math.max(0, week.entertainmentSeconds));
  if (!delta) return { target: resolved, delta: 0 };
  week.entertainmentSeconds += delta;
  if (sync) {
    const links = state.links.filter(link => link.week === context.week && (link.a === resolved || link.b === resolved));
    state.links = state.links.filter(link => !links.includes(link));
    for (const link of links) {
      const other = link.a === resolved ? link.b : link.a;
      if (!context.players.some(player => player.id === other)) continue;
      // One copied change cannot trigger more links. Its net time affects the same quota.
      change(state, context, other, delta, link.createdBy, getCard('sr-chain'), true, false);
    }
  }
  return { target: resolved, delta };
}

export function advanceGameState(state: GameState, context: GameContext): void {
  for (const player of context.players) getPlayerWeek(state, player.id, context.week);
  // A checkout may have completed before midnight while the client was offline.
  // Reconcile that earned bonus in its original week before expiring temporary states.
  for (const [userId, player] of Object.entries(state.members)) {
    for (const [weekKey, week] of Object.entries(player.weeks).sort(([a], [b]) => a.localeCompare(b))) {
    if (week.accelerationAt === undefined) continue;
    if (weekKey > context.week) continue;
    const historical = weekKey < context.week;
    const end = DateTime.fromISO(weekKey, { zone: 'Asia/Shanghai' }).plus({ days: 7 }).startOf('day').toMillis();
    const session = context.sessions?.filter(item => item.userId === userId && item.weekKey === weekKey &&
      item.durationSeconds > 0 && item.durationSeconds < 18000 && item.checkOutAt > week.accelerationAt! && item.checkOutAt <= context.now &&
      (!historical || item.checkOutAt < end) &&
      !(week.boostedSessionIds ?? []).includes(item.id))
      .sort((a, b) => a.checkOutAt - b.checkOutAt || a.id.localeCompare(b.id))[0];
    if (!session) {
      if (historical) delete week.accelerationAt;
      continue;
    }
    week.boostedSessionIds = [...(week.boostedSessionIds ?? []), session.id];
    delete week.accelerationAt;
    change(state, { ...context, week: weekKey, now: session.checkOutAt }, userId,
      Math.min(1800, Math.floor(session.durationSeconds * 0.15)), userId, getCard('n-acceleration'), true);
    }
  }
  state.links = state.links.filter(link => link.week === context.week);
}

/** Mutate only after the entire action succeeds, so rejected actions spend nothing. */
export function applyGameAction(state: GameState, actorId: string, action: GameAction, context: GameContext): GameActionResult {
  if (action.count !== undefined && (action.action !== 'draw' || ![1, 10].includes(action.count))) throw new Error('仅抽卡支持 1 次或 10 次抽取');
  const next = structuredClone(state);
  advanceGameState(next, context);
  const actor = context.players.find(player => player.id === actorId);
  if (!actor) throw new Error('当前成员没有卡牌访问资格');
  const week = getPlayerWeek(next, actorId, context.week);
  const member = next.members[actorId];
  const peers = context.players.filter(player => player.enrollYear === actor.enrollYear);
  const others = peers.filter(player => player.id !== actorId);
  const chooseTarget = (id: string | undefined, allowSelf = false) => {
    const target = peers.find(player => player.id === id && (allowSelf || player.id !== actorId));
    if (!target) throw new Error('请选择同年级的有效目标');
    return target.id;
  };
  let gainedCardId: string | undefined;
  let drawResult: Pick<GameActionResult, 'gainedCardIds' | 'drawAnimation' | 'ssrPity' | 'drawCount' | 'radianceCount'> | undefined;
  const touched = new Set<string>([actorId]);
  if (action.action === 'draw') {
    if ((week.starvedUntil ?? 0) > context.now) throw new Error('兵粮寸断期间不能获得新卡');
    const count = action.count ?? 1;
    const free = Math.min(count, Math.max(0, 2 - week.freeUsed));
    const gifts = Math.min(count - free, week.bonusDraws);
    const cost = (count - free - gifts) * 60;
    const { balance } = weeklyDrawPoints(context.baseSeconds[actorId] ?? 0, week.entertainmentSeconds, week.spentPoints);
    if (balance < cost && cost > 0) throw new Error(`抽卡积分不足，需要 ${cost} 积分`);
    const rewards: CardDefinition[] = [];
    const initialPity = { sr: member.pitySR, ssr: member.pitySSR };
    let animation: NonNullable<GameActionResult['drawAnimation']> = 'blue', hitPity = false, radianceCount = 0;
    const animationRank = { blue: 0, purple: 1, gold: 2, radiance: 3 };
    // All ten draws share this cloned state and one durable receipt. Any failure
    // rejects the whole batch; payment and pity still advance one draw at a time.
    for (let index = 0; index < count; index++) {
      if (week.freeUsed < 2) week.freeUsed++;
      else if (week.bonusDraws > 0) week.bonusDraws--;
      else {
        week.spentPoints += 60;
      }
      const ssrPity = member.pitySSR >= CARD_PITY_LIMITS.ssr - 1;
      const radiance = count === 10 && ssrPity && context.random() < 0.3;
      const ssrPool = CARD_CATALOG.filter(card => card.rarity === 'SSR');
      const cards = [ssrPity ? pick(ssrPool, context) : drawCard(context, member.pitySR >= CARD_PITY_LIMITS.sr - 1 ? 'SR' : 'N')];
      const card = cards[0];
      member.pitySSR = card.rarity === 'SSR' ? 0 : member.pitySSR + 1;
      member.pitySR = rarityValue[card.rarity] >= rarityValue.SR ? 0 : member.pitySR + 1;
      rewards.push(...cards); hitPity ||= ssrPity; if (radiance) radianceCount++;
      const selectedAnimation = radiance ? 'radiance' : card.rarity === 'SSR' ? 'gold' : card.rarity === 'SR' ? 'purple' : 'blue';
      if (animationRank[selectedAnimation] > animationRank[animation]) animation = selectedAnimation;
    }
    if (radianceCount) {
      // Upgrade an existing non-SSR slot; a batch always contains exactly ten
      // cards. Already-SSR rewards are never replaced, including the hard pity.
      const replacement = rewards.findIndex(card => card.rarity !== 'SSR');
      if (replacement >= 0) rewards[replacement] = pick(CARD_CATALOG.filter(card => card.rarity === 'SSR'), context);
      // The visible final order is also the pity order, including the upgrade.
      // This covers hard pity in the final slot without an eleventh reward.
      member.pitySR = initialPity.sr; member.pitySSR = initialPity.ssr;
      for (const card of rewards) {
        member.pitySSR = card.rarity === 'SSR' ? 0 : member.pitySSR + 1;
        member.pitySR = rarityValue[card.rarity] >= rarityValue.SR ? 0 : member.pitySR + 1;
      }
    }
    for (const reward of rewards) receive(next, actorId, reward.id);
    gainedCardId = rewards[0].id;
    drawResult = { gainedCardIds: rewards.map(reward => reward.id), ssrPity: hitPity, drawAnimation: animation,
      ...(count === 10 ? { drawCount: 10, radianceCount } : {}) };
  } else if (action.action === 'gift') {
    const card = getCard(action.cardId ?? '');
    const target = chooseTarget(action.targetId);
    if ((getPlayerWeek(next, target, context.week).starvedUntil ?? 0) > context.now) throw new Error('目标兵粮寸断期间不能接收新卡');
    take(next, actorId, card.id); receive(next, target, card.id); touched.add(target);
  } else if (action.action === 'use') {
    if ((week.lockedUntil ?? 0) > context.now) throw new Error('乐不思蜀期间不能主动使用卡牌');
    const card = getCard(action.cardId ?? '');
    if (['n-shield', 'r-blade', 'sr-reflect'].includes(card.id)) throw new Error('该卡自动防御，无需主动使用');
    if (card.id === 'n-acceleration' && week.accelerationAt !== undefined) throw new Error('已有待生效加速');
    if (card.id === 'ssr-invincible' && (week.immuneUntil ?? 0) > context.now) throw new Error('无懈可击仍在生效，不能叠加');
    if (card.id === 'r-mystery' && (week.starvedUntil ?? 0) > context.now) throw new Error('兵粮寸断期间不能获得新卡');
    take(next, actorId, card.id);
    const update = (target: string, delta: number, single = true, positiveOnly = false) => {
      touched.add(target); return change(next, context, target, delta, actorId, card, single, true, positiveOnly);
    };
    switch (card.id) {
      case 'n-acceleration': week.accelerationAt = context.now; break;
      case 'n-reduce': update(pick(others, context).id, -1800); break;
      case 'n-gamble': if (context.random() < 0.5) update(actorId, -1800); break;
      case 'r-add': update(chooseTarget(action.targetId ?? actorId, true), 1800); break;
      case 'r-steal': {
        const victim = pick(others, context).id;
        const stolen = update(victim, -1800);
        if (stolen.delta < 0) update(stolen.target === actorId ? victim : actorId, -stolen.delta);
        break;
      }
      case 'r-mystery': {
        const replacement = drawCard(context, 'N', true); receive(next, actorId, replacement.id);
        gainedCardId = replacement.id; break;
      }
      case 'r-charity': {
        const recipients = others.filter(player => (getPlayerWeek(next, player.id, context.week).immuneUntil ?? 0) <= context.now);
        if (!recipients.length || week.entertainmentSeconds <= 0) throw new Error('没有可接收成员或正娱乐余额');
        const share = Math.floor(Math.floor(week.entertainmentSeconds * 0.1) / recipients.length);
        if (!share) throw new Error('可分配时长不足一秒');
        // The transfer debit is part of the gift, not an attack on its author.
        change(next, context, actorId, -share * recipients.length, actorId, card, false, true, false, true);
        for (const recipient of recipients) update(recipient.id, share, false);
        break;
      }
      case 'r-skip': case 'sr-famine': {
        const target = chooseTarget(action.targetId);
        const resolved = resolveTarget(next, context, actorId, target, card, true, true);
        if (resolved) {
          const targetWeek = getPlayerWeek(next, resolved, context.week);
          if (card.id === 'r-skip') targetWeek.lockedUntil = context.now + 3600000;
          else targetWeek.starvedUntil = context.now + 3 * 3600000;
          touched.add(resolved);
        }
        break;
      }
      case 'r-thief': {
        const receiver = chooseTarget(action.targetId);
        const candidates = others.filter(player => player.id !== receiver);
        if (!candidates.length) throw new Error('没有可转移的供给方');
        const donor = pick(candidates, context).id;
        const amount = Math.min(1800, Math.max(0, getPlayerWeek(next, donor, context.week).entertainmentSeconds));
        if (!amount) throw new Error('供给方没有正娱乐余额');
        if ((getPlayerWeek(next, receiver, context.week).immuneUntil ?? 0) > context.now) break;
        const stolen = update(donor, -amount, true, true);
        if (stolen.delta < 0) update(receiver, -stolen.delta);
        break;
      }
      case 'sr-angel': for (const peer of peers) update(peer.id, 1800, false); break;
      case 'sr-chain': {
        const a = chooseTarget(action.targetId, true), b = chooseTarget(action.secondTargetId, true);
        if (a === b) throw new Error('连环需要两名不同成员');
        if (next.links.some(link => link.week === context.week && [link.a, link.b].some(id => id === a || id === b))) throw new Error('目标已有未触发连环');
        if (resolveTarget(next, context, actorId, a, card, false, true) && resolveTarget(next, context, actorId, b, card, false, true)) {
          next.links.push({a, b, week: context.week, createdBy: actorId}); touched.add(a); touched.add(b);
        }
        break;
      }
      case 'sr-lightning':
        for (const other of [...others].sort((a, b) => a.username < b.username ? -1 : a.username > b.username ? 1 : a.id.localeCompare(b.id))) {
          if (context.random() < 0.5) { update(other.id, -3600); break; }
        }
        break;
      case 'sr-invasion':
        for (const other of others) {
          const inventory = next.members[other.id].inventory;
          const nCards = CARD_CATALOG.filter(item => item.rarity === 'N').flatMap(item => Array.from({length: inventory[item.id] ?? 0}, () => item.id));
          const resolved = resolveTarget(next, context, actorId, other.id, card, true, false);
          if (!resolved) continue;
          if (nCards.length) take(next, other.id, pick(nCards, context)); else update(other.id, -900, false);
          touched.add(other.id);
        }
        break;
      case 'sr-redking': update(chooseTarget(action.targetId), -1800); break;
      case 'ssr-harvest':
        for (const peer of peers) if (resolveTarget(next, context, actorId, peer.id, card, false, false)) {
          getPlayerWeek(next, peer.id, context.week).bonusDraws += 2; touched.add(peer.id);
        }
        break;
      case 'ssr-invincible': week.immuneUntil = context.now + 24 * 3600000; break;
      case 'ssr-arrows': {
        const target = chooseTarget(action.targetId);
        let removed = 0;
        for (const peer of others) {
          const amount = Math.min(900, Math.floor(Math.max(0, getPlayerWeek(next, peer.id, context.week).entertainmentSeconds) * 0.1));
          removed -= update(peer.id, -amount, false).delta;
        }
        update(target, -Math.min(3600, Math.floor(removed / 2))); break;
      }
      default: throw new Error('卡片暂不支持主动使用');
    }
  } else throw new Error('不支持的卡牌操作');
  Object.assign(state, next);
  return { message: action.action === 'draw' ? action.count === 10 ? `十连抽成功，共获得 ${drawResult!.gainedCardIds!.length} 张卡片` : '抽卡成功' : action.action === 'gift' ? '卡片已赠送' : '卡片已结算',
    ...(gainedCardId ? {gainedCardId} : {}), ...drawResult, affectedUserIds: [...touched] };
}

import { describe, expect, it } from 'vitest';
import { CARD_CATALOG } from './card-catalog';
import { advanceGameState, applyGameAction, createGameState, getPlayerWeek, type GameContext } from './card-engine';
import { seededCardRandom } from './cards.service';

const a = 'a', b = 'b', c = 'c', senior = 'senior';
function fixture() {
  const context: GameContext = { assessmentYears: [2026, 2025], week: '2026-10-26', now: Date.parse('2026-10-28T00:00:00Z'), random: () => 0,
    baseSeconds: { a: 36000, b: 36000, c: 36000 }, players: [a, b, c, senior].map(id => ({ id, username: id, name: id, enrollYear: id === senior ? 2024 : 2025 })) };
  const state = createGameState(); advanceGameState(state, context);
  for (const id of [a, b, c]) getPlayerWeek(state, id, context.week).entertainmentSeconds = 6000;
  const own = (id: string, card: string) => { state.members[id].inventory[card] = (state.members[id].inventory[card] ?? 0) + 1; };
  const use = (card: string, targetId?: string, secondTargetId?: string, actor = a) => {
    own(actor, card); return applyGameAction(state, actor, { action: 'use', cardId: card, targetId, secondTargetId }, context);
  };
  const time = (id: string) => getPlayerWeek(state, id, context.week).entertainmentSeconds;
  return { state, context, own, use, time };
}

describe('full 21-card acquisition and gifting matrix', () => {
  it('keeps twenty-one unique catalog entries and every rarity reachable', () => {
    expect(CARD_CATALOG).toHaveLength(21); expect(new Set(CARD_CATALOG.map(card => card.id)).size).toBe(21);
    expect(['N', 'R', 'SR', 'SSR'].map(rarity => CARD_CATALOG.filter(card => card.rarity === rarity).length)).toEqual([4, 7, 7, 3]);
  });
  it.each(CARD_CATALOG)('$name is obtainable, giftable, and permanently discovered without duplicating inventory', card => {
    const { state, context } = fixture();
    const pool = CARD_CATALOG.filter(item => item.rarity === card.rarity);
    const rolls = [{ N: 0.1, R: 0.95, SR: 0.98, SSR: 0.999 }[card.rarity], (pool.findIndex(item => item.id === card.id) + 0.5) / pool.length];
    context.random = () => rolls.shift() ?? 0;
    expect(applyGameAction(state, a, { action: 'draw' }, context).gainedCardId).toBe(card.id);
    expect(state.members[a].inventory[card.id]).toBe(1);
    applyGameAction(state, a, { action: 'gift', cardId: card.id, targetId: b }, context);
    expect(state.members[a].inventory[card.id]).toBe(0); expect(state.members[b].inventory[card.id]).toBe(1);
    expect(state.members[a].discovered).toContain(card.id); expect(state.members[b].discovered).toContain(card.id);
    const before = structuredClone(state);
    expect(() => applyGameAction(state, a, { action: 'gift', cardId: card.id, targetId: b }, context)).toThrow('没有这张卡片');
    expect(state).toEqual(before);
  });
  it('completes 5000 deterministic normal draws, reaches all 21 cards, and obeys inventory and SSR guarantees', () => {
    const { state, context } = fixture(); getPlayerWeek(state, a, context.week).bonusDraws = 5000;
    const rewards: string[] = [];
    for (let batch = 0; batch < 500; batch++) {
      context.random = seededCardRandom('full-card-review-seed-20261028', String(batch));
      const result = applyGameAction(state, a, { action: 'draw', count: 10 }, context);
      expect(result.gainedCardIds).toHaveLength(10); rewards.push(...result.gainedCardIds!);
    }
    expect(new Set(rewards).size).toBe(21);
    expect(Object.values(state.members[a].inventory).reduce((sum, quantity) => sum + quantity, 0)).toBe(5000);
    expect(rewards.filter(id => CARD_CATALOG.find(card => card.id === id)!.rarity === 'SSR').length).toBeGreaterThanOrEqual(71);
    expect(getPlayerWeek(state, a, context.week).spentPoints).toBe(0);
  });
});

describe('full active-card effect matrix', () => {
  const checks: Record<string, (f: ReturnType<typeof fixture>) => void> = {
    'n-acceleration': f => {
      f.use('n-acceleration'); f.context.now += 1000;
      f.context.sessions = [{ id: 'valid', userId: a, weekKey: f.context.week, durationSeconds: 600, checkOutAt: f.context.now }];
      advanceGameState(f.state, f.context); advanceGameState(f.state, f.context);
      expect(f.time(a)).toBe(6090);
    },
    'n-reduce': f => { f.use('n-reduce'); expect(f.time(b)).toBe(4200); },
    'n-gamble': f => { f.use('n-gamble'); expect(f.time(a)).toBe(4200); },
    'r-add': f => { f.use('r-add', b); expect(f.time(b)).toBe(7800); },
    'r-steal': f => { f.use('r-steal', b); expect([f.time(a), f.time(b)]).toEqual([7800, 4200]); },
    'r-mystery': f => { const result = f.use('r-mystery'); expect(result.gainedCardId).toBe('n-acceleration'); expect(f.state.members[a].inventory['n-acceleration']).toBe(1); },
    'r-charity': f => { f.use('r-charity'); expect([f.time(a), f.time(b), f.time(c)]).toEqual([5400, 6300, 6300]); },
    'r-skip': f => {
      f.use('r-skip', b); expect(getPlayerWeek(f.state, b, f.context.week).lockedUntil).toBe(f.context.now + 3600000);
      expect(() => f.use('r-add', b, undefined, b)).toThrow('乐不思蜀');
    },
    'r-thief': f => { f.use('r-thief', b); expect([f.time(b), f.time(c)]).toEqual([7800, 4200]); },
    'sr-angel': f => { f.use('sr-angel'); expect([f.time(a), f.time(b), f.time(c), f.time(senior)]).toEqual([7800, 7800, 7800, 0]); },
    'sr-chain': f => { f.use('sr-chain', a, b); f.use('r-add', a); expect(f.time(b)).toBe(7800); expect(f.state.links).toEqual([]); },
    'sr-lightning': f => { f.use('sr-lightning'); expect([f.time(b), f.time(c)]).toEqual([2400, 6000]); },
    'sr-famine': f => {
      f.use('sr-famine', b); expect(getPlayerWeek(f.state, b, f.context.week).starvedUntil).toBe(f.context.now + 10800000);
      expect(() => applyGameAction(f.state, b, { action: 'draw' }, f.context)).toThrow('兵粮寸断');
    },
    'sr-invasion': f => { f.own(b, 'n-acceleration'); f.use('sr-invasion'); expect(f.state.members[b].inventory['n-acceleration']).toBe(0); expect([f.time(b), f.time(c)]).toEqual([6000, 5100]); },
    'sr-redking': f => { f.own(b, 'n-shield'); f.own(b, 'r-blade'); f.use('sr-redking', b); expect(f.time(b)).toBe(4200); expect(f.state.members[b].inventory['r-blade']).toBe(1); },
    'ssr-harvest': f => { f.use('ssr-harvest'); expect([a, b, c, senior].map(id => getPlayerWeek(f.state, id, f.context.week).bonusDraws)).toEqual([2, 2, 2, 0]); },
    'ssr-invincible': f => { f.use('ssr-invincible'); f.use('r-add', a, undefined, b); expect(f.time(a)).toBe(6000); expect(getPlayerWeek(f.state, a, f.context.week).immuneUntil).toBe(f.context.now + 86400000); },
    'ssr-arrows': f => { f.use('ssr-arrows', b); expect([f.time(b), f.time(c)]).toEqual([4800, 5400]); }
  };
  it('covers every active card exactly once', () => {
    expect(Object.keys(checks).sort()).toEqual(CARD_CATALOG.filter(card => !['n-shield', 'r-blade', 'sr-reflect'].includes(card.id)).map(card => card.id).sort());
  });
  it.each(Object.keys(checks))('%s consumes its card and produces the documented effect', id => {
    const f = fixture(); checks[id](f); expect(f.state.members[a].inventory[id]).toBe(0);
  });
  it.each(['n-shield', 'r-blade', 'sr-reflect'])('%s is passive and triggers against the documented threat', id => {
    const f = fixture(); f.own(a, id);
    expect(() => applyGameAction(f.state, a, { action: 'use', cardId: id }, f.context)).toThrow('自动防御');
    expect(f.state.members[a].inventory[id]).toBe(1);
    f.use(id === 'n-shield' ? 'n-reduce' : id === 'r-blade' ? 'r-steal' : 'sr-redking', id === 'n-shield' ? undefined : a, undefined, b);
    expect(f.state.members[a].inventory[id]).toBe(0); expect(f.time(a)).toBe(6000);
    if (id === 'sr-reflect') expect(f.time(b)).toBe(4200);
  });
});

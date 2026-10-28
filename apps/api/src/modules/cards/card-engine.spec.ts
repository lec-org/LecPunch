import { describe, expect, it } from 'vitest';
import { CARD_CATALOG } from './card-catalog';
import { CARD_DRAW_WEIGHTS, CARD_DRAW_WEIGHT_TOTAL, weeklyDrawPoints } from '@lecpunch/shared';
import { advanceGameState, applyGameAction, createGameState, GameContext, GameState, getPlayerWeek } from './card-engine';

const a = 'member-a', b = 'member-b', c = 'member-c', outsider = 'member-other-year';
function fixture() {
  const context: GameContext = {
    assessmentYears: [2026, 2025], week: '2026-10-26', now: Date.parse('2026-10-26T12:00:00Z'), random: () => 0,
    baseSeconds: {[a]: 36000, [b]: 36000, [c]: 36000},
    players: [{id:a,username:'aaa',name:'A',enrollYear:2025},{id:b,username:'bbb',name:'B',enrollYear:2025},
      {id:c,username:'ccc',name:'C',enrollYear:2025},{id:outsider,username:'other',name:'D',enrollYear:2024}]
  };
  const state = createGameState(); advanceGameState(state, context);
  return {state,context};
}
function own(state: GameState, user: string, card: string, count = 1) { state.members[user].inventory[card] = count; }
function use(state: GameState, context: GameContext, cardId: string, targetId?: string, secondTargetId?: string) {
  own(state,a,cardId,(state.members[a].inventory[cardId]??0)+1);
  return applyGameAction(state,a,{action:'use',cardId,targetId,secondTargetId},context);
}

describe('card collection and economy', () => {
  it('ignores legacy minted credits and derives payment from current net time', () => {
    const { state, context } = fixture(); context.baseSeconds[a] = 0;
    Object.assign(getPlayerWeek(state, a, context.week), { freeUsed: 2, mintedSeconds: 36000 });
    expect(() => applyGameAction(state, a, { action: 'draw' }, context)).toThrow('积分不足');
    use(state, context, 'r-add'); use(state, context, 'r-add');
    applyGameAction(state, a, { action: 'draw' }, context);
    expect(getPlayerWeek(state, a, context.week)).toMatchObject({ entertainmentSeconds: 3600, spentPoints: 60, mintedSeconds: 36000 });
    expect(weeklyDrawPoints(0, 3600, 60).balance).toBe(0);
  });
  it('transfers and linked changes affect recipients quota as well as assessment time', () => {
    const { state, context } = fixture();
    const quota = (id: string) => { const week = getPlayerWeek(state, id, context.week); return weeklyDrawPoints(context.baseSeconds[id] ?? 0, week.entertainmentSeconds, week.spentPoints).earned; };
    use(state, context, 'r-steal',b);
    expect(quota(a)).toBe(630); expect(quota(b)).toBe(570);
    use(state, context, 'sr-chain', a, c); use(state, context, 'r-add', a);
    expect(quota(a)).toBe(660); expect(quota(c)).toBe(630);
    use(state, context, 'sr-chain', b, c); use(state, context, 'sr-redking', b);
    expect(quota(b)).toBe(540); expect(quota(c)).toBe(600);
  });
  it('allocates the 10000 base-probability tickets as N 9000, R 770, SR 200, SSR 30', () => {
    expect(Object.values(CARD_DRAW_WEIGHTS).reduce((sum, n) => sum + n, 0)).toBe(CARD_DRAW_WEIGHT_TOTAL);
    const counts = { N: 0, R: 0, SR: 0, SSR: 0 };
    for (let ticket = 0; ticket < 10000; ticket++) {
      const { state, context } = fixture(); let calls = 0;
      context.random = () => calls++ === 0 ? (ticket + 0.5) / 10000 : 0;
      const result = applyGameAction(state, a, { action: 'draw' }, context);
      counts[CARD_CATALOG.find(card => card.id === result.gainedCardId)!.rarity]++;
    }
    expect(counts).toEqual({ N: 9000, R: 770, SR: 200, SSR: 30 });
  });
  it.each([
    { roll: 0, rarity: 'N' }, { roll: 0.89999999, rarity: 'N' },
    { roll: 0.9, rarity: 'R' }, { roll: 0.97699999, rarity: 'R' },
    { roll: 0.977, rarity: 'SR' }, { roll: 0.99699999, rarity: 'SR' },
    { roll: 0.997, rarity: 'SSR' }, { roll: 0.99999999, rarity: 'SSR' }
  ])('selects $rarity at the exact probability boundary $roll', ({ roll, rarity }) => {
    const { state, context } = fixture(); context.random = () => roll;
    const result = applyGameAction(state, a, { action: 'draw' }, context);
    expect(CARD_CATALOG.find(card => card.id === result.gainedCardId)!.rarity).toBe(rarity);
  });
  it.each([{ roll: 0.99699999, rarity: 'SR' }, { roll: 0.997, rarity: 'SSR' }])('keeps the natural SSR chance at SR pity: $roll -> $rarity', ({ roll, rarity }) => {
    const { state, context } = fixture(); state.members[a].pitySR = 29; context.random = () => roll;
    const result = applyGameAction(state, a, { action: 'draw' }, context);
    expect(CARD_CATALOG.find(card => card.id === result.gainedCardId)!.rarity).toBe(rarity);
    expect(state.members[a].pitySR).toBe(0);
  });
  it('does not trigger either pity one draw early and prioritizes SSR when both limits are reached', () => {
    const { state, context } = fixture(); state.members[a].pitySR = 28; state.members[a].pitySSR = 68;
    expect(applyGameAction(state, a, { action: 'draw' }, context).gainedCardId).toBe('n-acceleration');
    expect(state.members[a]).toMatchObject({ pitySR: 29, pitySSR: 69 });
    expect(applyGameAction(state, a, { action: 'draw' }, context).gainedCardId).toBe('ssr-harvest');
    expect(state.members[a]).toMatchObject({ pitySR: 0, pitySSR: 0 });
  });
  it('ten draws are equivalent to ten sequential single draws including both pity counters', () => {
    const batch = fixture(), single = fixture();
    batch.state.members[a].pitySSR = single.state.members[a].pitySSR = 20;
    batch.state.members[a].pitySR = single.state.members[a].pitySR = 27;
    const result = applyGameAction(batch.state, a, { action: 'draw', count: 10 }, batch.context);
    const singles = Array.from({ length: 10 }, () => applyGameAction(single.state, a, { action: 'draw' }, single.context));
    expect(batch.state).toEqual(single.state);
    expect(result.gainedCardIds).toEqual(singles.flatMap(item => item.gainedCardIds!));
    expect(result).toMatchObject({ drawCount: 10, radianceCount: 0, drawAnimation: 'purple', ssrPity: false });
    expect(result.gainedCardIds).toHaveLength(10);
    expect(getPlayerWeek(batch.state, a, batch.context.week).spentPoints).toBe(480);
  });

  it.each([{ gifts: 3, cost: 300 }, { gifts: 8, cost: 0 }, { gifts: 15, cost: 0 }])('ten draws use two free draws, then gifts, then exactly $cost points', ({ gifts, cost }) => {
    const { state, context } = fixture();
    getPlayerWeek(state, a, context.week).bonusDraws = gifts;
    context.baseSeconds[a] = cost * 60;
    const result = applyGameAction(state, a, { action: 'draw', count: 10 }, context);
    expect(getPlayerWeek(state, a, context.week)).toMatchObject({ freeUsed: 2, bonusDraws: Math.max(0, gifts - 8), spentPoints: cost });
    expect(result.gainedCardIds).toHaveLength(10);
    expect(result.drawAnimation).toBe('blue');
    expect(state.members[a].pitySR).toBe(10); expect(state.members[a].pitySSR).toBe(10);
  });

  it('an unaffordable ten-draw request leaves free draws, gifts, points, pity and discovery unchanged', () => {
    const { state, context } = fixture(); getPlayerWeek(state, a, context.week).bonusDraws = 3;
    context.baseSeconds[a] = 299 * 60; const before = structuredClone(state);
    expect(() => applyGameAction(state, a, { action: 'draw', count: 10 }, context)).toThrow('需要 300 积分');
    expect(state).toEqual(before);
  });

  it('a failure midway through the batch commits no partial rewards or payment', () => {
    const { state, context } = fixture(); const before = structuredClone(state); let calls = 0;
    context.random = () => { if (++calls === 9) throw new Error('random source unavailable'); return 0; };
    expect(() => applyGameAction(state, a, { action: 'draw', count: 10 }, context)).toThrow('random source unavailable');
    expect(state).toEqual(before);
  });

  it.each([0, 2, 9, 11, -1, 1.5, '10', null])('rejects an invalid draw count %s without mutation', count => {
    const { state, context } = fixture(); const before = structuredClone(state);
    expect(() => applyGameAction(state, a, { action: 'draw', count } as any, context)).toThrow('仅抽卡支持');
    expect(state).toEqual(before);
  });

  it('starvation blocks a batch and count cannot be used with card actions', () => {
    const { state, context } = fixture(); getPlayerWeek(state, a, context.week).starvedUntil = context.now + 1000;
    const before = structuredClone(state);
    expect(() => applyGameAction(state, a, { action: 'draw', count: 10 }, context)).toThrow('兵粮寸断');
    expect(() => applyGameAction(state, a, { action: 'use', cardId: 'r-add', count: 10 }, context)).toThrow('仅抽卡支持');
    expect(state).toEqual(before);
  });

  it('reconciles an earned pre-midnight acceleration in the old week exactly once', () => {
    const {state,context}=fixture();
    context.now=Date.parse('2026-11-01T15:40:00Z');
    use(state,context,'n-acceleration');
    context.week='2026-11-02'; context.now=Date.parse('2026-11-01T16:01:00Z');
    context.sessions=[{id:'old-week-checkout',userId:a,weekKey:'2026-10-26',
      checkOutAt:Date.parse('2026-11-01T15:50:00Z'),durationSeconds:600}];
    advanceGameState(state,context);
    expect(getPlayerWeek(state,a,'2026-10-26')).toMatchObject({entertainmentSeconds:90,mintedSeconds:0});
    expect(getPlayerWeek(state,a,context.week)).toMatchObject({entertainmentSeconds:0,mintedSeconds:0});
    advanceGameState(state,context);
    expect(getPlayerWeek(state,a,'2026-10-26').entertainmentSeconds).toBe(90);
  });

  it('does not carry an untriggered acceleration into a checkout at or after the next week', () => {
    const {state,context}=fixture();
    context.now=Date.parse('2026-11-01T15:40:00Z');
    use(state,context,'n-acceleration');
    context.week='2026-11-02';context.now=Date.parse('2026-11-01T16:10:00Z');
    context.sessions=[{id:'boundary-checkout',userId:a,weekKey:'2026-10-26',
      checkOutAt:Date.parse('2026-11-01T16:00:00Z'),durationSeconds:1200}];
    advanceGameState(state,context);
    expect(getPlayerWeek(state,a,'2026-10-26')).toMatchObject({entertainmentSeconds:0,mintedSeconds:0});
    expect(getPlayerWeek(state,a,'2026-10-26').accelerationAt).toBeUndefined();
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(0);
  });

  it('contains exactly 21 types with the agreed rarity counts', () => {
    expect(CARD_CATALOG).toHaveLength(21);
    expect(['N','R','SR','SSR'].map(r=>CARD_CATALOG.filter(card=>card.rarity===r).length)).toEqual([4,7,7,3]);
  });
  it('first two draws are free, then gifts, then exactly 60 points', () => {
    const {state,context}=fixture();const week=getPlayerWeek(state,a,context.week);week.bonusDraws=1;
    for(let i=0;i<4;i++)applyGameAction(state,a,{action:'draw'},context);
    const saved=getPlayerWeek(state,a,context.week);
    expect(saved.freeUsed).toBe(2);expect(saved.bonusDraws).toBe(0);expect(saved.spentPoints).toBe(60);
    expect(state.members[a].inventory['n-acceleration']).toBe(4);expect(state.members[a].discovered).toEqual(['n-acceleration']);
  });
  it('insufficient points and starvation reject without spending or revealing a card', () => {
    const {state,context}=fixture();const week=getPlayerWeek(state,a,context.week);week.freeUsed=2;context.baseSeconds[a]=0;
    const before=structuredClone(state);expect(()=>applyGameAction(state,a,{action:'draw'},context)).toThrow('积分不足');expect(state).toEqual(before);
    week.starvedUntil=context.now+1000;week.freeUsed=0;
    expect(()=>applyGameAction(state,a,{action:'draw'},context)).toThrow('兵粮寸断');expect(week.freeUsed).toBe(0);
  });
  it('30th SR pity, 70th SSR pity and natural SSR reset counters across weeks', () => {
    const {state,context}=fixture();state.members[a].pitySR=29;
    expect(applyGameAction(state,a,{action:'draw'},context).gainedCardId).toBe('sr-angel');
    expect(state.members[a].pitySR).toBe(0);
    state.members[a].pitySSR=69;state.members[a].pitySR=29;
    expect(applyGameAction(state,a,{action:'draw'},context).gainedCardId).toBe('ssr-harvest');
    expect(state.members[a].pitySSR).toBe(0);expect(state.members[a].pitySR).toBe(0);
    state.members[a].pitySSR=20;context.random=()=>0.999;
    applyGameAction(state,a,{action:'draw'},context);expect(state.members[a].pitySSR).toBe(0);
  });
  it.each([0, 0.1, 0.299999999, 0.3, 0.999])('single hard pity never triggers radiance (roll %s)', roll => {
    const { state, context } = fixture(); state.members[a].pitySSR = 69;
    let calls = 0; context.random = () => { calls++; return roll; };
    const result = applyGameAction(state, a, { action: 'draw' }, context);
    expect(result).toMatchObject({ drawAnimation: 'gold', ssrPity: true });
    expect(result.gainedCardIds).toHaveLength(1); expect(calls).toBe(1);
    expect(state.members[a].pitySSR).toBe(0); expect(state.members[a].pitySR).toBe(0);
  });
  it.each([{ roll: 0.299999999, animation: 'radiance', ssrs: 2 }, { roll: 0.3, animation: 'gold', ssrs: 1 }])('ten-draw hard pity has a strict 30% radiance threshold ($roll)', ({ roll, animation, ssrs }) => {
    const { state, context } = fixture(); state.members[a].pitySSR = 69;
    let calls = 0; context.random = () => calls++ === 0 ? roll : 0;
    const result = applyGameAction(state, a, { action: 'draw', count: 10 }, context);
    expect(result.drawAnimation).toBe(animation); expect(result.gainedCardIds).toHaveLength(10);
    expect(result.gainedCardIds!.filter(id => CARD_CATALOG.find(card => card.id === id)!.rarity === 'SSR')).toHaveLength(ssrs);
    expect(Object.values(state.members[a].inventory).reduce((sum, n) => sum + n, 0)).toBe(10);
    expect(getPlayerWeek(state, a, context.week).spentPoints).toBe(480);
    expect(state.members[a].pitySSR).toBe(ssrs === 2 ? 8 : 9);
  });
  it('radiance with hard pity in the tenth slot replaces a non-SSR and preserves all ten final rewards', () => {
    const { state, context } = fixture(); state.members[a].pitySSR = 60;
    const result = applyGameAction(state, a, { action: 'draw', count: 10 }, context);
    expect(result.drawAnimation).toBe('radiance'); expect(result.gainedCardIds).toHaveLength(10);
    expect(result.gainedCardIds![9]).toBe('ssr-harvest'); expect(result.gainedCardIds![0]).toBe('ssr-harvest');
    expect(state.members[a].pitySR).toBe(0); expect(state.members[a].pitySSR).toBe(0);
    expect(state.members[a].discovered).toEqual(['ssr-harvest', 'n-acceleration']);
  });
  it('keeps all naturally obtained SSR cards when a radiance batch has no non-SSR to upgrade', () => {
    const { state, context } = fixture(); state.members[a].pitySSR = 69; let calls = 0;
    context.random = () => calls++ < 2 ? 0 : 0.999;
    const result = applyGameAction(state, a, { action: 'draw', count: 10 }, context);
    expect(result.drawAnimation).toBe('radiance');
    expect(result.gainedCardIds).toEqual(['ssr-harvest', ...Array(9).fill('ssr-arrows')]);
    expect(calls).toBe(20); expect(state.members[a].pitySR).toBe(0); expect(state.members[a].pitySSR).toBe(0);
  });
  it('pity 68 does not enter radiance and an early natural SSR stays a single gold', () => {
    const {state,context}=fixture();state.members[a].pitySSR=68;
    context.random=()=>0.999;
    const result=applyGameAction(state,a,{action:'draw'},context);
    expect(result.drawAnimation).toBe('gold');expect(result.ssrPity).toBe(false);expect(result.gainedCardIds).toHaveLength(1);
    expect(state.members[a].pitySSR).toBe(0);
    state.members[a].pitySSR=68;context.random=()=>0;
    const lower=applyGameAction(state,a,{action:'draw'},context);
    expect(lower.drawAnimation).toBe('blue');expect(lower.ssrPity).toBe(false);expect(lower.gainedCardIds).toHaveLength(1);expect(state.members[a].pitySSR).toBe(69);
  });
  it.each([{roll:0.1,animation:'blue'},{roll:0.95,animation:'blue'},{roll:0.98,animation:'purple'},{roll:0.999,animation:'gold'}])('ordinary draw color follows rarity ($roll)', ({roll,animation}) => {
    const {state,context}=fixture();context.random=()=>roll;
    const result=applyGameAction(state,a,{action:'draw'},context);
    expect(result.drawAnimation).toBe(animation);expect(result.ssrPity).toBe(false);expect(result.gainedCardIds).toEqual([result.gainedCardId]);
  });
  it('gift reveals only to the recipient, preserves donor discovery and spends no points', () => {
    const {state,context}=fixture();own(state,a,'r-add');state.members[a].discovered=['r-add'];
    applyGameAction(state,a,{action:'gift',cardId:'r-add',targetId:b},context);
    expect(state.members[b].inventory['r-add']).toBe(1);expect(state.members[b].discovered).toEqual(['r-add']);
    expect(state.members[a].discovered).toEqual(['r-add']);expect(state.members[c].discovered).toEqual([]);
    expect(getPlayerWeek(state,b,context.week).mintedSeconds).toBe(0);
  });
  it('cross-year gift and frozen recipient fail without losing inventory', () => {
    const {state,context}=fixture();own(state,a,'r-add');
    expect(()=>applyGameAction(state,a,{action:'gift',cardId:'r-add',targetId:outsider},context)).toThrow('同年级');
    getPlayerWeek(state,b,context.week).starvedUntil=context.now+100;
    expect(()=>applyGameAction(state,a,{action:'gift',cardId:'r-add',targetId:b},context)).toThrow('兵粮寸断');
    expect(state.members[a].inventory['r-add']).toBe(1);
  });
  it('week changes reset spend/free/expired-status/balance while cards, discovery and pity persist', () => {
    const {state,context}=fixture();own(state,a,'r-add');state.members[a].discovered=['r-add'];state.members[a].pitySR=8;
    Object.assign(getPlayerWeek(state,a,context.week),{freeUsed:2,spentPoints:60,entertainmentSeconds:-3600,immuneUntil:context.now+99999999,bonusDraws:3});
    state.links.push({a,b,week:context.week,createdBy:a});context.week='2026-11-02';context.now+=7*86400000;advanceGameState(state,context);
    expect(getPlayerWeek(state,a,context.week)).toEqual({entertainmentSeconds:0,mintedSeconds:0,spentPoints:0,freeUsed:0,bonusDraws:0});
    expect(state.members[a].inventory['r-add']).toBe(1);expect(state.members[a].discovered).toEqual(['r-add']);expect(state.members[a].pitySR).toBe(8);expect(state.links).toEqual([]);
    expect(getPlayerWeek(state,a,'2026-10-26').entertainmentSeconds).toBe(-3600);
  });
  it('mystery neither draws itself nor changes ordinary pity', () => {
    const {state,context}=fixture();state.members[a].pitySSR=69;state.members[a].pitySR=29;context.random=()=>0.7;
    const result=use(state,context,'r-mystery');expect(result.gainedCardId).not.toBe('r-mystery');
    expect(state.members[a].pitySR).toBe(29);expect(state.members[a].pitySSR).toBe(69);expect(getPlayerWeek(state,a,context.week).freeUsed).toBe(0);
    expect(result.gainedCardIds).toBeUndefined();expect(result.drawAnimation).toBeUndefined();expect(result.ssrPity).toBeUndefined();
  });
  it('mystery produces one SSR without radiance at hard pity', () => {
    const {state,context}=fixture();state.members[a].pitySSR=69;context.random=()=>0.999;
    const result=use(state,context,'r-mystery');
    expect(result.gainedCardId).toBe('ssr-arrows');expect(state.members[a].inventory['ssr-arrows']).toBe(1);
    expect(result.drawAnimation).toBeUndefined();expect(result.gainedCardIds).toBeUndefined();expect(state.members[a].pitySSR).toBe(69);
  });
});

describe('card application and defenses', () => {
  it.each(['r-skip', 'r-thief', 'sr-famine', 'sr-redking'])('%s targets current assessment members across grades and rejects older grades atomically', card => {
    const {state,context}=fixture(); context.players.find(player=>player.id===b)!.enrollYear=2026;
    getPlayerWeek(state,c,context.week).entertainmentSeconds=6000;
    use(state,context,card,b);
    own(state,a,card); const before=structuredClone(state);
    expect(()=>applyGameAction(state,a,{action:'use',cardId:card,targetId:outsider},context)).toThrow('当前应考');
    expect(state).toEqual(before);
  });
  it('charity shares with both assessment cohorts while angel and lightning keep same-grade scope', () => {
    const {state,context}=fixture();context.players.find(player=>player.id===b)!.enrollYear=2026;
    getPlayerWeek(state,a,context.week).entertainmentSeconds=6000;
    use(state,context,'r-charity');
    expect([b,c,outsider].map(id=>getPlayerWeek(state,id,context.week).entertainmentSeconds)).toEqual([300,300,0]);
    use(state,context,'sr-angel');
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(300);
    use(state,context,'sr-lightning');
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(300);
    expect(getPlayerWeek(state,c,context.week).entertainmentSeconds).toBe(-1500);
  });
  it('steal requires the chosen same-grade target instead of selecting a random player', () => {
    const {state,context}=fixture();
    own(state,a,'r-steal');const before=structuredClone(state);
    expect(()=>applyGameAction(state,a,{action:'use',cardId:'r-steal'},context)).toThrow('同年级');
    expect(()=>applyGameAction(state,a,{action:'use',cardId:'r-steal',targetId:outsider},context)).toThrow('同年级');
    expect(state).toEqual(before);
    use(state,context,'r-steal',c);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(0);
    expect(getPlayerWeek(state,c,context.week).entertainmentSeconds).toBe(-1800);
  });
  it('self-judgement consumes the weakest applicable defense once and never reflects into itself', () => {
    const {state,context}=fixture();own(state,a,'n-shield');own(state,a,'r-blade');own(state,a,'sr-reflect');
    use(state,context,'ssr-invincible');
    expect(use(state,context,'n-gamble').defenses?.[0].defenseCardId).toBe('n-shield');
    expect(state.members[a].inventory['r-blade']).toBe(1);
    expect(use(state,context,'n-gamble').defenses?.[0].defenseCardId).toBe('r-blade');
    expect(state.members[a].inventory['sr-reflect']).toBe(1);
    use(state,context,'n-gamble');
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(-1800);
    expect(state.members[a].inventory['sr-reflect']).toBe(1);
  });
  it('reports the selected random target, blocked outcome and actual reflected target', () => {
    const { state, context } = fixture();
    expect(use(state, context, 'n-reduce').effects?.[0]).toMatchObject({ targetId: b, actualTargetId: b, randomTarget: true, outcome: 'applied', deltaSeconds: -1800 });
    own(state, b, 'n-shield');
    expect(use(state, context, 'n-reduce').effects?.[0]).toMatchObject({ targetId: b, randomTarget: true, outcome: 'blocked', deltaSeconds: 0 });
    own(state, b, 'sr-reflect');
    expect(use(state, context, 'r-steal', b).effects?.[0]).toMatchObject({ targetId: b, actualTargetId: a, outcome: 'reflected', deltaSeconds: -1800 });
  });
  it('reports lightning username-order misses and the first successful judgement', () => {
    const { state, context } = fixture(); const rolls = [0.9, 0]; context.random = () => rolls.shift() ?? 0;
    expect(use(state, context, 'sr-lightning').effects).toEqual([
      { targetId: b, randomTarget: true, kind: 'judgement', outcome: 'no-effect', detail: '雷电判定未命中（逐人独立 50% 判定），未扣除时长' },
      { targetId: c, randomTarget: true, kind: 'judgement', outcome: 'applied', detail: '雷电判定命中（逐人独立 50% 判定）' },
      { targetId: c, actualTargetId: c, randomTarget: true, kind: 'time', outcome: 'applied', deltaSeconds: -3600 }
    ]);
  });
  it('does not label chosen targets or linked recipients as system-random targets', () => {
    const { state, context } = fixture();
    use(state, context, 'sr-chain', b, c);
    const effects = use(state, context, 'n-reduce').effects!;
    expect(effects.find(effect => effect.targetId === b)?.randomTarget).toBe(true);
    expect(effects.find(effect => effect.targetId === c)?.randomTarget).toBeUndefined();
    expect(effects.find(effect => effect.targetId === c)).toMatchObject({ sourceId: a, sourceCardId: 'sr-chain' });
    expect(use(state, context, 'r-steal', b).effects!.some(effect => effect.randomTarget)).toBe(false);
    expect(use(state, context, 'sr-famine', b).effects![0].randomTarget).toBeUndefined();
  });
  it('does not attribute an older checkout acceleration to the card currently used', () => {
    const { state, context } = fixture();
    getPlayerWeek(state, c, context.week).accelerationAt = context.now - 1000;
    context.sessions = [{ id: 'checkout-c', userId: c, weekKey: context.week, durationSeconds: 600, checkOutAt: context.now }];
    const result = use(state, context, 'n-reduce');
    expect(getPlayerWeek(state, c, context.week).entertainmentSeconds).toBe(90);
    expect(result.effects?.map(effect => effect.targetId)).toEqual([b]);
  });
  it('reduction and steal may make net time negative without a separate minted balance', () => {
    const {state,context}=fixture();use(state,context,'n-reduce');use(state,context,'r-steal',b);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-3600);
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(1800);
    expect(getPlayerWeek(state,a,context.week).mintedSeconds).toBe(0);
  });
  it('positive additions change net time without a second minted credit', () => {
    const {state,context}=fixture();use(state,context,'r-add',b);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(1800);expect(getPlayerWeek(state,b,context.week).mintedSeconds).toBe(0);
    expect(state.members[b].discovered).toEqual([]);
  });
  it('N shield protects N, blade protects N/R, and weaker available defense is spent first', () => {
    const {state,context}=fixture();own(state,b,'n-shield');own(state,b,'r-blade');
    use(state,context,'n-reduce');expect(state.members[b].inventory['n-shield']).toBe(0);expect(state.members[b].inventory['r-blade']).toBe(1);
    use(state,context,'r-steal',b);expect(state.members[b].inventory['r-blade']).toBe(0);expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(0);
    own(state,b,'n-shield');use(state,context,'r-steal',b);expect(state.members[b].inventory['n-shield']).toBe(1);expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-1800);
  });
  it('a harmless gamble does not spend defenses; harmful self gamble does', () => {
    const {state,context}=fixture();own(state,a,'n-shield');context.random=()=>0.9;
    use(state,context,'n-gamble');expect(state.members[a].inventory['n-shield']).toBe(1);
    context.random=()=>0;use(state,context,'n-gamble');expect(state.members[a].inventory['n-shield']).toBe(0);expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(0);
  });
  it('red king bypasses lower-rarity defenses but can be reflected once', () => {
    const {state,context}=fixture();own(state,b,'n-shield');own(state,b,'r-blade');
    use(state,context,'sr-redking',b);expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-1800);
    own(state,b,'sr-reflect');own(state,a,'sr-reflect');use(state,context,'sr-redking',b);
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(-1800);expect(state.members[a].inventory['sr-reflect']).toBe(1);
    expect(state.members[b].inventory['n-shield']).toBe(1);expect(state.members[b].inventory['r-blade']).toBe(1);
  });
  it.each(['n-reduce', 'r-steal', 'r-skip', 'r-thief', 'sr-lightning', 'sr-famine', 'sr-invasion', 'sr-redking', 'ssr-arrows'])('the SSR ward blocks incoming %s without consuming passive defenses', cardId => {
    const {state,context}=fixture();
    const targetWeek=getPlayerWeek(state,b,context.week);
    targetWeek.immuneUntil=context.now+9999;targetWeek.entertainmentSeconds=6000;
    own(state,b,'n-acceleration');own(state,b,'n-shield');own(state,b,'r-blade');own(state,b,'sr-reflect');
    const before=structuredClone(state.members[b]);
    const result=use(state,context,cardId,cardId==='r-thief'?c:b);
    expect(state.members[b].inventory).toEqual(before.inventory);
    expect(state.members[b].weeks).toEqual(before.weeks);
    expect(result.effects?.some(effect=>effect.targetId===b&&effect.outcome==='blocked')).toBe(true);
    expect(state.members[a].inventory[cardId]).toBe(0);
  });
  it('an active ward also blocks reflected red king damage', () => {
    const {state,context}=fixture();own(state,b,'sr-reflect');own(state,a,'sr-reflect');
    getPlayerWeek(state,a,context.week).immuneUntil=context.now+9999;
    use(state,context,'sr-redking',b);
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(0);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(0);
    expect(state.members[b].inventory['sr-reflect']).toBe(0);
    expect(state.members[a].inventory['sr-reflect']).toBe(1);
  });
  it('red king applies again exactly when the ward expires', () => {
    const {state,context}=fixture();getPlayerWeek(state,b,context.week).immuneUntil=context.now;
    use(state,context,'sr-redking',b);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-1800);
  });
  it('keeps an activated ward for the complete 24 hours across Monday', () => {
    const {state,context}=fixture(); context.week='2026-10-26';context.now=Date.parse('2026-11-01T15:30:00Z');
    own(state,b,'ssr-invincible');
    applyGameAction(state,b,{action:'use',cardId:'ssr-invincible'},context);
    const until=context.now+86400000;
    context.week='2026-11-02';context.now=Date.parse('2026-11-01T16:01:00Z');
    use(state,context,'sr-redking',b);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(0);
    expect(getPlayerWeek(state,b,context.week).immuneUntil).toBe(until);
    expect(state.members[b].wardUntil).toBe(until);
    context.now=until;
    use(state,context,'sr-redking',b);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-1800);
    expect(state.members[b].wardUntil).toBeUndefined();
  });
  it('keeps a live legacy ward when an inactive member returns after their old week was archived', () => {
    const {state,context}=fixture();
    const until=Date.parse('2026-11-02T15:30:00Z');
    getPlayerWeek(state,b,context.week).immuneUntil=until;
    context.week='2026-11-02';context.now=Date.parse('2026-11-01T21:30:00Z');
    context.players=context.players.filter(player=>player.id!==b);
    advanceGameState(state,context);
    delete state.members[b].weeks['2026-10-26'];
    context.players.push({id:b,username:'bbb',name:'B',enrollYear:2025});
    use(state,context,'sr-redking',b);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(0);
    expect(getPlayerWeek(state,b,context.week).immuneUntil).toBe(until);
  });
  it('immunity rejects other benefits/attacks but not self-cast effects', () => {
    const {state,context}=fixture();getPlayerWeek(state,b,context.week).immuneUntil=context.now+9999;
    use(state,context,'r-add',b);use(state,context,'n-reduce');expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(0);
    use(state,context,'ssr-invincible');use(state,context,'r-add',a);expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(1800);
  });
  it('lightning tests username order and stops at first true even when immune', () => {
    const {state,context}=fixture();context.players.reverse();let rolls=0;context.random=()=>{rolls++;return 0;};
    getPlayerWeek(state,b,context.week).immuneUntil=context.now+9999;use(state,context,'sr-lightning');
    expect(rolls).toBe(1);expect(getPlayerWeek(state,c,context.week).entertainmentSeconds).toBe(0);
  });
  it('link copies one change once without minting points or chaining recursively', () => {
    const {state,context}=fixture();use(state,context,'sr-chain',a,b);use(state,context,'r-add',a);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(1800);expect(getPlayerWeek(state,b,context.week).mintedSeconds).toBe(0);expect(state.links).toEqual([]);
    use(state,context,'r-add',a);expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(1800);
  });
  it('angel affects same-year players, harvest has no weekly beneficiary limit', () => {
    const {state,context}=fixture();use(state,context,'sr-angel');use(state,context,'ssr-harvest');use(state,context,'ssr-harvest');
    expect(getPlayerWeek(state,a,context.week).mintedSeconds).toBe(0);expect(getPlayerWeek(state,b,context.week).bonusDraws).toBe(4);
    expect(getPlayerWeek(state,outsider,context.week).entertainmentSeconds).toBe(0);expect(getPlayerWeek(state,outsider,context.week).bonusDraws).toBe(0);
  });
  it('charity and thief conserve entertainment and do not mint transfer points', () => {
    const {state,context}=fixture();getPlayerWeek(state,a,context.week).entertainmentSeconds=6000;
    use(state,context,'r-charity');expect([a,b,c].map(id=>getPlayerWeek(state,id,context.week).entertainmentSeconds)).toEqual([5400,300,300]);
    getPlayerWeek(state,c,context.week).entertainmentSeconds=3600;use(state,context,'r-thief',b);
    expect(getPlayerWeek(state,c,context.week).entertainmentSeconds).toBe(1800);expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(2100);
    expect(getPlayerWeek(state,b,context.week).mintedSeconds).toBe(0);
  });
  it('a charity transfer debit triggers its one link without consuming the donor blade', () => {
    const {state,context}=fixture();getPlayerWeek(state,a,context.week).entertainmentSeconds=6000;own(state,a,'r-blade');
    use(state,context,'sr-chain',a,b);use(state,context,'r-charity');
    expect(state.links).toEqual([]);expect(state.members[a].inventory['r-blade']).toBe(1);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-300);expect(getPlayerWeek(state,b,context.week).mintedSeconds).toBe(0);
  });
  it('invasion discards N inventory or otherwise deducts entertainment', () => {
    const {state,context}=fixture();own(state,b,'n-shield');use(state,context,'sr-invasion');
    expect(state.members[b].inventory['n-shield']).toBe(0);expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(0);expect(getPlayerWeek(state,c,context.week).entertainmentSeconds).toBe(-900);
  });
  it('arrows percentage only uses positive balances and extra strike uses actual losses', () => {
    const {state,context}=fixture();getPlayerWeek(state,b,context.week).entertainmentSeconds=18000;getPlayerWeek(state,c,context.week).entertainmentSeconds=-100;
    use(state,context,'ssr-arrows',c);expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(17100);expect(getPlayerWeek(state,c,context.week).entertainmentSeconds).toBe(-550);
  });
  it('locks affect intended actions, expire, and passive defense remains automatic', () => {
    const {state,context}=fixture();use(state,context,'r-skip',b);own(state,b,'n-shield');own(state,b,'r-add');
    expect(()=>applyGameAction(state,b,{action:'use',cardId:'r-add',targetId:b},context)).toThrow('乐不思蜀');
    expect(()=>applyGameAction(state,b,{action:'draw'},context)).not.toThrow();
    use(state,context,'n-reduce');expect(state.members[b].inventory['n-shield']).toBe(0);
    context.now+=3600001;expect(()=>applyGameAction(state,b,{action:'use',cardId:'r-add',targetId:b},context)).not.toThrow();
    use(state,context,'sr-famine',c);expect(()=>applyGameAction(state,c,{action:'draw'},context)).toThrow('兵粮寸断');
  });
  it('acceleration rewards only next valid checkout once, never invalid or old sessions', () => {
    const {state,context}=fixture();use(state,context,'n-acceleration');
    context.sessions=[{id:'old',userId:a,weekKey:context.week,checkOutAt:context.now-1,durationSeconds:3600},
      {id:'invalid',userId:a,weekKey:context.week,checkOutAt:context.now+1,durationSeconds:18000}];
    advanceGameState(state,context);expect(getPlayerWeek(state,a,context.week).accelerationAt).toBe(context.now);
    context.sessions.push({id:'valid',userId:a,weekKey:context.week,checkOutAt:context.now+2,durationSeconds:14400});
    context.now+=3;
    advanceGameState(state,context);advanceGameState(state,context);
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(1800);expect(getPlayerWeek(state,a,context.week).mintedSeconds).toBe(0);
    expect(getPlayerWeek(state,a,context.week).accelerationAt).toBeUndefined();
  });
});

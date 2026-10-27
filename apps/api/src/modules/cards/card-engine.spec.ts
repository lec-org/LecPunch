import { describe, expect, it } from 'vitest';
import { CARD_CATALOG } from './card-catalog';
import { advanceGameState, applyGameAction, createGameState, GameContext, GameState, getPlayerWeek } from './card-engine';

const a = 'member-a', b = 'member-b', c = 'member-c', outsider = 'member-other-year';
function fixture() {
  const context: GameContext = {
    week: '2026-10-26', now: Date.parse('2026-10-26T12:00:00Z'), random: () => 0,
    earnedPoints: {[a]: 600, [b]: 600, [c]: 600},
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
  it('reconciles an earned pre-midnight acceleration in the old week exactly once', () => {
    const {state,context}=fixture();
    context.now=Date.parse('2026-11-01T15:40:00Z');
    use(state,context,'n-acceleration');
    context.week='2026-11-02'; context.now=Date.parse('2026-11-01T16:01:00Z');
    context.sessions=[{id:'old-week-checkout',userId:a,weekKey:'2026-10-26',
      checkOutAt:Date.parse('2026-11-01T15:50:00Z'),durationSeconds:600}];
    advanceGameState(state,context);
    expect(getPlayerWeek(state,a,'2026-10-26')).toMatchObject({entertainmentSeconds:90,mintedSeconds:90});
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
    const {state,context}=fixture();const week=getPlayerWeek(state,a,context.week);week.freeUsed=2;context.earnedPoints[a]=0;
    const before=structuredClone(state);expect(()=>applyGameAction(state,a,{action:'draw'},context)).toThrow('积分不足');expect(state).toEqual(before);
    week.starvedUntil=context.now+1000;week.freeUsed=0;
    expect(()=>applyGameAction(state,a,{action:'draw'},context)).toThrow('兵粮寸断');expect(week.freeUsed).toBe(0);
  });
  it('10th SR pity, 50th SSR pity and natural SSR reset counters across weeks', () => {
    const {state,context}=fixture();state.members[a].pitySR=9;
    expect(applyGameAction(state,a,{action:'draw'},context).gainedCardId).toBe('sr-angel');
    expect(state.members[a].pitySR).toBe(0);
    state.members[a].pitySSR=49;state.members[a].pitySR=9;
    expect(applyGameAction(state,a,{action:'draw'},context).gainedCardId).toBe('ssr-harvest');
    expect(state.members[a].pitySSR).toBe(0);expect(state.members[a].pitySR).toBe(0);
    state.members[a].pitySSR=20;context.random=()=>0.999;
    applyGameAction(state,a,{action:'draw'},context);expect(state.members[a].pitySSR).toBe(0);
  });
  it.each([
    {roll:0.299999999,animation:'radiance',quantity:2},
    {roll:0.3,animation:'gold',quantity:1}
  ])('hard-pity radiance threshold is strictly below 30% ($roll)', ({roll,animation,quantity}) => {
    const {state,context}=fixture();state.members[a].pitySSR=49;state.members[a].pitySR=9;
    let calls=0;context.random=()=>calls++===0 ? roll : 0;
    const result=applyGameAction(state,a,{action:'draw'},context);
    expect(result.drawAnimation).toBe(animation);expect(result.ssrPity).toBe(true);
    expect(result.gainedCardIds).toEqual(Array(quantity).fill('ssr-harvest'));
    expect(result.gainedCardId).toBe('ssr-harvest');expect(state.members[a].inventory['ssr-harvest']).toBe(quantity);
    expect(state.members[a].discovered).toEqual(['ssr-harvest']);expect(state.members[a].pitySSR).toBe(0);expect(state.members[a].pitySR).toBe(0);
    expect(calls).toBe(quantity+1);
  });
  it('radiance independently samples two different SSRs without rarity or ordinary draw rolls', () => {
    const {state,context}=fixture();state.members[a].pitySSR=49;
    const rolls=[0.1,0,0.999999];context.random=()=>{const value=rolls.shift();if(value===undefined)throw Error('unexpected random draw');return value;};
    const result=applyGameAction(state,a,{action:'draw'},context);
    expect(result.gainedCardIds).toEqual(['ssr-harvest','ssr-arrows']);
    expect(state.members[a].discovered).toEqual(['ssr-harvest','ssr-arrows']);expect(rolls).toEqual([]);
  });
  it.each(['free','gift','paid'] as const)('radiance consumes only one %s draw opportunity/payment', funding => {
    const {state,context}=fixture();state.members[a].pitySSR=49;
    const week=getPlayerWeek(state,a,context.week);
    if(funding!=='free')week.freeUsed=2;
    if(funding==='gift')week.bonusDraws=2;
    const result=applyGameAction(state,a,{action:'draw'},context);
    const saved=getPlayerWeek(state,a,context.week);
    expect(result.gainedCardIds).toHaveLength(2);
    expect(saved.freeUsed).toBe(funding==='free'?1:2);
    expect(saved.bonusDraws).toBe(funding==='gift'?1:0);
    expect(saved.spentPoints).toBe(funding==='paid'?60:0);
  });
  it('pity 48 does not enter radiance and an early natural SSR stays a single gold', () => {
    const {state,context}=fixture();state.members[a].pitySSR=48;
    context.random=()=>0.99;
    const result=applyGameAction(state,a,{action:'draw'},context);
    expect(result.drawAnimation).toBe('gold');expect(result.ssrPity).toBe(false);expect(result.gainedCardIds).toHaveLength(1);
    expect(state.members[a].pitySSR).toBe(0);
    state.members[a].pitySSR=48;context.random=()=>0;
    const lower=applyGameAction(state,a,{action:'draw'},context);
    expect(lower.drawAnimation).toBe('blue');expect(lower.ssrPity).toBe(false);expect(lower.gainedCardIds).toHaveLength(1);expect(state.members[a].pitySSR).toBe(49);
  });
  it.each([{roll:0.1,animation:'blue'},{roll:0.7,animation:'blue'},{roll:0.9,animation:'purple'},{roll:0.99,animation:'gold'}])('ordinary draw color follows rarity ($roll)', ({roll,animation}) => {
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
  it('week changes reset spend/free/status/balance while cards, discovery and pity persist', () => {
    const {state,context}=fixture();own(state,a,'r-add');state.members[a].discovered=['r-add'];state.members[a].pitySR=8;
    Object.assign(getPlayerWeek(state,a,context.week),{freeUsed:2,spentPoints:60,entertainmentSeconds:-3600,immuneUntil:context.now+99999999,bonusDraws:3});
    state.links.push({a,b,week:context.week,createdBy:a});context.week='2026-11-02';advanceGameState(state,context);
    expect(getPlayerWeek(state,a,context.week)).toEqual({entertainmentSeconds:0,mintedSeconds:0,spentPoints:0,freeUsed:0,bonusDraws:0});
    expect(state.members[a].inventory['r-add']).toBe(1);expect(state.members[a].discovered).toEqual(['r-add']);expect(state.members[a].pitySR).toBe(8);expect(state.links).toEqual([]);
    expect(getPlayerWeek(state,a,'2026-10-26').entertainmentSeconds).toBe(-3600);
  });
  it('mystery neither draws itself nor changes ordinary pity', () => {
    const {state,context}=fixture();state.members[a].pitySSR=49;state.members[a].pitySR=9;context.random=()=>0.7;
    const result=use(state,context,'r-mystery');expect(result.gainedCardId).not.toBe('r-mystery');
    expect(state.members[a].pitySR).toBe(9);expect(state.members[a].pitySSR).toBe(49);expect(getPlayerWeek(state,a,context.week).freeUsed).toBe(0);
    expect(result.gainedCardIds).toBeUndefined();expect(result.drawAnimation).toBeUndefined();expect(result.ssrPity).toBeUndefined();
  });
  it('mystery produces one SSR without radiance at hard pity', () => {
    const {state,context}=fixture();state.members[a].pitySSR=49;context.random=()=>0.99;
    const result=use(state,context,'r-mystery');
    expect(result.gainedCardId).toBe('ssr-arrows');expect(state.members[a].inventory['ssr-arrows']).toBe(1);
    expect(result.drawAnimation).toBeUndefined();expect(result.gainedCardIds).toBeUndefined();expect(state.members[a].pitySSR).toBe(49);
  });
});

describe('card application and defenses', () => {
  it('reduction and steal may make entertainment negative, without minting transferred points', () => {
    const {state,context}=fixture();use(state,context,'n-reduce');use(state,context,'r-steal');
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-3600);
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(1800);
    expect(getPlayerWeek(state,a,context.week).mintedSeconds).toBe(0);
  });
  it('positive new additions mint points, and can be applied to others', () => {
    const {state,context}=fixture();use(state,context,'r-add',b);
    expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(1800);expect(getPlayerWeek(state,b,context.week).mintedSeconds).toBe(1800);
    expect(state.members[b].discovered).toEqual([]);
  });
  it('N shield protects N, blade protects N/R, and weaker available defense is spent first', () => {
    const {state,context}=fixture();own(state,b,'n-shield');own(state,b,'r-blade');
    use(state,context,'n-reduce');expect(state.members[b].inventory['n-shield']).toBe(0);expect(state.members[b].inventory['r-blade']).toBe(1);
    use(state,context,'r-steal');expect(state.members[b].inventory['r-blade']).toBe(0);expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(0);
    own(state,b,'n-shield');use(state,context,'r-steal');expect(state.members[b].inventory['n-shield']).toBe(1);expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-1800);
  });
  it('a harmless gamble does not spend defenses; harmful self gamble does', () => {
    const {state,context}=fixture();own(state,a,'n-shield');context.random=()=>0.9;
    use(state,context,'n-gamble');expect(state.members[a].inventory['n-shield']).toBe(1);
    context.random=()=>0;use(state,context,'n-gamble');expect(state.members[a].inventory['n-shield']).toBe(0);expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(0);
  });
  it('red king ignores all immunity except one non-recursive reflection', () => {
    const {state,context}=fixture();own(state,b,'n-shield');own(state,b,'r-blade');getPlayerWeek(state,b,context.week).immuneUntil=context.now+9999;
    use(state,context,'sr-redking',b);expect(getPlayerWeek(state,b,context.week).entertainmentSeconds).toBe(-1800);
    own(state,b,'sr-reflect');own(state,a,'sr-reflect');use(state,context,'sr-redking',b);
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(-1800);expect(state.members[a].inventory['sr-reflect']).toBe(1);
    expect(state.members[b].inventory['n-shield']).toBe(1);expect(state.members[b].inventory['r-blade']).toBe(1);
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
    expect(getPlayerWeek(state,a,context.week).mintedSeconds).toBe(1800);expect(getPlayerWeek(state,b,context.week).bonusDraws).toBe(4);
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
    expect(getPlayerWeek(state,a,context.week).entertainmentSeconds).toBe(1800);expect(getPlayerWeek(state,a,context.week).mintedSeconds).toBe(1800);
    expect(getPlayerWeek(state,a,context.week).accelerationAt).toBeUndefined();
  });
});

export type CardRarity = 'N' | 'R' | 'SR' | 'SSR';
export const CARD_PITY_LIMITS = { sr: 30, ssr: 70 } as const;
export const CARD_DRAW_WEIGHT_TOTAL = 10_000;
export const CARD_DRAW_WEIGHTS = { N: 9000, R: 770, SR: 200, SSR: 30 } as const satisfies Record<CardRarity, number>;
export interface CardCollectionItem {
  id: string;
  rarity: CardRarity;
  unlocked: boolean;
  quantity: number;
  name?: string;
  type?: string;
  stat?: string;
  summary?: string;
  effect?: string;
  detail?: string;
  targetMode?: 'none' | 'self-or-other' | 'other' | 'two' | 'recipient';
  targetScope?: 'same-grade' | 'assessment';
  usable?: boolean;
}
export interface CardGamePlayer { id: string; username: string; displayName: string; enrollYear: number }
export interface CardGameEvent { id: string; at: string; message: string }
export interface CardEffectPlayer { id: string; username: string; displayName: string }
export interface CardActionEffect {
  target: CardEffectPlayer;
  actualTarget?: CardEffectPlayer;
  /** Applies to target only; a reflected actualTarget was not randomly selected. */
  randomTarget?: boolean;
  /** A linked effect can originate from a different member's earlier card. */
  source?: { user: CardEffectPlayer; card: { id: string; name: string; rarity: CardRarity } };
  outcome: 'applied' | 'blocked' | 'reflected' | 'no-effect';
  kind: 'time' | 'cards' | 'status' | 'judgement';
  deltaSeconds?: number;
  detail?: string;
}
export interface CardGiftNotice {
  id: string; at: string;
  sender: CardEffectPlayer;
  card: { id: string; name: string; rarity: CardRarity };
}
export interface CardDefenseNotice {
  id: string; at: string;
  randomlySelected?: boolean;
  events: {
    attacker: CardEffectPlayer;
    attackCard: { id: string; name: string; rarity: CardRarity };
    defenseCard: { id: string; name: string; rarity: CardRarity };
    outcome: 'blocked' | 'reflected';
  }[];
  effects?: CardActionEffect[];
}
export interface CardInteractionNotice {
  id: string; at: string; sender: CardEffectPlayer;
  randomlySelected?: boolean;
  card: { id: string; name: string; rarity: CardRarity };
  effects: CardActionEffect[];
}
export interface MemberCardInventory {
  member: { memberKey: string; displayName: string };
  total: number;
  items: { id: string; name: string; rarity: CardRarity; quantity: number; type: string; effect: string; detail: string }[];
}
export interface CardGameView {
  entertainmentSeconds: number;
  capacityLimited?: boolean;
  week: string;
  /** bonus is a compatibility field fixed at zero; earned is the comprehensive-time quota. */
  points: { earned: number; bonus: number; spent: number; balance: number; rule?: 'comprehensive-v1'; comprehensiveSeconds?: number };
  freeRemaining: number;
  giftDraws: number;
  pity: { sinceSR: number; sinceSSR: number; srRemaining: number; ssrRemaining: number };
  collection: CardCollectionItem[];
  players: CardGamePlayer[];
  requiredEnrollYears?: number[];
  statuses: { acceleration: boolean; immuneUntil: string | null; lockedUntil: string | null; starvedUntil: string | null };
  events: CardGameEvent[];
  incomingGifts?: CardGiftNotice[];
  incomingDefenses?: CardDefenseNotice[];
  incomingInteractions?: CardInteractionNotice[];
}
export interface CardGameActionInput {
  requestKey: string;
  action: 'draw' | 'use' | 'gift';
  count?: 1 | 10;
  cardId?: string;
  targetId?: string;
  secondTargetId?: string;
}
export interface CardGameActionResult {
  message: string;
  action?: 'draw' | 'use' | 'gift';
  actionCard?: { id: string; name: string; rarity: CardRarity };
  effects?: CardActionEffect[];
  gainedCardId?: string;
  gainedCardIds?: string[];
  drawAnimation?: 'blue' | 'purple' | 'gold' | 'radiance';
  ssrPity?: boolean;
  drawCount?: 10;
  radianceCount?: number;
}
export interface CardGameActionResponse { result: CardGameActionResult; state: CardGameView }

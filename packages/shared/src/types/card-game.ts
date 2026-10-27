export type CardRarity = 'N' | 'R' | 'SR' | 'SSR';
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
  usable?: boolean;
}
export interface CardGamePlayer { id: string; username: string; displayName: string; enrollYear: number }
export interface CardGameEvent { id: string; at: string; message: string }
export interface CardGameView {
  entertainmentSeconds: number;
  capacityLimited?: boolean;
  week: string;
  points: { earned: number; bonus: number; spent: number; balance: number };
  freeRemaining: number;
  giftDraws: number;
  pity: { sinceSR: number; sinceSSR: number; srRemaining: number; ssrRemaining: number };
  collection: CardCollectionItem[];
  players: CardGamePlayer[];
  statuses: { acceleration: boolean; immuneUntil: string | null; lockedUntil: string | null; starvedUntil: string | null };
  events: CardGameEvent[];
}
export interface CardGameActionInput {
  requestKey: string;
  action: 'draw' | 'use' | 'gift';
  cardId?: string;
  targetId?: string;
  secondTargetId?: string;
}
export interface CardGameActionResult {
  message: string;
  gainedCardId?: string;
  gainedCardIds?: string[];
  drawAnimation?: 'blue' | 'purple' | 'gold' | 'radiance';
  ssrPity?: boolean;
}
export interface CardGameActionResponse { result: CardGameActionResult; state: CardGameView }

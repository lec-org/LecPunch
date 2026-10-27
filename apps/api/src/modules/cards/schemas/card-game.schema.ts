import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import type { GameState, PlayerWeek } from '../card-engine';
import type { CardGameActionResult } from '@lecpunch/shared';

export interface CardActionReceipt {
  actorId: string;
  requestKey: string;
  hash: string;
  result: CardGameActionResult;
  at: string;
}

export interface PendingCardWrite {
  receipt?: { receiptKey: string; value: CardActionReceipt };
  weeks: { userId: string; weekKey: string; week: PlayerWeek }[];
}

@Schema({ collection: 'card_games', timestamps: true })
export class CardGame {
  @Prop({ type: String, required: true, unique: true }) teamId!: string;
  @Prop({ type: Number, required: true, default: 0 }) revision!: number;
  @Prop({ type: String, required: true }) startWeek!: string;
  @Prop({ type: SchemaTypes.Mixed, required: true }) state!: GameState;
  @Prop({ type: SchemaTypes.Mixed, default: {} }) receipts!: Record<string, CardActionReceipt>;
  @Prop({ type: SchemaTypes.Mixed }) pendingWrite?: PendingCardWrite;
}
export type CardGameDocument = HydratedDocument<CardGame>;
export const CardGameSchema = SchemaFactory.createForClass(CardGame);

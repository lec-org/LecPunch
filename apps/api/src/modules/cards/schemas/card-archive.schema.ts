import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import type { CardGameActionResult } from '@lecpunch/shared';
import type { CardActionReceipt } from './card-game.schema';
import type { PlayerWeek } from '../card-engine';

@Schema({ collection: 'card_action_receipts' })
export class CardActionArchive {
  @Prop({ required: true, type: String }) teamId!: string;
  @Prop({ required: true, type: String }) receiptKey!: string;
  @Prop({ required: true, type: String }) contentHash!: string;
  @Prop({ required: true, type: String }) actorId!: string;
  @Prop({ required: true, type: String }) requestKey!: string;
  @Prop({ required: true, type: String }) hash!: string;
  @Prop({ required: true, type: String }) at!: string;
  @Prop({ required: true, type: SchemaTypes.Mixed }) result!: CardGameActionResult;
  @Prop({ type: SchemaTypes.Mixed }) gift?: CardActionReceipt['gift'];
  /** Mutable delivery metadata; never part of the immutable receipt content hash. */
  @Prop({ type: Date }) giftReadAt?: Date;
}
export const CardActionArchiveSchema = SchemaFactory.createForClass(CardActionArchive);
CardActionArchiveSchema.index({ teamId: 1, receiptKey: 1 }, { unique: true });
CardActionArchiveSchema.index({ teamId: 1, actorId: 1, at: -1, receiptKey: 1 });
CardActionArchiveSchema.index({ teamId: 1, 'gift.recipientId': 1, giftReadAt: 1, at: 1, receiptKey: 1 });

@Schema({ collection: 'card_week_archives' })
export class CardWeekArchive {
  @Prop({ required: true, type: String }) teamId!: string;
  @Prop({ required: true, type: String }) userId!: string;
  @Prop({ required: true, type: String }) weekKey!: string;
  @Prop({ required: true, type: String }) contentHash!: string;
  @Prop({ required: true, type: SchemaTypes.Mixed }) week!: PlayerWeek;
}
export const CardWeekArchiveSchema = SchemaFactory.createForClass(CardWeekArchive);
CardWeekArchiveSchema.index({ teamId: 1, userId: 1, weekKey: 1 }, { unique: true });
CardWeekArchiveSchema.index({ teamId: 1, weekKey: 1 });

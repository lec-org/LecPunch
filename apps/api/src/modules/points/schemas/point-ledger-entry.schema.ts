import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'point_ledger_entries' })
export class PointLedgerEntry {
  @Prop({ required: true, type: String, index: true })
  teamId!: string;

  @Prop({ required: true, type: String, index: true })
  userId!: string;

  @Prop({ required: true, type: String, enum: ['attendance'], default: 'attendance' })
  sourceType!: 'attendance';

  @Prop({ required: true, type: String, unique: true })
  sourceAttendanceSessionId!: string;

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  points!: number;
}

export type PointLedgerEntryDocument = HydratedDocument<PointLedgerEntry>;
export const PointLedgerEntrySchema = SchemaFactory.createForClass(PointLedgerEntry);

PointLedgerEntrySchema.index({ userId: 1, teamId: 1, createdAt: -1 });

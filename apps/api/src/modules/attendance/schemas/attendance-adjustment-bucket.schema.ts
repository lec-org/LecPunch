import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
export interface AdjustmentEntry {
  id: string; requestKey: string; requestHash: string; username: string;
  operation: 'add' | 'subtract'; durationSeconds: number; signedDurationSeconds: number;
  previousDurationSeconds: number; resultingDurationSeconds: number; reason?: string;
  createdBy: string; createdAt: Date;
}
@Schema({ collection: 'attendance_adjustment_buckets' })
export class AttendanceAdjustmentBucket {
  @Prop({ required: true, type: String }) teamId!: string;
  @Prop({ required: true, type: String }) userId!: string;
  @Prop({ required: true, type: String }) weekKey!: string;
  @Prop({ required: true, type: Number, default: 0 }) version!: number;
  @Prop({ type: [SchemaTypes.Mixed], default: [] }) entries!: AdjustmentEntry[];
}
export type AttendanceAdjustmentBucketDocument = HydratedDocument<AttendanceAdjustmentBucket>;
export const AttendanceAdjustmentBucketSchema = SchemaFactory.createForClass(AttendanceAdjustmentBucket);
AttendanceAdjustmentBucketSchema.index({ teamId: 1, userId: 1, weekKey: 1 }, { unique: true });

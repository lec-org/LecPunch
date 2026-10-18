import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { NotificationPayload, NotificationSourceType, NotificationType } from '@lecpunch/shared';
import { HydratedDocument, SchemaTypes } from 'mongoose';

@Schema({
  collection: 'notifications',
  timestamps: { createdAt: true, updatedAt: false }
})
export class Notification {
  @Prop({ required: true, type: String, index: true })
  teamId!: string;

  @Prop({ required: function(this: Notification) { return !this.audience || this.audience === 'user'; }, type: String, index: true })
  userId?: string;

  @Prop({ type: String, enum: ['user', 'team_admin', 'team_members'], default: 'user' })
  audience?: 'user' | 'team_admin' | 'team_members';

  @Prop({ type: [String], default: undefined })
  recipientUserIds?: string[];

  @Prop({ type: String }) deliveryKey?: string;
  @Prop({ type: String }) requestHash?: string;

  @Prop({ required: true, type: String, enum: ['attendance.record_marked', 'report.submitted', 'admin.notice'] })
  type!: NotificationType;

  @Prop({ required: true, type: String })
  title!: string;

  @Prop({ required: true, type: String })
  message!: string;

  @Prop({ required: true, type: SchemaTypes.Mixed })
  payload!: NotificationPayload;

  @Prop({ required: true, type: String, enum: ['attendance_record', 'report', 'admin_notice'] })
  sourceType!: NotificationSourceType;

  @Prop({ required: true, type: String })
  sourceId!: string;

  @Prop({ required: true, type: String })
  createdBy!: string;

  @Prop({ type: Date, default: null, index: true })
  acknowledgedAt!: Date | null;

  createdAt!: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ deliveryKey: 1 }, { unique: true, partialFilterExpression: { deliveryKey: { $type: 'string' } } });
NotificationSchema.index({ teamId: 1, audience: 1, _id: -1 });
NotificationSchema.index({ userId: 1, acknowledgedAt: 1, createdAt: -1 });
NotificationSchema.index({ teamId: 1, userId: 1, createdAt: -1 });
NotificationSchema.index({ sourceType: 1, sourceId: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'notification_receipts' })
export class NotificationReceipt {
  @Prop({ required: true, type: String }) notificationId!: string;
  @Prop({ required: true, type: String }) userId!: string;
  @Prop({ required: true, type: String }) teamId!: string;
  @Prop({ required: true, type: Date }) readAt!: Date;
}
export type NotificationReceiptDocument = HydratedDocument<NotificationReceipt>;
export const NotificationReceiptSchema = SchemaFactory.createForClass(NotificationReceipt);
NotificationReceiptSchema.index({ notificationId: 1, userId: 1 }, { unique: true });

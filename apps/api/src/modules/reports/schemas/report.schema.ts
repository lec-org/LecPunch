import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class ReportImage {
  @Prop({ required: true, type: String })
  id!: string;

  @Prop({ required: true, type: String })
  filename!: string;

  @Prop({ required: true, type: String })
  contentType!: string;

  @Prop({ required: true, type: Number })
  sizeBytes!: number;
}

export const ReportImageSchema = SchemaFactory.createForClass(ReportImage);

@Schema({
  collection: 'reports',
  timestamps: { createdAt: true, updatedAt: true }
})
export class Report {
  @Prop({ required: true, type: String, index: true })
  teamId!: string;

  @Prop({ required: true, type: String, index: true })
  reporterUserId!: string;

  @Prop({ required: true, type: String })
  reporterUsername!: string;

  @Prop({ required: true, type: String })
  reporterDisplayName!: string;

  @Prop({ required: true, type: String, maxlength: 2_000 })
  description!: string;

  @Prop({ required: true, type: [ReportImageSchema], default: [] })
  images!: ReportImage[];

  @Prop({ type: Date, default: null, index: true })
  imagesExpireAt!: Date | null;

  @Prop({ type: Date, default: null })
  imagesPurgedAt!: Date | null;

  @Prop({ type: String }) requestKey?: string;
  @Prop({ type: String }) requestHash?: string;
  @Prop({ type: Boolean, default: false }) notificationPending?: boolean;
  @Prop({ type: String, enum: ['open', 'processed'], default: 'open' }) processingStatus?: 'open' | 'processed';
  @Prop({ type: String, maxlength: 2000 }) processingNote?: string;
  @Prop({ type: String }) processedBy?: string;
  @Prop({ type: String }) processedByDisplayName?: string;
  @Prop({ type: Date }) processedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);

ReportSchema.index({ teamId: 1, reporterUserId: 1, requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } });
ReportSchema.index({ notificationPending: 1, createdAt: 1 });
ReportSchema.index({ teamId: 1, createdAt: -1 });
ReportSchema.index({ imagesExpireAt: 1, imagesPurgedAt: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import type { AssessmentWeekState } from '../assessment-engine';

@Schema({ collection: 'assessment_weeks', timestamps: true })
export class AssessmentWeek {
  @Prop({ type: String, required: true }) teamId!: string;
  @Prop({ type: String, required: true }) weekKey!: string;
  @Prop({ type: Number, required: true, default: 0 }) revision!: number;
  @Prop({ type: SchemaTypes.Mixed, required: true }) state!: AssessmentWeekState;
}
export type AssessmentWeekDocument = HydratedDocument<AssessmentWeek>;
export const AssessmentWeekSchema = SchemaFactory.createForClass(AssessmentWeek);
AssessmentWeekSchema.index({ teamId: 1, weekKey: 1 }, { unique: true });

@Schema({ collection: 'assessment_memberships', timestamps: true })
export class AssessmentMembership {
  @Prop({ type: String, required: true }) teamId!: string;
  @Prop({ type: String, required: true }) userId!: string;
  // First actual active observation by this module; never an inferred SSO join date.
  @Prop({ type: Date, required: true }) registeredAt!: Date;
}
export type AssessmentMembershipDocument = HydratedDocument<AssessmentMembership>;
export const AssessmentMembershipSchema = SchemaFactory.createForClass(AssessmentMembership);
AssessmentMembershipSchema.index({ teamId: 1, userId: 1 }, { unique: true });

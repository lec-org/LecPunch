import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole, UserStatus } from '@lecpunch/shared';

@Schema({ timestamps: true, collection: 'users' })
export class User {
  // timestamps 由 Mongoose 维护，统一响应以 ISO 字符串输出。
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ type: String, unique: true, sparse: true, index: true })
  logtoUserId?: string;

  @Prop({ required: true, type: String, unique: true, index: true })
  username!: string;

  @Prop({ type: String })
  passwordHash?: string;

  @Prop({ required: true, type: String })
  displayName!: string;

  @Prop({ required: true, type: String, index: true })
  teamId!: string;

  @Prop({
    required: true,
    type: String,
    enum: ['member', 'admin'],
    default: 'member'
  })
  role!: UserRole;

  @Prop({
    required: true,
    type: String,
    enum: ['active', 'disabled'],
    default: 'active'
  })
  status!: UserStatus;

  @Prop({ required: true, type: Number })
  enrollYear!: number;

  @Prop({ type: String, sparse: true, unique: true, index: true })
  studentId?: string;

  @Prop({ type: String })
  realName?: string;

  /** LecSSO 签名身份资料中的头像地址。 */
  @Prop({ type: String })
  avatarUrl?: string;

  @Prop({ type: Boolean, default: true })
  adminMessageBadgeEnabled?: boolean;

  @Prop({ type: String })
  avatarBase64?: string;

  @Prop({ type: String })
  avatarColor?: string;

  @Prop({ type: String })
  avatarEmoji?: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ teamId: 1, role: 1 });

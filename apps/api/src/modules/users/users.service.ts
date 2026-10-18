import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { AttendanceSession, AttendanceSessionDocument } from '../attendance/schemas/attendance-session.schema';
import { ERROR_CODES, UserRole, UserStatus, type LecUser } from '@lecpunch/shared';
import * as bcrypt from 'bcrypt';
import { createHmac, timingSafeEqual } from 'crypto';
import type { AuthUser } from '../auth/types/auth-user.type';
import { PointsService } from '../points/points.service';

export interface CreateUserInput {
  logtoUserId?: string;
  username: string;
  passwordHash?: string;
  displayName: string;
  teamId: string;
  role?: UserRole;
  enrollYear: number;
  studentId?: string;
  realName?: string;
  avatarUrl?: string;
}

export interface UpdateProfileInput {
  displayName?: string;
  avatarBase64?: string;
  avatarColor?: string;
  avatarEmoji?: string;
}

export interface AdminUpdateMemberInput {
  role?: UserRole;
  status?: UserStatus;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AttendanceSession.name)
    private readonly attendanceModel: Model<AttendanceSessionDocument>,
    private readonly configService: ConfigService,
    private readonly pointsService: PointsService
  ) {}

  create(payload: CreateUserInput) {
    return this.userModel.create({
      ...payload,
      role: payload.role ?? 'member'
    });
  }

  findByUsername(username: string) {
    return this.userModel.findOne({ username }).exec();
  }

  findByLogtoUserId(logtoUserId: string) {
    return this.userModel.findOne({ logtoUserId }).exec();
  }

  findById(id: string) {
    return this.userModel.findById(id).exec();
  }

  findByIds(ids: string[]) {
    return this.userModel.find({ _id: { $in: ids } }).exec();
  }

  findByTeamAndEnrollYear(teamId: string, enrollYear: number) {
    return this.userModel.find({ teamId, enrollYear }).exec();
  }

  listTeamMembers(teamId: string) {
    return this.userModel
      .find({ teamId })
      .sort({ role: 1, status: 1, displayName: 1, username: 1 })
      .exec();
  }

  async setAdminMessageBadge(userId: string, enabled: boolean) {
    await this.userModel.updateOne({ _id: userId }, { $set: { adminMessageBadgeEnabled: enabled } }).exec();
    return { adminMessageBadgeEnabled: enabled };
  }

  getMemberKey(userId: string) {
    const payload = Buffer.from(userId, 'utf8').toString('base64url');
    const signature = this.signMemberKeyPayload(payload);
    return `${payload}.${signature}`;
  }

  async findByMemberKey(memberKey: string) {
    const userId = this.parseMemberKey(memberKey);
    if (!userId) {
      return null;
    }

    return this.findById(userId);
  }

  findByStudentId(studentId: string) {
    return this.userModel.findOne({ studentId }).exec();
  }

  bindLogtoIdentity(userId: string, logtoUserId: string) {
    return this.userModel
      .findOneAndUpdate(
        { _id: userId, logtoUserId: { $exists: false } },
        { $set: { logtoUserId } },
        { new: true }
      )
      .exec();
  }

  /** 仅同步经过 Logto 验签的身份资料；资料未变时不写数据库。 */
  async syncLecProfile(user: UserDocument, profile: Pick<LecUser, 'username'> & Partial<Pick<LecUser, 'name' | 'avatar' | 'studentNumber'>>) {
    const set: Record<string, string> = {};
    if (user.username !== profile.username) set.username = profile.username;
    if (profile.name != null && user.realName !== profile.name) set.realName = profile.name;
    if (profile.studentNumber != null && user.studentId !== profile.studentNumber) set.studentId = profile.studentNumber;
    if (profile.avatar && user.avatarUrl !== profile.avatar) set.avatarUrl = profile.avatar;
    const removeAvatar = profile.avatar === null && Boolean(user.avatarUrl);
    if (Object.keys(set).length === 0 && !removeAvatar) return user;
    const updated = await this.userModel.findByIdAndUpdate(user.id, {
      $set: set,
      ...(removeAvatar ? { $unset: { avatarUrl: 1 } } : {})
    }, { new: true }).exec();
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserDocument> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};

    if (input.displayName !== undefined) {
      set.displayName = input.displayName.trim();
    }

    // avatar fields are mutually exclusive
    if (input.avatarBase64 !== undefined) {
      set.avatarBase64 = input.avatarBase64;
      unset.avatarColor = 1;
      unset.avatarEmoji = 1;
    } else if (input.avatarEmoji !== undefined) {
      set.avatarEmoji = input.avatarEmoji;
      unset.avatarBase64 = 1;
      unset.avatarColor = 1;
    } else if (input.avatarColor !== undefined) {
      set.avatarColor = input.avatarColor;
      unset.avatarBase64 = 1;
      unset.avatarEmoji = 1;
    }

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) {
      update.$unset = unset;
    }

    const user = await this.userModel.findByIdAndUpdate(userId, update, { new: true }).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updatePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    if (!user.passwordHash) {
      throw new BadRequestException({ code: 'SSO_MANAGED_PASSWORD', message: '请在 LEC SSO 中修改密码' });
    }
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) {
      throw new BadRequestException({ code: 'WRONG_PASSWORD', message: '当前密码不正确' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.userModel.findByIdAndUpdate(userId, { $set: { passwordHash: newHash } }).exec();
  }

  async adminUpdateMember(
    currentUser: AuthUser,
    memberId: string,
    input: AdminUpdateMemberInput
  ): Promise<UserDocument> {
    if ('role' in input && input.role !== undefined) {
      throw new BadRequestException({ code: 'SSO_MANAGED_ROLE', message: '管理员权限由 SSO 管理，请在 SSO 平台修改' });
    }
    const member = await this.userModel.findById(memberId).exec();
    if (!member) {
      throw new NotFoundException('User not found');
    }

    if (member.teamId !== currentUser.teamId) {
      throw new ForbiddenException({
        code: ERROR_CODES.ATTENDANCE_CROSS_TEAM_FORBIDDEN,
        message: '不可管理其他团队成员'
      });
    }

    if (
      member.id === currentUser.userId &&
      ((input.role !== undefined && input.role !== member.role) ||
        (input.status !== undefined && input.status !== member.status))
    ) {
      throw new BadRequestException({
        code: 'ADMIN_SELF_UPDATE_FORBIDDEN',
        message: '管理员不能修改自己的角色或启用状态'
      });
    }

    const set: Record<string, unknown> = {};
    if (input.status !== undefined) {
      set.status = input.status;
    }

    if (Object.keys(set).length === 0) {
      throw new BadRequestException({
        code: 'ADMIN_MEMBER_UPDATE_EMPTY',
        message: '至少提供一个可更新字段'
      });
    }

    const updated = await this.userModel.findByIdAndUpdate(memberId, { $set: set }, { new: true }).exec();
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    return updated;
  }

  async adminDeleteMember(currentUser: AuthUser, memberId: string): Promise<void> {
    const member = await this.userModel.findById(memberId).exec();
    if (!member) {
      throw new NotFoundException('User not found');
    }

    if (member.teamId !== currentUser.teamId) {
      throw new ForbiddenException({
        code: ERROR_CODES.ATTENDANCE_CROSS_TEAM_FORBIDDEN,
        message: '涓嶅彲绠＄悊鍏朵粬鍥㈤槦鎴愬憳'
      });
    }

    if (member.id === currentUser.userId) {
      throw new BadRequestException({
        code: 'ADMIN_SELF_DELETE_FORBIDDEN',
        message: '绠＄悊鍛樹笉鑳介攢姣佽嚜宸辩殑璐﹀彿'
      });
    }

    await this.attendanceModel.deleteMany({ userId: member.id }).exec();
    await this.pointsService.deleteUserPoints(member.teamId, member.id);

    const deleted = await this.userModel.findByIdAndDelete(memberId).exec();
    if (!deleted) {
      throw new NotFoundException('User not found');
    }
  }

  private parseMemberKey(memberKey: string) {
    const [payload, signature, ...rest] = memberKey.split('.');
    if (!payload || !signature || rest.length > 0) {
      return null;
    }

    const expectedSignature = this.signMemberKeyPayload(payload);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      return null;
    }

    try {
      const userId = Buffer.from(payload, 'base64url').toString('utf8');
      return userId || null;
    } catch {
      return null;
    }
  }

  private signMemberKeyPayload(payload: string) {
    const secret = this.configService.get<string>('AUTH_SECRET');
    if (!secret) {
      throw new Error('AUTH_SECRET is required for member key signing');
    }

    return createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 24);
  }
}

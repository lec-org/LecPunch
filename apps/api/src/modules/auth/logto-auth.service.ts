import { ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ERROR_CODES, type LecUser } from '@lecpunch/shared';
import { TeamsService } from '../teams/teams.service';
import { UsersService } from '../users/users.service';
import type { AuthUser } from './types/auth-user.type';

export interface LogtoAccessTokenClaims extends JWTPayload {
  sub: string;
  organization_id?: string;
  scope?: string;
  username?: LecUser['username'];
  name?: LecUser['name'];
  student_number?: LecUser['studentNumber'];
  picture?: LecUser['avatar'];
}

@Injectable()
export class LogtoAuthService {
  private readonly endpoint: string;
  private readonly resource: string;
  private readonly organizationId: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService
  ) {
    this.endpoint = configService.getOrThrow<string>('LOGTO_ENDPOINT').replace(/\/$/, '');
    this.resource = configService.getOrThrow<string>('LOGTO_API_RESOURCE');
    this.organizationId = configService.getOrThrow<string>('LOGTO_ORGANIZATION_ID');
    this.jwks = createRemoteJWKSet(new URL(`${this.endpoint}/oidc/jwks`));
  }

  async authenticate(token: string): Promise<AuthUser> {
    let claims: LogtoAccessTokenClaims;
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `${this.endpoint}/oidc`, audience: this.resource, requiredClaims: ['exp', 'sub']
      });
      claims = payload as LogtoAccessTokenClaims;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (error instanceof TypeError || code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JOSE_GENERIC') {
        throw new ServiceUnavailableException({ code: 'SSO_TEMPORARILY_UNAVAILABLE', message: 'SSO 验证服务暂时不可用，请稍后重试' });
      }
      throw this.unauthorized('登录凭证无效或已过期');
    }
    // Database/profile failures are not proof that the SSO session has expired.
    return this.resolveUser(claims);
  }

  async resolveUser(claims: LogtoAccessTokenClaims): Promise<AuthUser> {
    const scopes = new Set(claims.scope?.split(/\s+/).filter(Boolean));
    if (claims.organization_id !== this.organizationId || !scopes.has('studio:access')) {
      throw new ForbiddenException({ code: 'SSO_ACCESS_REQUIRED', message: '需要 LEC 组织成员资格及打卡访问权限，请联系 SSO 管理员' });
    }

    if (!claims.sub || typeof claims.sub !== 'string') throw this.unauthorized('SSO 账号标识无效');
    const username = claims.username?.trim().toLowerCase();
    if (!username || !/^[a-z0-9][a-z0-9._-]*$/.test(username)) {
      throw this.unauthorized('SSO 账号缺少有效 Handle');
    }
    const studentId = claims.student_number?.trim();
    if (!studentId || !/^\d{12}$/.test(studentId)) throw this.unauthorized('SSO 账号缺少有效学号');

    const realName = typeof claims.name === 'string' ? claims.name.trim() : undefined;
    // 图片地址来自已验签的 SSO claim；不接受脚本或内联数据地址。
    let avatarUrl: string | null | undefined;
    if (claims.picture === null) avatarUrl = null;
    else if (typeof claims.picture === 'string') {
      try {
        const url = new URL(claims.picture);
        if (url.protocol === 'https:' || url.protocol === 'http:') avatarUrl = url.href;
      } catch { /* 不合法的头像地址不覆盖现有资料。 */ }
    }

    let user = await this.usersService.findByLogtoUserId(claims.sub);
    if (!user) {
      const legacyUser = await this.usersService.findByStudentId(studentId);
      if (legacyUser) {
        if (legacyUser.username.toLowerCase() !== username || legacyUser.logtoUserId) {
          throw this.unauthorized('SSO 账号与现有 LecPunch 成员不匹配，请联系管理员');
        }
        user = await this.usersService.bindLogtoIdentity(legacyUser.id, claims.sub);
        if (!user) throw this.unauthorized('LecPunch 成员绑定冲突，请重新登录');
      }
    }
    if (!user) {
      const configuredTeamId = this.configService.get<string>('LECPUNCH_TEAM_ID');
      const team = configuredTeamId
        ? await this.teamsService.findById(configuredTeamId)
        : await this.teamsService.ensureDefaultTeam(
            this.configService.get<string>('DEFAULT_TEAM_NAME', 'FocusTeam')
          );
      if (!team) throw this.unauthorized('LecPunch 业务团队配置无效');
      user = await this.usersService.create({
        logtoUserId: claims.sub,
        username,
        displayName: realName || username,
        teamId: team.id,
        role: 'member',
        enrollYear: Number(studentId.slice(0, 4)),
        studentId,
        realName,
        avatarUrl: avatarUrl ?? undefined
      });
    }

    if (user.status !== 'active') throw new ForbiddenException({ code: ERROR_CODES.USER_DISABLED, message: '打卡账号已停用，请联系管理员' });
    const identityUser = await this.usersService.syncLecProfile(user, {
      username, name: realName, avatar: avatarUrl, studentNumber: studentId
    });
    return {
      userId: identityUser.id,
      teamId: identityUser.teamId,
      role: scopes.has('studio:admin:access') ? 'admin' : 'member',
      username: identityUser.username,
      displayName: identityUser.displayName,
      enrollYear: identityUser.enrollYear,
      tokenExpiresAt: claims.exp
    };
  }

  private unauthorized(message: string, code: string = ERROR_CODES.AUTH_UNAUTHORIZED) {
    return new UnauthorizedException({ code, message });
  }
}

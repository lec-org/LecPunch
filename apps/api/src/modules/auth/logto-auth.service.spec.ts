import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LogtoAuthService } from './logto-auth.service';

const memberClaims = {
  sub: 'logto-user-1',
  aud: 'https://api.lecpunch.lec.org',
  organization_id: 'lec-studio',
  scope: 'studio:access',
  username: 'zhangsan.01',
  name: '张三',
  student_number: '202300010001'
};

const buildService = (
  overrides: Partial<
    Record<'findByLogtoUserId' | 'findByStudentId' | 'bindLogtoIdentity' | 'create' | 'syncLecProfile' | 'ensureDefaultTeam', ReturnType<typeof vi.fn>>
  > = {}
) => {
  const user = {
    id: 'mongo-user-1',
    username: 'zhangsan.01',
    displayName: '张三',
    teamId: 'team-1',
    role: 'member',
    status: 'active',
    enrollYear: 2023
  };
  const usersService = {
    findByLogtoUserId: overrides.findByLogtoUserId ?? vi.fn().mockResolvedValue(user),
    findByStudentId: overrides.findByStudentId ?? vi.fn().mockResolvedValue(null),
    bindLogtoIdentity: overrides.bindLogtoIdentity ?? vi.fn().mockResolvedValue(user),
    create: overrides.create ?? vi.fn().mockResolvedValue(user),
    syncLecProfile: overrides.syncLecProfile ?? vi.fn().mockImplementation(async (user) => user)
  };
  const teamsService = {
    ensureDefaultTeam: overrides.ensureDefaultTeam ?? vi.fn().mockResolvedValue({ id: 'team-1' })
  };
  const values: Record<string, string> = {
    LOGTO_ENDPOINT: 'http://localhost:3001',
    LOGTO_API_RESOURCE: 'https://api.lecpunch.lec.org',
    LOGTO_ORGANIZATION_ID: 'lec-studio',
    DEFAULT_TEAM_NAME: 'FocusTeam'
  };
  const config = {
    getOrThrow: vi.fn((key: string) => values[key]),
    get: vi.fn((key: string, fallback?: string) => values[key] ?? fallback)
  };
  const service = new LogtoAuthService(config as never, usersService as never, teamsService as never);
  return { service, usersService, teamsService, user };
};

describe('LogtoAuthService', () => {
  it('将有效的 LEC Studio token 映射为本地业务用户，并以 scope 决定权限', async () => {
    const { service, user } = buildService();

    await expect(service.resolveUser(memberClaims)).resolves.toEqual({
      userId: user.id,
      teamId: user.teamId,
      role: 'member',
      username: user.username,
      displayName: user.displayName,
      enrollYear: user.enrollYear
    });
    await expect(service.resolveUser({ ...memberClaims, scope: 'studio:access studio:admin:access' })).resolves.toMatchObject({ role: 'admin' });
  });

  it('拒绝不属于 LEC Studio 或缺少访问 scope 的 token', async () => {
    const { service } = buildService();

    await expect(service.resolveUser({ ...memberClaims, organization_id: 'other' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.resolveUser({ ...memberClaims, scope: 'openid' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('旧用户仅在学号和 Handle 同时匹配时绑定 Logto sub', async () => {
    const legacyUser = {
      id: 'mongo-legacy',
      username: 'zhangsan.01',
      displayName: '张三',
      teamId: 'team-1',
      role: 'member',
      status: 'active',
      enrollYear: 2023
    };
    const bindLogtoIdentity = vi.fn().mockResolvedValue(legacyUser);
    const { service, usersService } = buildService({
      findByLogtoUserId: vi.fn().mockResolvedValue(null),
      findByStudentId: vi.fn().mockResolvedValue(legacyUser),
      bindLogtoIdentity
    });

    await expect(service.resolveUser(memberClaims)).resolves.toMatchObject({ userId: 'mongo-legacy' });
    expect(bindLogtoIdentity).toHaveBeenCalledWith('mongo-legacy', 'logto-user-1');
    expect(usersService.create).not.toHaveBeenCalled();
  });

  it('首次登录按 Logto sub 创建本地业务用户', async () => {
    const create = vi.fn().mockImplementation(async (input) => ({ id: 'mongo-user-2', status: 'active', ...input }));
    const { service, usersService } = buildService({
      findByLogtoUserId: vi.fn().mockResolvedValue(null),
      create
    });

    await expect(service.resolveUser(memberClaims)).resolves.toMatchObject({
      userId: 'mongo-user-2',
      username: 'zhangsan.01',
      displayName: '张三',
      enrollYear: 2023
    });
    expect(usersService.create).toHaveBeenCalledWith(expect.objectContaining({
      logtoUserId: 'logto-user-1',
      username: 'zhangsan.01',
      teamId: 'team-1',
      studentId: '202300010001',
      realName: '张三'
    }));
  });
  it('将签名中的 SSO 真名和头像同步到现有成员，并保留本地业务状态', async () => {
    const { service, usersService, user } = buildService();
    await service.resolveUser({ ...memberClaims, name: '张三丰', picture: 'https://sso.example.com/lec-assets/avatar.png' });
    expect(usersService.syncLecProfile).toHaveBeenCalledWith(user, {
      username: 'zhangsan.01', name: '张三丰', avatar: 'https://sso.example.com/lec-assets/avatar.png', studentNumber: '202300010001'
    });
    await service.resolveUser({ ...memberClaims, picture: null });
    expect(usersService.syncLecProfile).toHaveBeenLastCalledWith(user, expect.objectContaining({ avatar: null }));
    await service.resolveUser({ ...memberClaims, picture: 'javascript:alert(1)' });
    expect(usersService.syncLecProfile).toHaveBeenLastCalledWith(user, expect.objectContaining({ avatar: undefined }));
    await service.resolveUser(memberClaims);
    expect(usersService.syncLecProfile).toHaveBeenLastCalledWith(user, expect.objectContaining({ avatar: undefined }));
  });

});

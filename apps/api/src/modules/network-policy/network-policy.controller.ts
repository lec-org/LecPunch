import { Body, Controller, ForbiddenException, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { NetworkPolicyService, type NetworkPolicySnapshot } from './network-policy.service';
import { UpdateNetworkPolicyDto } from './dto/update-network-policy.dto';
import { CheckNetworkStatusDto, UpdateWifiFingerprintDto } from './dto/wifi-fingerprint.dto';
import type { Request } from 'express';

@Controller('network-policy')
@UseGuards(JwtAuthGuard)
export class NetworkPolicyController {
  constructor(private readonly networkPolicyService: NetworkPolicyService) {}

  @Get('current-status')
  async getCurrentStatus(@CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.getRequestStatus(user.teamId, request);
  }

  /** 带周边 Wi-Fi 环境指纹的环境准入校验（供 Orbit 桌面端实时展示工作室环境匹配状态）。 */
  @Post('current-status')
  async checkCurrentStatus(
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
    @Body() dto?: CheckNetworkStatusDto
  ) {
    const clientIp = await this.networkPolicyService.getClientIp(user.teamId, request);
    return this.networkPolicyService.evaluateAccess(user.teamId, clientIp, dto?.wifiScan);
  }

  @Get('admin/current')
  async getCurrentPolicy(@CurrentUser() user: AuthUser) {
    this.assertAdmin(user);
    const policy = await this.networkPolicyService.getAdminPolicy(user.teamId);
    return this.mapPolicy(policy);
  }

  @Patch('admin/current')
  async updateCurrentPolicy(@CurrentUser() user: AuthUser, @Body() dto: UpdateNetworkPolicyDto) {
    this.assertAdmin(user);
    const policy = await this.networkPolicyService.updateAdminPolicy(user.teamId, dto);
    return this.mapPolicy(policy);
  }

  @Get('admin/wifi-fingerprint')
  async getWifiFingerprint(@CurrentUser() user: AuthUser) {
    this.assertAdmin(user);
    const cfg = await this.networkPolicyService.getWifiFingerprintConfig(user.teamId);
    return {
      ...cfg,
      updatedAt: cfg.updatedAt ? cfg.updatedAt.toISOString() : null
    };
  }

  @Patch('admin/wifi-fingerprint')
  async updateWifiFingerprint(@CurrentUser() user: AuthUser, @Body() dto: UpdateWifiFingerprintDto) {
    this.assertAdmin(user);
    const cfg = await this.networkPolicyService.updateWifiFingerprintConfig(user.teamId, dto);
    return {
      ...cfg,
      updatedAt: cfg.updatedAt ? cfg.updatedAt.toISOString() : null
    };
  }

  @Get('admin/debug')
  async getCurrentDebug(@CurrentUser() user: AuthUser, @Req() request: Request) {
    this.assertAdmin(user);
    return this.getRequestStatus(user.teamId, request);
  }

  private assertAdmin(user: AuthUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only admins can manage network policy');
    }
  }

  private async getRequestStatus(teamId: string, request: Request) {
    const clientIp = await this.networkPolicyService.getClientIp(teamId, request);
    const isAllowed = await this.networkPolicyService.isIpAllowed(teamId, clientIp);

    return {
      clientIp,
      isAllowed
    };
  }

  private mapPolicy(policy: NetworkPolicySnapshot) {
    return {
      teamId: policy.teamId,
      source: policy.source,
      allowAnyNetwork: policy.allowAnyNetwork,
      allowedPublicIps: policy.allowedPublicIps,
      allowedCidrs: policy.allowedCidrs,
      trustProxy: policy.trustProxy,
      trustedProxyHops: policy.trustedProxyHops,
      updatedAt: policy.updatedAt ? policy.updatedAt.toISOString() : null
    };
  }
}

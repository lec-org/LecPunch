import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@lecpunch/shared';
import type { Request } from 'express';
import * as ipaddr from 'ipaddr.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { UpdateNetworkPolicyDto } from './dto/update-network-policy.dto';
import type { UpdateWifiFingerprintDto } from './dto/wifi-fingerprint.dto';
import { NetworkPolicy, type WifiAnchorEntry } from './schemas/network-policy.schema';

export interface WifiScanSample {
  bssid: string;
  ssid?: string;
  rssi?: number;
}

export interface WifiFingerprintConfigSnapshot {
  teamId: string;
  enabled: boolean;
  anchors: WifiAnchorEntry[];
  minMatchCount: number;
  minRssi: number;
  updatedAt?: Date;
}

export interface AttendanceAccessEvaluation {
  clientIp: string;
  isAllowed: boolean;
  ipAllowed: boolean;
  wifiFingerprintEnabled: boolean;
  wifiAllowed: boolean;
  matchedCount: number;
  requiredMatchCount: number;
  configuredAnchorCount: number;
  reason?: string;
}

const DEFAULT_WIFI_MIN_MATCH = 2;
const DEFAULT_WIFI_MIN_RSSI = -82;

type PolicySource = 'database' | 'environment';

type PersistedNetworkPolicyInput = {
  allowAnyNetwork: boolean;
  allowedPublicIps: string[];
  allowedCidrs: string[];
  trustProxy: boolean;
  trustedProxyHops: number;
};

export interface NetworkPolicySnapshot extends PersistedNetworkPolicyInput {
  teamId: string;
  source: PolicySource;
  updatedAt?: Date;
}

type PersistedNetworkPolicyRecord = PersistedNetworkPolicyInput & {
  teamId: string;
  updatedAt?: Date;
};

@Injectable()
export class NetworkPolicyService {
  private readonly fallbackPolicy: PersistedNetworkPolicyInput;

  constructor(
    configService: ConfigService,
    @InjectModel(NetworkPolicy.name)
    private readonly networkPolicyModel: Model<NetworkPolicy>
  ) {
    this.fallbackPolicy = this.normalizePolicy({
      allowAnyNetwork: configService.get<boolean>('ALLOW_ANY_NETWORK', true),
      allowedPublicIps: this.parseCsv(configService.get<string>('ALLOWED_PUBLIC_IPS')),
      allowedCidrs: this.parseCsv(configService.get<string>('ALLOWED_CIDRS')),
      trustProxy: configService.get<boolean>('TRUST_PROXY', false),
      trustedProxyHops: configService.get<number>('TRUSTED_PROXY_HOPS', 1)
    });
  }

  async getAdminPolicy(teamId: string) {
    return this.resolvePolicy(teamId);
  }

  async updateAdminPolicy(teamId: string, input: UpdateNetworkPolicyDto) {
    const nextPolicy = this.normalizePolicy(input);
    this.assertAllowlistConfigured(nextPolicy);

    const updated = await this.networkPolicyModel
      .findOneAndUpdate(
        { teamId },
        { $set: nextPolicy },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
      .exec();

    if (!updated) {
      throw new BadRequestException('Failed to persist network policy');
    }

    return this.toSnapshot({
      teamId: updated.teamId,
      allowAnyNetwork: updated.allowAnyNetwork,
      allowedPublicIps: updated.allowedPublicIps,
      allowedCidrs: updated.allowedCidrs,
      trustProxy: updated.trustProxy,
      trustedProxyHops: updated.trustedProxyHops,
      updatedAt: updated.updatedAt as Date | undefined
    }, 'database');
  }

  async getClientIp(teamId: string, request: Request): Promise<string> {
    const policy = await this.resolvePolicy(teamId);

    if (policy.trustProxy) {
      const headerValue = request.headers['x-forwarded-for'];
      const forwarded = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;

      if (typeof forwarded === 'string' && forwarded.length > 0) {
        return this.normalizeIp(this.pickForwardedIp(forwarded, policy.trustedProxyHops));
      }
    }

    return this.normalizeIp(request.ip || request.socket.remoteAddress || '');
  }

  async assertIpAllowed(teamId: string, ip: string, wifiScan?: WifiScanSample[]) {
    const result = await this.evaluateAccess(teamId, ip, wifiScan);
    if (!result.isAllowed) {
      throw new ForbiddenException({
        code: ERROR_CODES.ATTENDANCE_NETWORK_NOT_ALLOWED,
        message: result.reason || 'Current network is not allowed for attendance'
      });
    }
  }

  async getWifiFingerprintConfig(teamId: string): Promise<WifiFingerprintConfigSnapshot> {
    const stored = await this.networkPolicyModel.findOne({ teamId }).exec();
    const anchors = this.normalizeWifiAnchors(stored?.wifiAnchors ?? []);
    const minMatchCount = this.clampInt(stored?.wifiMinMatchCount, DEFAULT_WIFI_MIN_MATCH, 1, 20);
    const minRssi = this.clampInt(stored?.wifiMinRssi, DEFAULT_WIFI_MIN_RSSI, -100, -30);
    return {
      teamId,
      enabled: Boolean(stored?.wifiFingerprintEnabled),
      anchors,
      minMatchCount,
      minRssi,
      updatedAt: stored?.updatedAt as Date | undefined
    };
  }

  async updateWifiFingerprintConfig(
    teamId: string,
    dto: UpdateWifiFingerprintDto
  ): Promise<WifiFingerprintConfigSnapshot> {
    const existing = await this.networkPolicyModel.findOne({ teamId }).exec();
    const incomingAnchors = this.normalizeWifiAnchors(dto.anchors ?? []);
    const mergedAnchors = dto.merge
      ? this.mergeWifiAnchors(this.normalizeWifiAnchors(existing?.wifiAnchors ?? []), incomingAnchors)
      : incomingAnchors;

    const enabled = Boolean(dto.enabled);
    if (enabled && mergedAnchors.length === 0) {
      throw new BadRequestException('启用工作室环境指纹校验前，请至少采集并保存 1 个固定 Wi-Fi 信号点。');
    }

    const minMatchCount = this.clampInt(
      dto.minMatchCount ?? existing?.wifiMinMatchCount,
      DEFAULT_WIFI_MIN_MATCH,
      1,
      20
    );
    const minRssi = this.clampInt(dto.minRssi ?? existing?.wifiMinRssi, DEFAULT_WIFI_MIN_RSSI, -100, -30);

    const basePolicy = existing
      ? {
          allowAnyNetwork: existing.allowAnyNetwork,
          allowedPublicIps: existing.allowedPublicIps,
          allowedCidrs: existing.allowedCidrs,
          trustProxy: existing.trustProxy,
          trustedProxyHops: existing.trustedProxyHops
        }
      : this.fallbackPolicy;

    const updated = await this.networkPolicyModel
      .findOneAndUpdate(
        { teamId },
        {
          $set: {
            ...basePolicy,
            wifiFingerprintEnabled: enabled,
            wifiAnchors: mergedAnchors,
            wifiMinMatchCount: minMatchCount,
            wifiMinRssi: minRssi
          }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
      .exec();

    if (!updated) {
      throw new BadRequestException('Failed to persist Wi-Fi fingerprint policy');
    }

    return {
      teamId: updated.teamId,
      enabled: Boolean(updated.wifiFingerprintEnabled),
      anchors: this.normalizeWifiAnchors(updated.wifiAnchors ?? []),
      minMatchCount: this.clampInt(updated.wifiMinMatchCount, DEFAULT_WIFI_MIN_MATCH, 1, 20),
      minRssi: this.clampInt(updated.wifiMinRssi, DEFAULT_WIFI_MIN_RSSI, -100, -30),
      updatedAt: updated.updatedAt as Date | undefined
    };
  }

  async evaluateAccess(
    teamId: string,
    ip: string,
    wifiScan?: WifiScanSample[]
  ): Promise<AttendanceAccessEvaluation> {
    const normalizedIp = this.normalizeIp(ip);
    const stored = await this.networkPolicyModel.findOne({ teamId }).exec();
    const policy = stored
      ? this.toSnapshot(
          {
            teamId: stored.teamId,
            allowAnyNetwork: stored.allowAnyNetwork,
            allowedPublicIps: stored.allowedPublicIps,
            allowedCidrs: stored.allowedCidrs,
            trustProxy: stored.trustProxy,
            trustedProxyHops: stored.trustedProxyHops,
            updatedAt: stored.updatedAt as Date | undefined
          },
          'database'
        )
      : { teamId, source: 'environment' as const, ...this.fallbackPolicy };

    const ipAllowed = this.matchIpPolicy(policy, normalizedIp);
    const anchors = this.normalizeWifiAnchors(stored?.wifiAnchors ?? []);
    const wifiFingerprintEnabled = Boolean(stored?.wifiFingerprintEnabled) && anchors.length > 0;
    const configuredAnchorCount = anchors.length;
    const minMatchCount = this.clampInt(stored?.wifiMinMatchCount, DEFAULT_WIFI_MIN_MATCH, 1, 20);
    const minRssi = this.clampInt(stored?.wifiMinRssi, DEFAULT_WIFI_MIN_RSSI, -100, -30);
    const requiredMatchCount = wifiFingerprintEnabled ? Math.min(minMatchCount, anchors.length) : 0;

    if (!ipAllowed) {
      return {
        clientIp: normalizedIp,
        isAllowed: false,
        ipAllowed: false,
        wifiFingerprintEnabled,
        wifiAllowed: !wifiFingerprintEnabled,
        matchedCount: 0,
        requiredMatchCount,
        configuredAnchorCount,
        reason: 'Current network is not allowed for attendance'
      };
    }

    if (!wifiFingerprintEnabled) {
      return {
        clientIp: normalizedIp,
        isAllowed: true,
        ipAllowed: true,
        wifiFingerprintEnabled: false,
        wifiAllowed: true,
        matchedCount: 0,
        requiredMatchCount: 0,
        configuredAnchorCount
      };
    }

    const anchorSet = new Set(anchors.map((a) => a.bssid));
    const bestRssiByBssid = new Map<string, number | undefined>();
    for (const sample of wifiScan ?? []) {
      const bssid = this.normalizeBssid(sample?.bssid);
      if (!bssid) continue;
      const rssi = typeof sample.rssi === 'number' && Number.isFinite(sample.rssi) ? sample.rssi : undefined;
      const prev = bestRssiByBssid.get(bssid);
      if (prev === undefined || (rssi !== undefined && rssi > prev)) {
        bestRssiByBssid.set(bssid, rssi);
      }
    }

    let matchedCount = 0;
    for (const [bssid, rssi] of bestRssiByBssid.entries()) {
      if (!anchorSet.has(bssid)) continue;
      if (rssi === undefined || rssi >= minRssi) {
        matchedCount += 1;
      }
    }

    const wifiAllowed = matchedCount >= requiredMatchCount;
    let reason: string | undefined;
    if (wifiAllowed) {
      reason = `已识别工作室环境（命中 ${matchedCount}/${configuredAnchorCount} 个信号点）`;
    } else if (bestRssiByBssid.size === 0) {
      reason = '已启用工作室环境指纹校验，请使用最新版 Orbit 桌面端并开启 Wi-Fi 与系统位置服务后再打卡。';
    } else {
      reason = `当前不在工作室环境内（命中 ${matchedCount}/${requiredMatchCount} 个固定信号点），请到工作室后再打卡。`;
    }

    return {
      clientIp: normalizedIp,
      isAllowed: wifiAllowed,
      ipAllowed: true,
      wifiFingerprintEnabled: true,
      wifiAllowed,
      matchedCount,
      requiredMatchCount,
      configuredAnchorCount,
      reason
    };
  }

  async isIpAllowed(teamId: string, ip: string) {
    const policy = await this.resolvePolicy(teamId);
    return this.matchIpPolicy(policy, this.normalizeIp(ip));
  }

  private matchIpPolicy(policy: PersistedNetworkPolicyInput, normalizedIp: string): boolean {
    if (policy.allowAnyNetwork) {
      return true;
    }

    if (!normalizedIp) {
      return false;
    }

    if (policy.allowedPublicIps.includes(normalizedIp)) {
      return true;
    }

    try {
      const parsedIp = ipaddr.parse(normalizedIp);
      return policy.allowedCidrs.some((cidr) => {
        const [range, prefix] = ipaddr.parseCIDR(cidr);
        return parsedIp.match(range, prefix);
      });
    } catch {
      return false;
    }
  }

  private async resolvePolicy(teamId: string): Promise<NetworkPolicySnapshot> {
    const stored = await this.networkPolicyModel.findOne({ teamId }).exec();
    if (!stored) {
      return {
        teamId,
        source: 'environment',
        ...this.fallbackPolicy
      };
    }

    return this.toSnapshot({
      teamId: stored.teamId,
      allowAnyNetwork: stored.allowAnyNetwork,
      allowedPublicIps: stored.allowedPublicIps,
      allowedCidrs: stored.allowedCidrs,
      trustProxy: stored.trustProxy,
      trustedProxyHops: stored.trustedProxyHops,
      updatedAt: stored.updatedAt as Date | undefined
    }, 'database');
  }

  private toSnapshot(policy: PersistedNetworkPolicyRecord, source: PolicySource): NetworkPolicySnapshot {
    const normalized = this.normalizePolicy({
      allowAnyNetwork: policy.allowAnyNetwork,
      allowedPublicIps: policy.allowedPublicIps,
      allowedCidrs: policy.allowedCidrs,
      trustProxy: policy.trustProxy,
      trustedProxyHops: policy.trustedProxyHops
    });

    return {
      teamId: policy.teamId,
      source,
      updatedAt: policy.updatedAt,
      ...normalized
    };
  }

  private parseCsv(value?: string | null) {
    if (!value) {
      return [] as string[];
    }

    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private normalizePolicy(input: PersistedNetworkPolicyInput): PersistedNetworkPolicyInput {
    const trustedProxyHops =
      Number.isFinite(input.trustedProxyHops) && input.trustedProxyHops > 0
        ? Math.floor(input.trustedProxyHops)
        : 1;

    return {
      allowAnyNetwork: Boolean(input.allowAnyNetwork),
      allowedPublicIps: Array.from(
        new Set((input.allowedPublicIps ?? []).map((item) => this.normalizeConfiguredIp(item)).filter(Boolean))
      ),
      allowedCidrs: Array.from(
        new Set((input.allowedCidrs ?? []).map((item) => this.normalizeConfiguredCidr(item)).filter(Boolean))
      ),
      trustProxy: Boolean(input.trustProxy),
      trustedProxyHops
    };
  }

  private assertAllowlistConfigured(policy: PersistedNetworkPolicyInput) {
    if (!policy.allowAnyNetwork && policy.allowedPublicIps.length === 0 && policy.allowedCidrs.length === 0) {
      throw new BadRequestException('At least one allowed IP or CIDR is required when network enforcement is enabled');
    }
  }

  private pickForwardedIp(forwarded: string, trustedProxyHops: number) {
    const parts = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      return '';
    }

    const index = Math.max(0, parts.length - trustedProxyHops - 1);
    return parts[index] ?? parts[0];
  }

  private normalizeConfiguredIp(ip: string) {
    const normalized = this.normalizeIp(ip);
    if (!normalized) {
      return '';
    }

    try {
      return ipaddr.parse(normalized).toString();
    } catch {
      throw new BadRequestException(`Invalid allowed IP address: ${ip}`);
    }
  }

  private normalizeConfiguredCidr(cidr: string) {
    const normalized = cidr.trim();
    if (!normalized) {
      return '';
    }

    try {
      const [range, prefix] = ipaddr.parseCIDR(normalized);
      return `${range.toString()}/${prefix}`;
    } catch {
      throw new BadRequestException(`Invalid allowed CIDR: ${cidr}`);
    }
  }

  private normalizeIp(ip: string) {
    if (!ip) {
      return '';
    }

    let normalized = ip.trim();
    const bracketedMatch = normalized.match(/^\[([^\]]+)\](?::\d+)?$/);

    if (bracketedMatch) {
      normalized = bracketedMatch[1];
    } else if (/^[^:]+:\d+$/.test(normalized)) {
      normalized = normalized.slice(0, normalized.lastIndexOf(':'));
    }

    if (normalized.startsWith('::ffff:')) {
      normalized = normalized.replace('::ffff:', '');
    }

    try {
      return ipaddr.parse(normalized).toString();
    } catch {
      return normalized;
    }
  }

  private normalizeBssid(raw?: string): string {
    if (typeof raw !== 'string') return '';
    const cleaned = raw.trim().toLowerCase().replace(/-/g, ':');
    return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(cleaned) ? cleaned : '';
  }

  private normalizeWifiAnchors(items: WifiAnchorEntry[]): WifiAnchorEntry[] {
    const byBssid = new Map<string, WifiAnchorEntry>();
    for (const item of items) {
      const bssid = this.normalizeBssid(item?.bssid);
      if (!bssid) continue;
      const ssid = typeof item.ssid === 'string' && item.ssid.trim() ? item.ssid.trim().slice(0, 128) : undefined;
      const sampleRssi =
        typeof item.sampleRssi === 'number' && Number.isFinite(item.sampleRssi)
          ? Math.max(-120, Math.min(0, Math.round(item.sampleRssi)))
          : undefined;
      const prev = byBssid.get(bssid);
      if (!prev) {
        byBssid.set(bssid, { bssid, ssid, sampleRssi });
      } else {
        byBssid.set(bssid, {
          bssid,
          ssid: ssid || prev.ssid,
          sampleRssi:
            sampleRssi !== undefined && (prev.sampleRssi === undefined || sampleRssi > prev.sampleRssi)
              ? sampleRssi
              : prev.sampleRssi
        });
      }
    }
    return [...byBssid.values()].slice(0, 80);
  }

  private mergeWifiAnchors(existing: WifiAnchorEntry[], incoming: WifiAnchorEntry[]): WifiAnchorEntry[] {
    return this.normalizeWifiAnchors([...existing, ...incoming]);
  }

  private clampInt(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value)));
  }
}

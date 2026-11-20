import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@lecpunch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkPolicyService } from './network-policy.service';

const findOne = vi.fn();
const findOneAndUpdate = vi.fn();

const createService = (config: Record<string, unknown>) =>
  new NetworkPolicyService(new ConfigService(config), { findOne, findOneAndUpdate } as any);

describe('NetworkPolicyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows all networks when environment enforcement is disabled', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null)
    });

    const service = createService({
      ALLOW_ANY_NETWORK: true
    });

    await expect(service.isIpAllowed('team-1', '203.0.113.10')).resolves.toBe(true);
    await expect(service.isIpAllowed('team-1', '')).resolves.toBe(true);
  });

  it('matches exact IPs and CIDRs from the environment fallback', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null)
    });

    const service = createService({
      ALLOW_ANY_NETWORK: false,
      ALLOWED_PUBLIC_IPS: '203.0.113.10',
      ALLOWED_CIDRS: '192.168.0.0/16'
    });

    await expect(service.isIpAllowed('team-1', '::ffff:203.0.113.10')).resolves.toBe(true);
    await expect(service.isIpAllowed('team-1', '192.168.10.20')).resolves.toBe(true);
    await expect(service.isIpAllowed('team-1', '198.51.100.99')).resolves.toBe(false);
  });

  it('prefers stored team policy over the environment fallback', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        allowAnyNetwork: false,
        allowedPublicIps: ['198.51.100.8'],
        allowedCidrs: [],
        trustProxy: true,
        trustedProxyHops: 2,
        updatedAt: new Date('2026-04-11T00:00:00.000Z')
      })
    });

    const service = createService({
      ALLOW_ANY_NETWORK: true,
      ALLOWED_PUBLIC_IPS: '203.0.113.10'
    });

    await expect(service.isIpAllowed('team-1', '198.51.100.8')).resolves.toBe(true);
    await expect(service.isIpAllowed('team-1', '203.0.113.10')).resolves.toBe(false);

    const clientIp = await service.getClientIp(
      'team-1',
      {
        headers: {
          'x-forwarded-for': '198.51.100.10, 10.0.0.2, 10.0.0.3'
        },
        ip: '::ffff:127.0.0.1',
        socket: {
          remoteAddress: '::ffff:127.0.0.1'
        }
      } as any
    );

    expect(clientIp).toBe('198.51.100.10');
  });

  it('returns environment source for admin reads before customization', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null)
    });

    const service = createService({
      ALLOW_ANY_NETWORK: false,
      ALLOWED_PUBLIC_IPS: '203.0.113.10'
    });

    await expect(service.getAdminPolicy('team-1')).resolves.toMatchObject({
      teamId: 'team-1',
      source: 'environment',
      allowAnyNetwork: false,
      allowedPublicIps: ['203.0.113.10']
    });
  });

  it('normalizes and persists admin policy updates', async () => {
    findOneAndUpdate.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        allowAnyNetwork: false,
        allowedPublicIps: ['203.0.113.10'],
        allowedCidrs: ['192.168.0.0/16'],
        trustProxy: true,
        trustedProxyHops: 2,
        updatedAt: new Date('2026-04-11T00:00:00.000Z')
      })
    });

    const service = createService({
      ALLOW_ANY_NETWORK: false,
      ALLOWED_PUBLIC_IPS: '203.0.113.10'
    });

    const result = await service.updateAdminPolicy('team-1', {
      allowAnyNetwork: false,
      allowedPublicIps: [' ::ffff:203.0.113.10 '],
      allowedCidrs: [' 192.168.0.0/16 '],
      trustProxy: true,
      trustedProxyHops: 2
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { teamId: 'team-1' },
      {
        $set: {
          allowAnyNetwork: false,
          allowedPublicIps: ['203.0.113.10'],
          allowedCidrs: ['192.168.0.0/16'],
          trustProxy: true,
          trustedProxyHops: 2
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    expect(result).toMatchObject({
      source: 'database',
      allowedPublicIps: ['203.0.113.10'],
      allowedCidrs: ['192.168.0.0/16']
    });
  });

  it('rejects updates that enable enforcement without any allowlist', async () => {
    const service = createService({
      ALLOW_ANY_NETWORK: false,
      ALLOWED_PUBLIC_IPS: '203.0.113.10'
    });

    await expect(
      service.updateAdminPolicy('team-1', {
        allowAnyNetwork: false,
        allowedPublicIps: [],
        allowedCidrs: [],
        trustProxy: false,
        trustedProxyHops: 1
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws a stable forbidden error code for disallowed networks', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue(null)
    });

    const service = createService({
      ALLOW_ANY_NETWORK: false,
      ALLOWED_PUBLIC_IPS: '203.0.113.10'
    });

    await expect(service.assertIpAllowed('team-1', '198.51.100.99')).rejects.toBeInstanceOf(ForbiddenException);

    try {
      await service.assertIpAllowed('team-1', '198.51.100.99');
    } catch (error) {
      expect(error).toMatchObject({
        response: {
          code: ERROR_CODES.ATTENDANCE_NETWORK_NOT_ALLOWED
        }
      });
    }
  });

  it('enforces studio Wi-Fi fingerprint matching when enabled even if IP allowAnyNetwork is true', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        allowAnyNetwork: true,
        allowedPublicIps: [],
        allowedCidrs: [],
        trustProxy: true,
        trustedProxyHops: 1,
        wifiFingerprintEnabled: true,
        wifiAnchors: [
          { bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Campus-5G', sampleRssi: -55 },
          { bssid: 'aa:bb:cc:dd:ee:02', ssid: 'Campus-2G', sampleRssi: -60 },
          { bssid: 'aa:bb:cc:dd:ee:03', ssid: 'Lab-AP', sampleRssi: -65 }
        ],
        wifiMinMatchCount: 2,
        wifiMinRssi: -80
      })
    });

    const service = createService({ ALLOW_ANY_NETWORK: true });

    // 命中 2 个固定 AP 且信号达标 -> 放行
    const ok = await service.evaluateAccess('team-1', '1.2.3.4', [
      { bssid: 'AA-BB-CC-DD-EE-01', rssi: -58 },
      { bssid: 'aa:bb:cc:dd:ee:03', rssi: -75 }
    ]);
    expect(ok.isAllowed).toBe(true);
    expect(ok.matchedCount).toBe(2);
    await expect(
      service.assertIpAllowed('team-1', '1.2.3.4', [
        { bssid: 'AA:BB:CC:DD:EE:01', rssi: -58 },
        { bssid: 'aa:bb:cc:dd:ee:03', rssi: -75 }
      ])
    ).resolves.toBeUndefined();

    // 信号过弱（-89 dBm < -80 dBm）仅命中 1 个 -> 拦截
    const weak = await service.evaluateAccess('team-1', '1.2.3.4', [
      { bssid: 'aa:bb:cc:dd:ee:01', rssi: -60 },
      { bssid: 'aa:bb:cc:dd:ee:02', rssi: -89 }
    ]);
    expect(weak.isAllowed).toBe(false);
    expect(weak.matchedCount).toBe(1);

    // 未上报 wifiScan -> 拦截
    await expect(service.assertIpAllowed('team-1', '1.2.3.4')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('merges and validates admin Wi-Fi fingerprint updates', async () => {
    findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        allowAnyNetwork: true,
        allowedPublicIps: [],
        allowedCidrs: [],
        trustProxy: false,
        trustedProxyHops: 1,
        wifiFingerprintEnabled: false,
        wifiAnchors: [{ bssid: 'aa:bb:cc:dd:ee:01', ssid: 'AP-1', sampleRssi: -60 }],
        wifiMinMatchCount: 2,
        wifiMinRssi: -82
      })
    });

    const service = createService({ ALLOW_ANY_NETWORK: true });

    await expect(
      service.updateWifiFingerprintConfig('team-1', {
        enabled: true,
        anchors: [],
        merge: false
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    findOneAndUpdate.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        wifiFingerprintEnabled: true,
        wifiAnchors: [
          { bssid: 'aa:bb:cc:dd:ee:01', ssid: 'AP-1', sampleRssi: -60 },
          { bssid: 'aa:bb:cc:dd:ee:02', ssid: 'AP-2', sampleRssi: -55 }
        ],
        wifiMinMatchCount: 2,
        wifiMinRssi: -80,
        updatedAt: new Date('2026-11-20T08:00:00.000Z')
      })
    });

    const saved = await service.updateWifiFingerprintConfig('team-1', {
      enabled: true,
      anchors: [{ bssid: 'AA-BB-CC-DD-EE-02', ssid: 'AP-2', sampleRssi: -55 }],
      minMatchCount: 2,
      minRssi: -80,
      merge: true
    });
    expect(saved.enabled).toBe(true);
    expect(saved.anchors).toHaveLength(2);
  });
});

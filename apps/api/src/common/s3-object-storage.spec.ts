import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinS3Key, S3ObjectStorage } from './s3-object-storage';

describe('S3ObjectStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes prefixes with joinS3Key', () => {
    expect(joinS3Key('/punch/cards/20261027-v1/', '/n-shield.png')).toBe('punch/cards/20261027-v1/n-shield.png');
    expect(joinS3Key('', '/test.png')).toBe('test.png');
  });

  it('returns null fromConfig when S3 env vars are omitted', () => {
    const config = new ConfigService({});
    expect(S3ObjectStorage.fromConfig(config)).toBeNull();
  });

  it('signs and executes PUT, GET, DELETE against path-style S3 endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.from('png-bytes'), { status: 200, headers: { 'content-type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const storage = new S3ObjectStorage({
      endpoint: 'http://rustfs.lec-storage.svc.cluster.local:9000',
      bucket: 'lec-private',
      region: 'us-east-1',
      accessKeyId: 'lec-punch-storage',
      secretAccessKey: 'test-secret-key'
    });

    await storage.putObject('punch/reports/demo.png', Buffer.from('png-bytes'), 'image/png');
    const obj = await storage.getObject('punch/reports/demo.png');
    expect(obj?.body.toString()).toBe('png-bytes');
    expect(obj?.contentType).toBe('image/png');

    expect(await storage.getObject('punch/reports/missing.png')).toBeNull();
    await storage.deleteObject('punch/reports/demo.png');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [putUrl, putInit] = fetchMock.mock.calls[0]!;
    expect(putUrl).toBe('http://rustfs.lec-storage.svc.cluster.local:9000/lec-private/punch/reports/demo.png');
    expect((putInit?.headers as Record<string, string>).Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=lec-punch-storage\//);
  });
});

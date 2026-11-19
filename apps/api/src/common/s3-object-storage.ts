/** 轻量零依赖 S3 兼容对象存储客户端（AWS SigV4 path-style），用于对接集群统一 RustFS 私有桶。 */
import { createHash, createHmac } from 'crypto';
import type { ConfigService } from '@nestjs/config';

export interface S3ObjectStorageConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface S3ObjectPayload {
  body: Buffer;
  contentType?: string;
}

function hmacSha256(key: Buffer | string, message: string): Buffer {
  return createHmac('sha256', key).update(message, 'utf8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function encodeS3Key(key: string): string {
  return key
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export function joinS3Key(prefix: string, name: string): string {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  const cleanName = name.replace(/^\/+/, '');
  return cleanPrefix ? `${cleanPrefix}/${cleanName}` : cleanName;
}

export class S3ObjectStorage {
  private readonly baseUrl: URL;

  constructor(private readonly cfg: S3ObjectStorageConfig) {
    this.baseUrl = new URL(cfg.endpoint.replace(/\/+$/, ''));
  }

  static fromConfig(config: ConfigService): S3ObjectStorage | null {
    const endpoint = config.get<string>('LEC_S3_ENDPOINT')?.trim();
    const bucket = config.get<string>('LEC_S3_BUCKET')?.trim();
    const accessKeyId = config.get<string>('LEC_S3_ACCESS_KEY')?.trim();
    const secretAccessKey = config.get<string>('LEC_S3_SECRET_KEY')?.trim();
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      return null;
    }
    const region = config.get<string>('LEC_S3_REGION')?.trim() || 'us-east-1';
    return new S3ObjectStorage({ endpoint, bucket, region, accessKeyId, secretAccessKey });
  }

  private signHeaders(method: 'GET' | 'PUT' | 'DELETE', key: string, body: Buffer, contentType?: string) {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const canonicalUri = `/${this.cfg.bucket}/${encodeS3Key(key)}`;
    const payloadHash = sha256Hex(body);

    const headers: Record<string, string> = {
      host: this.baseUrl.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    };
    if (contentType) {
      headers['content-type'] = contentType;
    }

    const signedKeys = Object.keys(headers).sort();
    const canonicalHeaders = signedKeys.map((k) => `${k}:${headers[k]}\n`).join('');
    const signedHeaders = signedKeys.join(';');
    const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const credentialScope = `${dateStamp}/${this.cfg.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

    const kDate = hmacSha256(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.cfg.region);
    const kService = hmacSha256(kRegion, 's3');
    const kSigning = hmacSha256(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

    const requestHeaders: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    };
    if (contentType) {
      requestHeaders['content-type'] = contentType;
    }
    return { url: `${this.baseUrl.origin}${canonicalUri}`, headers: requestHeaders };
  }

  async getObject(key: string): Promise<S3ObjectPayload | null> {
    const { url, headers } = this.signHeaders('GET', key, Buffer.alloc(0));
    const response = await fetch(url, { method: 'GET', headers });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`S3 GET ${key} failed with HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      body: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') ?? undefined
    };
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const { url, headers } = this.signHeaders('PUT', key, body, contentType);
    const response = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });
    if (!response.ok) {
      throw new Error(`S3 PUT ${key} failed with HTTP ${response.status}`);
    }
  }

  async deleteObject(key: string): Promise<void> {
    const { url, headers } = this.signHeaders('DELETE', key, Buffer.alloc(0));
    const response = await fetch(url, { method: 'DELETE', headers });
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 DELETE ${key} failed with HTTP ${response.status}`);
    }
  }
}

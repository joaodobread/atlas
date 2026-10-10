import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StorageConfig } from '../../config/AppConfig.ts';
import type { IObjectStorage, StoredObject, Visibility } from './IObjectStorage.ts';

/** S3 e compatíveis (RustFS, MinIO, Cloudflare R2, Garage…). */
export class S3ObjectStorage implements IObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      // Sem chaves: cadeia padrão da AWS (variáveis, IAM role da instância/tarefa…).
      ...(config.accessKey && config.secretKey ? { credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey } } : {}),
    });
  }

  async ensureBuckets(): Promise<void> {
    if (!this.config.autoCreateBuckets) return;
    for (const visibility of ['private', 'public'] as const) {
      const bucket = this.bucket(visibility);
      const exists = await this.client.send(new HeadBucketCommand({ Bucket: bucket })).then(
        () => true,
        () => false,
      );
      if (!exists) {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
        console.log(`[storage] bucket ${bucket} criado`);
      }
      if (visibility === 'public') {
        // Leitura anônima só de objetos (sem listagem) no bucket público.
        const policy = {
          Version: '2012-10-17',
          Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${bucket}/*`] }],
        };
        await this.client
          .send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: JSON.stringify(policy) }))
          .catch((err: Error) => console.warn(`[storage] não foi possível aplicar a política pública em ${bucket}: ${err.message}`));
      }
    }
  }

  async put(visibility: Visibility, key: string, body: Uint8Array | string, contentType: string): Promise<StoredObject> {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket(visibility), Key: key, Body: bytes, ContentType: contentType }));
    return { key, visibility, size: bytes.byteLength, contentType };
  }

  async get(visibility: Visibility, key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(visibility), Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async delete(visibility: Visibility, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(visibility), Key: key }));
  }

  async list(visibility: Visibility, prefix: string): Promise<Array<{ key: string; size: number }>> {
    const out: Array<{ key: string; size: number }> = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket(visibility), Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private bucket(visibility: Visibility): string {
    return visibility === 'public' ? this.config.publicBucket : this.config.privateBucket;
  }
}

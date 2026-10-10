import {
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetBucketPolicyCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageConfig } from '../../config/AppConfig.ts';
import { S3ObjectStorage } from './S3ObjectStorage.ts';

const ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const PRIVATE = 'cg-test-a-private';
const PUBLIC = 'cg-test-a-public';

const config = (over: Partial<StorageConfig> = {}): StorageConfig => ({
  endpoint: ENDPOINT,
  region: 'us-east-1',
  accessKey: 'commgraph',
  secretKey: 'commgraph-secret',
  forcePathStyle: true,
  privateBucket: PRIVATE,
  publicBucket: PUBLIC,
  publicBaseUrl: `${ENDPOINT}/${PUBLIC}`,
  autoCreateBuckets: true,
  ...over,
});

const admin = new S3Client({
  region: 'us-east-1',
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: 'commgraph', secretAccessKey: 'commgraph-secret' },
});

const bucketExists = (bucket: string) =>
  admin.send(new HeadBucketCommand({ Bucket: bucket })).then(
    () => true,
    () => false,
  );

async function dropBucket(bucket: string): Promise<void> {
  if (!(await bucketExists(bucket))) return;
  const res = await admin.send(new ListObjectsV2Command({ Bucket: bucket }));
  for (const o of res.Contents ?? []) await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key }));
  await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
}

describe('S3ObjectStorage', () => {
  beforeAll(async () => {
    await dropBucket(PRIVATE);
    await dropBucket(PUBLIC);
  });

  afterAll(async () => {
    await dropBucket(PRIVATE);
    await dropBucket(PUBLIC);
    admin.destroy();
  });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return () => vi.restoreAllMocks();
  });

  it('com autoCreateBuckets=false não cria nenhum bucket', async () => {
    await new S3ObjectStorage(config({ autoCreateBuckets: false })).ensureBuckets();
    expect(await bucketExists(PRIVATE)).toBe(false);
    expect(await bucketExists(PUBLIC)).toBe(false);
  });

  it('ensureBuckets cria os dois buckets e aplica leitura pública só no público', async () => {
    const storage = new S3ObjectStorage(config());
    await storage.ensureBuckets();
    expect(await bucketExists(PRIVATE)).toBe(true);
    expect(await bucketExists(PUBLIC)).toBe(true);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`bucket ${PRIVATE} criado`));

    const policy = JSON.parse((await admin.send(new GetBucketPolicyCommand({ Bucket: PUBLIC }))).Policy!) as {
      Statement: Array<{ Effect: string; Action: string[] | string; Resource: string[] | string }>;
    };
    const st = policy.Statement[0];
    expect(st.Effect).toBe('Allow');
    expect([st.Action].flat()).toContain('s3:GetObject');
    expect([st.Resource].flat()).toContain(`arn:aws:s3:::${PUBLIC}/*`);
    await expect(admin.send(new GetBucketPolicyCommand({ Bucket: PRIVATE }))).rejects.toThrow(/polic/i);
  });

  it('ensureBuckets é idempotente (buckets já existentes não são recriados)', async () => {
    const storage = new S3ObjectStorage(config());
    await storage.ensureBuckets();
    vi.mocked(console.log).mockClear();
    await storage.ensureBuckets();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('ensureBuckets só avisa (não falha) quando a política pública é recusada', async () => {
    const storage = new S3ObjectStorage(config());
    const client = (storage as unknown as { client: S3Client }).client;
    const original = client.send.bind(client) as (cmd: unknown) => Promise<unknown>;
    vi.spyOn(client, 'send').mockImplementation(((cmd: unknown) =>
      cmd instanceof PutBucketPolicyCommand ? Promise.reject(new Error('NotImplemented')) : original(cmd)) as never);
    await expect(storage.ensureBuckets()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`política pública em ${PUBLIC}: NotImplemented`));
  });

  it('ensureBuckets propaga erro ao criar bucket (credencial inválida)', async () => {
    const bad = new S3ObjectStorage(config({ privateBucket: 'cg-test-a-bad', secretKey: 'errada' }));
    await expect(bad.ensureBuckets()).rejects.toThrow(/signature/i);
    expect(await bucketExists('cg-test-a-bad')).toBe(false);
  });

  describe('objetos', () => {
    const storage = new S3ObjectStorage(config());
    beforeAll(async () => storage.ensureBuckets());

    it('put/get com texto e bytes, separando os buckets por visibilidade', async () => {
      const a = await storage.put('private', 'docs/a.md', '# Olá ✓', 'text/markdown');
      expect(a).toEqual({ key: 'docs/a.md', visibility: 'private', size: new TextEncoder().encode('# Olá ✓').byteLength, contentType: 'text/markdown' });
      const bytes = new Uint8Array([0, 1, 2, 255]);
      const b = await storage.put('public', 'img/b.bin', bytes, 'application/octet-stream');
      expect(b.size).toBe(4);

      expect(new TextDecoder().decode(await storage.get('private', 'docs/a.md'))).toBe('# Olá ✓');
      expect(Array.from((await storage.get('public', 'img/b.bin'))!)).toEqual([0, 1, 2, 255]);
      expect(await storage.get('public', 'docs/a.md')).toBeNull();
    });

    it('get de chave inexistente devolve null', async () => {
      expect(await storage.get('private', 'nao/existe.txt')).toBeNull();
    });

    it('get propaga outros erros (ex.: bucket inexistente)', async () => {
      const other = new S3ObjectStorage(config({ privateBucket: 'cg-test-a-nao-existe' }));
      await expect(other.get('private', 'x')).rejects.toThrow(/bucket/i);
    });

    it('list filtra por prefixo e devolve tamanhos; delete remove', async () => {
      await storage.put('private', 'lista/1.txt', 'um', 'text/plain');
      await storage.put('private', 'lista/2.txt', 'dois', 'text/plain');
      await storage.put('private', 'outra/3.txt', 'três', 'text/plain');
      const listed = await storage.list('private', 'lista/');
      expect(listed.sort((x, y) => x.key.localeCompare(y.key))).toEqual([
        { key: 'lista/1.txt', size: 2 },
        { key: 'lista/2.txt', size: 4 },
      ]);
      await storage.delete('private', 'lista/1.txt');
      expect((await storage.list('private', 'lista/')).map((o) => o.key)).toEqual(['lista/2.txt']);
      expect(await storage.get('private', 'lista/1.txt')).toBeNull();
      expect(await storage.list('private', 'vazio/')).toEqual([]);
    });

    it('list percorre várias páginas (IsTruncated/ContinuationToken)', async () => {
      // Simula paginação sem criar mais de 1000 objetos.
      const client = (storage as unknown as { client: S3Client }).client;
      const send = vi.spyOn(client, 'send');
      send
        .mockImplementationOnce(async () => ({ Contents: [{ Key: 'p/1', Size: 1 }, { Size: 9 }], IsTruncated: true, NextContinuationToken: 't1' }))
        .mockImplementationOnce(async () => ({ Contents: [{ Key: 'p/2' }], IsTruncated: false }));
      expect(await storage.list('private', 'p/')).toEqual([
        { key: 'p/1', size: 1 },
        { key: 'p/2', size: 0 },
      ]);
      expect(send).toHaveBeenCalledTimes(2);
      const second = send.mock.calls[1][0] as unknown as { input: { ContinuationToken?: string } };
      expect(second.input.ContinuationToken).toBe('t1');
      send.mockRestore();
    });

    it('get devolve null quando a resposta vem sem corpo', async () => {
      const client = (storage as unknown as { client: S3Client }).client;
      const send = vi.spyOn(client, 'send').mockImplementationOnce(async () => ({}));
      expect(await storage.get('private', 'qualquer')).toBeNull();
      send.mockRestore();
    });

    it('objeto público pode ser lido anonimamente pela publicUrl', async () => {
      await storage.put('public', 'pasta/arq público.txt', 'aberto', 'text/plain');
      const res = await fetch(storage.publicUrl('pasta/arq público.txt'));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('aberto');
    });
  });

  it('publicUrl codifica cada segmento da chave mantendo as barras', () => {
    const storage = new S3ObjectStorage(config({ publicBaseUrl: 'https://cdn.exemplo.com/pub' }));
    expect(storage.publicUrl('a b/c#d/e.png')).toBe('https://cdn.exemplo.com/pub/a%20b/c%23d/e.png');
  });

  it('aceita configuração sem endpoint e sem chaves (cadeia padrão da AWS)', () => {
    const storage = new S3ObjectStorage(config({ endpoint: null, accessKey: null, secretKey: null }));
    expect(storage.publicUrl('x')).toBe(`${ENDPOINT}/${PUBLIC}/x`);
  });
});

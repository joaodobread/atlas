import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfig } from './AppConfig.ts';

const NO_FILE = '/nao/existe/.env';
const DB = 'postgres://u:p@localhost:5432/comm';
const load = (env: Record<string, string | undefined> = {}) => AppConfig.fromEnv({ DATABASE_URL: DB, ...env }, NO_FILE);

describe('AppConfig.fromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('aplica os defaults', () => {
    const c = load();
    expect(c.env).toBe('development');
    expect(c.isProduction).toBe(false);
    expect(c.port).toBe(3001);
    expect(c.trustProxy).toBe('loopback');
    expect(c.database).toEqual({ url: DB, ssl: 'disable', sslCa: null, poolMax: 10 });
    expect(c.storage).toEqual({
      endpoint: null,
      region: 'us-east-1',
      accessKey: null,
      secretKey: null,
      forcePathStyle: true,
      privateBucket: 'comm-graph-private',
      publicBucket: 'comm-graph-public',
      publicBaseUrl: 'https://comm-graph-public.s3.us-east-1.amazonaws.com',
      autoCreateBuckets: true,
    });
    expect(c.staticDir).toBe(path.resolve('dist/web'));
    expect(c.embeddingModel).toBe('Xenova/multilingual-e5-small');
    expect(c.modelsDir).toBe(path.resolve('data/models'));
    expect(c.llm).toEqual({ provider: 'none' });
    expect(c.llmMentions).toBe(false);
    expect(c.appSecret).toBeUndefined();
    expect(c.secretKeyFile).toBe(path.resolve('data/secret.key'));
    expect(c.cookieSecure).toBe(false);
    expect(c.sessionDays).toBe(30);
  });

  it('lê valores explícitos', () => {
    const c = load({
      NODE_ENV: 'test',
      PORT: '8080',
      APP_SECRET: 'x'.repeat(16),
      COOKIE_SECURE: 'true',
      SESSION_DAYS: '7',
      DATABASE_SSL: 'verify-full',
      DATABASE_SSL_CA: ' /ca.pem ',
      DATABASE_POOL_MAX: '20',
      S3_ACCESS_KEY: 'ak',
      S3_SECRET_KEY: 'sk',
      S3_FORCE_PATH_STYLE: 'false',
      S3_AUTO_CREATE_BUCKETS: 'false',
      S3_REGION: 'sa-east-1',
      MODELS_DIR: '/models',
      SECRET_KEY_FILE: '/secret.key',
    });
    expect(c.env).toBe('test');
    expect(c.port).toBe(8080);
    expect(c.appSecret).toBe('x'.repeat(16));
    expect(c.cookieSecure).toBe(true);
    expect(c.sessionDays).toBe(7);
    expect(c.database).toEqual({ url: DB, ssl: 'verify-full', sslCa: '/ca.pem', poolMax: 20 });
    expect(c.storage).toMatchObject({ accessKey: 'ak', secretKey: 'sk', forcePathStyle: false, autoCreateBuckets: false, region: 'sa-east-1' });
    expect(c.storage.publicBaseUrl).toBe('https://comm-graph-public.s3.sa-east-1.amazonaws.com');
    expect(c.modelsDir).toBe('/models');
    expect(c.secretKeyFile).toBe('/secret.key');
  });

  it('trata strings vazias como ausentes', () => {
    const c = load({ APP_SECRET: '  ', S3_ENDPOINT: '', DATABASE_SSL_CA: '' });
    expect(c.appSecret).toBeUndefined();
    expect(c.storage.endpoint).toBeNull();
    expect(c.database.sslCa).toBeNull();
  });

  it('agrega as mensagens de validação', () => {
    let message = '';
    try {
      AppConfig.fromEnv({ PORT: '0', APP_SECRET: 'curto', DATABASE_URL: 'nope' }, NO_FILE);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^Configuração inválida:\n/);
    expect(message).toContain('  - PORT:');
    expect(message).toContain('  - APP_SECRET: APP_SECRET precisa de 16+ caracteres');
    expect(message).toContain('  - DATABASE_URL: DATABASE_URL precisa ser uma URL postgres://');
  });

  it('exige DATABASE_URL', () => {
    expect(() => AppConfig.fromEnv({}, NO_FILE)).toThrow(/DATABASE_URL/);
  });

  it('em produção exige APP_SECRET com 32+ caracteres', () => {
    expect(() => load({ NODE_ENV: 'production' })).toThrow(/APP_SECRET com 32\+/);
    expect(() => load({ NODE_ENV: 'production', APP_SECRET: 'x'.repeat(31) })).toThrow(/APP_SECRET/);
    const c = load({ NODE_ENV: 'production', APP_SECRET: 'x'.repeat(32) });
    expect(c.isProduction).toBe(true);
  });

  it.each([
    ['2', 2],
    ['true', true],
    ['false', false],
    ['10.0.0.0/8, 127.0.0.1', '10.0.0.0/8, 127.0.0.1'],
    [' 1 ', 1],
  ])('interpreta TRUST_PROXY=%j', (raw, expected) => {
    expect(load({ TRUST_PROXY: raw }).trustProxy).toBe(expected);
  });

  it('deriva a URL pública do endpoint (sem barra final)', () => {
    const c = load({ S3_ENDPOINT: 'http://minio:9000/', S3_BUCKET_PUBLIC: 'pub' });
    expect(c.storage.endpoint).toBe('http://minio:9000/');
    expect(c.storage.publicBaseUrl).toBe('http://minio:9000/pub');
  });

  it('usa a URL pública explícita, removendo a barra final', () => {
    const c = load({ S3_ENDPOINT: 'http://minio:9000', S3_PUBLIC_BASE_URL: 'https://cdn.example.com/files/' });
    expect(c.storage.publicBaseUrl).toBe('https://cdn.example.com/files');
  });

  it('rejeita endpoint/URL pública inválidos', () => {
    expect(() => load({ S3_ENDPOINT: 'nope' })).toThrow(/S3_ENDPOINT/);
    expect(() => load({ S3_PUBLIC_BASE_URL: 'nope' })).toThrow(/S3_PUBLIC_BASE_URL/);
    expect(() => load({ S3_FORCE_PATH_STYLE: 'yes' })).toThrow(/S3_FORCE_PATH_STYLE/);
  });

  describe('LLM', () => {
    it('anthropic usa o modelo padrão e cai para ANTHROPIC_API_KEY', () => {
      const c = load({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'ant' });
      expect(c.llm).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'ant' });
      expect(c.llmMentions).toBe(true);
    });

    it('anthropic prefere LLM_API_KEY e LLM_MODEL', () => {
      const c = load({ LLM_PROVIDER: 'anthropic', LLM_MODEL: 'm', LLM_API_KEY: 'k', ANTHROPIC_API_KEY: 'ant', LLM_MENTIONS: 'off' });
      expect(c.llm).toEqual({ provider: 'anthropic', model: 'm', apiKey: 'k' });
      expect(c.llmMentions).toBe(false);
    });

    it('openai-compatible exige base url e modelo', () => {
      expect(() => load({ LLM_PROVIDER: 'openai-compatible' })).toThrow('LLM_PROVIDER=openai-compatible exige LLM_BASE_URL e LLM_MODEL');
      expect(() => load({ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm' })).toThrow(/LLM_BASE_URL/);
      expect(() => load({ LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://localhost:11434/v1' })).toThrow(/LLM_MODEL/);
      const c = load({ LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'llama' });
      expect(c.llm).toEqual({ provider: 'openai-compatible', model: 'llama', baseUrl: 'http://localhost:11434/v1', apiKey: undefined });
    });

    it('rejeita provedor desconhecido', () => {
      expect(() => load({ LLM_PROVIDER: 'gpt' })).toThrow(/LLM_PROVIDER/);
    });
  });

  it('usa process.env por padrão (sem arquivo .env)', () => {
    vi.stubEnv('DATABASE_URL', DB);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PORT', '4321');
    expect(AppConfig.fromEnv(process.env, NO_FILE).port).toBe(4321);
  });

  it('carrega o arquivo .env quando usa process.env', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appconfig-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, 'SESSION_DAYS=9\n');
    vi.stubEnv('DATABASE_URL', DB);
    vi.stubEnv('SESSION_DAYS', undefined);
    try {
      expect(AppConfig.fromEnv(process.env, file).sessionDays).toBe(9);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

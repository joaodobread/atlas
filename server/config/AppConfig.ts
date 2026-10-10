import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const bool = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Proxy reverso confiável (express "trust proxy"): loopback, uma lista de IPs/CIDRs, ou um número de saltos. */
  TRUST_PROXY: z.string().trim().default('loopback'),
  /** Segredo para criptografar configurações sensíveis. Sem ele, uma chave é gerada em SECRET_KEY_FILE. */
  APP_SECRET: optionalString.pipe(z.string().min(16, 'APP_SECRET precisa de 16+ caracteres').optional()),
  SECRET_KEY_FILE: z.string().min(1).default('data/secret.key'),
  /** Defina como true atrás de HTTPS para o cookie de sessão ser Secure. */
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  // Postgres (local, container ou gerenciado como RDS/Aurora/Cloud SQL).
  DATABASE_URL: z.string().trim().url('DATABASE_URL precisa ser uma URL postgres://'),
  /** disable | require (TLS sem verificar) | verify-full (TLS verificando o certificado; recomendado no RDS). */
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  /** Caminho do bundle de CA (ex.: global-bundle.pem da AWS) para verify-full. */
  DATABASE_SSL_CA: optionalString,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),

  // Storage compatível com S3. Sem S3_ENDPOINT = AWS S3 (credenciais do ambiente/IAM role se as chaves faltarem).
  S3_ENDPOINT: optionalString.pipe(z.string().url().optional()),
  S3_REGION: z.string().trim().min(1).default('us-east-1'),
  S3_ACCESS_KEY: optionalString,
  S3_SECRET_KEY: optionalString,
  S3_FORCE_PATH_STYLE: bool('true'),
  /** Bucket privado: uploads, relatórios do CI, cache do modelo de embeddings. */
  S3_BUCKET_PRIVATE: z.string().trim().min(3).default('comm-graph-private'),
  /** Bucket público: só arquivos compartilhados explicitamente. */
  S3_BUCKET_PUBLIC: z.string().trim().min(3).default('comm-graph-public'),
  /** URL base pública (CDN) dos arquivos do bucket público. Vazio = endpoint/bucket. */
  S3_PUBLIC_BASE_URL: optionalString.pipe(z.string().url().optional()),
  /** Cria os buckets (e a política de leitura pública do bucket público) se não existirem. Desligue em AWS gerenciada. */
  S3_AUTO_CREATE_BUCKETS: bool('true'),

  // Embeddings locais (transformers.js). O modelo é baixado na 1ª vez para MODELS_DIR.
  EMBEDDING_MODEL: z.string().min(1).default('Xenova/multilingual-e5-small'),
  MODELS_DIR: z.string().min(1).default('data/models'),

  // LLM para responder perguntas (RAG). none = desligado.
  LLM_PROVIDER: z.enum(['none', 'anthropic', 'openai-compatible']).default('none'),
  /** auto: com LLM configurado, analisa cada documento novo/alterado para achar menções a módulos. */
  LLM_MENTIONS: z.enum(['auto', 'off']).default('auto'),
  LLM_MODEL: optionalString,
  /** openai-compatible: OpenRouter (https://openrouter.ai/api/v1), OpenAI, Ollama (http://localhost:11434/v1), LM Studio... */
  LLM_BASE_URL: optionalString.pipe(z.string().url().optional()),
  LLM_API_KEY: optionalString,
  /** anthropic: se LLM_API_KEY não vier, o SDK usa ANTHROPIC_API_KEY / perfil do `ant auth login`. */
  ANTHROPIC_API_KEY: optionalString,
});

export type LlmConfig =
  | { provider: 'none' }
  | { provider: 'anthropic'; model: string; apiKey?: string }
  | { provider: 'openai-compatible'; model: string; baseUrl: string; apiKey?: string };

export interface DatabaseConfig {
  url: string;
  ssl: 'disable' | 'require' | 'verify-full';
  sslCa: string | null;
  poolMax: number;
}

export interface StorageConfig {
  endpoint: string | null;
  region: string;
  accessKey: string | null;
  secretKey: string | null;
  forcePathStyle: boolean;
  privateBucket: string;
  publicBucket: string;
  publicBaseUrl: string;
  autoCreateBuckets: boolean;
}

export class AppConfig {
  readonly env: 'development' | 'production' | 'test';
  readonly port: number;
  readonly trustProxy: string | number | boolean;
  readonly database: DatabaseConfig;
  readonly storage: StorageConfig;
  readonly staticDir: string;
  readonly embeddingModel: string;
  readonly modelsDir: string;
  readonly llm: LlmConfig;
  readonly llmMentions: boolean;
  readonly appSecret: string | undefined;
  readonly secretKeyFile: string;
  readonly cookieSecure: boolean;
  readonly sessionDays: number;

  private constructor(env: z.infer<typeof envSchema>) {
    if (env.NODE_ENV === 'production' && (!env.APP_SECRET || env.APP_SECRET.length < 32)) {
      throw new Error('Em produção defina APP_SECRET com 32+ caracteres (criptografa as configurações sensíveis).');
    }
    this.env = env.NODE_ENV;
    this.port = env.PORT;
    this.trustProxy = /^\d+$/.test(env.TRUST_PROXY)
      ? Number(env.TRUST_PROXY)
      : env.TRUST_PROXY === 'true'
        ? true
        : env.TRUST_PROXY === 'false'
          ? false
          : env.TRUST_PROXY;
    this.database = { url: env.DATABASE_URL, ssl: env.DATABASE_SSL, sslCa: env.DATABASE_SSL_CA ?? null, poolMax: env.DATABASE_POOL_MAX };
    const endpoint = env.S3_ENDPOINT ?? null;
    this.storage = {
      endpoint,
      region: env.S3_REGION,
      accessKey: env.S3_ACCESS_KEY ?? null,
      secretKey: env.S3_SECRET_KEY ?? null,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      privateBucket: env.S3_BUCKET_PRIVATE,
      publicBucket: env.S3_BUCKET_PUBLIC,
      publicBaseUrl: (
        env.S3_PUBLIC_BASE_URL ??
        (endpoint ? `${endpoint.replace(/\/$/, '')}/${env.S3_BUCKET_PUBLIC}` : `https://${env.S3_BUCKET_PUBLIC}.s3.${env.S3_REGION}.amazonaws.com`)
      ).replace(/\/$/, ''),
      autoCreateBuckets: env.S3_AUTO_CREATE_BUCKETS,
    };
    // Só o front compilado é servido (o bundle do servidor fica em dist/server, fora daqui).
    this.staticDir = path.resolve('dist/web');
    this.embeddingModel = env.EMBEDDING_MODEL;
    this.modelsDir = path.resolve(env.MODELS_DIR);
    this.llm = AppConfig.parseLlm(env);
    this.llmMentions = env.LLM_MENTIONS === 'auto' && this.llm.provider !== 'none';
    this.appSecret = env.APP_SECRET;
    this.secretKeyFile = path.resolve(env.SECRET_KEY_FILE);
    this.cookieSecure = env.COOKIE_SECURE === 'true';
    this.sessionDays = env.SESSION_DAYS;
  }

  /** Lê .env (se existir) e valida as variáveis de ambiente. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env, envFile = '.env'): AppConfig {
    if (env === process.env && fs.existsSync(envFile)) process.loadEnvFile(envFile);
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
      const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Configuração inválida:\n${lines}`);
    }
    return new AppConfig(parsed.data);
  }

  get isProduction(): boolean {
    return this.env === 'production';
  }

  private static parseLlm(env: z.infer<typeof envSchema>): LlmConfig {
    switch (env.LLM_PROVIDER) {
      case 'anthropic':
        return { provider: 'anthropic', model: env.LLM_MODEL ?? 'claude-opus-5-5', apiKey: env.LLM_API_KEY ?? env.ANTHROPIC_API_KEY };
      case 'openai-compatible':
        if (!env.LLM_BASE_URL || !env.LLM_MODEL) {
          throw new Error('LLM_PROVIDER=openai-compatible exige LLM_BASE_URL e LLM_MODEL');
        }
        return { provider: 'openai-compatible', model: env.LLM_MODEL, baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY };
      default:
        return { provider: 'none' };
    }
  }
}

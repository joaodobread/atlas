import type { IGithubClient } from '../../infra/github/IGithubClient.ts';
import { redactSecrets } from './redactSecrets.ts';

export type CallKind = 'http' | 'sql' | 'nosql' | 'queue' | 'cache' | 'storage' | 'sdk';

export interface CodeCallSite {
  /** 1..n, usado como referência na resposta do LLM. */
  id: number;
  kind: CallKind;
  file: string;
  line: number;
  symbol: string | null;
  /** Linhas ao redor da chamada (sem segredos). */
  snippet: string;
}

export interface CodeScanResult {
  filesScanned: number;
  filesSkipped: number;
  sites: CodeCallSite[];
  /** Pastas de primeiro nível com código (candidatas a módulos). */
  folders: string[];
}

const MAX_FILES = 300;
const MAX_FILE_SIZE = 120_000;
const MAX_SITES = 250;
const MAX_SITES_PER_FILE = 6;
const CONTEXT_LINES = 3;
const CONCURRENCY = 8;

/** Padrões de chamada para fora do processo, por tipo. Ordem importa: o primeiro que casar define o tipo. */
const PATTERNS: Array<[CallKind, RegExp]> = [
  [
    'queue',
    /\b(SendMessage(Batch)?(Command)?|PublishCommand|PublishBatch|\.publish\(|sqs\.|sns\.|producer\.send\(|channel\.(publish|sendToQueue)\(|kafka\.|\.add\(\s*['"][\w-]+['"]|@SqsMessageHandler|ReceiveMessage)/,
  ],
  ['cache', /\b(redis|valkey|ioredis|glide|\.hset\(|\.hget\(|\.setex\(|\.xadd\(|RedisClient|Jedis|StringRedisTemplate)/i],
  ['storage', /\b(PutObject(Command)?|GetObject(Command)?|s3\.|S3Client|getSignedUrl|presign)/],
  [
    'nosql',
    /\b(DynamoDB(Client|DocumentClient)?|PutItem(Command)?|GetItem(Command)?|QueryCommand|ScanCommand|dynamodb\.|mongoose\.|\.collection\(|MongoClient)/,
  ],
  [
    'sql',
    /\b(\w*[Rr]epo(sitory)?\.(find\w*|save|insert|update|delete|remove|count\w*|softDelete|restore|upsert|exist\w*|increment|decrement|sum|average|minimum|maximum)\(|\.manager\.\w+\(|dataSource\.(query|transaction|getRepository)\(|\.query\(|\.execute\(|createQueryBuilder|getRepository\(|@InjectRepository|prisma\.\w+\.(find|create|update|delete|upsert)|knex\(|sequelize\.|sql\.Open|db\.(Query|Exec|QueryRow)(Context)?\(|\.(Query|Exec)Context\(|gorm\.|jdbcTemplate|EntityManager|SELECT\s+.+\s+FROM\s|INSERT\s+INTO\s|UPDATE\s+\w+\s+SET\s)/i,
  ],
  [
    'http',
    /\b(fetch\(|axios(\.\w+)?\(|got(\.\w+)?\(|superagent|http\.(Get|Post|NewRequest(WithContext)?)\(|client\.Do\(|resty\.|HttpClient|RestTemplate|WebClient|requests\.(get|post|put|delete)\(|httpx\.|this\.http\.(get|post|put|patch|delete)\(|httpService\.(get|post|put|patch|delete)\()/,
  ],
  ['sdk', /\b(new\s+(Stripe|Twilio|SESClient|SNSClient|LambdaClient|OpenAI|Anthropic)\b|admin\.messaging\(|InvokeCommand|lambda\.invoke|ses\.send)/],
];

const FUNCTION_DECL =
  /(?:async\s+)?(?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\], |]+)?\s*\{|func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(|def\s+(\w+)\s*\(|(?:public|private|protected)\s+[\w<>[\], ]+\s+(\w+)\s*\()/;

/**
 * Varredura da análise completa: lê os arquivos de código pela API e encontra as linhas que falam com o mundo
 * externo (HTTP, banco, fila, cache, storage, SDKs). Determinística; o LLM só decide o destino de cada chamada.
 */
export class CodeScanner {
  constructor(private readonly github: IGithubClient) {}

  async scan(owner: string, repo: string, sha: string, token: string, files: Array<{ path: string; size: number }>): Promise<CodeScanResult> {
    const candidates = files.filter((f) => f.size > 0 && f.size <= MAX_FILE_SIZE);
    // Prioriza caminhos com cara de integração (clients, adapters, repositories…).
    const score = (p: string) =>
      /(client|adapter|gateway|repositor|provider|integration|infra|service|queue|publisher|consumer|handler|dao|store)/i.test(p) ? 0 : 1;
    const chosen = [...candidates].sort((a, b) => score(a.path) - score(b.path) || a.path.length - b.path.length).slice(0, MAX_FILES);

    const sites: Omit<CodeCallSite, 'id'>[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, chosen.length) }, async () => {
        while (next < chosen.length && sites.length < MAX_SITES) {
          const file = chosen[next++]!;
          const text = await this.github.file(owner, repo, sha, file.path, token).catch(() => null);
          if (text) sites.push(...findSites(file.path, text));
        }
      }),
    );
    const folders = [...new Set(chosen.map((f) => topFolder(f.path)).filter((x): x is string => !!x))].slice(0, 40);
    return {
      filesScanned: Math.min(next, chosen.length),
      filesSkipped: files.length - Math.min(next, chosen.length),
      sites: sites.slice(0, MAX_SITES).map((s, i) => ({ ...s, id: i + 1 })),
      folders,
    };
  }
}

function findSites(path: string, text: string): Array<Omit<CodeCallSite, 'id'>> {
  const lines = text.split('\n');
  const out: Array<Omit<CodeCallSite, 'id'>> = [];
  let currentSymbol: string | null = null;
  for (let i = 0; i < lines.length && out.length < MAX_SITES_PER_FILE; i++) {
    const line = lines[i]!;
    const decl = FUNCTION_DECL.exec(line);
    if (decl) {
      const name = decl.slice(1).find(Boolean);
      if (name && !['if', 'for', 'while', 'switch', 'catch', 'return', 'function'].includes(name)) currentSymbol = name;
    }
    if (/^\s*(\/\/|#|\*|\/\*|import\s|from\s|require\(|package\s)/.test(line)) continue;
    // Declarações (func X(...), function x(), def x(), métodos) não são chamadas.
    if (/^\s*(export\s+)?(async\s+)?(func|function|def)\s|^\s*(public|private|protected)\s[^=]*\)\s*(:\s*[^=]+)?\{?\s*$/.test(line)) continue;
    const hit = PATTERNS.find(([, re]) => re.test(line));
    if (!hit) continue;
    // Evita repetir a mesma chamada em linhas seguidas (builders em várias linhas).
    if (out.length && out.at(-1)!.line >= i - 1) continue;
    const from = Math.max(0, i - CONTEXT_LINES);
    const to = Math.min(lines.length, i + CONTEXT_LINES + 1);
    out.push({ kind: hit[0], file: path, line: i + 1, symbol: currentSymbol, snippet: redactSecrets(lines.slice(from, to).join('\n')).slice(0, 800) });
  }
  return out;
}

/** "src/payments/payflow.client.ts" → "src/payments"; "internal/infra/sqs/x.go" → "internal/infra". */
export function topFolder(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2) return null;
  const root = ['src', 'internal', 'pkg', 'app', 'apps', 'lib', 'cmd', 'server'].includes(parts[0]!) ? 2 : 1;
  return parts.length > root ? parts.slice(0, root).join('/') : parts[0]!;
}

import type { IGithubClient } from '../../infra/github/IGithubClient.ts';
import type { ScanCheckpoint } from '../../repositories/contracts/IIntrospectionCheckpointRepository.ts';
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
  /** Análise máxima: bloco inteiro (função/método) que faz a chamada e onde ele termina. */
  code: string | null;
  endLine: number | null;
  /** Análise máxima: recurso usado, quando dá para ler do código (tabela, "POST /cobrancas", fila, bucket). */
  resource: string | null;
}

/** O que o código expõe: rota HTTP, consumidor de fila/tópico ou job agendado (análise máxima). */
export type SurfaceKind = 'http' | 'consumer' | 'job';

export interface CodeSurface {
  id: number;
  kind: SurfaceKind;
  /** "GET /pedidos/:id", nome da fila/tópico ou expressão do agendamento. */
  name: string;
  file: string;
  line: number;
  endLine: number | null;
  symbol: string | null;
  code: string | null;
}

export interface CodeScanResult {
  filesScanned: number;
  filesSkipped: number;
  sites: CodeCallSite[];
  /** Análise máxima: rotas, consumidores e jobs encontrados. */
  surfaces: CodeSurface[];
  /** Pastas de primeiro nível com código (candidatas a módulos). */
  folders: string[];
}

export interface ScanOptions {
  /** Limites (Infinity = sem limite). */
  maxFiles: number;
  maxFileSize: number;
  maxSites: number;
  maxSitesPerFile: number;
  /** Guarda o bloco inteiro e o recurso de cada chamada. */
  blocks: boolean;
  /** Procura rotas, consumidores e jobs. */
  surfaces: boolean;
}

/** Completa: amostra do código, só o trecho ao redor de cada chamada. */
export const SCAN_FULL: ScanOptions = { maxFiles: 300, maxFileSize: 120_000, maxSites: 250, maxSitesPerFile: 6, blocks: false, surfaces: false };
/** Máxima: TODOS os arquivos de código e todas as chamadas, sem limite; blocos inteiros, recursos e o que cada módulo expõe. */
export const SCAN_MAX: ScanOptions = {
  maxFiles: Infinity,
  maxFileSize: Infinity,
  maxSites: Infinity,
  maxSitesPerFile: Infinity,
  blocks: true,
  surfaces: true,
};

const CONTEXT_LINES = 3;
const CONCURRENCY = 8;
/** Blocos maiores que isso viram uma janela ao redor da linha. */
const MAX_BLOCK_LINES = 150;
const BLOCK_WINDOW = 40;
const MAX_CODE_CHARS = 20_000;
/** Salva o estado da varredura a cada tantos arquivos (para retomar depois de uma falha). */
const CHECKPOINT_EVERY = 50;

export interface ScanHooks {
  /** Estado salvo de uma varredura interrompida. */
  resume?: ScanCheckpoint;
  /** Chamado a cada {@link CHECKPOINT_EVERY} arquivos com o estado atual. */
  onCheckpoint?: (state: ScanCheckpoint) => Promise<void>;
}

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
 * Varredura do código: lê os arquivos pela API e encontra as linhas que falam com o mundo externo
 * (HTTP, banco, fila, cache, storage, SDKs) e, na análise máxima, o que cada arquivo expõe.
 * Determinística; o LLM só decide destino, módulo e interface de cada item.
 */
export class CodeScanner {
  constructor(private readonly github: IGithubClient) {}

  /** `onProgress(lidos, total)` a cada arquivo lido (para a barra de progresso). */
  async scan(
    owner: string,
    repo: string,
    sha: string,
    token: string,
    files: Array<{ path: string; size: number }>,
    onProgress?: (done: number, total: number) => void,
    options: ScanOptions = SCAN_FULL,
    hooks: ScanHooks = {},
  ): Promise<CodeScanResult> {
    const candidates = files.filter((f) => f.size > 0 && f.size <= options.maxFileSize);
    // Prioriza caminhos com cara de integração (clients, adapters, repositories…).
    const score = (p: string) =>
      /(client|adapter|gateway|repositor|provider|integration|infra|service|queue|publisher|consumer|handler|dao|store|controller|route)/i.test(p) ? 0 : 1;
    const chosen = [...candidates].sort((a, b) => score(a.path) - score(b.path) || a.path.length - b.path.length).slice(0, options.maxFiles);

    // Retomando: continua dos arquivos que faltam, com o que já foi encontrado.
    const already = new Set(hooks.resume?.files ?? []);
    const sites: Array<Omit<CodeCallSite, 'id'>> = [...(hooks.resume?.sites ?? [])];
    const surfaces: Array<Omit<CodeSurface, 'id'>> = [...(hooks.resume?.surfaces ?? [])];
    const doneFiles = chosen.filter((f) => already.has(f.path)).map((f) => f.path);
    const todo = chosen.filter((f) => !already.has(f.path));
    let next = 0;
    let read = doneFiles.length;
    let saving = Promise.resolve();
    const checkpoint = () => {
      const snapshot = { files: [...doneFiles], sites: [...sites], surfaces: [...surfaces] };
      saving = saving.then(() => hooks.onCheckpoint!(snapshot));
    };
    onProgress?.(read, chosen.length);
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
        while (next < todo.length && sites.length < options.maxSites) {
          const file = todo[next++]!;
          const text = await this.github.file(owner, repo, sha, file.path, token).catch(() => null);
          if (text) {
            sites.push(...findSites(file.path, text, options));
            if (options.surfaces) surfaces.push(...findSurfaces(file.path, text));
          }
          doneFiles.push(file.path);
          // Fora da chamada: com `?.` e sem callback, o `++` nem seria avaliado.
          read++;
          onProgress?.(read, chosen.length);
          if (hooks.onCheckpoint && read % CHECKPOINT_EVERY === 0) checkpoint();
        }
      }),
    );
    await saving;
    const folders = [...new Set(chosen.map((f) => topFolder(f.path)).filter((x): x is string => !!x))].slice(0, options.surfaces ? Infinity : 40);
    return {
      filesScanned: read,
      filesSkipped: files.length - read,
      sites: sites.slice(0, options.maxSites).map((s, i) => ({ ...s, id: i + 1 })),
      surfaces: surfaces.map((s, i) => ({ ...s, id: i + 1 })),
      folders,
    };
  }
}

function findSites(path: string, text: string, options: ScanOptions): Array<Omit<CodeCallSite, 'id'>> {
  const lines = text.split('\n');
  const out: Array<Omit<CodeCallSite, 'id'>> = [];
  let currentSymbol: string | null = null;
  let declLine: number | null = null;
  for (let i = 0; i < lines.length && out.length < options.maxSitesPerFile; i++) {
    const line = lines[i]!;
    const decl = FUNCTION_DECL.exec(line);
    if (decl) {
      const name = decl.slice(1).find(Boolean);
      if (name && !['if', 'for', 'while', 'switch', 'catch', 'return', 'function'].includes(name)) {
        currentSymbol = name;
        declLine = i;
      }
    }
    if (/^\s*(\/\/|#|\*|\/\*|import\s|from\s|require\(|package\s)/.test(line)) continue;
    // Declarações (func X(...), function x(), def x(), métodos) não são chamadas.
    if (/^\s*(export\s+)?(async\s+)?(func|function|def)\s|^\s*(public|private|protected)\s[^=]*\)\s*(:\s*[^=]+)?\{?\s*$/.test(line)) continue;
    const hit = PATTERNS.find(([, re]) => re.test(line));
    if (!hit) continue;
    // Evita repetir a mesma chamada em linhas seguidas (builders em várias linhas). `line` é 1-based: a anterior é `i`.
    if (out.length && out.at(-1)!.line >= i) continue;
    const from = Math.max(0, i - CONTEXT_LINES);
    const to = Math.min(lines.length, i + CONTEXT_LINES + 1);
    const block = options.blocks ? enclosingBlock(path, lines, i, declLine) : null;
    out.push({
      kind: hit[0],
      file: path,
      line: i + 1,
      symbol: currentSymbol,
      snippet: redactSecrets(lines.slice(from, to).join('\n')).slice(0, 800),
      code: block ? redactSecrets(lines.slice(block.start, block.end + 1).join('\n')).slice(0, MAX_CODE_CHARS) : null,
      endLine: block ? block.end + 1 : null,
      resource: options.blocks ? resourceOf(hit[0], lines.slice(from, to).join('\n')) : null,
    });
  }
  return out;
}

/**
 * Bloco que contém a linha `at`: da declaração da função até a chave que a fecha (ou, em Python, até a
 * indentação voltar). Sem declaração, chamada fora dela ou bloco grande demais: uma janela ao redor da linha.
 */
export function enclosingBlock(path: string, lines: readonly string[], at: number, declLine: number | null): { start: number; end: number } {
  const window = { start: Math.max(0, at - BLOCK_WINDOW / 4), end: Math.min(lines.length - 1, at + BLOCK_WINDOW / 4) };
  if (declLine == null) return window;
  const end = path.endsWith('.py') ? pythonBlockEnd(lines, declLine) : braceBlockEnd(lines, declLine);
  if (end == null || end < at) return window;
  if (end - declLine + 1 > MAX_BLOCK_LINES) return { start: Math.max(declLine, at - BLOCK_WINDOW), end: Math.min(end, at + BLOCK_WINDOW) };
  return { start: declLine, end };
}

/** Conta chaves (ignorando strings e comentários de linha) até voltar a zero. */
function braceBlockEnd(lines: readonly string[], start: number): number | null {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    const code = lines[i]!.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '');
    for (const ch of code) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') depth--;
    }
    if (opened && depth <= 0) return i;
  }
  return null;
}

/** Fim de um bloco Python: última linha antes de a indentação voltar ao nível da declaração. */
function pythonBlockEnd(lines: readonly string[], start: number): number | null {
  const indent = (l: string) => l.length - l.trimStart().length;
  const base = indent(lines[start]!);
  let last = start;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim()) continue;
    if (indent(l) <= base) break;
    last = i;
  }
  return last > start ? last : null;
}

/** Nome do handler numa linha de declaração (método com decorators nos parâmetros, def, func, function). */
function handlerName(line: string): string | null {
  if (/^\s*@/.test(line)) return null;
  const m = /^\s*(?:(?:public|private|protected|static|async|export|override)\s+)*(?:def\s+|func\s+(?:\([^)]*\)\s*)?|function\s+)?(\w+)\s*\(/.exec(line);
  return m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1]!) ? m[1]! : null;
}

/** Recurso que a chamada usa, quando está escrito no código: tabela, "MÉTODO /caminho", fila/tópico ou bucket. */
export function resourceOf(kind: CallKind, text: string): string | null {
  const str = (re: RegExp) => re.exec(text)?.[1] ?? null;
  switch (kind) {
    case 'sql': {
      const table = str(/\b(?:FROM|INTO|UPDATE|JOIN)\s+[`"[]?([A-Za-z_][\w.]*)/i);
      if (table && !/^(select|where|set|values)$/i.test(table)) return table;
      const entity = str(/(?:getRepository|InjectRepository)\(\s*(\w+)/) ?? str(/prisma\.(\w+)\./);
      if (entity) return entity;
      // this.animalsRepository.find(...) → "animals"
      const repo = str(/\b(\w+?)Repo(?:sitory)?\.\w+\(/);
      return repo && repo !== 'this' ? repo : null;
    }
    case 'http': {
      const path = /(["'`])((?:https?:\/\/[^"'`\s]+)|(?:\/[\w\-/{}:.$]+))\1/.exec(text)?.[2];
      if (!path) return null;
      const method =
        /\.(get|post|put|patch|delete)\(/i.exec(text)?.[1] ?? /method\s*:\s*['"](\w+)['"]/i.exec(text)?.[1] ?? /http\.(Get|Post)\(/.exec(text)?.[1] ?? 'GET';
      return `${method.toUpperCase()} ${path.replace(/^https?:\/\/[^/]+/, '') || '/'}`;
    }
    case 'queue':
      return (
        str(/(?:QueueUrl|TopicArn|queue|topic|exchange)\s*[:=]\s*["'`]([^"'`]+)["'`]/i) ??
        str(/(?:sendToQueue|publish|subscribe)\(\s*["'`]([^"'`]+)["'`]/) ??
        str(/\.add\(\s*["'`]([\w-]+)["'`]/)
      );
    case 'storage':
      return str(/Bucket\s*[:=]\s*["'`]([^"'`]+)["'`]/i);
    default:
      return null;
  }
}

/** Rotas HTTP, consumidores de fila/tópico e jobs agendados de um arquivo. */
export function findSurfaces(path: string, text: string): Array<Omit<CodeSurface, 'id'>> {
  const lines = text.split('\n');
  const out: Array<Omit<CodeSurface, 'id'>> = [];
  // Prefixos de classe: @Controller('pedidos') (Nest) e @RequestMapping("/pedidos") (Spring).
  const prefix = (
    /@Controller\(\s*['"`]([^'"`]*)['"`]/.exec(text)?.[1] ??
    /@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"\s*\)\s*\n\s*(?:public\s+)?class/.exec(text)?.[1] ??
    ''
  )
    .replace(/^\/?/, '/')
    .replace(/\/$/, '');
  const route = (method: string, p: string) =>
    `${method.toUpperCase()} ${`${prefix}/${p.replace(/^\//, '')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1') || '/'}`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let found: { kind: SurfaceKind; name: string } | null = null;
    let m: RegExpExecArray | null;
    if ((m = /\b(?:app|router|server|api|routes?)\.(get|post|put|patch|delete|all)\(\s*(['"`])([^'"`]+)\2/i.exec(line)))
      found = { kind: 'http', name: route(m[1]!, m[3]!) };
    else if ((m = /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/.exec(line))) found = { kind: 'http', name: route(m[1]!, m[3] ?? '') };
    else if ((m = /@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?(?:"([^"]*)")?/.exec(line)))
      found = { kind: 'http', name: route(m[1]!, m[2] ?? '') };
    else if ((m = /\.(GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)"/.exec(line))) found = { kind: 'http', name: route(m[1]!, m[2]!) };
    else if ((m = /HandleFunc\(\s*"([^"]+)"/.exec(line))) found = { kind: 'http', name: route('ANY', m[1]!) };
    else if ((m = /@(?:app|router|bp|blueprint)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/.exec(line)))
      found = { kind: 'http', name: route(m[1]!, m[2]!) };
    else if ((m = /@(?:app|bp|blueprint)\.route\(\s*['"]([^'"]+)['"]/.exec(line))) found = { kind: 'http', name: route('ANY', m[1]!) };
    else if (
      (m =
        /@SqsMessageHandler\(\s*['"]([^'"]+)/.exec(line) ??
        /@(?:EventPattern|MessagePattern|Process|Processor)\(\s*['"]([^'"]+)/.exec(line) ??
        /@KafkaListener\([^)]*topics\s*=\s*\{?\s*"([^"]+)"/.exec(line) ??
        /@RabbitListener\([^)]*queues\s*=\s*\{?\s*"([^"]+)"/.exec(line) ??
        /\.subscribe\(\s*\{\s*topics?\s*:\s*\[?\s*['"]([^'"]+)/.exec(line) ??
        /\.consume\(\s*['"]([^'"]+)/.exec(line) ??
        /\bnew\s+Worker\(\s*['"]([^'"]+)/.exec(line))
    )
      found = { kind: 'consumer', name: m[1]! };
    else if ((m = /@Cron\(\s*['"]?([^'")]+)/.exec(line) ?? /cron\.schedule\(\s*['"]([^'"]+)/.exec(line) ?? /@Scheduled\(([^)]*)\)/.exec(line)))
      found = { kind: 'job', name: m[1]!.trim() };
    if (!found) continue;
    // O handler começa na declaração (pode estar algumas linhas abaixo do decorator).
    const def = path.endsWith('.py') ? lines.findIndex((l, k) => k >= i && k < i + 4 && /^\s*(async\s+)?def\s/.test(l)) : -1;
    const end = path.endsWith('.py') ? (def >= 0 ? pythonBlockEnd(lines, def) : null) : braceBlockEnd(lines, i);
    const stop = end == null ? Math.min(lines.length - 1, i + 10) : Math.min(end, i + MAX_BLOCK_LINES - 1);
    const symbol =
      lines
        .slice(i + 1, i + 5)
        .map(handlerName)
        .find(Boolean) ?? null;
    out.push({
      ...found,
      file: path,
      line: i + 1,
      endLine: stop + 1,
      symbol,
      code: redactSecrets(lines.slice(i, stop + 1).join('\n')).slice(0, MAX_CODE_CHARS),
    });
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

import type { AuthUser } from '../../core/auth/AuthUser.ts';
import type { ApiTokenView, AuthStatus, CreatedApiToken, User } from '../../../shared/types.ts';
import type { ChangePasswordInput, CreateApiTokenInput, CreateUserInput, LoginInput, SetupInput, UpdateUserInput } from '../../../shared/schemas.ts';
import type {
  AskResult,
  DocumentDetail,
  DocumentSource,
  DocumentSummary,
  IndexStatus,
  LlmInfo,
  LlmSettingsView,
  LlmTestResult,
  NodeMention,
  SearchResult,
  WatchedFolder,
} from '../../../shared/types.ts';
import type { AskInput, ImportDocumentsInput, SearchQueryInput, UpdateLlmSettingsInput, UpsertDocumentInput } from '../../../shared/schemas.ts';
import type { CallSite, Connection, GraphData, GraphNode, ImportResult, NodeInterface } from '../../../shared/types.ts';
import type {
  CreateCallSiteInput,
  CreateConnectionInput,
  CreateInterfaceInput,
  CreateNodeInput,
  ExchangeDocument,
  UpdateCallSiteInput,
  UpdateConnectionInput,
  UpdateInterfaceInput,
  UpdateNodeInput,
} from '../../../shared/schemas.ts';
import type {
  GithubSettingsView,
  GithubTestResult,
  IntrospectionRunState,
  RepoIntrospectionDetail,
  RepoIntrospectionSummary,
  RepoMetricsSnapshot,
} from '../../../shared/types.ts';
import type { CreateGraphInput, GraphFromReposInput, UpdateGraphInput } from '../../../shared/schemas.ts';
import type { GraphInfo } from '../../../shared/types.ts';
import type { IngestMetricsInput, RunIntrospectionInput, StoredGithubSettings, UpdateGithubSettingsInput } from '../../../shared/schemas.ts';
import type { ICrudService } from './ICrudService.ts';

export type { ICrudService } from './ICrudService.ts';

export interface INodeService extends ICrudService<GraphNode, CreateNodeInput, UpdateNodeInput> {}
export interface IInterfaceService extends ICrudService<NodeInterface, CreateInterfaceInput, UpdateInterfaceInput> {}
export interface IConnectionService extends ICrudService<Connection, CreateConnectionInput, UpdateConnectionInput> {}
export interface ICallSiteService extends ICrudService<CallSite, CreateCallSiteInput, UpdateCallSiteInput> {}

export interface IGraphService {
  getGraph(graphId?: number): Promise<GraphData>;
}

export interface IGraphsService {
  list(): Promise<GraphInfo[]>;
  get(id: number): Promise<GraphInfo>;
  create(input: CreateGraphInput): Promise<GraphInfo>;
  update(id: number, input: UpdateGraphInput): Promise<GraphInfo>;
  delete(id: number): Promise<void>;
  generateFromRepos(input: GraphFromReposInput): Promise<GraphInfo>;
}

export interface IExchangeService {
  exportDocument(graphId: number): Promise<ExchangeDocument>;
  importDocument(doc: ExchangeDocument, graphId: number): Promise<ImportResult>;
}

// ---------- Documentos / RAG ----------
export interface UpsertDocumentData {
  path: string;
  title?: string;
  content: string;
  source: DocumentSource;
  folderId: number | null;
  /** Só para documentos do modelo do grafo. */
  nodeId?: number | null;
  /** Arquivo original no bucket privado. */
  storageKey?: string | null;
}

export interface UpsertOutcome {
  id: number;
  status: 'created' | 'updated' | 'unchanged';
}

export interface IDocumentService {
  list(): Promise<DocumentSummary[]>;
  get(id: number): Promise<DocumentDetail>;
  upsert(input: UpsertDocumentInput): Promise<UpsertOutcome>;
  importMany(input: ImportDocumentsInput): Promise<UpsertOutcome[]>;
  /** Usado internamente (pastas monitoradas). */
  upsertData(data: UpsertDocumentData): Promise<UpsertOutcome>;
  delete(id: number): Promise<void>;
  mentionsOfNode(nodeId: number): Promise<NodeMention[]>;
}

export interface IMentionService {
  /** Recalcula as menções dos trechos informados (ou de todos). */
  recompute(chunkIds?: readonly number[]): Promise<void>;
}

export interface IEmbeddingIndexer {
  /** Garante que o processamento de trechos pendentes esteja rodando em segundo plano. */
  kick(): void;
  status(): Promise<Omit<IndexStatus, 'llmMentions'>>;
}

export interface ILlmMentionExtractor {
  kick(): void;
  /** Marca todos os documentos para nova análise pelo LLM. */
  reprocessAll(): Promise<void>;
  status(): Promise<IndexStatus['llmMentions']>;
}

export interface ILlmSettingsService {
  /** Carrega a configuração salva (ou do .env) e aplica o provedor. Chame no boot. */
  init(): Promise<void>;
  view(): LlmSettingsView;
  update(input: UpdateLlmSettingsInput): Promise<LlmSettingsView>;
  /** Extração automática de menções ligada e LLM configurado. */
  mentionsEnabled(): boolean;
  test(): Promise<LlmTestResult>;
}

export interface ISearchService {
  search(input: SearchQueryInput): Promise<SearchResult>;
}

export interface IRagService {
  info(): LlmInfo;
  ask(input: AskInput): Promise<AskResult>;
}

export interface IGraphKnowledgeSync {
  /** Regenera os documentos do modelo do grafo (só reescreve os que mudaram). */
  sync(): Promise<{ created: number; updated: number; removed: number }>;
  start(): Promise<void>;
}

export interface IFolderWatchService {
  start(): Promise<void>;
  list(): Promise<WatchedFolder[]>;
  add(path: string): Promise<WatchedFolder>;
  remove(id: number): Promise<void>;
  rescan(id: number): Promise<WatchedFolder>;
}

// ---------- Usuários / autenticação ----------
export interface LoginContext {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionResult {
  /** Token opaco para o cookie (só existe na resposta do login/setup). */
  token: string;
  expiresAt: Date;
  status: AuthStatus;
}

export interface IAuthService {
  status(user: AuthUser | null): Promise<AuthStatus>;
  /** Cria o primeiro administrador (só quando não há usuários). */
  setup(input: SetupInput, ctx: LoginContext): Promise<SessionResult>;
  login(input: LoginInput, ctx: LoginContext): Promise<SessionResult>;
  logout(sessionToken: string | null): Promise<void>;
  /** Resolve o usuário a partir do cookie de sessão ou de um token de API. */
  authenticate(credentials: { sessionToken: string | null; bearerToken: string | null }): Promise<AuthUser | null>;
  changePassword(user: AuthUser, input: ChangePasswordInput): Promise<void>;
  setOnboarded(user: AuthUser, done: boolean): Promise<AuthStatus>;
}

export interface IUserService {
  list(): Promise<User[]>;
  create(input: CreateUserInput): Promise<User>;
  update(actor: AuthUser, id: number, input: UpdateUserInput): Promise<User>;
  delete(actor: AuthUser, id: number): Promise<void>;
}

export interface IApiTokenService {
  list(user: AuthUser): Promise<ApiTokenView[]>;
  create(user: AuthUser, input: CreateApiTokenInput): Promise<CreatedApiToken>;
  revoke(user: AuthUser, id: number): Promise<void>;
}

// ---------- GitHub / introspecção de repositórios ----------
export interface IGithubSettingsService {
  view(): Promise<GithubSettingsView>;
  update(input: UpdateGithubSettingsInput): Promise<GithubSettingsView>;
  test(): Promise<GithubTestResult>;
  /** Configuração com token; lança erro de regra se não houver. */
  require(): Promise<StoredGithubSettings & { token: string }>;
}

export interface IIntrospectionService {
  /** Retoma o que ficou pela metade quando o processo reiniciou. */
  start(): Promise<void>;
  list(): Promise<RepoIntrospectionSummary[]>;
  get(id: number): Promise<RepoIntrospectionDetail>;
  /** Atualiza a lista de repositórios a partir do GitHub (aplica os filtros da configuração). */
  sync(): Promise<RepoIntrospectionSummary[]>;
  /** Enfileira a análise; responde na hora, o trabalho segue em segundo plano. */
  run(input: RunIntrospectionInput): Promise<IntrospectionRunState>;
  state(): IntrospectionRunState;
  /** Cria no grafo os nós/conexões propostos para o repositório. */
  apply(id: number, graphId: number): Promise<ImportResult>;
  /** Recalcula o scorecard (e o documento) com as métricas mais recentes. */
  refreshQuality(owner: string, repo: string): Promise<void>;
}

export interface IMetricsService {
  ingest(input: IngestMetricsInput): Promise<RepoMetricsSnapshot>;
  history(owner: string, repo: string): Promise<RepoMetricsSnapshot[]>;
}

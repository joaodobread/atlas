// Entidades persistidas, compartilhadas entre servidor e UI.
import type { AnalysisDepth, IntrospectionStage, NodeKind, Permission, Role } from './constants.ts';

export type { NodeKind, Protocol } from './constants.ts';

/** Qualquer "coisa" do grafo: projeto, banco, infra, fila, módulo, submódulo... */
export interface GraphNode {
  id: number;
  /** Grafo (diagrama) ao qual o nó pertence. */
  graph_id: number;
  parent_id: number | null;
  name: string;
  kind: NodeKind;
  tech: string | null;
  /** Ícone escolhido ("si:mysql", "lu:database"). null = automático pelo tipo/tecnologia. */
  icon: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Algo que um nó expõe para ser consumido: endpoint, tabela, tópico, método RPC... */
export interface NodeInterface {
  id: number;
  node_id: number;
  name: string;
  type: string | null;
  spec: string | null;
  description: string | null;
}

/** Comunicação dirigida: source -> target. */
export interface Connection {
  id: number;
  source_id: number;
  target_id: number;
  target_interface_id: number | null;
  /** Saída de um ancestral que esta conexão implementa/refina. */
  parent_connection_id: number | null;
  protocol: string | null;
  description: string | null;
  created_at: string;
}

/** Local no código onde a chamada é feita. */
export interface CallSite {
  id: number;
  connection_id: number;
  file_path: string;
  line: number | null;
  symbol: string | null;
  snippet: string | null;
  notes: string | null;
  /** Linha onde termina o bloco de código (análise máxima). */
  end_line: number | null;
  /** Bloco inteiro (função/método) que faz a chamada, sem segredos (análise máxima). */
  code: string | null;
}

export interface GraphData {
  nodes: GraphNode[];
  interfaces: NodeInterface[];
  connections: Connection[];
  callSites: CallSite[];
}

/** Um grafo independente (diagrama), com seus próprios nós e conexões. */
export interface GraphInfo {
  id: number;
  name: string;
  description: string | null;
  nodeCount: number;
  created_at: string;
  updated_at: string;
}

export interface ImportResult {
  nodesCreated: number;
  nodesUpdated: number;
  interfacesCreated: number;
  connectionsCreated: number;
  connectionsUpdated: number;
  callSitesCreated: number;
  warnings: string[];
}

// ---------- Documentos / RAG ----------

export type DocumentSource = 'upload' | 'folder' | 'api' | 'graph';

export interface DocumentSummary {
  id: number;
  path: string;
  title: string;
  source: DocumentSource;
  folder_id: number | null;
  updated_at: string;
  chunkCount: number;
  embeddedCount: number;
  mentionCount: number;
}

export interface DocChunk {
  id: number;
  document_id: number;
  ordinal: number;
  heading: string;
  content: string;
  start_line: number;
  end_line: number;
}

export type MentionMethod = 'exact' | 'fuzzy' | 'llm';

export interface ChunkMention {
  chunk_id: number;
  node_id: number;
  /** Texto como aparece no documento (ex.: "NodApi"). */
  matched: string;
  method: MentionMethod;
  /** 0..1 (exato = 1). */
  confidence: number;
}

export interface DocumentDetail extends DocumentSummary {
  content: string;
  chunks: DocChunk[];
  mentions: ChunkMention[];
}

export interface SearchHit {
  chunkId: number;
  documentId: number;
  path: string;
  title: string;
  heading: string;
  startLine: number;
  endLine: number;
  /** Trecho com termos marcados entre [[ e ]]. */
  snippet: string;
  score: number;
  matchedBy: Array<'text' | 'semantic'>;
  mentionedNodeIds: number[];
  /** Trecho do modelo do grafo: nó descrito por ele (clicar foca o nó em vez de abrir documento). */
  nodeId: number | null;
}

export interface AffectedNode {
  nodeId: number;
  /** Em quantos resultados o nó é mencionado. */
  hits: number;
}

export interface SearchResult {
  query: string;
  mode: 'hybrid' | 'text' | 'semantic';
  hits: SearchHit[];
  affectedNodes: AffectedNode[];
  /** A busca semântica não estava disponível (modelo carregando/indisponível). */
  semanticUnavailable: boolean;
}

export interface NodeMention {
  chunkId: number;
  documentId: number;
  path: string;
  title: string;
  heading: string;
  startLine: number;
  endLine: number;
  matched: string;
  method: MentionMethod;
  confidence: number;
  excerpt: string;
}

export interface WatchedFolder {
  id: number;
  path: string;
  created_at: string;
  last_scan_at: string | null;
  documentCount: number;
}

export interface IndexStatus {
  documents: number;
  /** Nós do grafo indexados como documentos do modelo. */
  graphDocuments: number;
  chunks: number;
  embedded: number;
  pending: number;
  embeddingModel: string;
  embeddingState: 'idle' | 'loading-model' | 'indexing' | 'error';
  embeddingError: string | null;
  llmMentions: {
    enabled: boolean;
    /** Documentos ainda não analisados pelo LLM (ou alterados depois). */
    pendingDocuments: number;
    state: 'idle' | 'running' | 'error' | 'disabled';
    error: string | null;
  };
}

export type LlmProviderKind = 'none' | 'anthropic' | 'openai-compatible';

/** Configuração de LLM como a UI enxerga: a chave nunca é devolvida, só se existe e o final dela. */
export interface LlmSettingsView {
  provider: LlmProviderKind;
  model: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  /** Analisar documentos novos/alterados com o LLM para achar menções. */
  mentionsAuto: boolean;
  /** De onde vêm os valores: salvos pela interface ou só o .env. */
  source: 'database' | 'env';
}

export interface LlmTestResult {
  ok: boolean;
  latencyMs: number;
  reply: string | null;
  error: string | null;
}

export interface LlmInfo {
  configured: boolean;
  provider: 'anthropic' | 'openai-compatible' | 'none';
  model: string | null;
}

export interface AskResult {
  answer: string;
  provider: LlmInfo['provider'];
  model: string;
  /** Trechos usados como contexto (na ordem das citações [1], [2]...). */
  sources: SearchHit[];
  affectedNodes: AffectedNode[];
}

// ---------- Usuários / autenticação ----------

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
  /** Tutorial de primeiro acesso concluído (null = mostrar). */
  onboarded_at: string | null;
}

export interface AuthStatus {
  /** Nenhum usuário ainda: a tela inicial cria o primeiro administrador. */
  needsSetup: boolean;
  user: User | null;
  permissions: Permission[];
}

export interface ApiTokenView {
  id: number;
  name: string;
  /** Começo do token, para reconhecê-lo. */
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface CreatedApiToken extends ApiTokenView {
  /** Exibido uma única vez. */
  token: string;
}

// ---------- GitHub / introspecção de repositórios ----------
export interface GithubSettingsView {
  owner: string | null;
  hasToken: boolean;
  tokenHint: string | null;
  includeArchived: boolean;
  includeForks: boolean;
  pushedWithinMonths: number | null;
}

export interface GithubTestResult {
  ok: boolean;
  login: string | null;
  repoCount: number | null;
  error: string | null;
}

export type IntrospectionStatus = 'pending' | 'running' | 'done' | 'error';

/** Fatos extraídos de forma determinística dos arquivos do repositório. */
export interface RepoFacts {
  languages: string[];
  manifests: string[];
  frameworks: string[];
  runtime: { name: string; version: string } | null;
  deploy: string[];
  workflows: string[];
  envVars: string[];
  resources: Array<{ type: string; name: string }>;
  hosts: string[];
  testFiles: number;
  e2e: boolean;
  lockfiles: string[];
  updateAutomation: string | null;
  lintConfig: string[];
  hasCodeowners: boolean;
  readmeChars: number;
  hasChangelog: boolean;
  committedEnvFiles: string[];
  /** Dependências diretas com versão resolvida (do lockfile quando houver). */
  dependencies: Array<{ name: string; version: string; ecosystem: 'npm' | 'Go' }>;
  appType: 'frontend' | 'mobile' | 'service' | 'library' | 'infra' | 'docs' | 'unknown';
  /** Auditoria dos workflows do GitHub Actions. */
  workflowAudit: WorkflowAudit;
  /** Binários versionados (.exe, .jar, .so…), até 20. */
  binaryFiles: string[];
  docFiles: { security: boolean; agents: boolean; envExample: boolean; contributing: boolean };
  /** Dependências de banco/cache encontradas (pg, mysql, redis, prisma…). */
  dataStores: string[];
  /** Como os testes sobem dependências reais (testcontainers, compose, services do CI) ou null. */
  realDependencyHarness: string | null;
  /** Dados do repositório no GitHub (null = não foi possível ler). */
  github: {
    topics: string[] | null;
    secretScanning: boolean | null;
    /** Regras ativas no branch padrão (rulesets); null = não visível com o token. */
    branchRules: string[] | null;
  };
  /** Consultas a fontes públicas (null = não foi possível consultar). */
  intel: {
    vulnerabilities: Array<{ dependency: string; ids: string[] }> | null;
    freshness: { averageLibyears: number; measured: number; outdated: number } | null;
    runtimeSupport: { supported: boolean; eol: string | null; latest: string | null } | null;
  };
}

export interface WorkflowAudit {
  files: number;
  /** pull_request_target fazendo checkout do código do PR. */
  dangerousTriggers: string[];
  /** Workflows com permissions: write-all. */
  writeAll: string[];
  /** Workflows sem bloco permissions (nem no topo nem em todos os jobs). */
  missingPermissions: string[];
  /** Actions de terceiros referenciadas por tag/branch em vez de SHA. */
  unpinnedActions: string[];
  sastTools: string[];
  secretScanTools: string[];
  /** Algum workflow envia métricas ao Comm Graph. */
  sendsMetrics: boolean;
}

/** Saúde do processo de desenvolvimento numa janela recente (API do GitHub). */
export interface RepoProcess {
  windowDays: number;
  collectedAt: string;
  mergedPrs: number;
  /** PRs mesclados com aprovação de alguém que não o autor. */
  reviewedPrs: number;
  /** PRs que citam uma issue (#123, closes #123, AB#123…). */
  linkedPrs: number;
  directPushes: { sampled: number; direct: number } | null;
  commits: number;
  /** Fração dos commits do autor mais ativo (null com poucos commits). */
  topAuthorShare: number | null;
  openPrs: number;
  /** Abertos há mais de 90 dias. */
  staleOpenPrs: number;
  /** Abertos há mais de 14 dias sem nenhuma revisão. */
  unreviewedOldPrs: number;
  errors: string[];
}

export interface OpenPullInfo {
  number: number;
  title: string;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  url: string | null;
}

/** Atividade do repositório: PRs abertos (o último push já vem na lista do GitHub). */
export interface RepoActivity {
  collectedAt: string;
  /** null = não foi possível ler (ex.: token sem permissão de Pull requests). */
  openPrs: number | null;
  draftPrs: number;
  /** PRs abertos (sem rascunhos/bots) há mais de 30 dias. */
  oldPrs: number;
  /** Os mais antigos primeiro (até 10, sem rascunhos/bots). */
  pulls: OpenPullInfo[];
  error: string | null;
}

export type AttentionLevel = 'ok' | 'watch' | 'attention';

export interface RepoAttention {
  level: AttentionLevel;
  reasons: string[];
}

export type QualityCategory = 'ci' | 'tests' | 'security' | 'guardrails' | 'process' | 'docs';
export type QualityCheckStatus = 'pass' | 'fail' | 'warn' | 'na' | 'unknown';

export interface QualityCheck {
  id: string;
  category: QualityCategory;
  /** grade = entra na nota; signal = só informativo. */
  impact: 'grade' | 'signal';
  status: QualityCheckStatus;
  /** 0–10; null = não medido (não entra na média). */
  score: number | null;
  detail: string;
  fix: string | null;
}

export interface QualityReport {
  version: string;
  score: number | null;
  /** Fração dos checks aplicáveis que foram medidos (0–1). */
  confidence: number;
  categories: Array<{ category: QualityCategory; label: string; weight: number; score: number | null; checks: QualityCheck[] }>;
}

export interface ScoreHistoryPoint {
  score: number | null;
  confidence: number;
  version: string;
  createdAt: string;
}

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface TestCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

/** Métricas enviadas por um workflow, já interpretadas. */
export interface RepoMetricsSnapshot {
  id: number;
  owner: string;
  repo: string;
  sha: string;
  ref: string | null;
  runUrl: string | null;
  receivedAt: string;
  /** Chaves dos relatórios brutos (JUnit, SARIF…) no bucket privado. */
  reportKeys: string[];
  coverage: { lines: number | null; branches: number | null } | null;
  tests: Partial<Record<'unit' | 'integration' | 'e2e', TestCounts>>;
  security: Partial<Record<'sast' | 'dast' | 'sca' | 'secrets', SeverityCounts>>;
  /** Ferramentas que geraram os relatórios (ex.: semgrep, zap, rainforest). */
  tools: string[];
  mutationScore: number | null;
  flakyRate: number | null;
  lint: { errors: number; warnings: number } | null;
  /** Relatórios que não puderam ser interpretados. */
  warnings: string[];
}

export interface RepoAnalysis {
  purpose: string;
  stack: string;
  deploy: string;
  inbound: string[];
  outbound: string[];
  data: string[];
  notes: string[];
  /** 'llm' ou 'heuristic' (sem LLM configurado ou falha do LLM). */
  method: 'llm' | 'heuristic';
}

export interface ProposalNode {
  key: string;
  /** Nó que já existe no grafo (não é criado nem alterado). */
  existingId: number | null;
  name: string;
  kind: NodeKind;
  tech: string | null;
  description: string | null;
  /** key do pai dentro da proposta (null = raiz). Ignorado para nós existentes. */
  parentKey: string | null;
  /** O que o nó expõe (rotas HTTP, consumidores de fila, jobs) — análise máxima. */
  interfaces?: Array<{ name: string; type: string | null; description: string | null; spec: string | null }>;
}

/** Mudanças propostas no grafo; só são aplicadas quando alguém revisa e confirma. */
export interface RepoGraphProposal {
  nodes: ProposalNode[];
  connections: Array<{
    fromKey: string;
    toKey: string;
    protocol: string | null;
    description: string | null;
    /** Interface do destino usada (endpoint, tabela, tópico); criada se não existir. */
    interface?: string | null;
    /** Análise completa/máxima: onde no código a chamada é feita. */
    callSites?: Array<{
      file_path: string;
      line: number | null;
      symbol: string | null;
      snippet: string | null;
      end_line?: number | null;
      code?: string | null;
    }>;
  }>;
}

export interface RepoIntrospectionSummary {
  id: number;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  archived: boolean;
  pushedAt: string | null;
  htmlUrl: string | null;
  status: IntrospectionStatus;
  error: string | null;
  score: number | null;
  analyzedAt: string | null;
  appliedAt: string | null;
  documentId: number | null;
  /** Há commits mais novos que a última análise. */
  stale: boolean;
  confidence: number | null;
  /** Nó do grafo ligado ao repositório e o grupo (pai) dele, para agrupar a grade por sistema. */
  nodeId: number | null;
  system: string | null;
  /** Resumo para a grade. */
  /** O CI já enviou métricas. */
  hasMetrics: boolean;
  analysisDepth: AnalysisDepth | null;
  coverage: number | null;
  securityFindings: number | null;
  /** Categorias com nota abaixo de 5. */
  failingCategories: QualityCategory[];
  /** Últimas notas (mais antiga → mais nova) para o sparkline. */
  trend: Array<number | null>;
  /** PRs abertos e idade (coletado ao sincronizar a lista). */
  activity: RepoActivity | null;
  /** Dependências com vulnerabilidade conhecida (da última análise). */
  vulnerabilities: number | null;
  /** Runtime fora de suporte (EOL), pela última análise. */
  runtimeEol: boolean | null;
  /** Precisa de atenção? Calculado em `shared/repoHealth.ts`. */
  attention: RepoAttention;
}

export interface RepoIntrospectionDetail extends RepoIntrospectionSummary {
  defaultBranch: string | null;
  facts: RepoFacts | null;
  quality: QualityReport | null;
  analysis: RepoAnalysis | null;
  proposal: RepoGraphProposal | null;
  /** Últimas métricas recebidas do workflow (cobertura, testes, SAST/DAST…). */
  metrics: RepoMetricsSnapshot | null;
  process: RepoProcess | null;
  history: ScoreHistoryPoint[];
}

/** Progresso de um repositório em análise. */
export interface IntrospectionProgress {
  repo: string;
  depth: AnalysisDepth;
  stage: IntrospectionStage;
  /** Itens da etapa (arquivos lidos, lotes enviados ao LLM); null quando a etapa não é contável. */
  done: number | null;
  total: number | null;
  startedAt: string;
  stageStartedAt: string;
}

export interface IntrospectionRunState {
  running: boolean;
  queued: number;
  current: string | null;
  done: number;
  failed: number;
  /** Um item por repositório sendo analisado agora. */
  progress: IntrospectionProgress[];
}

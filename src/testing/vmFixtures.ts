// Fábricas e utilitários compartilhados pelos testes do front (data, stores, viewmodels).
import type { Permission } from '../../shared/constants.ts';
import type {
  CallSite,
  Connection,
  DocumentSummary,
  GraphData,
  GraphInfo,
  GraphNode,
  IndexStatus,
  NodeInterface,
  RepoIntrospectionSummary,
  SearchHit,
  User,
} from '../../shared/types.ts';
import { GraphIndex } from '../domain/GraphIndex.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useDocsStore } from '../stores/docsStore.ts';
import { useGraphStore } from '../stores/graphStore.ts';
import { useUiStore } from '../stores/uiStore.ts';

export const makeNode = (id: number, parent_id: number | null = null, o: Partial<GraphNode> = {}): GraphNode => ({
  id,
  graph_id: 1,
  parent_id,
  name: `n${id}`,
  kind: 'service',
  tech: null,
  icon: null,
  description: null,
  created_at: '',
  updated_at: '',
  ...o,
});

export const makeConn = (id: number, source_id: number, target_id: number, o: Partial<Connection> = {}): Connection => ({
  id,
  source_id,
  target_id,
  target_interface_id: null,
  parent_connection_id: null,
  protocol: 'http',
  description: null,
  created_at: '',
  ...o,
});

export const makeIface = (id: number, node_id: number, name = `i${id}`, o: Partial<NodeInterface> = {}): NodeInterface => ({
  id,
  node_id,
  name,
  type: null,
  spec: null,
  description: null,
  ...o,
});

export const makeCallSite = (id: number, connection_id: number, o: Partial<CallSite> = {}): CallSite => ({
  id,
  connection_id,
  file_path: 'a.ts',
  line: 1,
  symbol: null,
  snippet: null,
  notes: null,
  end_line: null,
  code: null,
  ...o,
});

export const graphData = (o: Partial<GraphData> = {}): GraphData => ({ nodes: [], interfaces: [], connections: [], callSites: [], ...o });

export const makeGraphInfo = (id: number, o: Partial<GraphInfo> = {}): GraphInfo => ({
  id,
  name: `g${id}`,
  description: null,
  nodeCount: 0,
  created_at: '',
  updated_at: '',
  ...o,
});

export const makeUser = (o: Partial<User> = {}): User => ({
  id: 1,
  email: 'a@b.com',
  name: 'Ana Maria',
  role: 'admin',
  active: true,
  created_at: '',
  last_login_at: null,
  onboarded_at: '2024-01-01',
  ...o,
});

export const makeStatus = (o: Partial<IndexStatus> = {}): IndexStatus => ({
  documents: 1,
  graphDocuments: 2,
  chunks: 3,
  embedded: 3,
  pending: 0,
  embeddingModel: 'e5',
  embeddingState: 'idle',
  embeddingError: null,
  llmMentions: { enabled: true, pendingDocuments: 0, state: 'idle', error: null },
  ...o,
});

export const makeDoc = (id: number, o: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id,
  path: `/docs/d${id}.md`,
  title: `d${id}`,
  source: 'upload',
  folder_id: null,
  updated_at: '',
  chunkCount: 1,
  embeddedCount: 1,
  mentionCount: 0,
  ...o,
});

export const makeHit = (o: Partial<SearchHit> = {}): SearchHit => ({
  chunkId: 1,
  documentId: 7,
  path: '/d.md',
  title: 'd',
  heading: 'h',
  startLine: 2,
  endLine: 4,
  snippet: 'a [[b]] c',
  score: 1,
  matchedBy: ['text'],
  mentionedNodeIds: [],
  nodeId: null,
  ...o,
});

export const makeRepo = (id: number, o: Partial<RepoIntrospectionSummary> = {}): RepoIntrospectionSummary => ({
  id,
  owner: 'org',
  name: `r${id}`,
  description: null,
  language: null,
  archived: false,
  pushedAt: null,
  htmlUrl: null,
  status: 'done',
  error: null,
  score: null,
  analyzedAt: null,
  appliedAt: null,
  documentId: null,
  stale: false,
  confidence: null,
  nodeId: null,
  system: null,
  hasMetrics: false,
  analysisDepth: null,
  coverage: null,
  securityFindings: null,
  failingCategories: [],
  trend: [],
  activity: null,
  vulnerabilities: null,
  runtimeEol: null,
  attention: { level: 'ok', reasons: [] },
  resumable: null,
  ...o,
});

/** Coloca um grafo pronto no store. */
export function seedGraph(data: Partial<GraphData>): GraphIndex {
  const index = new GraphIndex(graphData(data));
  useGraphStore.setState({ index, status: 'ready', error: null });
  return index;
}

export function setPermissions(...perms: Permission[]): void {
  useAuthStore.setState({ permissions: new Set(perms) });
}

const initial = {
  ui: useUiStore.getState(),
  graph: useGraphStore.getState(),
  docs: useDocsStore.getState(),
  auth: useAuthStore.getState(),
};

/** Volta todos os stores ao estado inicial. */
export function resetStores(): void {
  useUiStore.setState(initial.ui, true);
  useGraphStore.setState(initial.graph, true);
  useDocsStore.setState(initial.docs, true);
  useAuthStore.setState(initial.auth, true);
}

export const toasts = () => useUiStore.getState().toasts.map((t) => [t.kind, t.message] as const);

/** Zera o singleton de uma classe (campo estático privado `instance`). */
export function resetSingleton(cls: object): void {
  (cls as { instance?: unknown }).instance = undefined;
}

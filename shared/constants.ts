export const NODE_KINDS = ['project', 'service', 'database', 'infra', 'queue', 'external', 'module'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const PROTOCOLS = ['http', 'grpc', 'graphql', 'sql', 'nosql', 'amqp', 'kafka', 'websocket', 'tcp', 'file', 'function-call', 'other'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

/** Profundidade da análise/geração: rápida (heurística), média (LLM) ou completa (LLM + trechos do código). */
/** Profundidade da análise: rápida (heurística), média (LLM), completa (LLM + chamadas do código) e máxima (todo o código, blocos inteiros, o que cada módulo expõe e usa). */
export const ANALYSIS_DEPTHS = ['fast', 'medium', 'full', 'max'] as const;
export type AnalysisDepth = (typeof ANALYSIS_DEPTHS)[number];

export const ROLES = ['admin', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** metrics:write = enviar métricas de CI (use um token de API de um usuário editor dedicado ao CI). */
export const PERMISSIONS = ['graph:read', 'graph:write', 'docs:read', 'docs:write', 'metrics:write', 'settings:manage', 'users:manage'] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Papéis simples: leitura, escrita e administração. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: ['graph:read', 'docs:read'],
  editor: ['graph:read', 'graph:write', 'docs:read', 'docs:write', 'metrics:write'],
  admin: PERMISSIONS,
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  editor: 'Editor',
  viewer: 'Leitor',
};

export const KIND_LABEL: Record<NodeKind, string> = {
  project: 'Projeto',
  service: 'Serviço',
  database: 'Banco de dados',
  infra: 'Infra',
  queue: 'Fila / Mensageria',
  external: 'Externo',
  module: 'Módulo',
};

/** Etapas da análise de um repositório, na ordem. */
export const INTROSPECTION_STAGES = ['collecting', 'history', 'analyzing', 'scanning', 'mapping', 'scoring'] as const;
export type IntrospectionStage = (typeof INTROSPECTION_STAGES)[number];

/** Eixos do relatório de segurança/DevSecOps. */
export const SECURITY_AXES = ['vulnerabilities', 'pipeline', 'supplyChain', 'governance'] as const;
export const SECURITY_AXIS_LABEL: Record<(typeof SECURITY_AXES)[number], string> = {
  vulnerabilities: 'Vulnerabilidades',
  pipeline: 'Pipeline DevSecOps',
  supplyChain: 'Cadeia de suprimentos',
  governance: 'Governança',
};

/** Do mais grave para o menos grave. */
export const RISK_LEVELS = ['critical', 'high', 'medium', 'low'] as const;
export const RISK_LABEL: Record<(typeof RISK_LEVELS)[number], string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

/** Níveis de maturidade DevSecOps (índice = nível). */
export const MATURITY_LABELS = ['Ausente', 'Inicial', 'Básico', 'Gerenciado', 'Avançado'] as const;

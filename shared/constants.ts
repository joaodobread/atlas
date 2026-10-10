export const NODE_KINDS = ['project', 'service', 'database', 'infra', 'queue', 'external', 'module'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const PROTOCOLS = ['http', 'grpc', 'graphql', 'sql', 'nosql', 'amqp', 'kafka', 'websocket', 'tcp', 'file', 'function-call', 'other'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

/** Profundidade da análise/geração: rápida (heurística), média (LLM) ou completa (LLM + trechos do código). */
export const ANALYSIS_DEPTHS = ['fast', 'medium', 'full'] as const;
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

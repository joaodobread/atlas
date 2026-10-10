// Schemas zod: única fonte de verdade para validar qualquer entrada (API, import, seed).
import { z } from 'zod';
import { ANALYSIS_DEPTHS, NODE_KINDS, PROTOCOLS, ROLES } from './constants.ts';

const id = z.number().int().positive();

/** Texto opcional; string vazia vira null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

const requiredText = (max: number) => z.string().trim().min(1, 'Obrigatório').max(max);

/** Id de ícone: "<conjunto>:<nome>", ex.: "si:mysql" (marca) ou "lu:database" (genérico). */
export const iconIdSchema = z
  .string()
  .trim()
  .max(60)
  .regex(/^(si|lu):[a-z0-9-]+$/, 'Ícone inválido');

export const idParamSchema = z.coerce.number().int().positive();

// ---------- Nodes ----------
const nodeFields = {
  parent_id: id.nullable(),
  name: requiredText(200),
  kind: z.enum(NODE_KINDS),
  tech: optionalText(200),
  icon: iconIdSchema.nullable(),
  description: optionalText(5000),
};
export const createNodeSchema = z
  .object({
    ...nodeFields,
    /** Obrigatório para nós raiz; filhos herdam o grafo do pai. */
    graph_id: id.optional(),
    parent_id: nodeFields.parent_id.default(null),
    kind: nodeFields.kind.default('project'),
    icon: nodeFields.icon.default(null),
  })
  .strict();
export const updateNodeSchema = z.object(nodeFields).partial().strict();
export type CreateNodeInput = z.infer<typeof createNodeSchema>;
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

// ---------- Interfaces ----------
const interfaceFields = {
  node_id: id,
  name: requiredText(300),
  type: optionalText(100),
  spec: optionalText(2000),
  description: optionalText(5000),
};
export const createInterfaceSchema = z.object(interfaceFields).strict();
export const updateInterfaceSchema = z.object(interfaceFields).omit({ node_id: true }).partial().strict();
export type CreateInterfaceInput = z.infer<typeof createInterfaceSchema>;
export type UpdateInterfaceInput = z.infer<typeof updateInterfaceSchema>;

// ---------- Connections ----------
const connectionFields = {
  source_id: id,
  target_id: id,
  target_interface_id: id.nullable(),
  parent_connection_id: id.nullable(),
  protocol: optionalText(50),
  description: optionalText(5000),
};
export const createConnectionSchema = z
  .object({
    ...connectionFields,
    target_interface_id: connectionFields.target_interface_id.default(null),
    parent_connection_id: connectionFields.parent_connection_id.default(null),
  })
  .strict()
  .refine((c) => c.source_id !== c.target_id, { message: 'Origem e destino não podem ser o mesmo nó', path: ['target_id'] });
export const updateConnectionSchema = z.object(connectionFields).partial().strict();
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;

// ---------- Call sites ----------
const callSiteFields = {
  connection_id: id,
  file_path: requiredText(1000),
  line: z.number().int().positive().nullable(),
  symbol: optionalText(500),
  snippet: optionalText(10000),
  notes: optionalText(5000),
  end_line: z.number().int().positive().nullable().optional(),
  code: optionalText(20000),
};
export const createCallSiteSchema = z.object({ ...callSiteFields, line: callSiteFields.line.default(null) }).strict();
export const updateCallSiteSchema = z.object(callSiteFields).omit({ connection_id: true }).partial().strict();
export type CreateCallSiteInput = z.infer<typeof createCallSiteSchema>;
export type UpdateCallSiteInput = z.infer<typeof updateCallSiteSchema>;

// ---------- Import / export (formato pensado para ser gerado por um LLM) ----------
const exchangeText = (max: number) => z.string().trim().max(max).optional();

export const exchangeInterfaceSchema = z.object({
  name: requiredText(300),
  type: exchangeText(100),
  spec: exchangeText(2000),
  description: exchangeText(5000),
});

export const exchangeNodeSchema = z.object({
  /** Identificador único no documento. No export é o caminho "Projeto/Modulo/Sub". */
  ref: requiredText(1000),
  name: requiredText(200),
  kind: z.enum(NODE_KINDS).optional(),
  tech: exchangeText(200),
  icon: iconIdSchema.optional(),
  description: exchangeText(5000),
  /** ref do pai, ou caminho "Projeto/Modulo" de um nó já existente. */
  parent: z.string().trim().min(1).max(1000).nullable().optional(),
  interfaces: z.array(exchangeInterfaceSchema).max(1000).optional(),
});

export const exchangeCallSiteSchema = z.object({
  file_path: requiredText(1000),
  line: z.number().int().positive().optional(),
  symbol: exchangeText(500),
  snippet: exchangeText(10000),
  notes: exchangeText(5000),
  end_line: z.number().int().positive().optional(),
  code: exchangeText(20000),
});

export const exchangeConnectionSchema = z.object({
  /** ref local, usado por `implements`. */
  ref: z.string().trim().min(1).max(1000).optional(),
  from: requiredText(1000),
  to: requiredText(1000),
  /** Nome de uma interface do nó `to` (criada se não existir). */
  interface: z.string().trim().min(1).max(300).optional(),
  protocol: exchangeText(50),
  description: exchangeText(5000),
  /** ref de outra conexão (normalmente do projeto pai) que esta implementa. */
  implements: z.string().trim().min(1).max(1000).optional(),
  callSites: z.array(exchangeCallSiteSchema).max(1000).optional(),
});

export const exchangeDocumentSchema = z.object({
  mode: z.enum(['merge', 'replace']).default('merge'),
  nodes: z.array(exchangeNodeSchema).max(20000).default([]),
  connections: z.array(exchangeConnectionSchema).max(50000).default([]),
});

export type ExchangeInterface = z.infer<typeof exchangeInterfaceSchema>;
export type ExchangeNode = z.infer<typeof exchangeNodeSchema>;
export type ExchangeCallSite = z.infer<typeof exchangeCallSiteSchema>;
export type ExchangeConnection = z.infer<typeof exchangeConnectionSchema>;
export type ExchangeDocument = z.infer<typeof exchangeDocumentSchema>;
export type ExchangeDocumentInput = z.input<typeof exchangeDocumentSchema>;

// ---------- Configurações de LLM ----------
export const LLM_PROVIDERS = ['none', 'anthropic', 'openai-compatible'] as const;

const llmSettingsFields = z.object({
  provider: z.enum(LLM_PROVIDERS),
  model: z.string().trim().max(200).nullable().optional(),
  baseUrl: z.string().trim().url('URL inválida').max(500).nullable().optional(),
  /** undefined = manter a atual; null = apagar; string = nova chave. */
  apiKey: z.string().trim().min(1).max(1000).nullable().optional(),
  mentionsAuto: z.boolean(),
});

const requireProviderFields = (s: z.infer<typeof llmSettingsFields>, ctx: z.RefinementCtx) => {
  if (s.provider !== 'none' && !s.model) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['model'], message: 'Informe o modelo' });
  if (s.provider === 'openai-compatible' && !s.baseUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['baseUrl'], message: 'Informe a URL base da API' });
};

export const updateLlmSettingsSchema = llmSettingsFields.strict().superRefine(requireProviderFields);
export type UpdateLlmSettingsInput = z.infer<typeof updateLlmSettingsSchema>;

/** Formato persistido (com a chave). */
export const storedLlmSettingsSchema = llmSettingsFields.extend({ apiKey: z.string().min(1).nullable() }).superRefine(requireProviderFields);
export type StoredLlmSettings = z.infer<typeof storedLlmSettingsSchema>;

// ---------- Documentos / RAG ----------
const MAX_DOC_CHARS = 2_000_000;

export const upsertDocumentSchema = z
  .object({
    /** Identificador único (caminho/nome do arquivo). Reenviar o mesmo path atualiza o documento. */
    path: requiredText(1000),
    title: z.string().trim().max(300).optional(),
    content: z.string().max(MAX_DOC_CHARS, 'Documento grande demais'),
    source: z.enum(['upload', 'api']).default('api'),
  })
  .strict();
export type UpsertDocumentInput = z.infer<typeof upsertDocumentSchema>;

export const importDocumentsSchema = z.object({ documents: z.array(upsertDocumentSchema).min(1).max(500) }).strict();
export type ImportDocumentsInput = z.infer<typeof importDocumentsSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Digite algo para buscar').max(500),
  mode: z.enum(['hybrid', 'text', 'semantic']).default('hybrid'),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;

export const askSchema = z
  .object({
    question: z.string().trim().min(3, 'Pergunta muito curta').max(2000),
    limit: z.number().int().min(1).max(20).default(8),
  })
  .strict();
export type AskInput = z.infer<typeof askSchema>;

export const watchedFolderSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((p) => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p), 'Use um caminho absoluto'),
  })
  .strict();
export type WatchedFolderInput = z.infer<typeof watchedFolderSchema>;

// ---------- Usuários / autenticação ----------
const email = z.string().trim().toLowerCase().email('E-mail inválido').max(254);
const password = z.string().min(8, 'Mínimo de 8 caracteres').max(200);
const personName = requiredText(120);

export const setupSchema = z.object({ name: personName, email, password }).strict();
export type SetupInput = z.infer<typeof setupSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1, 'Informe a senha').max(200) }).strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({ name: personName, email, role: z.enum(ROLES), password }).strict();
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({ name: personName, email, role: z.enum(ROLES), active: z.boolean(), password })
  .partial()
  .strict();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }).strict();
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Tutorial de primeiro acesso: true = concluído/dispensado; false = mostrar de novo. */
export const onboardingSchema = z.object({ done: z.boolean() }).strict();
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const createApiTokenSchema = z.object({ name: requiredText(100) }).strict();
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

// ---------- GitHub / introspecção de repositórios ----------
const githubOwner = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'Organização ou usuário do GitHub inválido');

export const updateGithubSettingsSchema = z
  .object({
    owner: githubOwner,
    /** undefined = mantém o token salvo; null = apaga. */
    token: z.string().trim().min(10, 'Token inválido').max(500).nullable().optional(),
    includeArchived: z.boolean(),
    includeForks: z.boolean(),
    /** Só repositórios com push nos últimos N meses (null = todos). */
    pushedWithinMonths: z.number().int().min(1).max(120).nullable(),
  })
  .strict();
export type UpdateGithubSettingsInput = z.infer<typeof updateGithubSettingsSchema>;

export const storedGithubSettingsSchema = z.object({
  owner: githubOwner,
  token: z.string().min(10).max(500).nullable(),
  includeArchived: z.boolean(),
  includeForks: z.boolean(),
  pushedWithinMonths: z.number().int().min(1).max(120).nullable(),
});
export type StoredGithubSettings = z.infer<typeof storedGithubSettingsSchema>;

export const runIntrospectionSchema = z
  .object({
    /** Nomes dos repositórios; vazio/ausente = todos os listados. */
    repos: z.array(z.string().trim().min(1).max(200)).max(1000).optional(),
    /** Reanalisa mesmo sem commits novos. */
    force: z.boolean().default(false),
    depth: z.enum(ANALYSIS_DEPTHS).default('medium'),
  })
  .strict();
export type RunIntrospectionInput = z.infer<typeof runIntrospectionSchema>;

/** Formatos de relatório que o workflow do GitHub pode enviar (o servidor interpreta cada um). */
export const METRICS_REPORT_TYPES = ['istanbul-summary', 'lcov', 'go-cover', 'cobertura', 'junit', 'sarif'] as const;
export const METRICS_CATEGORIES = ['unit', 'integration', 'e2e', 'sast', 'dast', 'sca', 'secrets', 'lint'] as const;

/** Métricas que o workflow já calculou (todas opcionais). */
export const rawMetricsSchema = z
  .object({
    coverageLines: z.number().min(0).max(100),
    coverageBranches: z.number().min(0).max(100),
    mutationScore: z.number().min(0).max(100),
    flakyRate: z.number().min(0).max(100),
    lintErrors: z.number().int().min(0),
    lintWarnings: z.number().int().min(0),
  })
  .partial()
  .strict();

/** Envio de métricas de um workflow (autenticado com token de API). */
export const ingestMetricsSchema = z
  .object({
    owner: z.string().trim().min(1).max(100),
    repo: z.string().trim().min(1).max(200),
    sha: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{7,40}$/i, 'SHA inválido'),
    ref: z.string().trim().max(300).optional(),
    runUrl: z.string().trim().url().max(2000).optional(),
    reports: z
      .array(
        z
          .object({
            type: z.enum(METRICS_REPORT_TYPES),
            /** Para SARIF/JUnit: que tipo de análise é (SAST, DAST, testes e2e…). */
            category: z.enum(METRICS_CATEGORIES).optional(),
            tool: z.string().trim().max(100).optional(),
            content: z.string().max(15_000_000),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    metrics: rawMetricsSchema.default({}),
  })
  .strict();
export type IngestMetricsInput = z.infer<typeof ingestMetricsSchema>;

// ---------- Grafos (diagramas) ----------
export const createGraphSchema = z.object({ name: requiredText(120), description: optionalText(2000) }).strict();
export type CreateGraphInput = z.infer<typeof createGraphSchema>;
export const updateGraphSchema = createGraphSchema.partial().strict();
export type UpdateGraphInput = z.infer<typeof updateGraphSchema>;

/** Novo grafo com os repositórios escolhidos e com quem eles se comunicam. */
export const graphFromReposSchema = z
  .object({
    name: requiredText(120),
    description: optionalText(2000),
    repoIds: z.array(id).min(1, 'Selecione ao menos um repositório').max(500),
    depth: z.enum(ANALYSIS_DEPTHS).default('medium'),
  })
  .strict();
export type GraphFromReposInput = z.infer<typeof graphFromReposSchema>;

export const applyProposalSchema = z.object({ graphId: id }).strict();

export const repoKeySchema = z.object({ owner: z.string().trim().min(1).max(100), repo: z.string().trim().min(1).max(200) }).strict();

/** Resposta do LLM ao analisar um repositório. */
export const repoAnalysisSchema = z.object({
  purpose: z.string().max(2000),
  stack: z.string().max(500),
  deploy: z.string().max(1000),
  inbound: z.array(z.string().max(500)).max(30),
  outbound: z.array(z.string().max(500)).max(40),
  data: z.array(z.string().max(500)).max(30),
  notes: z.array(z.string().max(500)).max(20),
  /** Caminho de um nó existente que já representa este repositório (ou null). */
  matchedNode: z.string().max(1000).nullable(),
  /** Recursos que o repositório usa e ainda não existem no grafo. */
  resources: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        kind: z.enum(NODE_KINDS),
        tech: z.string().max(200),
        description: z.string().max(1000),
      }),
    )
    .max(40),
  /** "target" é o caminho de um nó existente ou o nome de um recurso acima. */
  connections: z
    .array(
      z.object({
        direction: z.enum(['out', 'in']),
        target: z.string().min(1).max(1000),
        protocol: z.enum(PROTOCOLS),
        description: z.string().max(500),
      }),
    )
    .max(60),
});
export type RepoAnalysisOutput = z.infer<typeof repoAnalysisSchema>;

/** Resposta do LLM na análise completa: módulos e a que destino cada chamada encontrada no código vai. */
export const codeMappingSchema = z.object({
  modules: z.array(z.object({ name: z.string().min(1).max(200), path: z.string().max(500), description: z.string().max(500) })).max(40),
  calls: z
    .array(
      z.object({
        site: z.number().int().positive(),
        /** Caminho do catálogo, nome de recurso da análise ou null quando não dá para saber. */
        target: z.string().max(1000).nullable(),
        module: z.string().max(200).nullable(),
        protocol: z.enum(PROTOCOLS),
        /** Análise máxima: interface usada no destino (endpoint, tabela, tópico) e o que a chamada faz. */
        interface: z.string().max(300).nullable().optional(),
        description: z.string().max(500).nullable().optional(),
      }),
    )
    .max(400),
  /** Análise máxima: módulo e descrição de cada rota/consumidor/job encontrado. */
  surfaces: z
    .array(z.object({ surface: z.number().int().positive(), module: z.string().max(200).nullable(), description: z.string().max(500).nullable() }))
    .max(400)
    .default([]),
});
export type CodeMappingOutput = z.infer<typeof codeMappingSchema>;

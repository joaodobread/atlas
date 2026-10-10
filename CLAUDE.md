# Comm Graph — regras de código

Sistema para mapear a comunicação entre projetos/infra (nós hierárquicos de profundidade N + conexões dirigidas),
persistido em Postgres (pgvector + full-text) com arquivos em storage S3 (bucket privado e público),
visualizado em 2D/3D (React + Three.js). Self-hosted e open source.

## Gerais

- **Somente TypeScript.** Nenhum arquivo `.js`/`.jsx` em lugar algum (configs incluídas). `strict` ligado.
- Imports relativos com extensão `.ts`/`.tsx`.
- `npm run check` precisa passar antes de considerar uma tarefa pronta: typecheck, `oxlint --type-aware` (sem erros),
  `oxfmt --check` e testes (Vitest) com **cobertura mínima de 90%** (linhas, funções, branches e statements) no backend,
  no `shared/` e na lógica do front (domain, core, data, stores, viewmodels).
- Testes: `*.test.ts` (unit, sem banco), `*.int.test.ts` (integração com Postgres real via `test/support/database.ts`,
  banco `<nome>_test`), `src/**/*.test.ts(x)` (front, happy-dom). Nada de rede real em teste: injete fakes/mocks
  (`test/support/MemoryObjectStorage.ts`, fetch mockado). Todo código novo vem com testes.
- Containers ficam em `containers/` (Containerfile + compose compatível com Docker e Podman), nunca soltos na raiz.
- Tipos de entidade em `shared/types.ts`; constantes em `shared/constants.ts`.
- **Toda entrada é validada com zod** (`shared/schemas.ts` é a fonte única). Tipos de input são `z.infer` dos schemas.
  Vale para HTTP, import JSON, variáveis de ambiente (`AppConfig`) e formulários do front.

## Backend (`server/`) — OOP em camadas

```
config/          AppConfig (env validado com zod)
core/errors/     AppError, NotFoundError(404), ValidationError(400), BusinessRuleError(422)
infra/database/  IDatabase (assíncrono, placeholders ?) + PostgresDatabase (pg, pool, TLS, transações reentrantes via AsyncLocalStorage) + migrations (schema_migrations + advisory lock)
infra/storage/   IObjectStorage + S3ObjectStorage (buckets privado/público; RustFS/MinIO/AWS/R2)
infra/embeddings IEmbeddingProvider + TransformersEmbeddingProvider (local, multilingual-e5-small)
infra/llm/       ILlmProvider: Anthropic (SDK oficial), OpenAI-compatível (OpenRouter/Ollama/LM Studio), Null
infra/files/     IMarkdownFolder (scan + fs.watch de pastas de .md)
core/events/     EventBus tipado ('graph.changed', 'documents.changed', 'chunks.embedded', 'llm.changed')
core/auth/       AuthUser (usuário da requisição + permissões do papel)
infra/github/    IGithubClient + RestGithubClient (API REST, somente leitura)
infra/packages/  IPackageIntel + PublicPackageIntel (OSV, registry npm, proxy Go, endoflife.date)
infra/crypto/    AesGcmCipher (configs sensíveis), ScryptPasswordHasher, TokenService (sessões/tokens: só o hash vai pro banco)
repositories/
  contracts/     I*Repository (interfaces)
  postgres/      implementações (extendem PgCrudRepository)
services/
  contracts/     I*Service (interfaces)
  *.ts           implementações com regras de negócio
  documents/     RAG: MarkdownChunker, MentionDetector/MentionService, DocumentService, EmbeddingIndexer,
                 SearchService (FTS5 + vetores, RRF), RagService (contexto = trechos + fatos do grafo), FolderWatchService,
                 GraphKnowledgeSync (cada nó vira documento source='graph', regenerado em 'graph.changed')
  github/        introspecção de repositórios: RepoCollector (fatos, sem segredos), RepoAnalyzer (LLM ou heurística),
                 QualityScorer (scorecard), IntrospectionService (fila, documento por repo, proposta → grafo só ao aplicar)
  metrics/       MetricsService + reportParsers: métricas enviadas pelo CI (cobertura, JUnit, SARIF) → histórico + nota
http/
  controllers/   validam a entrada com zod e chamam services; retornam HttpResponse (não usam res do Express)
  RouteBinder    liga rota -> (Token do controller, método); resolve o controller do container na requisição
  routes.ts      declaração das rotas
di/              Container (singleton/transient/value) + Token<T> + TOKENS
composition/     buildContainer: ÚNICO lugar com `new` de classes de infra/repo/service/controller
main.ts          entry point
```

- Classes dependem de **interfaces**, recebidas pelo construtor. Nunca instanciar dependências dentro de uma classe
  (exceção: objetos de estado por operação, ex.: `ImportRun`).
- Repositories só acessam dados; regras de negócio ficam nos services; controllers só validam/delegam.
- Tudo que toca banco/storage é assíncrono (`Promise`); nunca deixe promessa solta (o lint barra `no-floating-promises`).
- Transações via `await db.transaction(async () => …)` (reentrante).
- Nova rota: método no controller → `routes.ts` com `binder.get('/path', TOKENS.X, 'metodo', '<permissão>')`.
  A permissão é obrigatória: uma de `shared/constants.ts#PERMISSIONS`, `'authenticated'` ou `'public'`.
- Papéis (`ROLE_PERMISSIONS`): viewer = leitura, editor = + escrita, admin = + usuários/configurações/pastas.
- Mutações exigem o header `X-Requested-With: comm-graph` (CSRF) ou `Authorization: Bearer <token de API>`.
- Dados sensíveis (ex.: chave do LLM) vão pelo `ISecureSettingsStore` (criptografado); nunca devolva segredos na API.
- Nova dependência: interface em `contracts/`, implementação, token em `di/tokens.ts`, registro em `composition/buildContainer.ts`.
- Services se comunicam por eventos quando um não deve depender do outro (ex.: NodeService emite `graph.changed` → MentionService recalcula menções).
- Configuração só via `AppConfig` (env/.env validados com zod). Veja `.env.example`.
- Mudança de schema do banco: **nova** migração em `infra/database/migrations.ts` (nunca editar uma aplicada).
- Arquivos vão para o storage: privado por padrão; o bucket público só recebe o que for explicitamente compartilhado.
- Configuração por ambiente (`AppConfig`): banco gerenciado (RDS) via `DATABASE_URL` + `DATABASE_SSL`; em produção
  `APP_SECRET` é obrigatório.
- Há vários grafos independentes (tabela `graphs`; `nodes.graph_id`). Conexões só entre nós do mesmo grafo; filhos herdam o grafo do pai; consultas/import/export recebem o `graphId`.
- Toda mutação do grafo (nós, interfaces, conexões, locais) deve emitir `graph.changed`: menções e o modelo indexado dependem disso.
- Conteúdo de repositório que vai para banco ou LLM passa por `redactSecrets`; arquivos `.env` nunca são lidos (de `.env.example` só os nomes).
- Introspecção nunca altera o grafo sozinha: gera uma proposta que o usuário aplica.
- Profundidades da análise (`ANALYSIS_DEPTHS`): fast (heurística), medium (LLM), full (LLM + chamadas do código,
  `SCAN_FULL`) e max (`SCAN_MAX`: todos os arquivos de código (`allCodeFiles`) e chamadas, sem limite; bloco inteiro em `call_sites.code`/`end_line`, interface usada no
  destino e rotas/consumidores/jobs como interfaces do módulo). Etapas longas reportam progresso em `IntrospectionRunState.progress`.
- Métricas de CI entram por `POST /api/metrics` (permissão `metrics:write`); a action fica em `integrations/github-action`.

## Frontend (`src/`) — MVVM

```
core/http/    IHttpService + HttpService (classe singleton sobre fetch), HttpError
data/api/     *Api — classes singleton (`getInstance(http)`), recebem IHttpService no construtor
data/         GraphSync (recarrega o grafo no store)
domain/       modelo puro: GraphIndex (consultas, cena com foco), ForceLayout (layout 2D/3D), visual, iconCatalog
stores/       zustand (Model): graphStore (dados), uiStore (seleção, foco, modo, expandidos, toasts, modais), docsStore
viewmodels/   hooks use*ViewModel: estado de formulário, validação zod, chamadas às APIs, derivações
views/        componentes React só de apresentação: chamam um ViewModel e renderizam
  scene/      GraphScene3D (three/r3f) e GraphScene2D (SVG) — ambas usam useGraphSceneViewModel
  icons/      NodeIcon: renderiza ids do iconCatalog (lucide = genéricos, simple-icons = marcas)
  NavRail     barra lateral (painéis, repositórios, import/export, configurações, conta)
  scene/SceneToolbar  controles da cena (2D/3D, layout, expandir, enquadrar) — ficam sobre o grafo, não no topo
  settings/   tela de configurações (conta, usuários, LLM, GitHub): novas configurações entram como seção aqui
app/          composição da tela
```

- Views não chamam APIs nem stores diretamente para mutações — passam pelo ViewModel.
- Mutações usam `useCommand().run(...)` (recarrega o grafo + toast de erro/sucesso).
- Formulários usam `useForm` + `validate(schema, payload)` com os schemas de `shared/schemas.ts`.
- Estado global somente em zustand.
- Permissões na UI via `usePermissions()` dentro dos ViewModels (a API sempre revalida).
- Novo ícone: entrada em `domain/iconCatalog.ts` + import nomeado em `views/icons/NodeIcon.tsx` (ids `si:<slug>` / `lu:<nome>`).

# Contribuindo com o Atlas

Obrigado pelo interesse! Este guia resume como rodar o projeto, as regras de código e o fluxo de PR.
Ao participar você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).

## Pré-requisitos

- **Node 24** (há um `.nvmrc`: `nvm use`).
- **Docker ou Podman** com compose, para o Postgres 17 (pgvector) e o storage S3 (RustFS) de desenvolvimento.

## Rodando localmente

Atalho: `make dev` (cria o `.env`, instala, sobe as dependências e roda a API e o front). `make help` lista os demais alvos.
Sem `make`:

```bash
docker compose -f containers/compose.yaml --profile deps up -d   # ou: podman compose ...
cp .env.example .env                                              # já aponta para os containers acima
npm install
npm run dev                                                       # API :3001 + Vite :5173
```

## Antes de abrir o PR

```bash
TEST_DATABASE_URL=postgres://commgraph:commgraph@127.0.0.1:5432/commgraph npm run check
```

O `check` roda typecheck, `oxlint --type-aware` (sem erros), `oxfmt --check` e os testes com cobertura
**mínima de 90%** (linhas, funções, branches e statements). Use `npm run format` para formatar.

Tipos de teste:

| Arquivo               | O que é                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| `*.test.ts`           | unitário, sem banco nem rede                                                         |
| `*.int.test.ts`       | integração com Postgres real (banco `<nome>_test`, criado e migrado automaticamente) |
| `src/**/*.test.ts(x)` | front (ViewModels, stores, domínio) com happy-dom                                    |

Nada de rede real em teste: injete fakes (`test/support/`) ou mocks de `fetch`. **Todo código novo vem com testes.**

## Regras principais (resumo do [CLAUDE.md](CLAUDE.md))

- **Somente TypeScript** (`strict`), nada de `.js`/`.jsx`. Imports relativos com extensão `.ts`/`.tsx`.
- **Toda entrada validada com zod**; `shared/schemas.ts` é a fonte única dos schemas e dos tipos de input.
- **Backend em camadas**: controllers só validam e delegam, regras de negócio nos services, repositories só acessam
  dados. Classes recebem **interfaces** pelo construtor; o único lugar com `new` de infra/repo/service/controller é
  `server/composition/buildContainer.ts` (DI com `Token<T>`).
- **Banco**: mudança de schema é sempre uma **migração nova** em `server/infra/database/migrations.ts` —
  **nunca edite uma migração já aplicada**.
- Toda mutação do grafo emite `graph.changed`; segredos vão para o store criptografado e nunca voltam pela API.
- **Front em MVVM**: views só apresentam, ViewModels (`use*ViewModel`) concentram estado, validação e chamadas.
- Containers ficam em `containers/`.

## Commits e PRs

- Commits no padrão **[Conventional Commits](https://www.conventionalcommits.org/pt-br/)**:
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `perf:`, `chore:`, `ci:` (ex.: `fix(repos): conta PRs de bots`).
  Eles alimentam o CHANGELOG e a versão gerados pelo release-please.
- Um assunto por PR, com descrição do porquê e de como testar. Preencha o checklist do template.
- O merge é feito com **squash**: o título do PR vira o commit na `main`, então use o mesmo padrão nele.
- Não inclua segredos, dados de clientes/empresas nem prints com informação interna em código, testes ou exemplos.

## Dúvidas

Use as [Discussions](https://github.com/joaodobread/atlas/discussions). Bugs e sugestões pelos formulários de issue.

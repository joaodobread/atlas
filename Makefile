# Atalhos para subir e manter o projeto. `make` (ou `make help`) lista os alvos.
# Detecta Docker ou Podman sozinho; force com `make deps ENGINE=podman`.

ENGINE ?= $(shell if docker compose version >/dev/null 2>&1; then echo docker; elif podman compose version >/dev/null 2>&1; then echo podman; fi)
COMPOSE = $(ENGINE) compose -f containers/compose.yaml
# `--wait` (espera os healthchecks) é do Docker Compose; o podman-compose pode não ter.
WAIT = $(if $(filter docker,$(ENGINE)),--wait,)
APP_IMAGE ?= ghcr.io/joaodobread/atlas:latest
TEST_DATABASE_URL ?= postgres://commgraph:commgraph@127.0.0.1:5432/commgraph
export TEST_DATABASE_URL

.DEFAULT_GOAL := help
.PHONY: help engine env install deps deps-down dev up app app-image down logs ps check test lint format build start reset-db

help: ## Lista os alvos
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'

engine:
	@test -n "$(ENGINE)" || { echo "Docker ou Podman (com compose) não encontrado."; exit 1; }

env: ## Cria o .env a partir do .env.example (não sobrescreve)
	@test -f .env || { cp .env.example .env && echo ".env criado a partir do .env.example"; }

node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

install: node_modules ## Instala as dependências (npm ci)

deps: engine ## Sobe Postgres + storage S3 de desenvolvimento e espera ficarem prontos
	$(COMPOSE) --profile deps up -d $(WAIT)

deps-down: engine ## Para Postgres + storage (mantém os dados)
	$(COMPOSE) --profile deps down

dev: env install deps ## Desenvolvimento: dependências + API :3001 + Vite :5173
	npm run dev

up: dev ## Atalho para `make dev`

app: engine ## Tudo em containers com build local da imagem (http://localhost:3001)
	@test -n "$$APP_SECRET" || echo "Aviso: APP_SECRET vazio — obrigatório em produção (32+ caracteres)."
	$(COMPOSE) --profile deps --profile app up -d --build $(WAIT)

app-image: engine ## Tudo em containers com a imagem publicada (APP_IMAGE=...)
	@test -n "$$APP_SECRET" || echo "Aviso: APP_SECRET vazio — obrigatório em produção (32+ caracteres)."
	APP_IMAGE=$(APP_IMAGE) $(COMPOSE) --profile app pull app
	APP_IMAGE=$(APP_IMAGE) $(COMPOSE) --profile deps --profile app up -d --no-build $(WAIT)

down: engine ## Para todos os containers do projeto (mantém os dados)
	$(COMPOSE) --profile deps --profile app down

logs: engine ## Acompanha os logs dos containers
	$(COMPOSE) --profile deps --profile app logs -f --tail=100

ps: engine ## Estado dos containers
	$(COMPOSE) --profile deps --profile app ps

check: install deps ## typecheck + oxlint + oxfmt --check + testes com cobertura (≥ 90%)
	npm run check

test: install deps ## Só os testes
	npm test

lint: install ## oxlint (type-aware)
	npm run lint

format: install ## Formata com oxfmt
	npm run format

build: install ## Build de produção (front em dist/web, servidor em dist/server)
	npm run build && npm run build:server

start: build deps ## Roda o build de produção localmente
	npm start

reset-db: engine ## APAGA os volumes (banco, storage, cache do modelo) e sobe as dependências de novo
	@printf "Isso apaga TODOS os dados locais do banco e do storage. Digite 'apagar' para confirmar: "; \
	read ans; test "$$ans" = apagar || { echo "Cancelado."; exit 1; }
	$(COMPOSE) --profile deps --profile app down -v
	$(COMPOSE) --profile deps up -d $(WAIT)

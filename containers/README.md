# Containers

Tudo de container do Comm Graph fica nesta pasta. Os arquivos seguem o padrão OCI/Compose e funcionam com
`docker` e `podman` (`podman compose` / `podman build`).

| Arquivo             | Para quê                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| `compose.yaml`      | Postgres + storage S3 (perfil `deps`) e a app (perfil `app`)                  |
| `Containerfile`     | Imagem de produção (multi-stage, usuário não-root)                            |
| `postgres/init.sql` | Extensões (`vector`, `unaccent`, `citext`) no primeiro boot do Postgres local |

## Desenvolvimento

```bash
docker compose -f containers/compose.yaml --profile deps up -d   # Postgres :5432 e S3 :9000 (console :9001)
cp .env.example .env                                              # valores já apontam para os containers
npm run dev
```

## Produção

Tudo local (app + Postgres + storage):

```bash
APP_SECRET=$(openssl rand -base64 48) docker compose -f containers/compose.yaml --profile deps --profile app up -d --build
```

Com serviços gerenciados (RDS/Aurora Postgres com pgvector, S3/R2/MinIO…), só a app:

```bash
export APP_SECRET=...                       # 32+ caracteres; guarde em um cofre de segredos
export DATABASE_URL=postgres://user:pass@meu-rds.xxxx.us-east-1.rds.amazonaws.com:5432/commgraph
export DATABASE_SSL=verify-full             # TLS verificando o certificado do servidor
export DATABASE_SSL_CA=/certs/rds-global-bundle.pem   # bundle da AWS montado no container
export S3_ENDPOINT=                         # vazio = AWS S3 (use IAM role ou S3_ACCESS_KEY/S3_SECRET_KEY)
export S3_BUCKET_PRIVATE=minha-empresa-comm-graph-private
export S3_BUCKET_PUBLIC=minha-empresa-comm-graph-public
export S3_PUBLIC_BASE_URL=https://arquivos.minha-empresa.com   # CDN na frente do bucket público
docker compose -f containers/compose.yaml --profile app up -d --build
```

O banco precisa das extensões `vector`, `unaccent` e `citext` (no RDS: `CREATE EXTENSION` com um usuário
`rds_superuser`, ou deixe a migração criar se o usuário da app tiver permissão).

### Buckets

- **Privado** (`S3_BUCKET_PRIVATE`): uploads de documentos, relatórios do CI e cache do modelo de embeddings. Nunca
  exposto; a app lê com as credenciais dela.
- **Público** (`S3_BUCKET_PUBLIC`): só o que alguém compartilha explicitamente. Leitura anônima (via política do
  bucket ou CDN); a app aplica a política de leitura pública nos storages locais.

### Segurança da imagem

- Usuário não-root, filesystem somente leitura (`read_only` + `tmpfs /tmp`), `no-new-privileges`, sem capabilities.
- Nenhum segredo na imagem: tudo por variável de ambiente (`APP_SECRET`, `DATABASE_URL`, `S3_*`).
- Portas do Postgres e do storage locais ficam presas em `127.0.0.1`.

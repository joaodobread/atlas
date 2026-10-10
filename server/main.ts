import { AppConfig } from './config/AppConfig.ts';
import { buildContainer } from './composition/buildContainer.ts';
import { TOKENS } from './di/tokens.ts';
import { MIGRATIONS } from './infra/database/migrations.ts';

const container = buildContainer(AppConfig.fromEnv());

async function boot(): Promise<void> {
  // Banco (local, container ou gerenciado): espera ficar disponível e aplica as migrações.
  const db = container.resolve(TOKENS.Database);
  await db.waitUntilReady();
  await db.migrate(MIGRATIONS);

  // Buckets privado/público (cria se faltarem, quando permitido).
  await container
    .resolve(TOKENS.ObjectStorage)
    .ensureBuckets()
    .catch((err: unknown) => console.error('[storage] não foi possível preparar os buckets:', err));

  // Configuração de LLM salva (ou do .env) antes de qualquer uso.
  await container.resolve(TOKENS.LlmSettingsService).init();

  container.resolve(TOKENS.HttpServer).start();

  // Em segundo plano: menções, modelo do grafo pesquisável, pastas monitoradas, embeddings e análises pendentes.
  container.resolve(TOKENS.MentionService);
  void container.resolve(TOKENS.GraphKnowledgeSync).start();
  container.resolve(TOKENS.LlmMentionExtractor).kick();
  void container
    .resolve(TOKENS.FolderWatchService)
    .start()
    .catch((err: unknown) => console.error('[folders]', err));
  container.resolve(TOKENS.EmbeddingIndexer).kick();
  await container.resolve(TOKENS.IntrospectionService).start();
}

// Desligamento limpo (containers recebem SIGTERM).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`[server] ${signal}: encerrando`);
    void container
      .resolve(TOKENS.Database)
      .close()
      .finally(() => process.exit(0));
  });
}

boot().catch((err: unknown) => {
  console.error('[server] falha no boot:', err);
  process.exit(1);
});

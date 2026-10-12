// Composition root: o ÚNICO lugar onde classes concretas são instanciadas.
import type { AppConfig } from '../config/AppConfig.ts';
import { Container } from '../di/Container.ts';
import { TOKENS } from '../di/tokens.ts';
import { PostgresDatabase } from '../infra/database/PostgresDatabase.ts';
import { S3ObjectStorage } from '../infra/storage/S3ObjectStorage.ts';
import { BucketModelCache } from '../infra/embeddings/ModelCache.ts';
import { PgCallSiteRepository } from '../repositories/postgres/PgCallSiteRepository.ts';
import { PgConnectionRepository } from '../repositories/postgres/PgConnectionRepository.ts';
import { PgInterfaceRepository } from '../repositories/postgres/PgInterfaceRepository.ts';
import { PgNodeRepository } from '../repositories/postgres/PgNodeRepository.ts';
import { CallSiteService } from '../services/CallSiteService.ts';
import { ConnectionService } from '../services/ConnectionService.ts';
import { ExchangeService } from '../services/ExchangeService.ts';
import { GraphService } from '../services/GraphService.ts';
import { InterfaceService } from '../services/InterfaceService.ts';
import { NodeService } from '../services/NodeService.ts';
import { CallSiteController, ConnectionController, InterfaceController, NodeController } from '../http/controllers/EntityControllers.ts';
import { GraphController } from '../http/controllers/GraphController.ts';
import { ErrorHandler } from '../http/middlewares/ErrorHandler.ts';
import { HttpServer } from '../http/HttpServer.ts';
import { EventBus } from '../core/events/EventBus.ts';
import { TransformersEmbeddingProvider } from '../infra/embeddings/TransformersEmbeddingProvider.ts';
import { LocalMarkdownFolder } from '../infra/files/LocalMarkdownFolder.ts';
import { LlmProviderFactory } from '../infra/llm/LlmProviderFactory.ts';
import { SwitchableLlmProvider } from '../infra/llm/SwitchableLlmProvider.ts';
import { PgSettingsRepository } from '../repositories/postgres/PgSettingsRepository.ts';
import { LlmSettingsService } from '../services/settings/LlmSettingsService.ts';
import { LlmMentionExtractor } from '../services/documents/LlmMentionExtractor.ts';
import { SettingsController } from '../http/controllers/SettingsController.ts';
import { AesGcmCipher } from '../infra/crypto/AesGcmCipher.ts';
import { ScryptPasswordHasher } from '../infra/crypto/ScryptPasswordHasher.ts';
import { TokenService } from '../infra/crypto/TokenService.ts';
import { EncryptedSettingsStore } from '../repositories/postgres/EncryptedSettingsStore.ts';
import { PgApiTokenRepository, PgSessionRepository, PgUserRepository } from '../repositories/postgres/PgUserRepository.ts';
import { ApiTokenService } from '../services/auth/ApiTokenService.ts';
import { AuthService } from '../services/auth/AuthService.ts';
import { LoginThrottle } from '../services/auth/LoginThrottle.ts';
import { UserService } from '../services/auth/UserService.ts';
import { AuthController } from '../http/controllers/AuthController.ts';
import { UserController } from '../http/controllers/UserController.ts';
import { AuthMiddleware } from '../http/middlewares/AuthMiddleware.ts';
import { PgDocumentRepository } from '../repositories/postgres/PgDocumentRepository.ts';
import { PgWatchedFolderRepository } from '../repositories/postgres/PgWatchedFolderRepository.ts';
import { DocumentService } from '../services/documents/DocumentService.ts';
import { EmbeddingIndexer } from '../services/documents/EmbeddingIndexer.ts';
import { FolderWatchService } from '../services/documents/FolderWatchService.ts';
import { MarkdownChunker } from '../services/documents/MarkdownChunker.ts';
import { MentionService } from '../services/documents/MentionService.ts';
import { RagService } from '../services/documents/RagService.ts';
import { SearchService } from '../services/documents/SearchService.ts';
import { GraphKnowledgeSync } from '../services/documents/GraphKnowledgeSync.ts';
import { DocumentController } from '../http/controllers/DocumentController.ts';
import { SearchController } from '../http/controllers/SearchController.ts';
import { RestGithubClient } from '../infra/github/RestGithubClient.ts';
import { PublicPackageIntel } from '../infra/packages/PublicPackageIntel.ts';
import { PgRepoIntrospectionRepository } from '../repositories/postgres/PgRepoIntrospectionRepository.ts';
import { PgRepoMetricsRepository } from '../repositories/postgres/PgRepoMetricsRepository.ts';
import { PgIntrospectionCheckpointRepository } from '../repositories/postgres/PgIntrospectionCheckpointRepository.ts';
import { GithubSettingsService } from '../services/github/GithubSettingsService.ts';
import { IntrospectionService } from '../services/github/IntrospectionService.ts';
import { QualityScorer } from '../services/github/QualityScorer.ts';
import { CodeMapper, RepoAnalyzer } from '../services/github/RepoAnalyzer.ts';
import { CodeScanner } from '../services/github/CodeScanner.ts';
import { RepoCollector } from '../services/github/RepoCollector.ts';
import { ProcessCollector } from '../services/github/ProcessCollector.ts';
import { ActivityCollector } from '../services/github/ActivityCollector.ts';
import { MetricsService } from '../services/metrics/MetricsService.ts';
import { GithubController } from '../http/controllers/GithubController.ts';
import { ReportController } from '../http/controllers/ReportController.ts';
import { PgSecurityReportRepository } from '../repositories/postgres/PgSecurityReportRepository.ts';
import { SecurityPostureBuilder } from '../services/reports/SecurityPosture.ts';
import { SecurityReportService } from '../services/reports/SecurityReportService.ts';
import { PgGraphRepository } from '../repositories/postgres/PgGraphRepository.ts';
import { GraphsService } from '../services/GraphsService.ts';

export function buildContainer(config: AppConfig): Container {
  const c = new Container();

  // Infra
  c.value(TOKENS.Config, config);
  c.singleton(TOKENS.Database, (r) => new PostgresDatabase(r.resolve(TOKENS.Config).database));
  c.singleton(TOKENS.ObjectStorage, (r) => new S3ObjectStorage(r.resolve(TOKENS.Config).storage));
  c.singleton(TOKENS.EventBus, () => new EventBus());
  c.singleton(TOKENS.EmbeddingProvider, (r) => {
    const cfg = r.resolve(TOKENS.Config);
    return new TransformersEmbeddingProvider(cfg.embeddingModel, cfg.modelsDir, new BucketModelCache(r.resolve(TOKENS.ObjectStorage), cfg.modelsDir));
  });
  // O provedor real é definido (e trocado) pelo LlmSettingsService.
  c.singleton(TOKENS.LlmProvider, () => new SwitchableLlmProvider());
  c.singleton(TOKENS.LlmProviderFactory, () => new LlmProviderFactory());
  c.singleton(TOKENS.SecretCipher, (r) => {
    const cfg = r.resolve(TOKENS.Config);
    return cfg.appSecret ? AesGcmCipher.fromSecret(cfg.appSecret) : AesGcmCipher.fromKeyFile(cfg.secretKeyFile);
  });
  c.singleton(TOKENS.PasswordHasher, () => new ScryptPasswordHasher());
  c.singleton(TOKENS.TokenService, () => new TokenService());
  c.singleton(TOKENS.MarkdownFolder, () => new LocalMarkdownFolder());

  // Repositories
  c.singleton(TOKENS.NodeRepository, (r) => new PgNodeRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.GraphRepository, (r) => new PgGraphRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.InterfaceRepository, (r) => new PgInterfaceRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.ConnectionRepository, (r) => new PgConnectionRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.CallSiteRepository, (r) => new PgCallSiteRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.DocumentRepository, (r) => new PgDocumentRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.WatchedFolderRepository, (r) => new PgWatchedFolderRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.SettingsRepository, (r) => new PgSettingsRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.SecureSettings, (r) => new EncryptedSettingsStore(r.resolve(TOKENS.SettingsRepository), r.resolve(TOKENS.SecretCipher)));
  c.singleton(TOKENS.UserRepository, (r) => new PgUserRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.SessionRepository, (r) => new PgSessionRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.ApiTokenRepository, (r) => new PgApiTokenRepository(r.resolve(TOKENS.Database)));

  // Services
  c.singleton(TOKENS.NodeService, (r) => new NodeService(r.resolve(TOKENS.NodeRepository), r.resolve(TOKENS.GraphRepository), r.resolve(TOKENS.EventBus)));
  c.singleton(
    TOKENS.InterfaceService,
    (r) => new InterfaceService(r.resolve(TOKENS.InterfaceRepository), r.resolve(TOKENS.NodeRepository), r.resolve(TOKENS.EventBus)),
  );
  c.singleton(
    TOKENS.ConnectionService,
    (r) =>
      new ConnectionService(
        r.resolve(TOKENS.ConnectionRepository),
        r.resolve(TOKENS.NodeRepository),
        r.resolve(TOKENS.InterfaceRepository),
        r.resolve(TOKENS.EventBus),
      ),
  );
  c.singleton(
    TOKENS.CallSiteService,
    (r) => new CallSiteService(r.resolve(TOKENS.CallSiteRepository), r.resolve(TOKENS.ConnectionRepository), r.resolve(TOKENS.EventBus)),
  );
  c.singleton(
    TOKENS.GraphService,
    (r) =>
      new GraphService(
        r.resolve(TOKENS.NodeRepository),
        r.resolve(TOKENS.InterfaceRepository),
        r.resolve(TOKENS.ConnectionRepository),
        r.resolve(TOKENS.CallSiteRepository),
      ),
  );
  c.singleton(
    TOKENS.ExchangeService,
    (r) =>
      new ExchangeService(
        r.resolve(TOKENS.Database),
        r.resolve(TOKENS.GraphService),
        r.resolve(TOKENS.NodeRepository),
        r.resolve(TOKENS.InterfaceRepository),
        r.resolve(TOKENS.ConnectionRepository),
        r.resolve(TOKENS.CallSiteRepository),
        r.resolve(TOKENS.EventBus),
      ),
  );

  // Usuários / autenticação
  c.singleton(TOKENS.LoginThrottle, () => new LoginThrottle());
  c.singleton(
    TOKENS.AuthService,
    (r) =>
      new AuthService(
        r.resolve(TOKENS.UserRepository),
        r.resolve(TOKENS.SessionRepository),
        r.resolve(TOKENS.ApiTokenRepository),
        r.resolve(TOKENS.PasswordHasher),
        r.resolve(TOKENS.TokenService),
        r.resolve(TOKENS.LoginThrottle),
        r.resolve(TOKENS.Config).sessionDays,
      ),
  );
  c.singleton(
    TOKENS.UserService,
    (r) => new UserService(r.resolve(TOKENS.UserRepository), r.resolve(TOKENS.SessionRepository), r.resolve(TOKENS.PasswordHasher)),
  );
  c.singleton(TOKENS.ApiTokenService, (r) => new ApiTokenService(r.resolve(TOKENS.ApiTokenRepository), r.resolve(TOKENS.TokenService)));

  // Configurações
  c.singleton(
    TOKENS.LlmSettingsService,
    (r) =>
      new LlmSettingsService(
        r.resolve(TOKENS.SecureSettings),
        r.resolve(TOKENS.Config),
        r.resolve(TOKENS.LlmProviderFactory),
        r.resolve(TOKENS.LlmProvider),
        r.resolve(TOKENS.EventBus),
      ),
  );

  // Documentos / RAG
  c.singleton(
    TOKENS.LlmMentionExtractor,
    (r) =>
      new LlmMentionExtractor(
        r.resolve(TOKENS.DocumentRepository),
        r.resolve(TOKENS.NodeRepository),
        r.resolve(TOKENS.InterfaceRepository),
        r.resolve(TOKENS.LlmProvider),
        r.resolve(TOKENS.LlmSettingsService),
        r.resolve(TOKENS.EventBus),
      ),
  );
  c.singleton(TOKENS.MarkdownChunker, () => new MarkdownChunker());
  c.singleton(
    TOKENS.MentionService,
    (r) =>
      new MentionService(
        r.resolve(TOKENS.DocumentRepository),
        r.resolve(TOKENS.NodeRepository),
        r.resolve(TOKENS.InterfaceRepository),
        r.resolve(TOKENS.EventBus),
      ),
  );
  c.singleton(
    TOKENS.EmbeddingIndexer,
    (r) => new EmbeddingIndexer(r.resolve(TOKENS.DocumentRepository), r.resolve(TOKENS.EmbeddingProvider), r.resolve(TOKENS.EventBus)),
  );
  c.singleton(
    TOKENS.DocumentService,
    (r) =>
      new DocumentService(
        r.resolve(TOKENS.DocumentRepository),
        r.resolve(TOKENS.MarkdownChunker),
        r.resolve(TOKENS.MentionService),
        r.resolve(TOKENS.EmbeddingIndexer),
        r.resolve(TOKENS.EventBus),
        r.resolve(TOKENS.ObjectStorage),
      ),
  );
  c.singleton(
    TOKENS.GraphKnowledgeSync,
    (r) =>
      new GraphKnowledgeSync(
        r.resolve(TOKENS.GraphService),
        r.resolve(TOKENS.GraphRepository),
        r.resolve(TOKENS.DocumentRepository),
        r.resolve(TOKENS.DocumentService),
        r.resolve(TOKENS.EventBus),
      ),
  );
  c.singleton(TOKENS.SearchService, (r) => new SearchService(r.resolve(TOKENS.DocumentRepository), r.resolve(TOKENS.EmbeddingProvider)));
  c.singleton(
    TOKENS.RagService,
    (r) => new RagService(r.resolve(TOKENS.SearchService), r.resolve(TOKENS.DocumentRepository), r.resolve(TOKENS.GraphService), r.resolve(TOKENS.LlmProvider)),
  );
  c.singleton(
    TOKENS.FolderWatchService,
    (r) =>
      new FolderWatchService(
        r.resolve(TOKENS.WatchedFolderRepository),
        r.resolve(TOKENS.DocumentRepository),
        r.resolve(TOKENS.DocumentService),
        r.resolve(TOKENS.MarkdownFolder),
        r.resolve(TOKENS.EventBus),
      ),
  );

  // GitHub: introspecção de repositórios e métricas de CI
  c.singleton(TOKENS.GithubClient, () => new RestGithubClient());
  c.singleton(TOKENS.PackageIntel, () => new PublicPackageIntel());
  c.singleton(TOKENS.RepoIntrospectionRepository, (r) => new PgRepoIntrospectionRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.RepoMetricsRepository, (r) => new PgRepoMetricsRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.IntrospectionCheckpointRepository, (r) => new PgIntrospectionCheckpointRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.GithubSettingsService, (r) => new GithubSettingsService(r.resolve(TOKENS.SecureSettings), r.resolve(TOKENS.GithubClient)));
  c.singleton(TOKENS.RepoCollector, (r) => new RepoCollector(r.resolve(TOKENS.GithubClient)));
  c.singleton(TOKENS.ProcessCollector, (r) => new ProcessCollector(r.resolve(TOKENS.GithubClient)));
  c.singleton(TOKENS.ActivityCollector, (r) => new ActivityCollector(r.resolve(TOKENS.GithubClient)));
  c.singleton(TOKENS.RepoAnalyzer, (r) => new RepoAnalyzer(r.resolve(TOKENS.LlmProvider)));
  c.singleton(TOKENS.CodeScanner, (r) => new CodeScanner(r.resolve(TOKENS.GithubClient)));
  c.singleton(TOKENS.CodeMapper, (r) => new CodeMapper(r.resolve(TOKENS.LlmProvider)));
  c.singleton(TOKENS.QualityScorer, () => new QualityScorer());
  c.singleton(
    TOKENS.IntrospectionService,
    (r) =>
      new IntrospectionService(
        r.resolve(TOKENS.RepoIntrospectionRepository),
        r.resolve(TOKENS.RepoMetricsRepository),
        r.resolve(TOKENS.GithubSettingsService),
        r.resolve(TOKENS.GithubClient),
        r.resolve(TOKENS.RepoCollector),
        r.resolve(TOKENS.ProcessCollector),
        r.resolve(TOKENS.ActivityCollector),
        r.resolve(TOKENS.RepoAnalyzer),
        r.resolve(TOKENS.CodeScanner),
        r.resolve(TOKENS.CodeMapper),
        r.resolve(TOKENS.QualityScorer),
        r.resolve(TOKENS.PackageIntel),
        r.resolve(TOKENS.GraphService),
        r.resolve(TOKENS.NodeService),
        r.resolve(TOKENS.ConnectionService),
        r.resolve(TOKENS.CallSiteService),
        r.resolve(TOKENS.InterfaceService),
        r.resolve(TOKENS.InterfaceRepository),
        r.resolve(TOKENS.IntrospectionCheckpointRepository),
        r.resolve(TOKENS.NodeRepository),
        r.resolve(TOKENS.ConnectionRepository),
        r.resolve(TOKENS.DocumentService),
        r.resolve(TOKENS.Database),
      ),
  );
  c.singleton(
    TOKENS.GraphsService,
    (r) =>
      new GraphsService(
        r.resolve(TOKENS.GraphRepository),
        r.resolve(TOKENS.GraphService),
        r.resolve(TOKENS.NodeRepository),
        r.resolve(TOKENS.InterfaceRepository),
        r.resolve(TOKENS.ConnectionRepository),
        r.resolve(TOKENS.CallSiteRepository),
        r.resolve(TOKENS.RepoIntrospectionRepository),
        r.resolve(TOKENS.IntrospectionService),
        r.resolve(TOKENS.Database),
        r.resolve(TOKENS.EventBus),
      ),
  );
  c.singleton(
    TOKENS.MetricsService,
    (r) => new MetricsService(r.resolve(TOKENS.RepoMetricsRepository), r.resolve(TOKENS.IntrospectionService), r.resolve(TOKENS.ObjectStorage)),
  );

  // HTTP
  c.singleton(TOKENS.NodeController, (r) => new NodeController(r.resolve(TOKENS.NodeService)));
  c.singleton(TOKENS.InterfaceController, (r) => new InterfaceController(r.resolve(TOKENS.InterfaceService)));
  c.singleton(TOKENS.ConnectionController, (r) => new ConnectionController(r.resolve(TOKENS.ConnectionService)));
  c.singleton(TOKENS.CallSiteController, (r) => new CallSiteController(r.resolve(TOKENS.CallSiteService)));
  c.singleton(
    TOKENS.GraphController,
    (r) => new GraphController(r.resolve(TOKENS.GraphService), r.resolve(TOKENS.GraphsService), r.resolve(TOKENS.ExchangeService)),
  );
  c.singleton(TOKENS.DocumentController, (r) => new DocumentController(r.resolve(TOKENS.DocumentService), r.resolve(TOKENS.FolderWatchService)));
  c.singleton(
    TOKENS.SearchController,
    (r) =>
      new SearchController(
        r.resolve(TOKENS.SearchService),
        r.resolve(TOKENS.RagService),
        r.resolve(TOKENS.EmbeddingIndexer),
        r.resolve(TOKENS.LlmMentionExtractor),
      ),
  );
  c.singleton(TOKENS.SettingsController, (r) => new SettingsController(r.resolve(TOKENS.LlmSettingsService)));
  c.singleton(
    TOKENS.GithubController,
    (r) => new GithubController(r.resolve(TOKENS.GithubSettingsService), r.resolve(TOKENS.IntrospectionService), r.resolve(TOKENS.MetricsService)),
  );

  // Relatório de segurança/DevSecOps
  c.singleton(TOKENS.SecurityReportRepository, (r) => new PgSecurityReportRepository(r.resolve(TOKENS.Database)));
  c.singleton(TOKENS.SecurityPostureBuilder, () => new SecurityPostureBuilder());
  c.singleton(
    TOKENS.SecurityReportService,
    (r) =>
      new SecurityReportService(
        r.resolve(TOKENS.RepoIntrospectionRepository),
        r.resolve(TOKENS.RepoMetricsRepository),
        r.resolve(TOKENS.SecurityReportRepository),
        r.resolve(TOKENS.GithubSettingsService),
        r.resolve(TOKENS.LlmProvider),
        r.resolve(TOKENS.SecurityPostureBuilder),
      ),
  );
  c.singleton(TOKENS.ReportController, (r) => new ReportController(r.resolve(TOKENS.SecurityReportService)));
  c.singleton(TOKENS.AuthController, (r) => new AuthController(r.resolve(TOKENS.AuthService), r.resolve(TOKENS.ApiTokenService)));
  c.singleton(TOKENS.UserController, (r) => new UserController(r.resolve(TOKENS.UserService)));
  c.singleton(TOKENS.AuthMiddleware, (r) => new AuthMiddleware(r.resolve(TOKENS.AuthService)));
  c.singleton(TOKENS.ErrorHandler, () => new ErrorHandler());
  c.singleton(
    TOKENS.HttpServer,
    (r) => new HttpServer(r.resolve(TOKENS.Config), r, r.resolve(TOKENS.ErrorHandler), r.resolve(TOKENS.AuthMiddleware), r.resolve(TOKENS.Database)),
  );

  return c;
}

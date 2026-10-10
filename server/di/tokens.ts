import type { AppConfig } from '../config/AppConfig.ts';
import type { PostgresDatabase } from '../infra/database/PostgresDatabase.ts';
import type { ICallSiteRepository } from '../repositories/contracts/ICallSiteRepository.ts';
import type { IConnectionRepository } from '../repositories/contracts/IConnectionRepository.ts';
import type { IInterfaceRepository } from '../repositories/contracts/IInterfaceRepository.ts';
import type { INodeRepository } from '../repositories/contracts/INodeRepository.ts';
import type { ICallSiteService, IConnectionService, IExchangeService, IGraphService, IInterfaceService, INodeService } from '../services/contracts/index.ts';
import type { CallSiteController, ConnectionController, InterfaceController, NodeController } from '../http/controllers/EntityControllers.ts';
import type { GraphController } from '../http/controllers/GraphController.ts';
import type { ErrorHandler } from '../http/middlewares/ErrorHandler.ts';
import type { HttpServer } from '../http/HttpServer.ts';
import type { IEventBus } from '../core/events/EventBus.ts';
import type { IEmbeddingProvider } from '../infra/embeddings/IEmbeddingProvider.ts';
import type { IMarkdownFolder } from '../infra/files/IMarkdownFolder.ts';
import type { ILlmProviderFactory } from '../infra/llm/LlmProviderFactory.ts';
import type { ISwitchableLlm } from '../infra/llm/SwitchableLlmProvider.ts';
import type { ISettingsRepository } from '../repositories/contracts/ISettingsRepository.ts';
import type { SettingsController } from '../http/controllers/SettingsController.ts';
import type { IObjectStorage } from '../infra/storage/IObjectStorage.ts';
import type { IDocumentRepository } from '../repositories/contracts/IDocumentRepository.ts';
import type { IWatchedFolderRepository } from '../repositories/contracts/IWatchedFolderRepository.ts';
import type {
  IDocumentService,
  IEmbeddingIndexer,
  IFolderWatchService,
  IGraphKnowledgeSync,
  ILlmMentionExtractor,
  ILlmSettingsService,
  IMentionService,
  IRagService,
  ISearchService,
} from '../services/contracts/index.ts';
import type { MarkdownChunker } from '../services/documents/MarkdownChunker.ts';
import type { DocumentController } from '../http/controllers/DocumentController.ts';
import type { SearchController } from '../http/controllers/SearchController.ts';
import type { ISecretCipher } from '../infra/crypto/ISecretCipher.ts';
import type { IPasswordHasher } from '../infra/crypto/IPasswordHasher.ts';
import type { ITokenService } from '../infra/crypto/TokenService.ts';
import type { ISecureSettingsStore } from '../repositories/contracts/ISecureSettingsStore.ts';
import type { IApiTokenRepository, ISessionRepository, IUserRepository } from '../repositories/contracts/IUserRepository.ts';
import type { IApiTokenService, IAuthService, IUserService } from '../services/contracts/index.ts';
import type { ILoginThrottle } from '../services/auth/LoginThrottle.ts';
import type { AuthController } from '../http/controllers/AuthController.ts';
import type { UserController } from '../http/controllers/UserController.ts';
import type { AuthMiddleware } from '../http/middlewares/AuthMiddleware.ts';
import type { IGithubClient } from '../infra/github/IGithubClient.ts';
import type { IPackageIntel } from '../infra/packages/IPackageIntel.ts';
import type { IRepoIntrospectionRepository } from '../repositories/contracts/IRepoIntrospectionRepository.ts';
import type { IRepoMetricsRepository } from '../repositories/contracts/IRepoMetricsRepository.ts';
import type { IIntrospectionCheckpointRepository } from '../repositories/contracts/IIntrospectionCheckpointRepository.ts';
import type { IGithubSettingsService, IIntrospectionService, IMetricsService } from '../services/contracts/index.ts';
import type { RepoCollector } from '../services/github/RepoCollector.ts';
import type { ProcessCollector } from '../services/github/ProcessCollector.ts';
import type { ActivityCollector } from '../services/github/ActivityCollector.ts';
import type { CodeMapper, RepoAnalyzer } from '../services/github/RepoAnalyzer.ts';
import type { CodeScanner } from '../services/github/CodeScanner.ts';
import type { QualityScorer } from '../services/github/QualityScorer.ts';
import type { GithubController } from '../http/controllers/GithubController.ts';
import type { IGraphRepository } from '../repositories/contracts/IGraphRepository.ts';
import type { IGraphsService } from '../services/contracts/index.ts';
import { Token } from './Token.ts';

/** Todas as dependências resolvíveis. Tokens de repositories/services são tipados pela interface. */
export const TOKENS = {
  Config: new Token<AppConfig>('Config'),
  Database: new Token<PostgresDatabase>('Database'),
  EventBus: new Token<IEventBus>('EventBus'),
  EmbeddingProvider: new Token<IEmbeddingProvider>('EmbeddingProvider'),
  LlmProvider: new Token<ISwitchableLlm>('LlmProvider'),
  LlmProviderFactory: new Token<ILlmProviderFactory>('LlmProviderFactory'),
  SettingsRepository: new Token<ISettingsRepository>('SettingsRepository'),
  SecretCipher: new Token<ISecretCipher>('SecretCipher'),
  SecureSettings: new Token<ISecureSettingsStore>('SecureSettings'),
  PasswordHasher: new Token<IPasswordHasher>('PasswordHasher'),
  TokenService: new Token<ITokenService>('TokenService'),
  UserRepository: new Token<IUserRepository>('UserRepository'),
  SessionRepository: new Token<ISessionRepository>('SessionRepository'),
  ApiTokenRepository: new Token<IApiTokenRepository>('ApiTokenRepository'),
  LoginThrottle: new Token<ILoginThrottle>('LoginThrottle'),
  AuthService: new Token<IAuthService>('AuthService'),
  UserService: new Token<IUserService>('UserService'),
  ApiTokenService: new Token<IApiTokenService>('ApiTokenService'),
  AuthController: new Token<AuthController>('AuthController'),
  UserController: new Token<UserController>('UserController'),
  AuthMiddleware: new Token<AuthMiddleware>('AuthMiddleware'),
  LlmSettingsService: new Token<ILlmSettingsService>('LlmSettingsService'),
  LlmMentionExtractor: new Token<ILlmMentionExtractor>('LlmMentionExtractor'),
  SettingsController: new Token<SettingsController>('SettingsController'),
  GraphRepository: new Token<IGraphRepository>('GraphRepository'),
  GraphsService: new Token<IGraphsService>('GraphsService'),
  GithubClient: new Token<IGithubClient>('GithubClient'),
  PackageIntel: new Token<IPackageIntel>('PackageIntel'),
  RepoIntrospectionRepository: new Token<IRepoIntrospectionRepository>('RepoIntrospectionRepository'),
  RepoMetricsRepository: new Token<IRepoMetricsRepository>('RepoMetricsRepository'),
  IntrospectionCheckpointRepository: new Token<IIntrospectionCheckpointRepository>('IntrospectionCheckpointRepository'),
  GithubSettingsService: new Token<IGithubSettingsService>('GithubSettingsService'),
  RepoCollector: new Token<RepoCollector>('RepoCollector'),
  ProcessCollector: new Token<ProcessCollector>('ProcessCollector'),
  ActivityCollector: new Token<ActivityCollector>('ActivityCollector'),
  RepoAnalyzer: new Token<RepoAnalyzer>('RepoAnalyzer'),
  CodeScanner: new Token<CodeScanner>('CodeScanner'),
  CodeMapper: new Token<CodeMapper>('CodeMapper'),
  QualityScorer: new Token<QualityScorer>('QualityScorer'),
  IntrospectionService: new Token<IIntrospectionService>('IntrospectionService'),
  MetricsService: new Token<IMetricsService>('MetricsService'),
  GithubController: new Token<GithubController>('GithubController'),
  ObjectStorage: new Token<IObjectStorage>('ObjectStorage'),
  MarkdownFolder: new Token<IMarkdownFolder>('MarkdownFolder'),
  DocumentRepository: new Token<IDocumentRepository>('DocumentRepository'),
  WatchedFolderRepository: new Token<IWatchedFolderRepository>('WatchedFolderRepository'),
  MarkdownChunker: new Token<MarkdownChunker>('MarkdownChunker'),
  MentionService: new Token<IMentionService>('MentionService'),
  EmbeddingIndexer: new Token<IEmbeddingIndexer>('EmbeddingIndexer'),
  DocumentService: new Token<IDocumentService>('DocumentService'),
  SearchService: new Token<ISearchService>('SearchService'),
  RagService: new Token<IRagService>('RagService'),
  FolderWatchService: new Token<IFolderWatchService>('FolderWatchService'),
  GraphKnowledgeSync: new Token<IGraphKnowledgeSync>('GraphKnowledgeSync'),
  DocumentController: new Token<DocumentController>('DocumentController'),
  SearchController: new Token<SearchController>('SearchController'),

  NodeRepository: new Token<INodeRepository>('NodeRepository'),
  InterfaceRepository: new Token<IInterfaceRepository>('InterfaceRepository'),
  ConnectionRepository: new Token<IConnectionRepository>('ConnectionRepository'),
  CallSiteRepository: new Token<ICallSiteRepository>('CallSiteRepository'),

  NodeService: new Token<INodeService>('NodeService'),
  InterfaceService: new Token<IInterfaceService>('InterfaceService'),
  ConnectionService: new Token<IConnectionService>('ConnectionService'),
  CallSiteService: new Token<ICallSiteService>('CallSiteService'),
  GraphService: new Token<IGraphService>('GraphService'),
  ExchangeService: new Token<IExchangeService>('ExchangeService'),

  NodeController: new Token<NodeController>('NodeController'),
  InterfaceController: new Token<InterfaceController>('InterfaceController'),
  ConnectionController: new Token<ConnectionController>('ConnectionController'),
  CallSiteController: new Token<CallSiteController>('CallSiteController'),
  GraphController: new Token<GraphController>('GraphController'),

  ErrorHandler: new Token<ErrorHandler>('ErrorHandler'),
  HttpServer: new Token<HttpServer>('HttpServer'),
} as const;

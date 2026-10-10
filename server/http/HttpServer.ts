import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import express, { type Express } from 'express';
import type { AppConfig } from '../config/AppConfig.ts';
import type { IContainer } from '../di/Container.ts';
import type { AuthMiddleware } from './middlewares/AuthMiddleware.ts';
import type { ErrorHandler } from './middlewares/ErrorHandler.ts';
import { RateLimiter } from './middlewares/RateLimiter.ts';
import { SecurityHeaders } from './middlewares/SecurityHeaders.ts';
import type { PostgresDatabase } from '../infra/database/PostgresDatabase.ts';
import { buildApiRouter } from './routes.ts';

export class HttpServer {
  private readonly app: Express;

  constructor(
    private readonly config: AppConfig,
    container: IContainer,
    errorHandler: ErrorHandler,
    auth: AuthMiddleware,
    db: PostgresDatabase,
  ) {
    this.app = express();
    this.app.disable('x-powered-by');
    // Atrás de proxy reverso (comum em self-host), req.ip vem do X-Forwarded-For dos proxies confiáveis.
    this.app.set('trust proxy', config.trustProxy);
    this.app.use(new SecurityHeaders({ https: config.cookieSecure, imageOrigins: [new URL(config.storage.publicBaseUrl).origin] }).middleware);
    // Health check para orquestradores (não exige login e não toca em dados).
    this.app.get('/api/health', (_req, res) => {
      void db
        .get('SELECT 1 AS ok')
        .then(() => res.json({ status: 'ok' }))
        .catch(() => res.status(503).json({ status: 'db-unavailable' }));
    });
    this.app.use('/api', new RateLimiter(1200, 60_000).middleware);
    // 20 MB: relatórios de CI (SARIF/JUnit) podem ser grandes.
    this.app.use(express.json({ limit: '20mb' }));
    this.app.use('/api', auth.handle, buildApiRouter(container));
    this.serveFrontend();
    this.app.use(errorHandler.middleware);
  }

  start(): Server {
    return this.app.listen(this.config.port, () => console.log(`API em http://localhost:${this.config.port}`));
  }

  private serveFrontend(): void {
    const dir = this.config.staticDir;
    if (!fs.existsSync(dir)) return;
    this.app.use(express.static(dir));
    this.app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }
}

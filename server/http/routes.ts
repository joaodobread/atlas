import { Router } from 'express';
import type { IContainer } from '../di/Container.ts';
import { TOKENS } from '../di/tokens.ts';
import { RouteBinder } from './RouteBinder.ts';

/** Todas as rotas da API, cada uma com a permissão exigida. */
export function buildApiRouter(container: IContainer): Router {
  const router = Router();
  const config = container.resolve(TOKENS.Config);

  new RouteBinder(router, container, { secure: config.cookieSecure })
    // Autenticação
    .get('/auth/status', TOKENS.AuthController, 'status', 'public')
    .post('/auth/setup', TOKENS.AuthController, 'setup', 'public')
    .post('/auth/login', TOKENS.AuthController, 'login', 'public')
    .post('/auth/logout', TOKENS.AuthController, 'logout', 'public')
    .post('/auth/password', TOKENS.AuthController, 'changePassword', 'authenticated')
    .post('/auth/onboarding', TOKENS.AuthController, 'onboarding', 'authenticated')
    .get('/auth/tokens', TOKENS.AuthController, 'listTokens', 'authenticated')
    .post('/auth/tokens', TOKENS.AuthController, 'createToken', 'authenticated')
    .delete('/auth/tokens/:id', TOKENS.AuthController, 'revokeToken', 'authenticated')

    // Usuários
    .get('/users', TOKENS.UserController, 'list', 'users:manage')
    .post('/users', TOKENS.UserController, 'create', 'users:manage')
    .patch('/users/:id', TOKENS.UserController, 'update', 'users:manage')
    .delete('/users/:id', TOKENS.UserController, 'destroy', 'users:manage')

    // Grafo
    .get('/graphs', TOKENS.GraphController, 'list', 'graph:read')
    .post('/graphs', TOKENS.GraphController, 'create', 'graph:write')
    .post('/graphs/from-repos', TOKENS.GraphController, 'fromRepos', 'graph:write')
    .get('/graphs/:id', TOKENS.GraphController, 'show', 'graph:read')
    .patch('/graphs/:id', TOKENS.GraphController, 'update', 'graph:write')
    .delete('/graphs/:id', TOKENS.GraphController, 'destroy', 'graph:write')
    .get('/graphs/:id/export', TOKENS.GraphController, 'export', 'graph:read')
    .post('/graphs/:id/import', TOKENS.GraphController, 'import', 'graph:write')
    .resource('/nodes', TOKENS.NodeController, 'graph:read', 'graph:write')
    .resource('/interfaces', TOKENS.InterfaceController, 'graph:read', 'graph:write')
    .resource('/connections', TOKENS.ConnectionController, 'graph:read', 'graph:write')
    .resource('/call-sites', TOKENS.CallSiteController, 'graph:read', 'graph:write')

    // Documentos / RAG
    .get('/documents', TOKENS.DocumentController, 'list', 'docs:read')
    .post('/documents', TOKENS.DocumentController, 'upsert', 'docs:write')
    .post('/documents/import', TOKENS.DocumentController, 'import', 'docs:write')
    .get('/documents/:id', TOKENS.DocumentController, 'show', 'docs:read')
    .delete('/documents/:id', TOKENS.DocumentController, 'destroy', 'docs:write')
    .get('/nodes/:id/mentions', TOKENS.DocumentController, 'mentionsOfNode', 'docs:read')
    .get('/search', TOKENS.SearchController, 'search', 'docs:read')
    .post('/ask', TOKENS.SearchController, 'ask', 'docs:read')
    .get('/index-status', TOKENS.SearchController, 'status', 'docs:read')
    .get('/llm', TOKENS.SearchController, 'llm', 'docs:read')
    .post('/mentions/reprocess', TOKENS.SearchController, 'reprocessMentions', 'docs:write')
    // Pastas leem o disco do servidor: só administradores.
    .get('/folders', TOKENS.DocumentController, 'listFolders', 'docs:read')
    .post('/folders', TOKENS.DocumentController, 'addFolder', 'settings:manage')
    .delete('/folders/:id', TOKENS.DocumentController, 'removeFolder', 'settings:manage')
    .post('/folders/:id/rescan', TOKENS.DocumentController, 'rescanFolder', 'docs:write')

    // Configurações
    .get('/settings/llm', TOKENS.SettingsController, 'getLlm', 'settings:manage')
    .put('/settings/llm', TOKENS.SettingsController, 'updateLlm', 'settings:manage')
    .post('/settings/llm/test', TOKENS.SettingsController, 'testLlm', 'settings:manage')
    .get('/settings/github', TOKENS.GithubController, 'getSettings', 'settings:manage')
    .put('/settings/github', TOKENS.GithubController, 'updateSettings', 'settings:manage')
    .post('/settings/github/test', TOKENS.GithubController, 'testSettings', 'settings:manage')

    // Repositórios do GitHub (introspecção) e métricas de CI
    .get('/repos', TOKENS.GithubController, 'list', 'graph:read')
    .post('/repos/sync', TOKENS.GithubController, 'sync', 'graph:write')
    .post('/repos/introspect', TOKENS.GithubController, 'run', 'graph:write')
    .get('/repos/state', TOKENS.GithubController, 'state', 'graph:read')
    .get('/repos/:id', TOKENS.GithubController, 'show', 'graph:read')
    .post('/repos/:id/apply', TOKENS.GithubController, 'apply', 'graph:write')
    .post('/metrics', TOKENS.GithubController, 'ingestMetrics', 'metrics:write')
    .get('/metrics/:owner/:repo', TOKENS.GithubController, 'metricsHistory', 'graph:read')

    // Relatório de segurança/DevSecOps (gerar usa o LLM: editores)
    .get('/reports/security', TOKENS.ReportController, 'securityPortfolio', 'graph:read')
    .get('/reports/security/repos/:owner/:repo', TOKENS.ReportController, 'securityRepo', 'graph:read')
    .post('/reports/security', TOKENS.ReportController, 'generateSecurity', 'graph:write');

  return router;
}

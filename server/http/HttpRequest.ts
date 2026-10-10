import type { AuthUser } from '../core/auth/AuthUser.ts';

/** Dados de entrada de uma action, desacoplados do Express. Corpo e parâmetros são `unknown`: valide com zod. */
export interface HttpRequest {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  /** Usuário autenticado (null em rotas públicas sem login). */
  user: AuthUser | null;
  cookies: Record<string, string>;
  ip: string | null;
  userAgent: string | null;
}

import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../../core/auth/AuthUser.ts';
import type { IAuthService } from '../../services/contracts/index.ts';

export const SESSION_COOKIE = 'cg_session';
/** Header exigido em requisições que alteram dados (proteção CSRF simples para cookies). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'comm-graph';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // cookie malformado: ignora
    }
  }
  return out;
}

/** Resolve o usuário (cookie de sessão ou Bearer) e barra mutações sem o header anti-CSRF. */
export class AuthMiddleware {
  constructor(private readonly auth: IAuthService) {}

  readonly handle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cookies = parseCookies(req.headers.cookie);
    const authorization = req.headers.authorization;
    const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : null;

    // Navegadores não enviam headers customizados em requisições cross-site sem CORS: basta exigir um.
    if (!SAFE_METHODS.has(req.method) && !bearerToken && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      res.status(403).json({ error: 'Requisição sem o header de proteção CSRF' });
      return;
    }

    try {
      const user: AuthUser | null = await this.auth.authenticate({ sessionToken: cookies[SESSION_COOKIE] ?? null, bearerToken });
      res.locals.user = user;
      res.locals.cookies = cookies;
      next();
    } catch (err) {
      next(err);
    }
  };
}

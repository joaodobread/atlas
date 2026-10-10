import type { NextFunction, Request, Response, Router } from 'express';
import type { Permission } from '../../shared/constants.ts';
import type { AuthUser } from '../core/auth/AuthUser.ts';
import { ForbiddenError, UnauthorizedError } from '../core/errors/AppError.ts';
import type { IContainer } from '../di/Container.ts';
import type { Token } from '../di/Token.ts';
import type { HttpRequest } from './HttpRequest.ts';
import type { HttpResponse } from './HttpResponse.ts';

type Action = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

/** Nomes de métodos de C que são actions válidas. */
type ActionOf<C> = {
  [K in keyof C]: C[K] extends Action ? K : never;
}[keyof C] &
  string;

/** Quem pode chamar a rota: uma permissão, qualquer usuário logado, ou público. */
export type Access = Permission | 'authenticated' | 'public';

export interface CookieOptions {
  secure: boolean;
}

/**
 * Liga rotas Express a actions de controllers registrados no container, exigindo a permissão declarada.
 * O controller é resolvido no entry point de cada requisição:
 *
 *   routes.get('/nodes/:id', TOKENS.NodeController, 'show', 'graph:read');
 */
export class RouteBinder {
  constructor(
    private readonly router: Router,
    private readonly container: IContainer,
    private readonly cookieOptions: CookieOptions,
  ) {}

  get<C>(path: string, token: Token<C>, action: ActionOf<C>, access: Access): this {
    this.router.get(path, this.handler(token, action, access));
    return this;
  }

  post<C>(path: string, token: Token<C>, action: ActionOf<C>, access: Access): this {
    this.router.post(path, this.handler(token, action, access));
    return this;
  }

  put<C>(path: string, token: Token<C>, action: ActionOf<C>, access: Access): this {
    this.router.put(path, this.handler(token, action, access));
    return this;
  }

  patch<C>(path: string, token: Token<C>, action: ActionOf<C>, access: Access): this {
    this.router.patch(path, this.handler(token, action, access));
    return this;
  }

  delete<C>(path: string, token: Token<C>, action: ActionOf<C>, access: Access): this {
    this.router.delete(path, this.handler(token, action, access));
    return this;
  }

  /** list/show exigem `read`; create/update/destroy exigem `write`. */
  resource<C>(path: string, token: Token<C>, read: Permission, write: Permission): this {
    const t = token as Token<Record<'list' | 'show' | 'create' | 'update' | 'destroy', Action>>;
    return this.get(path, t, 'list', read)
      .get(`${path}/:id`, t, 'show', read)
      .post(path, t, 'create', write)
      .patch(`${path}/:id`, t, 'update', write)
      .delete(`${path}/:id`, t, 'destroy', write);
  }

  private handler<C>(token: Token<C>, action: ActionOf<C>, access: Access) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = (res.locals.user as AuthUser | null | undefined) ?? null;
        if (access !== 'public') {
          if (!user) throw new UnauthorizedError('Faça login para continuar');
          if (access !== 'authenticated' && !user.can(access)) throw new ForbiddenError('Você não tem permissão para esta ação');
        }

        const controller = this.container.resolve(token);
        const fn = controller[action] as unknown as Action;
        const result = await fn.call(controller, {
          params: req.params,
          query: req.query as Record<string, unknown>,
          body: req.body as unknown,
          user,
          cookies: (res.locals.cookies as Record<string, string> | undefined) ?? {},
          ip: req.ip ?? null,
          userAgent: req.get('user-agent') ?? null,
        });

        for (const c of result.cookies ?? []) {
          const options = { httpOnly: true, sameSite: 'lax' as const, secure: this.cookieOptions.secure, path: '/' };
          if (c.value === null) res.clearCookie(c.name, options);
          else res.cookie(c.name, c.value, { ...options, expires: c.expires });
        }
        res.status(result.status);
        if (result.body === undefined) res.end();
        else res.json(result.body);
      } catch (err) {
        next(err);
      }
    };
  }
}

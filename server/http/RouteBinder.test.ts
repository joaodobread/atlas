import type { Request, Response, Router } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AuthUser } from '../core/auth/AuthUser.ts';
import { ForbiddenError, UnauthorizedError } from '../core/errors/AppError.ts';
import { Container } from '../di/Container.ts';
import { Token } from '../di/Token.ts';
import type { User } from '../../shared/types.ts';
import type { IIntrospectionService } from '../services/contracts/index.ts';
import { GithubController } from './controllers/GithubController.ts';
import type { HttpRequest } from './HttpRequest.ts';
import type { HttpResponse } from './HttpResponse.ts';
import { RouteBinder } from './RouteBinder.ts';

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<void>;

class EchoController {
  last: HttpRequest | null = null;
  async echo(req: HttpRequest): Promise<HttpResponse> {
    this.last = req;
    return {
      status: 200,
      body: { ok: true },
      cookies: [
        { name: 'a', value: 'b' },
        { name: 'c', value: null },
      ],
    };
  }
  async empty(): Promise<HttpResponse> {
    return { status: 204 };
  }
}

const ECHO = new Token<EchoController>('Echo');

/** Router falso que só guarda os handlers registrados. */
function fakeRouter() {
  const routes: Array<{ method: string; path: string; handler: Handler }> = [];
  const add = (method: string) => (path: string, handler: Handler) => routes.push({ method, path, handler });
  const router = { get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete') } as unknown as Router;
  return { router, routes };
}

function fakeRes(locals: Record<string, unknown> = {}) {
  const res = {
    locals,
    statusCode: 0,
    body: undefined as unknown,
    ended: false,
    cookies: [] as Array<{ name: string; value?: string; options: Record<string, unknown> }>,
    cleared: [] as string[],
    jsonCalls: 0,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(b: unknown) {
      res.jsonCalls++;
      res.body = b;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      res.cookies.push({ name, value, options });
      return res;
    },
    clearCookie(name: string) {
      res.cleared.push(name);
      return res;
    },
  };
  return res;
}

const fakeReq = (extra: Record<string, unknown> = {}) =>
  ({ params: { id: '1' }, query: { q: 'x' }, body: { b: 1 }, ip: undefined, get: () => undefined, ...extra }) as unknown as Request;

const user = (role: User['role']) =>
  new AuthUser({ id: 7, email: 'u@x.dev', name: 'U', role, active: true, created_at: '', last_login_at: null, onboarded_at: null }, 'session');

describe('RouteBinder', () => {
  const setup = (secure = false) => {
    const controller = new EchoController();
    const container = new Container().value(ECHO, controller);
    const { router, routes } = fakeRouter();
    const binder = new RouteBinder(router, container, { secure });
    return { controller, binder, routes };
  };

  it('registra todos os verbos e o resource padrão', () => {
    const { binder, routes } = setup();
    binder
      .get('/a', ECHO, 'echo', 'public')
      .post('/a', ECHO, 'echo', 'public')
      .put('/a', ECHO, 'echo', 'public')
      .patch('/a', ECHO, 'echo', 'public')
      .delete('/a', ECHO, 'echo', 'public')
      .resource('/r', ECHO as unknown as Token<Record<'list' | 'show' | 'create' | 'update' | 'destroy', () => HttpResponse>>, 'graph:read', 'graph:write');
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'get /a',
      'post /a',
      'put /a',
      'patch /a',
      'delete /a',
      'get /r',
      'get /r/:id',
      'post /r',
      'patch /r/:id',
      'delete /r/:id',
    ]);
  });

  it('rota pública sem middleware de auth: usuário null, cookies vazios, ip/user-agent null', async () => {
    const { binder, routes, controller } = setup(true);
    binder.get('/a', ECHO, 'echo', 'public');
    const res = fakeRes();
    const next = vi.fn<(err?: unknown) => void>();
    await routes[0]!.handler(fakeReq(), res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(controller.last).toEqual({ params: { id: '1' }, query: { q: 'x' }, body: { b: 1 }, user: null, cookies: {}, ip: null, userAgent: null });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.cookies[0]).toMatchObject({ name: 'a', value: 'b', options: { httpOnly: true, sameSite: 'lax', secure: true, path: '/' } });
    expect(res.cleared).toEqual(['c']);
  });

  it('repassa ip, user-agent, cookies e usuário do middleware', async () => {
    const { binder, routes, controller } = setup();
    binder.get('/a', ECHO, 'echo', 'authenticated');
    const u = user('viewer');
    await routes[0]!.handler(
      fakeReq({ ip: '1.2.3.4', get: (h: string) => (h === 'user-agent' ? 'UA' : undefined) }),
      fakeRes({ user: u, cookies: { k: 'v' } }) as unknown as Response,
      vi.fn<(err?: unknown) => void>(),
    );
    expect(controller.last).toMatchObject({ user: u, cookies: { k: 'v' }, ip: '1.2.3.4', userAgent: 'UA' });
  });

  it('resposta sem corpo encerra sem JSON', async () => {
    const { binder, routes } = setup();
    binder.delete('/a', ECHO, 'empty', 'public');
    const res = fakeRes();
    await routes[0]!.handler(fakeReq(), res as unknown as Response, vi.fn<(err?: unknown) => void>());
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.jsonCalls).toBe(0);
  });

  it('sem login → UnauthorizedError; sem permissão → ForbiddenError', async () => {
    const { binder, routes } = setup();
    binder.get('/a', ECHO, 'echo', 'graph:write').get('/b', ECHO, 'echo', 'authenticated');
    const next = vi.fn<(err?: unknown) => void>();
    await routes[0]!.handler(fakeReq(), fakeRes() as unknown as Response, next);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(UnauthorizedError);
    await routes[0]!.handler(fakeReq(), fakeRes({ user: user('viewer') }) as unknown as Response, next);
    expect(next.mock.calls[1]![0]).toBeInstanceOf(ForbiddenError);
    const res = fakeRes({ user: user('editor') });
    await routes[0]!.handler(fakeReq(), res as unknown as Response, next);
    expect(res.statusCode).toBe(200);
    await routes[1]!.handler(fakeReq(), fakeRes() as unknown as Response, next);
    expect(next.mock.calls[2]![0]).toBeInstanceOf(UnauthorizedError);
  });
});

describe('GithubController.run', () => {
  it('corpo ausente vale como {} (todos os repositórios, profundidade média)', async () => {
    const run = vi.fn<IIntrospectionService['run']>(async () => ({ running: false, queued: 0, current: null, done: 0, failed: 0, progress: [] }));
    const controller = new GithubController({} as never, { run } as unknown as IIntrospectionService, {} as never);
    const res = await controller.run({ params: {}, query: {}, body: undefined, user: null, cookies: {}, ip: null, userAgent: null });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ force: false, depth: 'medium' });
  });
});

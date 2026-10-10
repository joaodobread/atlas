import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AuthUser } from '../../core/auth/AuthUser.ts';
import { NotFoundError } from '../../core/errors/AppError.ts';
import type { IAuthService } from '../../services/contracts/index.ts';
import { AuthMiddleware, parseCookies } from './AuthMiddleware.ts';
import { ErrorHandler } from './ErrorHandler.ts';
import { RateLimiter } from './RateLimiter.ts';
import { SecurityHeaders } from './SecurityHeaders.ts';

/** Response mínima do Express que registra o que foi enviado. */
function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    setHeader(k: string, v: string) {
      res.headers[k] = v;
      return res;
    },
  };
  return res;
}
const asRes = (r: ReturnType<typeof fakeRes>) => r as unknown as Response;
const asReq = (r: Partial<Request> | Record<string, unknown>) => r as unknown as Request;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RateLimiter', () => {
  it('permite até o máximo na janela e bloqueia depois', () => {
    let now = 1_000;
    const rl = new RateLimiter(2, 60_000, () => now);
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(false);
    expect(rl.take('b')).toBe(true);
    now += 60_000;
    expect(rl.take('a')).toBe(true);
  });

  it('usa Date.now por padrão', () => {
    const rl = new RateLimiter(1, 1_000);
    expect(rl.take('x')).toBe(true);
    expect(rl.take('x')).toBe(false);
  });

  it('middleware responde 429 com Retry-After ao estourar', () => {
    let now = 0;
    const rl = new RateLimiter(1, 30_500, () => now);
    const next = vi.fn<(err?: unknown) => void>();
    const res1 = fakeRes();
    rl.middleware(asReq({ ip: '10.0.0.1' }), asRes(res1), next);
    expect(next).toHaveBeenCalledTimes(1);

    const res2 = fakeRes();
    rl.middleware(asReq({ ip: '10.0.0.1' }), asRes(res2), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res2.statusCode).toBe(429);
    expect(res2.headers['Retry-After']).toBe('31');
    expect(res2.body).toEqual({ error: 'Muitas requisições; tente de novo em instantes' });

    now = 30_500;
    rl.middleware(asReq({ ip: '10.0.0.1' }), asRes(fakeRes()), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('sem IP conhecido agrupa em "unknown"', () => {
    const rl = new RateLimiter(1, 1_000, () => 0);
    const next = vi.fn<(err?: unknown) => void>();
    rl.middleware(asReq({ ip: undefined }), asRes(fakeRes()), next);
    const res = fakeRes();
    rl.middleware(asReq({ ip: undefined }), asRes(res), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(429);
  });

  it('limpa entradas expiradas quando o mapa passa de 10 mil chaves', () => {
    let now = 0;
    const rl = new RateLimiter(1, 1_000, () => now);
    for (let i = 0; i < 10_000; i++) rl.take(`k${i}`);
    now = 5_000;
    // A 10.001ª chave dispara a varredura: as antigas (expiradas) saem.
    expect(rl.take('nova')).toBe(true);
    const hits = (rl as unknown as { hits: Map<string, unknown> }).hits;
    expect(hits.size).toBe(1);
    expect(hits.has('nova')).toBe(true);
  });

  it('a varredura mantém as entradas ainda válidas', () => {
    const now = 0;
    const rl = new RateLimiter(1, 1_000, () => now);
    for (let i = 0; i <= 10_000; i++) rl.take(`k${i}`);
    const hits = (rl as unknown as { hits: Map<string, unknown> }).hits;
    expect(hits.size).toBe(10_001);
  });
});

describe('SecurityHeaders', () => {
  it('aplica CSP, anti-iframe e nosniff; sem HSTS fora de HTTPS', () => {
    const res = fakeRes();
    const next = vi.fn<(err?: unknown) => void>();
    new SecurityHeaders({ https: false, imageOrigins: [] }).middleware(asReq({}), asRes(res), next);
    expect(next).toHaveBeenCalled();
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Security-Policy']).toContain("img-src 'self' data: blob:;");
    expect(res.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('liga HSTS em HTTPS e inclui as origens extras de imagens', () => {
    const res = fakeRes();
    new SecurityHeaders({ https: true, imageOrigins: ['https://cdn.acme.dev'] }).middleware(asReq({}), asRes(res), vi.fn<(err?: unknown) => void>());
    expect(res.headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['Content-Security-Policy']).toContain("img-src 'self' data: blob: https://cdn.acme.dev");
  });
});

describe('ErrorHandler', () => {
  const handler = new ErrorHandler();
  const run = (err: unknown) => {
    const res = fakeRes();
    handler.middleware(err, asReq({}), asRes(res), vi.fn<(err?: unknown) => void>() as unknown as NextFunction);
    return res;
  };

  it('erros do zod viram 400 com os caminhos', () => {
    const parsed = z.object({ a: z.object({ b: z.number() }) }).safeParse({ a: { b: 'x' } });
    const res = run(parsed.error);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Dados inválidos', issues: [{ path: 'a.b', message: expect.any(String) as string }] });
  });

  it('AppError usa o próprio status e detalhes', () => {
    const res = run(new NotFoundError('Nada aqui', { id: 1 }));
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Nada aqui', details: { id: 1 } });
  });

  it('SyntaxError do body-parser vira 400', () => {
    const err = Object.assign(new SyntaxError('Unexpected token'), { body: '{' });
    const res = run(err);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'JSON inválido' });
  });

  it('SyntaxError sem body e erros desconhecidos viram 500 sem vazar detalhes', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = run(new SyntaxError('de outro lugar'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno' });
    const res2 = run('string lançada');
    expect(res2.statusCode).toBe(500);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('parseCookies', () => {
  it('lê pares, decodifica e ignora malformados', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('=semnome; a=1; b=x%20y; semvalor; c=%E0%A4%A')).toEqual({ a: '1', b: 'x y' });
    expect(parseCookies('t=a=b')).toEqual({ t: 'a=b' });
  });
});

describe('AuthMiddleware', () => {
  const user = { id: 1 } as unknown as AuthUser;
  const service = (impl: IAuthService['authenticate']) => ({ authenticate: vi.fn<IAuthService['authenticate']>(impl) });

  it('GET sem CSRF passa e resolve o usuário pelo cookie de sessão', async () => {
    const auth = service(async () => user);
    const res = fakeRes();
    const next = vi.fn<(err?: unknown) => void>();
    await new AuthMiddleware(auth as unknown as IAuthService).handle(asReq({ method: 'GET', headers: { cookie: 'cg_session=abc; x=1' } }), asRes(res), next);
    expect(auth.authenticate).toHaveBeenCalledWith({ sessionToken: 'abc', bearerToken: null });
    expect(res.locals.user).toBe(user);
    expect(res.locals.cookies).toEqual({ cg_session: 'abc', x: '1' });
    expect(next).toHaveBeenCalledWith();
  });

  it('mutação sem o header anti-CSRF recebe 403 e nem autentica', async () => {
    const auth = service(async () => user);
    const res = fakeRes();
    const next = vi.fn<(err?: unknown) => void>();
    await new AuthMiddleware(auth as unknown as IAuthService).handle(asReq({ method: 'POST', headers: { 'x-requested-with': 'outro' } }), asRes(res), next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(auth.authenticate).not.toHaveBeenCalled();
  });

  it('mutação com header CSRF passa', async () => {
    const auth = service(async () => null);
    const next = vi.fn<(err?: unknown) => void>();
    await new AuthMiddleware(auth as unknown as IAuthService).handle(
      asReq({ method: 'DELETE', headers: { 'x-requested-with': 'comm-graph' } }),
      asRes(fakeRes()),
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('Bearer dispensa o header CSRF', async () => {
    const auth = service(async () => user);
    const next = vi.fn<(err?: unknown) => void>();
    await new AuthMiddleware(auth as unknown as IAuthService).handle(
      asReq({ method: 'POST', headers: { authorization: 'Bearer  cgt_x ' } }),
      asRes(fakeRes()),
      next,
    );
    expect(auth.authenticate).toHaveBeenCalledWith({ sessionToken: null, bearerToken: 'cgt_x' });
    expect(next).toHaveBeenCalledWith();
  });

  it('Authorization que não é Bearer é ignorado (e não dispensa CSRF)', async () => {
    const auth = service(async () => user);
    const res = fakeRes();
    await new AuthMiddleware(auth as unknown as IAuthService).handle(
      asReq({ method: 'PUT', headers: { authorization: 'Basic abc' } }),
      asRes(res),
      vi.fn<(err?: unknown) => void>(),
    );
    expect(res.statusCode).toBe(403);
  });

  it('erro ao autenticar segue para o handler de erros', async () => {
    const boom = new Error('banco fora');
    const auth = service(async () => {
      throw boom;
    });
    const next = vi.fn<(err?: unknown) => void>();
    await new AuthMiddleware(auth as unknown as IAuthService).handle(asReq({ method: 'GET', headers: {} }), asRes(fakeRes()), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

import type { NextFunction, Request, Response } from 'express';

/**
 * Limite de requisições por IP em janela fixa (em memória; por instância).
 * Protege a API de abuso simples; o login tem o seu próprio limite por e-mail/IP.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** true = permitido. */
  take(key: string): boolean {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(t);
      return true;
    }
    entry.count++;
    return entry.count <= this.max;
  }

  readonly middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (this.take(req.ip ?? 'unknown')) return next();
    res.setHeader('Retry-After', String(Math.ceil(this.windowMs / 1000)));
    res.status(429).json({ error: 'Muitas requisições; tente de novo em instantes' });
  };

  private sweep(t: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}

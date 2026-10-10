import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../core/errors/AppError.ts';

export class ErrorHandler {
  /** Middleware de erro do Express (precisa ter 4 parâmetros). */
  readonly middleware = (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Dados inválidos',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'JSON inválido' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  };
}

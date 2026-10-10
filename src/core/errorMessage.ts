import { ZodError } from 'zod';
import { HttpError } from './http/HttpError.ts';

export function errorMessage(err: unknown): string {
  if (err instanceof HttpError) return err.detailed;
  if (err instanceof ZodError) return err.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; ');
  if (err instanceof Error) return err.message;
  return String(err);
}

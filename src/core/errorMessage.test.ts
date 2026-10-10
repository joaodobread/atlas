import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorMessage } from './errorMessage.ts';
import { HttpError } from './http/HttpError.ts';

describe('errorMessage', () => {
  it('HttpError usa a mensagem detalhada', () => {
    expect(errorMessage(new HttpError(400, 'Inválido', [{ path: 'a', message: 'b' }]))).toBe('Inválido: a: b');
  });

  it('ZodError lista os campos (ou "valor" sem caminho)', () => {
    const r = z.object({ name: z.string().min(1, 'Obrigatório') }).safeParse({ name: '' });
    expect(errorMessage(r.success ? null : r.error)).toBe('name: Obrigatório');
    const r2 = z.string().safeParse(1);
    expect(errorMessage(r2.success ? null : r2.error)).toMatch(/^valor: /);
  });

  it('Error comum e valores quaisquer', () => {
    expect(errorMessage(new Error('falhou'))).toBe('falhou');
    expect(errorMessage('texto')).toBe('texto');
    expect(errorMessage(42)).toBe('42');
  });
});

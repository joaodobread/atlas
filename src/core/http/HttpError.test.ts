import { describe, expect, it } from 'vitest';
import { HttpError } from './HttpError.ts';

describe('HttpError', () => {
  it('sem issues, detailed é a própria mensagem', () => {
    const e = new HttpError(404, 'Não encontrado');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('HttpError');
    expect(e.status).toBe(404);
    expect(e.issues).toEqual([]);
    expect(e.detailed).toBe('Não encontrado');
  });

  it('com issues, inclui campo e mensagem', () => {
    const e = new HttpError(400, 'Dados inválidos', [
      { path: 'name', message: 'Obrigatório' },
      { path: '', message: 'Geral' },
    ]);
    expect(e.detailed).toBe('Dados inválidos: name: Obrigatório; Geral');
  });
});

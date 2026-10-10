import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TokenService } from './TokenService.ts';

describe('TokenService', () => {
  const tokens = new TokenService();

  it('gera token com o prefixo e 256 bits aleatórios em base64url', () => {
    const t = tokens.generate('cgs');
    expect(t).toMatch(/^cgs_[\w-]{43}$/);
    expect(Buffer.from(t.slice(4), 'base64url')).toHaveLength(32);
  });

  it('gera tokens diferentes a cada chamada', () => {
    const set = new Set(Array.from({ length: 50 }, () => tokens.generate('cgt')));
    expect(set.size).toBe(50);
  });

  it('hash é sha256 hex determinístico e não contém o token', () => {
    const t = tokens.generate('cgt');
    const h = tokens.hash(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(crypto.createHash('sha256').update(t).digest('hex'));
    expect(tokens.hash(t)).toBe(h);
    expect(tokens.hash(`${t}x`)).not.toBe(h);
  });
});

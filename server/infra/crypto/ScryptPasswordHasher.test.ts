import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from './ScryptPasswordHasher.ts';

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  it('gera hash no formato scrypt$N$r$p$salt$hash e verifica a senha correta', async () => {
    const stored = await hasher.hash('s3nh@forte');
    const parts = stored.split('$');
    expect(parts).toHaveLength(6);
    expect(parts.slice(0, 4)).toEqual(['scrypt', '32768', '8', '1']);
    expect(Buffer.from(parts[4], 'base64url')).toHaveLength(16);
    expect(Buffer.from(parts[5], 'base64url')).toHaveLength(64);
    expect(stored).not.toContain('s3nh@forte');
    await expect(hasher.verify('s3nh@forte', stored)).resolves.toBe(true);
  });

  it('rejeita senha errada', async () => {
    const stored = await hasher.hash('correta');
    await expect(hasher.verify('errada', stored)).resolves.toBe(false);
  });

  it('usa salt aleatório: mesma senha gera hashes diferentes', async () => {
    expect(await hasher.hash('igual')).not.toBe(await hasher.hash('igual'));
  });

  it('normaliza unicode (NFKC) antes de derivar', async () => {
    const stored = await hasher.hash('Amélia'); // "e" + acento combinante
    await expect(hasher.verify('Amélia', stored)).resolves.toBe(true);
  });

  it('respeita os parâmetros gravados no hash (compatível com custos diferentes)', async () => {
    const stored = await hasher.hash('x');
    const [, , r, p, salt, hash] = stored.split('$');
    // Mesmos dados, N declarado diferente -> chave diferente -> não confere.
    await expect(hasher.verify('x', ['scrypt', 16384, r, p, salt, hash].join('$'))).resolves.toBe(false);
  });

  it.each([
    ['algoritmo desconhecido', 'bcrypt$32768$8$1$abc$def'],
    ['partes faltando', 'scrypt$32768$8$1$abc'],
    ['vazio', ''],
    ['salt vazio', 'scrypt$32768$8$1$$def'],
  ])('retorna false para hash armazenado inválido (%s)', async (_label, stored) => {
    await expect(hasher.verify('qualquer', stored)).resolves.toBe(false);
  });
});

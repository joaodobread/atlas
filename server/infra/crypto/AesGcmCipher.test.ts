import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AesGcmCipher } from './AesGcmCipher.ts';

describe('AesGcmCipher', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-cipher-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('fromSecret', () => {
    it('cifra e decifra ida e volta (inclusive unicode e texto vazio)', () => {
      const c = AesGcmCipher.fromSecret('segredo');
      for (const plain of ['sk-ant-123', 'ação ✓ 日本', '']) {
        const enc = c.encrypt(plain);
        expect(enc).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]*$/);
        expect(enc).not.toContain(plain || '\u0000');
        expect(c.decrypt(enc)).toBe(plain);
      }
    });

    it('usa IV aleatório: o mesmo texto gera cifras diferentes', () => {
      const c = AesGcmCipher.fromSecret('segredo');
      expect(c.encrypt('x')).not.toBe(c.encrypt('x'));
    });

    it('é determinística na chave: outra instância com o mesmo segredo decifra', () => {
      const enc = AesGcmCipher.fromSecret('abc').encrypt('valor');
      expect(AesGcmCipher.fromSecret('abc').decrypt(enc)).toBe('valor');
    });

    it('falha ao decifrar com outro segredo', () => {
      const enc = AesGcmCipher.fromSecret('abc').encrypt('valor');
      expect(() => AesGcmCipher.fromSecret('outro').decrypt(enc)).toThrow(/unable to authenticate data/);
    });
  });

  describe('decrypt', () => {
    const c = AesGcmCipher.fromSecret('segredo');

    it('detecta adulteração dos dados', () => {
      const [v, iv, tag, data] = c.encrypt('importante').split(':');
      const bytes = Buffer.from(data, 'base64url');
      bytes[0] = bytes[0] ^ 0xff;
      expect(() => c.decrypt([v, iv, tag, bytes.toString('base64url')].join(':'))).toThrow(/unable to authenticate data/);
    });

    it('detecta adulteração da tag de autenticação', () => {
      const [v, iv, tag, data] = c.encrypt('importante').split(':');
      const bytes = Buffer.from(tag, 'base64url');
      bytes[0] = bytes[0] ^ 0x01;
      expect(() => c.decrypt([v, iv, bytes.toString('base64url'), data].join(':'))).toThrow(/unable to authenticate data/);
    });

    it.each([
      ['versão desconhecida', 'v2:aaa:bbb:ccc'],
      ['partes faltando', 'v1:aaa:bbb'],
      ['iv vazio', 'v1::bbb:ccc'],
      ['tag vazia', 'v1:aaa::ccc'],
      ['texto qualquer', 'não é cifra'],
    ])('rejeita formato inválido (%s)', (_label, payload) => {
      expect(() => c.decrypt(payload)).toThrow('Formato de dado criptografado inválido');
    });
  });

  describe('fromKeyFile', () => {
    it('cria a chave (32 bytes, 0600) quando o arquivo não existe, inclusive em pasta nova', () => {
      const file = path.join(dir, 'sub', 'dir', 'secret.key');
      const c = AesGcmCipher.fromKeyFile(file);
      expect(fs.existsSync(file)).toBe(true);
      expect(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64').length).toBe(32);
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(file));
      expect(c.decrypt(c.encrypt('ok'))).toBe('ok');
    });

    it('reaproveita a chave existente (outra instância decifra) sem recriar o arquivo', () => {
      const file = path.join(dir, 'secret.key');
      const enc = AesGcmCipher.fromKeyFile(file).encrypt('persistido');
      const before = fs.readFileSync(file, 'utf8');
      vi.mocked(console.log).mockClear();
      expect(AesGcmCipher.fromKeyFile(file).decrypt(enc)).toBe('persistido');
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
      expect(console.log).not.toHaveBeenCalled();
    });

    it('aceita espaços/quebra de linha em volta da chave', () => {
      const file = path.join(dir, 'secret.key');
      fs.writeFileSync(file, `  ${Buffer.alloc(32, 7).toString('base64')}\n`);
      expect(() => AesGcmCipher.fromKeyFile(file)).not.toThrow(/unable to authenticate data/);
    });

    it('rejeita arquivo com chave de tamanho errado', () => {
      const file = path.join(dir, 'secret.key');
      fs.writeFileSync(file, Buffer.alloc(16).toString('base64'));
      expect(() => AesGcmCipher.fromKeyFile(file)).toThrow(/Chave inválida/);
    });
  });
});

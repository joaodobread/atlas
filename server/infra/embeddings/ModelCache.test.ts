import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryObjectStorage } from '../../../test/support/MemoryObjectStorage.ts';
import { BucketModelCache } from './ModelCache.ts';

const MODEL = 'Xenova/multilingual-e5-small';
const PREFIX = 'models/Xenova/multilingual-e5-small/';

describe('BucketModelCache', () => {
  let dir: string;
  let storage: MemoryObjectStorage;
  let cache: BucketModelCache;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-models-'));
    storage = new MemoryObjectStorage();
    cache = new BucketModelCache(storage, dir);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const writeLocal = (rel: string, content: string) => {
    const file = path.join(dir, MODEL, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  describe('persist', () => {
    it('envia todos os arquivos do modelo (recursivo) para o bucket privado', async () => {
      writeLocal('config.json', '{"a":1}');
      writeLocal('onnx/model_quantized.onnx', 'binário');
      await cache.persist(MODEL);
      expect([...storage.objects.keys()].sort()).toEqual([`private:${PREFIX}config.json`, `private:${PREFIX}onnx/model_quantized.onnx`]);
      const obj = storage.objects.get(`private:${PREFIX}onnx/model_quantized.onnx`)!;
      expect(new TextDecoder().decode(obj.body)).toBe('binário');
      expect(obj.contentType).toBe('application/octet-stream');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2 arquivo(s)'));
    });

    it('não envia de novo se o bucket já tem o modelo', async () => {
      writeLocal('config.json', 'novo');
      await storage.put('private', `${PREFIX}config.json`, 'antigo', 'application/octet-stream');
      const put = vi.spyOn(storage, 'put');
      await cache.persist(MODEL);
      expect(put).not.toHaveBeenCalled();
      expect(new TextDecoder().decode(storage.objects.get(`private:${PREFIX}config.json`)!.body)).toBe('antigo');
    });

    it('não faz nada se o modelo não está no disco', async () => {
      await cache.persist(MODEL);
      expect(storage.objects.size).toBe(0);
      expect(console.log).not.toHaveBeenCalled();
    });

    it('sanitiza caracteres estranhos do nome do modelo no prefixo', async () => {
      const weird = 'org/mo del:v1';
      const file = path.join(dir, weird, 'a.bin');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x');
      await cache.persist(weird);
      expect([...storage.objects.keys()]).toEqual(['private:models/org/mo_del_v1/a.bin']);
    });
  });

  describe('restore', () => {
    it('baixa os arquivos do bucket para o disco, criando subpastas', async () => {
      await storage.put('private', `${PREFIX}config.json`, '{"b":2}', 'application/octet-stream');
      await storage.put('private', `${PREFIX}onnx/model.onnx`, 'pesos', 'application/octet-stream');
      await cache.restore(MODEL);
      expect(fs.readFileSync(path.join(dir, MODEL, 'config.json'), 'utf8')).toBe('{"b":2}');
      expect(fs.readFileSync(path.join(dir, MODEL, 'onnx/model.onnx'), 'utf8')).toBe('pesos');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('restaurado do bucket (2 arquivo(s))'));
    });

    it('não baixa nada se o modelo já está no disco', async () => {
      writeLocal('config.json', 'local');
      await storage.put('private', `${PREFIX}config.json`, 'remoto', 'application/octet-stream');
      const list = vi.spyOn(storage, 'list');
      await cache.restore(MODEL);
      expect(list).not.toHaveBeenCalled();
      expect(fs.readFileSync(path.join(dir, MODEL, 'config.json'), 'utf8')).toBe('local');
    });

    it('baixa quando a pasta local existe mas está vazia', async () => {
      fs.mkdirSync(path.join(dir, MODEL), { recursive: true });
      await storage.put('private', `${PREFIX}config.json`, 'remoto', 'application/octet-stream');
      await cache.restore(MODEL);
      expect(fs.readFileSync(path.join(dir, MODEL, 'config.json'), 'utf8')).toBe('remoto');
    });

    it('pula objetos que sumiram entre a listagem e o download', async () => {
      await storage.put('private', `${PREFIX}a.bin`, 'a', 'application/octet-stream');
      await storage.put('private', `${PREFIX}b.bin`, 'b', 'application/octet-stream');
      vi.spyOn(storage, 'get').mockImplementation(async (_v, key) => (key.endsWith('a.bin') ? null : new TextEncoder().encode('b')));
      await cache.restore(MODEL);
      expect(fs.existsSync(path.join(dir, MODEL, 'a.bin'))).toBe(false);
      expect(fs.readFileSync(path.join(dir, MODEL, 'b.bin'), 'utf8')).toBe('b');
    });

    it('sem nada no bucket: não cria arquivos nem loga', async () => {
      await cache.restore(MODEL);
      expect(fs.existsSync(path.join(dir, MODEL))).toBe(false);
      expect(console.log).not.toHaveBeenCalled();
    });

    it('ida e volta: persist numa máquina, restore em outra', async () => {
      writeLocal('tokenizer.json', 'tok');
      await cache.persist(MODEL);
      const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-models-'));
      try {
        await new BucketModelCache(storage, otherDir).restore(MODEL);
        expect(fs.readFileSync(path.join(otherDir, MODEL, 'tokenizer.json'), 'utf8')).toBe('tok');
      } finally {
        fs.rmSync(otherDir, { recursive: true, force: true });
      }
    });
  });
});

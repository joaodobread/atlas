import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IModelCache } from './ModelCache.ts';

type Extractor = (texts: string[], opts: unknown) => Promise<{ tolist: () => number[][] }>;

const hf = vi.hoisted(() => ({
  env: {} as { cacheDir?: string },
  pipeline: vi.fn<(task: string, model: string, opts: unknown) => Promise<Extractor>>(),
}));
vi.mock('@huggingface/transformers', () => ({ pipeline: hf.pipeline, env: hf.env }));

const { TransformersEmbeddingProvider } = await import('./TransformersEmbeddingProvider.ts');

const extractor = vi.fn<Extractor>((texts) => Promise.resolve({ tolist: () => texts.map((_, i) => [i, 0.5]) }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('TransformersEmbeddingProvider', () => {
  beforeEach(() => {
    hf.pipeline.mockReset();
    hf.pipeline.mockResolvedValue(extractor);
    extractor.mockClear();
    delete hf.env.cacheDir;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lista vazia não carrega o modelo', async () => {
    const p = new TransformersEmbeddingProvider('Xenova/multilingual-e5-small', '/tmp/cache');
    expect(await p.embed([], 'query')).toEqual([]);
    expect(hf.pipeline).not.toHaveBeenCalled();
    expect(p).toMatchObject({ state: 'idle', lastError: null, dimensions: 384 });
  });

  it('modelos E5 recebem os prefixos query/passage e o pipeline é carregado uma vez', async () => {
    const p = new TransformersEmbeddingProvider('Xenova/multilingual-E5-small', '/tmp/cache');
    const out = await p.embed(['a', 'b'], 'passage');
    expect(out).toEqual([Float32Array.from([0, 0.5]), Float32Array.from([1, 0.5])]);
    expect(extractor).toHaveBeenLastCalledWith(['passage: a', 'passage: b'], { pooling: 'mean', normalize: true });
    await p.embed(['c'], 'query');
    expect(extractor).toHaveBeenLastCalledWith(['query: c'], { pooling: 'mean', normalize: true });
    expect(hf.pipeline).toHaveBeenCalledTimes(1);
    expect(hf.pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/multilingual-E5-small', { dtype: 'q8' });
    expect(hf.env.cacheDir).toBe('/tmp/cache');
    expect(p.state).toBe('ready');
  });

  it('outros modelos não recebem prefixo', async () => {
    const p = new TransformersEmbeddingProvider('Xenova/all-MiniLM-L6-v2', '/c');
    await p.embed(['texto'], 'query');
    expect(extractor).toHaveBeenLastCalledWith(['texto'], { pooling: 'mean', normalize: true });
  });

  it('fica em "loading" enquanto o modelo carrega', async () => {
    let release!: (e: Extractor) => void;
    hf.pipeline.mockReturnValueOnce(new Promise<Extractor>((r) => (release = r)));
    const p = new TransformersEmbeddingProvider('m', '/c');
    const pending = p.embed(['x'], 'query');
    expect(p.state).toBe('loading');
    await flush();
    release(extractor);
    await pending;
    expect(p.state).toBe('ready');
  });

  it('restaura o cache do bucket antes e persiste depois de carregar', async () => {
    const cache: IModelCache = {
      restore: vi.fn<IModelCache['restore']>(() => Promise.resolve()),
      persist: vi.fn<IModelCache['persist']>(() => Promise.resolve()),
    };
    const p = new TransformersEmbeddingProvider('modelo-e5', '/c', cache);
    await p.embed(['x'], 'query');
    expect(cache.restore).toHaveBeenCalledWith('modelo-e5');
    expect(cache.persist).toHaveBeenCalledWith('modelo-e5');
  });

  it('falhas do cache do bucket só geram aviso', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache: IModelCache = {
      restore: vi.fn<IModelCache['restore']>(() => Promise.reject(new Error('r'))),
      persist: vi.fn<IModelCache['persist']>(() => Promise.reject(new Error('p'))),
    };
    const p = new TransformersEmbeddingProvider('m', '/c', cache);
    await p.embed(['x'], 'query');
    await flush();
    expect(p.state).toBe('ready');
    expect(warn).toHaveBeenCalledWith('[embeddings] cache do bucket indisponível:', expect.any(Error));
    expect(warn).toHaveBeenCalledWith('[embeddings] não foi possível guardar o modelo no bucket:', expect.any(Error));
  });

  it('erro ao carregar marca o estado e permite nova tentativa', async () => {
    hf.pipeline.mockRejectedValueOnce(new Error('sem rede')).mockRejectedValueOnce('texto puro');
    const p = new TransformersEmbeddingProvider('m', '/c');
    await expect(p.embed(['x'], 'query')).rejects.toThrow('sem rede');
    expect(p).toMatchObject({ state: 'error', lastError: 'sem rede' });
    await expect(p.embed(['x'], 'query')).rejects.toBe('texto puro');
    expect(p.lastError).toBe('texto puro');
    expect(await p.embed(['x'], 'query')).toHaveLength(1);
    expect(p.state).toBe('ready');
    expect(hf.pipeline).toHaveBeenCalledTimes(3);
  });
});

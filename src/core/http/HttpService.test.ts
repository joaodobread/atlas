import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './HttpError.ts';
import { HttpService } from './HttpService.ts';

const json = (status: number, body: unknown, statusText = '') =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });

describe('HttpService', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const http = HttpService.getInstance();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    http.onUnauthorized(() => {});
  });

  it('é singleton', () => {
    expect(HttpService.getInstance('/outra')).toBe(http);
  });

  it('GET envia o header CSRF, sem corpo, e devolve o JSON', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: 1 }));
    await expect(http.get('/graph')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/api/graph', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'comm-graph' },
      body: undefined,
    });
  });

  it.each([
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
  ] as const)('%s envia JSON com Content-Type', async (method, verb) => {
    fetchMock.mockResolvedValue(json(200, { id: 1 }));
    await expect(http[method]('/nodes', { name: 'A' })).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/api/nodes', {
      method: verb,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'comm-graph', 'Content-Type': 'application/json' },
      body: '{"name":"A"}',
    });
  });

  it('POST sem corpo não manda Content-Type', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await http.post('/x');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { 'X-Requested-With': 'comm-graph' }, body: undefined });
  });

  it('204 devolve undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(http.delete('/nodes/1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('erro vira HttpError com mensagem e issues da API', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'Dados inválidos', issues: [{ path: 'name', message: 'Obrigatório' }] }));
    const err = await http.post('/nodes', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 400, message: 'Dados inválidos', issues: [{ path: 'name', message: 'Obrigatório' }] });
  });

  it('erro sem JSON usa o statusText', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502, statusText: 'Bad Gateway' }));
    const err = await http.get('/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, message: 'Bad Gateway', issues: [] });
  });

  it('401 chama o handler, exceto nas rotas /auth/', async () => {
    const handler = vi.fn<() => void>();
    http.onUnauthorized(handler);
    fetchMock.mockResolvedValue(json(401, { error: 'Sessão expirada' }));
    await expect(http.get('/graph')).rejects.toThrow('Sessão expirada');
    expect(handler).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(json(401, { error: 'Credenciais inválidas' }));
    await expect(http.post('/auth/login', {})).rejects.toBeInstanceOf(HttpError);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

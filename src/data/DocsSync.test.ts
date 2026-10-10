import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocsStore } from '../stores/docsStore.ts';
import { makeDoc, makeStatus, resetSingleton, resetStores } from '../testing/vmFixtures.ts';
import type { DocumentApi } from './api/DocumentApi.ts';
import { DocsSync } from './DocsSync.ts';

const api = {
  list: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  folders: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  status: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  llm: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
};
let sync: DocsSync;

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  resetSingleton(DocsSync);
  api.list.mockReset().mockResolvedValue([makeDoc(1)]);
  api.folders.mockReset().mockResolvedValue([]);
  api.status.mockReset().mockResolvedValue(makeStatus());
  api.llm.mockReset().mockResolvedValue({ configured: false, provider: 'none', model: null });
  sync = DocsSync.getInstance(api as unknown as DocumentApi);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DocsSync', () => {
  it('é singleton e preenche o store', async () => {
    expect(DocsSync.getInstance()).toBe(sync);
    await sync.reload();
    const s = useDocsStore.getState();
    expect(s.documents).toHaveLength(1);
    expect(s.status?.documents).toBe(1);
    expect(s.llm?.configured).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('acompanha a indexação enquanto houver pendências', async () => {
    api.status.mockResolvedValueOnce(makeStatus({ pending: 2 })).mockResolvedValueOnce(makeStatus({ embeddingState: 'indexing' }));
    await sync.reload();
    await vi.advanceTimersByTimeAsync(2500);
    expect(api.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2500);
    expect(api.list).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('continua tentando quando o recarregamento do polling falha', async () => {
    api.status.mockResolvedValueOnce(makeStatus({ pending: 1 }));
    await sync.reload();
    api.list.mockRejectedValueOnce(new Error('rede'));
    await vi.advanceTimersByTimeAsync(2500);
    expect(api.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2500);
    expect(api.list).toHaveBeenCalledTimes(3);
  });
});

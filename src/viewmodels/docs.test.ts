import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskResult, SearchResult } from '../../shared/types.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { NodeApi } from '../data/api/NodeApi.ts';
import { DocsSync } from '../data/DocsSync.ts';
import { GraphSync } from '../data/GraphSync.ts';
import { useDocsStore } from '../stores/docsStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { makeHit, makeNode, makeStatus, resetStores, seedGraph, setPermissions, toasts } from '../testing/vmFixtures.ts';
import { useDocsManagerViewModel } from './useDocsManagerViewModel.ts';
import { useDocsPanelViewModel } from './useDocsPanelViewModel.ts';

const ui = () => useUiStore.getState();
let docsReload: ReturnType<typeof vi.spyOn>;
const confirmMock = vi.fn<(message?: string) => boolean>(() => true);

beforeEach(() => {
  resetStores();
  docsReload = vi.spyOn(DocsSync.getInstance(), 'reload').mockResolvedValue();
  confirmMock.mockReset().mockReturnValue(true);
  vi.stubGlobal('confirm', confirmMock);
  seedGraph({ nodes: [makeNode(1, null, { name: 'A', kind: 'project' }), makeNode(2, 1, { name: 'B' })] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useDocsPanelViewModel', () => {
  const searchResult: SearchResult = {
    query: 'x',
    mode: 'hybrid',
    hits: [makeHit()],
    affectedNodes: [
      { nodeId: 2, hits: 3 },
      { nodeId: 99, hits: 1 },
    ],
    semanticUnavailable: false,
  };

  it('recarrega documentos ao montar e tira o destaque ao desmontar', async () => {
    docsReload.mockRejectedValueOnce(new Error('offline'));
    useUiStore.setState({ searchHighlight: new Set([1]) });
    const { unmount } = renderHook(() => useDocsPanelViewModel());
    await waitFor(() => expect(toasts()).toEqual([['error', 'offline']]));
    unmount();
    expect(ui().searchHighlight).toBeNull();
  });

  it('estado do LLM e da indexação', () => {
    const { result } = renderHook(() => useDocsPanelViewModel());
    expect(result.current).toMatchObject({ llmConfigured: false, llmLabel: null, noDocuments: false });
    act(() => useDocsStore.setState({ llm: { configured: true, provider: 'anthropic', model: 'm' }, status: makeStatus({ documents: 0 }) }));
    expect(result.current).toMatchObject({ llmConfigured: true, llmLabel: 'anthropic · m', noDocuments: true });
  });

  it('busca: valida, consulta e destaca os nós afetados', async () => {
    const search = vi.spyOn(DocumentApi.getInstance(), 'search').mockResolvedValueOnce(searchResult);
    const { result } = renderHook(() => useDocsPanelViewModel());
    await act(() => result.current.search());
    expect(result.current.error).toBe('q: Digite algo para buscar');
    act(() => {
      result.current.setQuery('pedidos');
      result.current.setMode('text');
    });
    await act(() => result.current.search());
    expect(search).toHaveBeenCalledWith({ q: 'pedidos', mode: 'text', limit: 15 });
    expect(result.current.error).toBeNull();
    expect(result.current.searching).toBe(false);
    expect([...ui().searchHighlight!]).toEqual([2, 99]);
    expect(result.current.affected).toEqual([expect.objectContaining({ id: 2, name: 'B', path: 'A / B', hits: 3, icon: 'lu:server' })]);
    search.mockResolvedValueOnce({ ...searchResult, affectedNodes: [] });
    await act(() => result.current.search());
    expect(ui().searchHighlight).toBeNull();
    search.mockRejectedValueOnce(new Error('falhou'));
    await act(() => result.current.search());
    expect(result.current.error).toBe('falhou');
  });

  it('pergunta: valida, responde e monta o resultado com as fontes', async () => {
    const answer: AskResult = {
      answer: 'Veja [1] e [2].',
      provider: 'anthropic',
      model: 'm',
      sources: [makeHit({ nodeId: 1 })],
      affectedNodes: [{ nodeId: 1, hits: 1 }],
    };
    const ask = vi.spyOn(DocumentApi.getInstance(), 'ask').mockResolvedValueOnce(answer);
    const { result } = renderHook(() => useDocsPanelViewModel());
    act(() => result.current.setQuery('a'));
    await act(() => result.current.ask());
    expect(result.current.error).toBe('question: Pergunta muito curta');
    act(() => result.current.setQuery('quem usa?'));
    await act(() => result.current.ask());
    expect(ask).toHaveBeenCalledWith({ question: 'quem usa?', limit: 8 });
    expect(result.current.answer).toBe(answer);
    expect(result.current.result).toMatchObject({ query: 'quem usa?', hits: answer.sources });
    expect([...ui().searchHighlight!]).toEqual([1]);
    expect(result.current.asking).toBe(false);
    act(() => result.current.openCitation(1));
    await waitFor(() => expect(ui().focusId).toBe(1));
    act(() => result.current.openCitation(5));
    ask.mockRejectedValueOnce(new Error('sem LLM'));
    await act(() => result.current.ask());
    expect(result.current.error).toBe('sem LLM');
    act(() => result.current.clear());
    expect(result.current).toMatchObject({ result: null, answer: null, query: '' });
    expect(ui().searchHighlight).toBeNull();
  });

  it('abrir trecho: documento abre o visualizador; nó de outro grafo troca o grafo', async () => {
    const get = vi
      .spyOn(NodeApi.getInstance(), 'get')
      .mockResolvedValueOnce(makeNode(50, null, { graph_id: 7 }))
      .mockRejectedValueOnce(new Error('sumiu'));
    const open = vi.spyOn(GraphSync.getInstance(), 'open').mockResolvedValue();
    const { result } = renderHook(() => useDocsPanelViewModel());
    const docHit = makeHit();
    expect(result.current.isModelHit(docHit)).toBe(false);
    act(() => result.current.openHit(docHit));
    expect(ui().docViewer).toEqual({ documentId: 7, startLine: 2, endLine: 4 });
    act(() => result.current.openHit(makeHit({ nodeId: 50 })));
    await waitFor(() => expect(ui().focusId).toBe(50));
    expect(get).toHaveBeenCalledWith(50);
    expect(open).toHaveBeenCalledWith(7);
    expect(ui().selection).toEqual({ type: 'node', id: 50 });
    act(() => result.current.openHit(makeHit({ nodeId: 51 })));
    await waitFor(() => expect(result.current.error).toBe('sumiu'));
    act(() => result.current.focusNode(2));
    expect(ui()).toMatchObject({ focusId: 2, selection: { type: 'node', id: 2 } });
  });

  it('formatação de trechos, respostas e nós mencionados', () => {
    const { result } = renderHook(() => useDocsPanelViewModel());
    expect(result.current.snippetParts('a [[b]] c')).toEqual([
      { mark: false, text: 'a ' },
      { mark: true, text: 'b' },
      { mark: false, text: ' c' },
    ]);
    expect(result.current.answerParts('x [12] y')).toEqual([
      { cite: null, text: 'x ' },
      { cite: 12, text: '[12]' },
      { cite: null, text: ' y' },
    ]);
    expect(result.current.nodesOf(makeHit({ nodeId: 1, mentionedNodeIds: [1, 2, 99] })).map((n) => n.id)).toEqual([2]);
  });
});

describe('useDocsManagerViewModel', () => {
  const file = (name: string, content: string, rel = '') => Object.assign(new File([content], name), { webkitRelativePath: rel }) as File;
  const files = (...f: File[]) => f as unknown as FileList;

  it('permissões e rótulos', () => {
    setPermissions('docs:write');
    const { result } = renderHook(() => useDocsManagerViewModel());
    expect(result.current).toMatchObject({ canUpload: true, canManageFolders: false, indexLabel: '' });
    expect(result.current.sourceLabel('folder')).toBe('pasta');
    expect(result.current.sourceLabel('upload')).toBe('upload');
    expect(result.current.sourceLabel('api')).toBe('API');
    expect(result.current.fileName('C:\\x\\a.md')).toBe('a.md');
    // Fallback defensivo: sem segmentos devolve o próprio valor.
    const weird = { split: () => [] } as unknown as string;
    expect(result.current.fileName(weird)).toBe(weird);
  });

  it.each([
    [makeStatus({ embeddingState: 'loading-model' }), 'Baixando/carregando modelo de embeddings…'],
    [makeStatus({ embeddingState: 'indexing', embedded: 1, chunks: 4 }), 'Vetorizando: 1/4 trechos'],
    [makeStatus({ pending: 2, embedded: 2, chunks: 4 }), 'Vetorizando: 2/4 trechos'],
    [makeStatus({ embeddingState: 'error', embeddingError: 'oom' }), 'Erro nos embeddings: oom'],
    [makeStatus({ embeddingState: 'error' }), 'Erro nos embeddings: '],
    [makeStatus(), '1 documentos + 2 nós do modelo · 3 trechos vetorizados'],
  ])('indexLabel %#', (status, label) => {
    useDocsStore.setState({ status });
    expect(renderHook(() => useDocsManagerViewModel()).result.current.indexLabel).toBe(label);
  });

  it('upload: ignora vazio, valida, importa e resume', async () => {
    const imp = vi
      .spyOn(DocumentApi.getInstance(), 'importMany')
      .mockResolvedValueOnce([
        { id: 1, status: 'created' },
        { id: 2, status: 'unchanged' },
      ])
      .mockResolvedValueOnce([{ id: 1, status: 'updated' }])
      .mockRejectedValueOnce(new Error('cheio'));
    const { result } = renderHook(() => useDocsManagerViewModel());
    await act(() => result.current.upload(null));
    await act(() => result.current.upload(files()));
    expect(imp).not.toHaveBeenCalled();
    await act(() => result.current.upload(files(file('a.md', '# a'), file('b.md', '# b', 'docs/b.md'))));
    expect(imp).toHaveBeenCalledWith({
      documents: [
        { path: 'upload/a.md', content: '# a', source: 'upload' },
        { path: 'upload/docs/b.md', content: '# b', source: 'upload' },
      ],
    });
    expect(toasts()).toEqual([['success', '1 documento(s) indexado(s), 1 sem mudanças']]);
    expect(docsReload).toHaveBeenCalled();
    await act(() => result.current.upload(files(file('a.md', 'x'))));
    expect(toasts()[1]).toEqual(['success', '1 documento(s) indexado(s)']);
    docsReload.mockRejectedValueOnce(new Error('x'));
    await act(() => result.current.upload(files(file('a.md', 'x'))));
    expect(toasts()[2]).toEqual(['error', 'cheio']);
    expect(result.current.busy).toBe(false);
    await act(() => result.current.upload(files(file('big.md', 'x'.repeat(2_000_001)))));
    expect(toasts()[3]).toEqual(['error', 'documents.0.content: Documento grande demais']);
    expect(imp).toHaveBeenCalledTimes(3);
  });

  it('pastas: valida caminho, adiciona, reindexa e remove com confirmação', async () => {
    const api = DocumentApi.getInstance();
    const add = vi.spyOn(api, 'addFolder').mockResolvedValue({ id: 1, path: '/d', created_at: '', last_scan_at: null, documentCount: 0 });
    const rescan = vi.spyOn(api, 'rescanFolder').mockResolvedValue({ id: 1, path: '/d', created_at: '', last_scan_at: null, documentCount: 0 });
    const removeFolder = vi.spyOn(api, 'removeFolder').mockResolvedValue();
    const { result } = renderHook(() => useDocsManagerViewModel());
    act(() => result.current.setFolderPath('rel/path'));
    await act(() => result.current.addFolder());
    expect(result.current.folderError).toBe('path: Use um caminho absoluto');
    act(() => result.current.setFolderPath('/docs'));
    expect(result.current.folderError).toBeNull();
    await act(() => result.current.addFolder());
    expect(add).toHaveBeenCalledWith('/docs');
    expect(result.current.folderPath).toBe('');
    expect(toasts()).toEqual([['success', 'Pasta adicionada e indexada']]);
    await act(() => result.current.rescanFolder(1));
    expect(rescan).toHaveBeenCalledWith(1);
    confirmMock.mockReturnValueOnce(false);
    act(() => result.current.removeFolder(1));
    expect(removeFolder).not.toHaveBeenCalled();
    act(() => result.current.removeFolder(1));
    await waitFor(() => expect(toasts()).toContainEqual(['success', 'Pasta removida']));
  });

  it('documentos: remover com confirmação e abrir', async () => {
    const remove = vi.spyOn(DocumentApi.getInstance(), 'remove').mockResolvedValue();
    const { result } = renderHook(() => useDocsManagerViewModel());
    confirmMock.mockReturnValueOnce(false);
    act(() => result.current.removeDocument(3));
    expect(remove).not.toHaveBeenCalled();
    act(() => result.current.removeDocument(3));
    await waitFor(() => expect(toasts()).toEqual([['success', 'Documento removido']]));
    act(() => result.current.openDocument(3));
    expect(ui().docViewer).toEqual({ documentId: 3 });
  });
});

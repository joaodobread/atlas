import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiTokenView, GithubSettingsView, LlmSettingsView } from '../../shared/types.ts';
import { AuthApi } from '../data/api/AuthApi.ts';
import { DocumentApi } from '../data/api/DocumentApi.ts';
import { GithubApi } from '../data/api/GithubApi.ts';
import { SettingsApi } from '../data/api/SettingsApi.ts';
import { UserApi } from '../data/api/UserApi.ts';
import { DocsSync } from '../data/DocsSync.ts';
import { useAuthStore } from '../stores/authStore.ts';
import { useUiStore } from '../stores/uiStore.ts';
import { makeStatus, makeUser, resetStores, toasts } from '../testing/vmFixtures.ts';
import { useAccountViewModel } from './useAccountViewModel.ts';
import { useGithubSettingsViewModel, workflowSnippet } from './useGithubSettingsViewModel.ts';
import { BASE_URL_PRESETS, MODEL_SUGGESTIONS, useLlmSettingsViewModel } from './useLlmSettingsViewModel.ts';
import { useUsersAdminViewModel } from './useUsersAdminViewModel.ts';

const confirmMock = vi.fn<(message?: string) => boolean>(() => true);

beforeEach(() => {
  resetStores();
  confirmMock.mockReset().mockReturnValue(true);
  vi.stubGlobal('confirm', confirmMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useLlmSettingsViewModel', () => {
  const view = (o: Partial<LlmSettingsView> = {}): LlmSettingsView => ({
    provider: 'anthropic',
    model: 'claude-x',
    baseUrl: null,
    hasApiKey: true,
    apiKeyHint: '…abcd',
    mentionsAuto: true,
    source: 'database',
    ...o,
  });
  let api: SettingsApi;
  let docsReload: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    api = SettingsApi.getInstance();
    docsReload = vi.spyOn(DocsSync.getInstance(), 'reload').mockResolvedValue();
  });

  it('carrega a configuração e o status; dirty ao editar', async () => {
    vi.spyOn(api, 'llm').mockResolvedValue(view());
    vi.spyOn(DocumentApi.getInstance(), 'status').mockResolvedValue(makeStatus());
    const { result } = renderHook(() => useLlmSettingsViewModel());
    await waitFor(() => expect(result.current.current).not.toBeNull());
    await waitFor(() => expect(result.current.status).not.toBeNull());
    expect(result.current).toMatchObject({
      dirty: false,
      showModel: true,
      showBaseUrl: false,
      showApiKey: true,
      apiKeyPlaceholder: 'Salva (…abcd) — deixe vazio para manter',
      mentionsLabel: 'Em dia',
      baseUrlPresets: BASE_URL_PRESETS,
    });
    expect(result.current.modelSuggestions).toBe(MODEL_SUGGESTIONS.anthropic);
    expect(result.current.form.values).toMatchObject({ provider: 'anthropic', model: 'claude-x', baseUrl: '', apiKey: '' });
    act(() => result.current.form.set('model', 'outro'));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.form.set('provider', 'none'));
    expect(result.current).toMatchObject({ modelSuggestions: [], showModel: false, showApiKey: false });
    act(() => result.current.form.set('provider', 'openai-compatible'));
    expect(result.current.showBaseUrl).toBe(true);
  });

  it('erros ao carregar: toast e status vazio', async () => {
    vi.spyOn(api, 'llm').mockRejectedValue(new Error('proibido'));
    vi.spyOn(DocumentApi.getInstance(), 'status').mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => useLlmSettingsViewModel());
    await waitFor(() => expect(toasts()).toEqual([['error', 'proibido']]));
    expect(result.current).toMatchObject({ current: null, status: null, mentionsLabel: '', dirty: false, apiKeyPlaceholder: 'Cole a chave de API' });
  });

  it.each([
    [{ state: 'disabled' as const }, 'Desligada'],
    [{ state: 'running' as const, pendingDocuments: 2 }, 'Analisando… 2 documento(s) na fila'],
    [{ state: 'error' as const, error: 'quota' }, 'Erro: quota'],
    [{ state: 'error' as const }, 'Erro: '],
    [{ state: 'idle' as const, pendingDocuments: 3 }, '3 documento(s) na fila'],
  ])('mentionsLabel %#', async (llmMentions, label) => {
    vi.spyOn(api, 'llm').mockResolvedValue(view());
    vi.spyOn(DocumentApi.getInstance(), 'status').mockResolvedValue(
      makeStatus({ llmMentions: { enabled: true, pendingDocuments: 0, error: null, ...llmMentions } }),
    );
    const { result } = renderHook(() => useLlmSettingsViewModel());
    await waitFor(() => expect(result.current.mentionsLabel).toBe(label));
  });

  it('save: valida, envia a chave conforme o formulário e recarrega documentos', async () => {
    vi.spyOn(api, 'llm').mockResolvedValue(view());
    vi.spyOn(DocumentApi.getInstance(), 'status').mockResolvedValue(makeStatus());
    const update = vi
      .spyOn(api, 'updateLlm')
      .mockResolvedValueOnce(view({ model: 'novo' }))
      .mockResolvedValueOnce(view())
      .mockResolvedValueOnce(view({ hasApiKey: false }))
      .mockRejectedValueOnce(new Error('inválida'));
    const { result } = renderHook(() => useLlmSettingsViewModel());
    await waitFor(() => expect(result.current.current).not.toBeNull());
    let ok: boolean | undefined;
    act(() => result.current.form.set('provider', 'openai-compatible'));
    await act(async () => {
      ok = await result.current.save();
    });
    expect(ok).toBe(false);
    expect(result.current.form.errors).toHaveProperty('baseUrl');
    act(() => result.current.form.set('provider', 'anthropic'));
    act(() => result.current.form.set('model', 'novo'));
    await act(async () => {
      ok = await result.current.save();
    });
    expect(ok).toBe(true);
    expect(update).toHaveBeenLastCalledWith({ provider: 'anthropic', model: 'novo', baseUrl: null, apiKey: undefined, mentionsAuto: true });
    expect(result.current.form.values.model).toBe('novo');
    expect(docsReload).toHaveBeenCalled();
    expect(toasts()).toEqual([['success', 'Configuração salva']]);
    act(() => result.current.form.set('apiKey', ' sk-1 '));
    await act(() => result.current.save());
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'sk-1' }));
    act(() => result.current.form.set('clearApiKey', true));
    await act(() => result.current.save());
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: null }));
    await act(async () => {
      ok = await result.current.save();
    });
    expect(ok).toBe(false);
    expect(toasts().at(-1)).toEqual(['error', 'inválida']);
    expect(result.current.busy).toBe(false);
  });

  it('testar conexão e reprocessar menções', async () => {
    vi.spyOn(api, 'llm').mockResolvedValue(view());
    const status = vi.spyOn(DocumentApi.getInstance(), 'status').mockResolvedValue(makeStatus());
    vi.spyOn(api, 'testLlm').mockResolvedValueOnce({ ok: true, latencyMs: 5, reply: 'oi', error: null }).mockRejectedValueOnce(new Error('timeout'));
    vi.spyOn(api, 'reprocessMentions')
      .mockResolvedValueOnce(makeStatus({ documents: 9 }))
      .mockRejectedValueOnce(new Error('não'));
    const { result } = renderHook(() => useLlmSettingsViewModel());
    await act(() => result.current.runTest());
    expect(result.current.test).toMatchObject({ ok: true, reply: 'oi' });
    await act(() => result.current.runTest());
    expect(result.current.test).toEqual({ ok: false, latencyMs: 0, reply: null, error: 'timeout' });
    await act(() => result.current.reprocess());
    expect(result.current.status?.documents).toBe(9);
    await act(() => result.current.reprocess());
    expect(toasts()).toEqual([
      ['success', 'Reanálise das menções iniciada'],
      ['error', 'não'],
    ]);
    await act(() => result.current.refreshStatus());
    expect(status).toHaveBeenCalledTimes(2);
  });
});

describe('useGithubSettingsViewModel', () => {
  const view = (o: Partial<GithubSettingsView> = {}): GithubSettingsView => ({
    owner: 'acme',
    hasToken: true,
    tokenHint: '…zz',
    includeArchived: false,
    includeForks: true,
    pushedWithinMonths: 12,
    ...o,
  });

  it('snippet do workflow usa a URL', () => {
    expect(workflowSnippet('https://x')).toContain('url: https://x');
  });

  it('carrega e salva com as variações do token e dos meses', async () => {
    const api = GithubApi.getInstance();
    vi.spyOn(api, 'settings').mockResolvedValue(view());
    const update = vi
      .spyOn(api, 'updateSettings')
      .mockResolvedValueOnce(view({ pushedWithinMonths: null, owner: null, hasToken: false }))
      .mockResolvedValueOnce(view())
      .mockRejectedValueOnce(new Error('403'));
    const { result } = renderHook(() => useGithubSettingsViewModel());
    await waitFor(() => expect(result.current.current).not.toBeNull());
    expect(result.current.form.values).toMatchObject({ owner: 'acme', pushedWithinMonths: '12', includeForks: true });
    expect(result.current).toMatchObject({ dirty: false, tokenPlaceholder: 'Salvo (…zz) — deixe vazio para manter', apiBase: `${window.location.origin}/api` });
    expect(result.current.workflow).toContain(window.location.origin);

    act(() => result.current.form.set('owner', '-bad'));
    expect(result.current.dirty).toBe(true);
    await act(() => result.current.save());
    expect(result.current.form.errors).toHaveProperty('owner');
    expect(update).not.toHaveBeenCalled();

    act(() => {
      result.current.form.set('owner', 'acme');
      result.current.form.set('pushedWithinMonths', ' ');
    });
    await act(() => result.current.save());
    expect(update).toHaveBeenLastCalledWith({ owner: 'acme', token: undefined, includeArchived: false, includeForks: true, pushedWithinMonths: null });
    expect(result.current.form.values).toMatchObject({ owner: '', pushedWithinMonths: '' });
    expect(result.current.tokenPlaceholder).toMatch(/^github_pat_/);
    expect(toasts()).toEqual([['success', 'Configuração do GitHub salva']]);

    act(() => {
      result.current.form.set('owner', 'acme');
      result.current.form.set('token', ' ghp_1234567890 ');
      result.current.form.set('pushedWithinMonths', '6');
    });
    await act(() => result.current.save());
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'ghp_1234567890', pushedWithinMonths: 6 }));

    act(() => result.current.form.set('clearToken', true));
    await act(() => result.current.save());
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ token: null }));
    expect(toasts().at(-1)).toEqual(['error', '403']);
    expect(result.current.busy).toBe(false);
  });

  it('erro ao carregar e teste de conexão', async () => {
    const api = GithubApi.getInstance();
    vi.spyOn(api, 'settings').mockRejectedValue(new Error('sem permissão'));
    vi.spyOn(api, 'testSettings').mockResolvedValueOnce({ ok: true, login: 'bot', repoCount: 3, error: null }).mockRejectedValueOnce(new Error('401'));
    const { result } = renderHook(() => useGithubSettingsViewModel());
    await waitFor(() => expect(toasts()).toEqual([['error', 'sem permissão']]));
    expect(result.current.dirty).toBe(false);
    await act(() => result.current.runTest());
    expect(result.current.test).toMatchObject({ ok: true, login: 'bot' });
    await act(() => result.current.runTest());
    expect(result.current.test).toEqual({ ok: false, login: null, repoCount: null, error: '401' });
  });
});

describe('useAccountViewModel', () => {
  const token: ApiTokenView = { id: 4, name: 'ci', prefix: 'cg_', created_at: '', last_used_at: null };
  let api: AuthApi;

  beforeEach(() => {
    api = AuthApi.getInstance();
    useAuthStore.setState({ user: makeUser({ role: 'viewer' }) });
  });

  it('carrega tokens (erro é ignorado) e mostra o papel', async () => {
    const tokens = vi.spyOn(api, 'tokens').mockResolvedValueOnce([token]).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useAccountViewModel());
    await waitFor(() => expect(result.current.tokens).toEqual([token]));
    expect(result.current.roleLabel).toBe('Leitor');
    renderHook(() => useAccountViewModel());
    await waitFor(() => expect(tokens).toHaveBeenCalledTimes(2));
    act(() => useAuthStore.setState({ user: null }));
    expect(result.current.roleLabel).toBe('');
  });

  it('restartTour reabre o tutorial ou avisa o erro', async () => {
    vi.spyOn(api, 'tokens').mockResolvedValue([]);
    vi.spyOn(api, 'setOnboarded')
      .mockResolvedValueOnce({ needsSetup: false, user: makeUser({ onboarded_at: null }), permissions: [] })
      .mockRejectedValueOnce(new Error('falhou'));
    useUiStore.setState({ screen: 'settings' });
    const { result } = renderHook(() => useAccountViewModel());
    result.current.restartTour();
    await waitFor(() => expect(useUiStore.getState().screen).toBe('graph'));
    expect(useAuthStore.getState().user?.onboarded_at).toBeNull();
    result.current.restartTour();
    await waitFor(() => expect(toasts()).toEqual([['error', 'falhou']]));
  });

  it('troca de senha: valida, confere e envia', async () => {
    vi.spyOn(api, 'tokens').mockResolvedValue([]);
    const change = vi.spyOn(api, 'changePassword').mockResolvedValueOnce().mockRejectedValueOnce(new Error('senha atual incorreta'));
    const { result } = renderHook(() => useAccountViewModel());
    await act(() => result.current.changePassword());
    expect(result.current.passwordForm.errors).toHaveProperty('newPassword');
    act(() => {
      result.current.passwordForm.set('currentPassword', 'old');
      result.current.passwordForm.set('newPassword', '12345678');
      result.current.passwordForm.set('confirm', 'x');
    });
    await act(() => result.current.changePassword());
    expect(toasts()).toEqual([['error', 'As senhas não conferem']]);
    act(() => result.current.passwordForm.set('confirm', '12345678'));
    await act(() => result.current.changePassword());
    expect(change).toHaveBeenCalledWith({ currentPassword: 'old', newPassword: '12345678' });
    expect(result.current.passwordForm.values.currentPassword).toBe('');
    expect(toasts().at(-1)).toEqual(['success', 'Senha alterada']);
    act(() => {
      result.current.passwordForm.set('currentPassword', 'old');
      result.current.passwordForm.set('newPassword', '12345678');
      result.current.passwordForm.set('confirm', '12345678');
    });
    await act(() => result.current.changePassword());
    expect(toasts().at(-1)).toEqual(['error', 'senha atual incorreta']);
  });

  it('tokens: criar, copiar, dispensar e revogar', async () => {
    const tokens = vi.spyOn(api, 'tokens').mockResolvedValue([]);
    const created = { ...token, token: 'cg_secret' };
    vi.spyOn(api, 'createToken').mockResolvedValueOnce(created).mockRejectedValueOnce(new Error('limite'));
    const revoke = vi.spyOn(api, 'revokeToken').mockResolvedValueOnce().mockRejectedValueOnce(new Error('não'));
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('negado'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { result } = renderHook(() => useAccountViewModel());

    await act(() => result.current.copyCreated());
    expect(writeText).not.toHaveBeenCalled();
    await act(() => result.current.createToken());
    expect(result.current.tokenForm.errors).toHaveProperty('name');
    act(() => result.current.tokenForm.set('name', 'ci'));
    await act(() => result.current.createToken());
    expect(result.current.created).toEqual(created);
    expect(result.current.tokenForm.values.name).toBe('');
    expect(tokens).toHaveBeenCalledTimes(2);
    await act(() => result.current.copyCreated());
    await act(() => result.current.copyCreated());
    expect(writeText).toHaveBeenCalledWith('cg_secret');
    expect(toasts()).toEqual([
      ['success', 'Token copiado'],
      ['error', 'Não foi possível copiar; selecione e copie manualmente'],
    ]);
    act(() => result.current.dismissCreated());
    expect(result.current.created).toBeNull();
    act(() => result.current.tokenForm.set('name', 'ci2'));
    await act(() => result.current.createToken());
    expect(toasts().at(-1)).toEqual(['error', 'limite']);

    confirmMock.mockReturnValueOnce(false);
    await act(() => result.current.revoke(token));
    expect(revoke).not.toHaveBeenCalled();
    await act(() => result.current.revoke(token));
    expect(revoke).toHaveBeenCalledWith(4);
    await act(() => result.current.revoke(token));
    expect(toasts().at(-1)).toEqual(['error', 'não']);
  });
});

describe('useUsersAdminViewModel', () => {
  const ana = makeUser({ id: 1, name: 'Ana' });
  const bia = makeUser({ id: 2, name: 'Bia', active: false, role: 'viewer' });
  let api: UserApi;

  beforeEach(() => {
    api = UserApi.getInstance();
    useAuthStore.setState({ user: ana });
  });

  it('carrega usuários; erro vira toast', async () => {
    vi.spyOn(api, 'list').mockResolvedValueOnce([ana, bia]).mockRejectedValueOnce(new Error('403'));
    const { result } = renderHook(() => useUsersAdminViewModel());
    await waitFor(() => expect(result.current.users).toHaveLength(2));
    expect(result.current.isMe(ana)).toBe(true);
    expect(result.current.isMe(bia)).toBe(false);
    expect(result.current.roles).toEqual([
      { value: 'admin', label: 'Administrador' },
      { value: 'editor', label: 'Editor' },
      { value: 'viewer', label: 'Leitor' },
    ]);
    renderHook(() => useUsersAdminViewModel());
    await waitFor(() => expect(toasts()).toEqual([['error', '403']]));
  });

  it('criar: valida, cria e limpa; erro mantém o formulário', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([]);
    const create = vi.spyOn(api, 'create').mockRejectedValueOnce(new Error('e-mail em uso')).mockResolvedValueOnce(bia);
    const { result } = renderHook(() => useUsersAdminViewModel());
    await act(() => result.current.create());
    expect(create).not.toHaveBeenCalled();
    act(() => {
      result.current.form.set('name', 'Bia');
      result.current.form.set('email', 'bia@x.com');
      result.current.form.set('password', '12345678');
    });
    await act(() => result.current.create());
    expect(result.current.form.values.name).toBe('Bia');
    expect(toasts()).toEqual([['error', 'e-mail em uso']]);
    await act(() => result.current.create());
    expect(create).toHaveBeenLastCalledWith({ name: 'Bia', email: 'bia@x.com', role: 'viewer', password: '12345678' });
    expect(result.current.form.values.name).toBe('');
    expect(toasts().at(-1)).toEqual(['success', 'Usuário criado']);
    expect(result.current.busy).toBe(false);
  });

  it('papel, ativação, senha e exclusão', async () => {
    vi.spyOn(api, 'list').mockResolvedValue([ana, bia]);
    const update = vi.spyOn(api, 'update').mockResolvedValue(ana);
    const remove = vi.spyOn(api, 'remove').mockResolvedValue();
    const promptMock = vi.fn<() => string | null>().mockReturnValueOnce(null).mockReturnValueOnce('curta').mockReturnValueOnce('novasenha1');
    vi.stubGlobal('prompt', promptMock);
    const { result } = renderHook(() => useUsersAdminViewModel());

    act(() => result.current.changeRole(bia, 'editor'));
    await waitFor(() => expect(toasts()).toEqual([['success', 'Papel alterado']]));
    expect(update).toHaveBeenLastCalledWith(2, { role: 'editor' });
    act(() => result.current.changeRole(bia, 'root' as never));
    expect(toasts().at(-1)![0]).toBe('error');

    act(() => result.current.toggleActive(ana));
    await waitFor(() => expect(toasts().at(-1)).toEqual(['success', 'Usuário desativado']));
    expect(update).toHaveBeenLastCalledWith(1, { active: false });
    act(() => result.current.toggleActive(bia));
    await waitFor(() => expect(toasts().at(-1)).toEqual(['success', 'Usuário reativado']));

    act(() => result.current.resetPassword(bia));
    expect(promptMock).toHaveBeenCalledWith(expect.stringContaining('Bia'));
    const calls = update.mock.calls.length;
    act(() => result.current.resetPassword(bia));
    expect(toasts().at(-1)).toEqual(['error', 'password: Mínimo de 8 caracteres']);
    act(() => result.current.resetPassword(bia));
    await waitFor(() => expect(toasts().at(-1)).toEqual(['success', 'Senha redefinida (sessões encerradas)']));
    expect(update).toHaveBeenCalledTimes(calls + 1);

    confirmMock.mockReturnValueOnce(false);
    act(() => result.current.remove(bia));
    expect(remove).not.toHaveBeenCalled();
    act(() => result.current.remove(bia));
    await waitFor(() => expect(toasts().at(-1)).toEqual(['success', 'Usuário excluído']));
    expect(remove).toHaveBeenCalledWith(2);
  });
});

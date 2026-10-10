import { describe, expect, it } from 'vitest';
import type { ISecureSettingsStore } from '../../repositories/contracts/ISecureSettingsStore.ts';
import { BusinessRuleError } from '../../core/errors/AppError.ts';
import { FakeGithubClient } from '../../../test/support/githubFakes.ts';
import { GithubSettingsService } from './GithubSettingsService.ts';

class MemorySecureStore implements ISecureSettingsStore {
  data = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }
}

const TOKEN = 'ghp_1234567890abcd';
const setup = () => {
  const store = new MemorySecureStore();
  const github = new FakeGithubClient();
  return { store, github, service: new GithubSettingsService(store, github) };
};
const base = { owner: 'acme', includeArchived: true, includeForks: false, pushedWithinMonths: 12 };

describe('GithubSettingsService', () => {
  it('view sem nada salvo usa os padrões', async () => {
    const { service } = setup();
    expect(await service.view()).toEqual({
      owner: null,
      hasToken: false,
      tokenHint: null,
      includeArchived: false,
      includeForks: false,
      pushedWithinMonths: 24,
    });
  });

  it('valor salvo inválido é tratado como ausente', async () => {
    const { service, store } = setup();
    store.data.set('github', { owner: '!!!' });
    expect((await service.view()).owner).toBeNull();
  });

  it('update grava, mostra só o final do token e nunca o token', async () => {
    const { service, store } = setup();
    const view = await service.update({ ...base, token: TOKEN });
    expect(view).toEqual({ owner: 'acme', hasToken: true, tokenHint: '…abcd', includeArchived: true, includeForks: false, pushedWithinMonths: 12 });
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(store.data.get('github')).toMatchObject({ token: TOKEN });
  });

  it('update sem token mantém o salvo; null apaga', async () => {
    const { service, store } = setup();
    await service.update({ ...base, token: TOKEN });
    await service.update({ ...base, owner: 'outra' });
    expect(store.data.get('github')).toMatchObject({ owner: 'outra', token: TOKEN });
    const cleared = await service.update({ ...base, token: null });
    expect(cleared.hasToken).toBe(false);
    expect(store.data.get('github')).toMatchObject({ token: null });
  });

  it('update sem token e sem nada salvo grava token null', async () => {
    const { service, store } = setup();
    await service.update({ ...base, pushedWithinMonths: null });
    expect(store.data.get('github')).toMatchObject({ token: null, pushedWithinMonths: null });
  });

  it('require exige token', async () => {
    const { service } = setup();
    await expect(service.require()).rejects.toBeInstanceOf(BusinessRuleError);
    await service.update({ ...base, token: null });
    await expect(service.require()).rejects.toThrow('Configure a organização e o token do GitHub primeiro');
    await service.update({ ...base, token: TOKEN });
    expect(await service.require()).toMatchObject({ owner: 'acme', token: TOKEN });
  });

  it('test: ok com login e quantidade de repositórios', async () => {
    const { service, github } = setup();
    github.login = 'octocat';
    github.repos = [{ name: 'a', description: null, defaultBranch: 'main', language: null, archived: false, fork: false, pushedAt: null, htmlUrl: '' }];
    await service.update({ ...base, token: TOKEN });
    expect(await service.test()).toEqual({ ok: true, login: 'octocat', repoCount: 1, error: null });
  });

  it('test: erro vira resultado (Error e não-Error)', async () => {
    const { service, github } = setup();
    expect(await service.test()).toEqual({ ok: false, login: null, repoCount: null, error: 'Configure a organização e o token do GitHub primeiro' });
    await service.update({ ...base, token: TOKEN });
    github.viewer = async () => {
      throw 'rede caiu';
    };
    expect(await service.test()).toEqual({ ok: false, login: null, repoCount: null, error: 'rede caiu' });
  });
});

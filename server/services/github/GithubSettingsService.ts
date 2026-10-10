import type { ISecureSettingsStore } from '../../repositories/contracts/ISecureSettingsStore.ts';
import type { IGithubClient } from '../../infra/github/IGithubClient.ts';
import { storedGithubSettingsSchema, type StoredGithubSettings, type UpdateGithubSettingsInput } from '../../../shared/schemas.ts';
import type { GithubSettingsView, GithubTestResult } from '../../../shared/types.ts';
import { BusinessRuleError } from '../../core/errors/AppError.ts';
import type { IGithubSettingsService } from '../contracts/index.ts';

const KEY = 'github';

/** Organização/usuário e token do GitHub. O token fica criptografado e nunca volta pela API. */
export class GithubSettingsService implements IGithubSettingsService {
  constructor(
    private readonly store: ISecureSettingsStore,
    private readonly github: IGithubClient,
  ) {}

  async view(): Promise<GithubSettingsView> {
    const s = await this.stored();
    return {
      owner: s?.owner ?? null,
      hasToken: !!s?.token,
      tokenHint: s?.token ? `…${s.token.slice(-4)}` : null,
      includeArchived: s?.includeArchived ?? false,
      includeForks: s?.includeForks ?? false,
      // Sem configuração ainda: sugere 24 meses; null salvo = todos os repositórios.
      pushedWithinMonths: s ? s.pushedWithinMonths : 24,
    };
  }

  async update(input: UpdateGithubSettingsInput): Promise<GithubSettingsView> {
    const current = await this.stored();
    const next = storedGithubSettingsSchema.parse({
      owner: input.owner,
      token: input.token === undefined ? (current?.token ?? null) : input.token,
      includeArchived: input.includeArchived,
      includeForks: input.includeForks,
      pushedWithinMonths: input.pushedWithinMonths,
    });
    await this.store.set(KEY, next);
    return await this.view();
  }

  async test(): Promise<GithubTestResult> {
    try {
      const s = await this.require();
      const login = await this.github.viewer(s.token);
      const repos = await this.github.listRepos(s.owner, s.token);
      return { ok: true, login, repoCount: repos.length, error: null };
    } catch (err) {
      return { ok: false, login: null, repoCount: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async require(): Promise<StoredGithubSettings & { token: string }> {
    const s = await this.stored();
    if (!s?.token) throw new BusinessRuleError('Configure a organização e o token do GitHub primeiro');
    return { ...s, token: s.token };
  }

  private async stored(): Promise<StoredGithubSettings | null> {
    const parsed = storedGithubSettingsSchema.safeParse(await this.store.get(KEY));
    return parsed.success ? parsed.data : null;
  }
}

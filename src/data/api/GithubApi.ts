import { HttpService } from '../../core/http/HttpService.ts';
import type { IHttpService } from '../../core/http/IHttpService.ts';
import type {
  GithubSettingsView,
  GithubTestResult,
  ImportResult,
  IntrospectionRunState,
  RepoIntrospectionDetail,
  RepoIntrospectionSummary,
  RepoMetricsSnapshot,
} from '../../../shared/types.ts';
import type { RunIntrospectionInput, UpdateGithubSettingsInput } from '../../../shared/schemas.ts';

export class GithubApi {
  private static instance: GithubApi | undefined;

  private constructor(private readonly http: IHttpService) {}

  static getInstance(http: IHttpService = HttpService.getInstance()): GithubApi {
    return (GithubApi.instance ??= new GithubApi(http));
  }

  settings(): Promise<GithubSettingsView> {
    return this.http.get('/settings/github');
  }

  updateSettings(input: UpdateGithubSettingsInput): Promise<GithubSettingsView> {
    return this.http.put('/settings/github', input);
  }

  testSettings(): Promise<GithubTestResult> {
    return this.http.post('/settings/github/test');
  }

  repos(): Promise<RepoIntrospectionSummary[]> {
    return this.http.get('/repos');
  }

  sync(): Promise<RepoIntrospectionSummary[]> {
    return this.http.post('/repos/sync');
  }

  introspect(input: RunIntrospectionInput): Promise<IntrospectionRunState> {
    return this.http.post('/repos/introspect', input);
  }

  state(): Promise<IntrospectionRunState> {
    return this.http.get('/repos/state');
  }

  repo(id: number): Promise<RepoIntrospectionDetail> {
    return this.http.get(`/repos/${id}`);
  }

  /** Aplica a proposta do repositório no grafo informado. */
  apply(id: number, graphId: number): Promise<ImportResult> {
    return this.http.post(`/repos/${id}/apply`, { graphId });
  }

  metricsHistory(owner: string, repo: string): Promise<RepoMetricsSnapshot[]> {
    return this.http.get(`/metrics/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  }
}

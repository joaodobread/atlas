import type { RepoMetricsSnapshot } from '../../../shared/types.ts';

export type MetricsData = Omit<RepoMetricsSnapshot, 'id' | 'owner' | 'repo' | 'sha' | 'ref' | 'runUrl' | 'receivedAt' | 'reportKeys'>;

export interface NewMetrics {
  owner: string;
  repo: string;
  sha: string;
  ref: string | null;
  runUrl: string | null;
  data: MetricsData;
  /** Relatórios brutos guardados no bucket privado. */
  reportKeys: string[];
}

export interface IRepoMetricsRepository {
  insert(m: NewMetrics): Promise<RepoMetricsSnapshot>;
  latest(owner: string, repo: string): Promise<RepoMetricsSnapshot | null>;
  history(owner: string, repo: string, limit: number): Promise<RepoMetricsSnapshot[]>;
}

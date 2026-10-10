import type { AnalysisDepth } from '../../../shared/constants.ts';
import type {
  IntrospectionStatus,
  QualityReport,
  RepoAnalysis,
  RepoFacts,
  RepoGraphProposal,
  RepoIntrospectionDetail,
  RepoIntrospectionSummary,
  RepoActivity,
  RepoProcess,
  ScoreHistoryPoint,
} from '../../../shared/types.ts';

/** Metadados do repositório vindos do GitHub. */
export interface RepoMetadata {
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string | null;
  language: string | null;
  archived: boolean;
  fork: boolean;
  pushedAt: string | null;
  htmlUrl: string | null;
}

export interface IntrospectionOutcome {
  sha: string;
  depth: AnalysisDepth;
  facts: RepoFacts;
  quality: QualityReport;
  analysis: RepoAnalysis;
  proposal: RepoGraphProposal;
  documentId: number | null;
  /** Análise concluída com ressalva (ex.: LLM falhou e caiu na heurística). Fica no campo `error`. */
  warning?: string | null;
}

export interface IRepoIntrospectionRepository {
  list(owner: string): Promise<RepoIntrospectionSummary[]>;
  /** Detalhe sem métricas nem histórico (quem monta o detalhe completo é o service). */
  findById(id: number): Promise<Omit<RepoIntrospectionDetail, 'metrics' | 'history'> | null>;
  findByName(owner: string, name: string): Promise<Omit<RepoIntrospectionDetail, 'metrics' | 'history'> | null>;
  /** Cria ou atualiza os metadados (não mexe na análise). */
  upsertMetadata(meta: RepoMetadata): Promise<void>;
  /** Remove da lista os repositórios do dono que não vieram mais do GitHub. */
  deleteMissing(owner: string, keepNames: readonly string[]): Promise<void>;
  analyzedSha(id: number): Promise<string | null>;
  setStatus(id: number, status: IntrospectionStatus, error?: string | null): Promise<void>;
  saveOutcome(id: number, outcome: IntrospectionOutcome): Promise<void>;
  /** Atualiza só o scorecard (ex.: chegou um resumo de segurança). */
  saveQuality(id: number, quality: QualityReport): Promise<void>;
  markApplied(id: number): Promise<void>;
  saveProcess(id: number, process: RepoProcess): Promise<void>;
  saveActivity(id: number, activity: RepoActivity): Promise<void>;
  /** Liga o repositório a um nó do grafo. */
  linkNode(id: number, nodeId: number | null): Promise<void>;
  /** Registra a nota calculada (histórico). */
  addHistory(id: number, quality: QualityReport): Promise<void>;
  history(id: number, limit: number): Promise<ScoreHistoryPoint[]>;
  /** Volta para "pendente" o que ficou "rodando" (processo reiniciado no meio). */
  resetRunning(): Promise<void>;
}

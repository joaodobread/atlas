import type { AnalysisDepth, IntrospectionStage } from '../../../shared/constants.ts';
import type { CodeMappingOutput } from '../../../shared/schemas.ts';
import type { RepoAnalysis, RepoGraphProposal } from '../../../shared/types.ts';
import type { CodeCallSite, CodeScanResult, CodeSurface } from '../../services/github/CodeScanner.ts';

/** Estado salvo da varredura em andamento. */
export interface ScanCheckpoint {
  /** Arquivos já lidos. */
  files: string[];
  sites: Array<Omit<CodeCallSite, 'id'>>;
  surfaces: Array<Omit<CodeSurface, 'id'>>;
}

/** Estado salvo do mapeamento pelo LLM: os lotes já respondidos. */
export interface MappingCheckpoint {
  output: CodeMappingOutput;
  batchesDone: number;
}

/** O que já foi feito numa análise; vale só para o mesmo commit e a mesma profundidade. */
export interface IntrospectionCheckpoint {
  sha: string;
  depth: AnalysisDepth;
  stage: IntrospectionStage;
  done: number | null;
  total: number | null;
  analyzed?: { analysis: RepoAnalysis; proposal: RepoGraphProposal; llmError: string | null };
  scan?: ScanCheckpoint;
  /** Varredura concluída (com os ids que o mapeamento usa). */
  scanned?: CodeScanResult;
  mapping?: MappingCheckpoint;
}

export interface IIntrospectionCheckpointRepository {
  get(repoId: number): Promise<IntrospectionCheckpoint | null>;
  save(repoId: number, checkpoint: IntrospectionCheckpoint): Promise<void>;
  clear(repoId: number): Promise<void>;
}

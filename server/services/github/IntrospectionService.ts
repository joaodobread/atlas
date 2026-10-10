import type { AnalysisDepth, IntrospectionStage } from '../../../shared/constants.ts';
import type { RunIntrospectionInput } from '../../../shared/schemas.ts';
import type {
  GraphNode,
  ImportResult,
  IntrospectionProgress,
  IntrospectionRunState,
  RepoIntrospectionDetail,
  RepoIntrospectionSummary,
} from '../../../shared/types.ts';
import { NotFoundError } from '../../core/errors/AppError.ts';
import type { IDatabase } from '../../infra/database/IDatabase.ts';
import type { IGithubClient } from '../../infra/github/IGithubClient.ts';
import type { IPackageIntel } from '../../infra/packages/IPackageIntel.ts';
import type { IConnectionRepository } from '../../repositories/contracts/IConnectionRepository.ts';
import type { IInterfaceRepository } from '../../repositories/contracts/IInterfaceRepository.ts';
import type { INodeRepository } from '../../repositories/contracts/INodeRepository.ts';
import type { IRepoIntrospectionRepository } from '../../repositories/contracts/IRepoIntrospectionRepository.ts';
import type { IRepoMetricsRepository } from '../../repositories/contracts/IRepoMetricsRepository.ts';
import type {
  ICallSiteService,
  IConnectionService,
  IDocumentService,
  IGithubSettingsService,
  IGraphService,
  IInterfaceService,
  IIntrospectionService,
  INodeService,
} from '../contracts/index.ts';
import type { QualityScorer } from './QualityScorer.ts';
import { SCAN_FULL, SCAN_MAX, type CodeScanner } from './CodeScanner.ts';
import type { CodeMapper, RepoAnalyzer } from './RepoAnalyzer.ts';
import type { ProcessCollector } from './ProcessCollector.ts';
import type { ActivityCollector } from './ActivityCollector.ts';
import type { RepoCollector } from './RepoCollector.ts';
import { repoMarkdown } from './RepoDocumentWriter.ts';

const CONCURRENCY = 2;
const DEPTH_RANK: Record<AnalysisDepth, number> = { fast: 0, medium: 1, full: 2, max: 3 };

/**
 * Introspecção dos repositórios do GitHub: coleta fatos, consulta fontes públicas (OSV, registries, endoflife),
 * calcula o scorecard, resume com o LLM, grava um documento por repositório (entra no RAG) e guarda uma proposta de
 * nós/conexões que só vai para o grafo quando alguém aplica.
 */

const ACTIVITY_CONCURRENCY = 6;
export class IntrospectionService implements IIntrospectionService {
  private queue: Array<{ id: number; force: boolean; depth: AnalysisDepth }> = [];
  /** Nome de cada repositório na fila (para o estado, sem ir ao banco). */
  private readonly names = new Map<number, string>();
  private active = new Set<number>();
  private counters = { done: 0, failed: 0 };
  /** Progresso de cada repositório em análise (some ao terminar). */
  private readonly progress = new Map<number, IntrospectionProgress>();

  constructor(
    private readonly repos: IRepoIntrospectionRepository,
    private readonly metrics: IRepoMetricsRepository,
    private readonly settings: IGithubSettingsService,
    private readonly github: IGithubClient,
    private readonly collector: RepoCollector,
    private readonly processCollector: ProcessCollector,
    private readonly activityCollector: ActivityCollector,
    private readonly analyzer: RepoAnalyzer,
    private readonly scanner: CodeScanner,
    private readonly mapper: CodeMapper,
    private readonly scorer: QualityScorer,
    private readonly intel: IPackageIntel,
    private readonly graph: IGraphService,
    private readonly nodeService: INodeService,
    private readonly connectionService: IConnectionService,
    private readonly callSiteService: ICallSiteService,
    private readonly interfaceService: IInterfaceService,
    private readonly interfaces: IInterfaceRepository,
    private readonly nodes: INodeRepository,
    private readonly connections: IConnectionRepository,
    private readonly documents: IDocumentService,
    private readonly db: IDatabase,
  ) {}

  async start(): Promise<void> {
    await this.repos.resetRunning();
  }

  async list(): Promise<RepoIntrospectionSummary[]> {
    const owner = await this.ownerOrNull();
    return owner ? await this.repos.list(owner) : [];
  }

  async get(id: number): Promise<RepoIntrospectionDetail> {
    const r = await this.repos.findById(id);
    if (!r) throw new NotFoundError(`Repositório ${id} não encontrado`);
    return { ...r, metrics: await this.metrics.latest(r.owner, r.name), history: await this.repos.history(id, 30) };
  }

  async sync(): Promise<RepoIntrospectionSummary[]> {
    const s = await this.settings.require();
    const cutoff = s.pushedWithinMonths ? Date.now() - s.pushedWithinMonths * 30.44 * 24 * 3600 * 1000 : null;
    const list = (await this.github.listRepos(s.owner, s.token)).filter(
      (r) => (s.includeArchived || !r.archived) && (s.includeForks || !r.fork) && (!cutoff || (r.pushedAt != null && Date.parse(r.pushedAt) >= cutoff)),
    );
    await this.db.transaction(async () => {
      for (const r of list) await this.repos.upsertMetadata({ owner: s.owner, ...r });
      await this.repos.deleteMissing(
        s.owner,
        list.map((r) => r.name),
      );
    });
    // Atividade (PRs abertos): 1 chamada por repositório, em paralelo limitado; erro fica no próprio registro.
    const saved = (await this.repos.list(s.owner)).filter((r) => !r.archived);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(ACTIVITY_CONCURRENCY, saved.length) }, async () => {
        while (next < saved.length) {
          const r = saved[next++]!;
          await this.repos.saveActivity(r.id, await this.activityCollector.collect(r.owner, r.name, s.token));
        }
      }),
    );
    return await this.repos.list(s.owner);
  }

  async run(input: RunIntrospectionInput): Promise<IntrospectionRunState> {
    const s = await this.settings.require();
    const all = await this.repos.list(s.owner);
    const wanted = input.repos?.length ? all.filter((r) => input.repos!.includes(r.name)) : all;
    for (const r of wanted) {
      if (this.active.has(r.id) || this.queue.some((q) => q.id === r.id)) continue;
      this.queue.push({ id: r.id, force: input.force, depth: input.depth });
      this.names.set(r.id, r.name);
      await this.repos.setStatus(r.id, 'pending');
    }
    this.pump();
    return this.state();
  }

  state(): IntrospectionRunState {
    const current = [...this.active]
      .map((id) => this.names.get(id))
      .filter(Boolean)
      .join(', ');
    return {
      running: this.active.size > 0,
      queued: this.queue.length,
      current: current || null,
      ...this.counters,
      progress: [...this.progress.values()].map((p) => ({ ...p })),
    };
  }

  async apply(id: number, graphId: number): Promise<ImportResult> {
    const r = await this.get(id);
    if (!r.proposal) throw new NotFoundError('Este repositório ainda não foi analisado');
    const result: ImportResult = {
      nodesCreated: 0,
      nodesUpdated: 0,
      interfacesCreated: 0,
      connectionsCreated: 0,
      connectionsUpdated: 0,
      callSitesCreated: 0,
      warnings: [],
    };
    const ids = new Map<string, number>();
    const proposal = r.proposal;

    await this.db.transaction(async () => {
      // Pais antes dos filhos (a proposta tem no máximo grupo → nó → módulos).
      const pending = [...proposal.nodes];
      for (let guard = 0; pending.length && guard < 10; guard++) {
        // Cópia: o laço remove itens de `pending`.
        for (const n of Array.from(pending)) {
          if (n.existingId != null) {
            const graphOfExisting = await this.nodes.graphOf(n.existingId);
            if (graphOfExisting === graphId) {
              ids.set(n.key, n.existingId);
              pending.splice(pending.indexOf(n), 1);
              continue;
            }
            if (graphOfExisting === undefined) result.warnings.push(`Nó "${n.name}" não existe mais; será criado`);
            // Nó de outro grafo: usa um homônimo deste grafo ou cria na raiz.
            const same = (await this.nodes.findByGraph(graphId)).find((x) => x.name.toLowerCase() === n.name.toLowerCase());
            ids.set(
              n.key,
              same
                ? same.id
                : (
                    await this.nodeService.create({
                      graph_id: graphId,
                      parent_id: null,
                      name: n.name,
                      kind: n.kind,
                      tech: n.tech,
                      icon: null,
                      description: n.description,
                    })
                  ).id,
            );
            if (!same) result.nodesCreated++;
            pending.splice(pending.indexOf(n), 1);
            continue;
          }
          const parentId = n.parentKey == null ? null : ids.get(n.parentKey);
          if (parentId === undefined) continue;
          const found = await this.nodes.findByParentAndName(graphId, parentId, n.name);
          ids.set(
            n.key,
            found
              ? found.id
              : (
                  await this.nodeService.create({
                    graph_id: graphId,
                    parent_id: parentId,
                    name: n.name,
                    kind: n.kind,
                    tech: n.tech,
                    icon: null,
                    description: n.description,
                  })
                ).id,
          );
          if (!found) result.nodesCreated++;
          pending.splice(pending.indexOf(n), 1);
        }
      }
      for (const n of pending) result.warnings.push(`Nó "${n.name}" ignorado: o pai "${n.parentKey}" não existe na proposta`);
      /** Interface do nó (criada se não existir) — rotas/consumidores expostos e o que é usado no destino. */
      const ensureInterface = async (nodeId: number, name: string, extra: { type?: string | null; spec?: string | null; description?: string | null } = {}) => {
        const found = await this.interfaces.findByNodeAndName(nodeId, name);
        if (found) return found.id;
        result.interfacesCreated++;
        return (
          await this.interfaceService.create({
            node_id: nodeId,
            name,
            type: extra.type ?? null,
            spec: extra.spec ?? null,
            description: extra.description ?? null,
          })
        ).id;
      };
      for (const n of proposal.nodes) {
        const nodeId = ids.get(n.key);
        if (nodeId == null) continue;
        for (const i of n.interfaces ?? []) await ensureInterface(nodeId, i.name, i);
      }
      for (const c of proposal.connections) {
        const source = ids.get(c.fromKey);
        const target = ids.get(c.toKey);
        if (source == null || target == null || source === target) continue;
        const ifaceId = c.interface ? await ensureInterface(target, c.interface) : null;
        if (await this.connections.findByEndpoints(source, target, ifaceId)) continue;
        const conn = await this.connectionService.create({
          source_id: source,
          target_id: target,
          target_interface_id: ifaceId,
          parent_connection_id: null,
          protocol: c.protocol,
          description: c.description,
        });
        result.connectionsCreated++;
        for (const site of c.callSites ?? []) {
          await this.callSiteService.create({
            connection_id: conn.id,
            file_path: site.file_path,
            line: site.line,
            symbol: site.symbol,
            snippet: site.snippet,
            notes: null,
            end_line: site.end_line ?? null,
            code: site.code ?? null,
          });
          result.callSitesCreated++;
        }
      }
      await this.repos.markApplied(id);
      // Liga o repositório ao nó só se ainda não estiver ligado (o primeiro grafo vira o "principal").
      const self = ids.get('self');
      if (self != null && r.nodeId == null) await this.repos.linkNode(id, self);
    });
    return result;
  }

  async refreshQuality(requestedOwner: string, requestedName: string): Promise<void> {
    const r = await this.repos.findByName(requestedOwner, requestedName);
    // O CI pode mandar outra capitalização: usa o nome guardado para não duplicar o documento.
    const owner = r?.owner ?? requestedOwner;
    const name = r?.name ?? requestedName;
    if (!r?.facts || !r.analysis) return;
    const metrics = await this.metrics.latest(owner, name);
    const quality = this.scorer.score({ facts: r.facts, metrics, process: r.process, repo: { description: r.description, pushedAt: r.pushedAt } });
    await this.repos.saveQuality(r.id, quality);
    await this.repos.addHistory(r.id, quality);
    await this.documents.upsertData({
      path: docPath(owner, name),
      title: `${name} (GitHub)`,
      content: repoMarkdown({
        owner,
        name,
        htmlUrl: r.htmlUrl,
        sha: (await this.repos.analyzedSha(r.id)) ?? '',
        facts: r.facts,
        analysis: r.analysis,
        quality,
        metrics,
      }),
      source: 'api',
      folderId: null,
    });
  }

  // ---------- Fila ----------

  private pump(): void {
    while (this.active.size < CONCURRENCY && this.queue.length) {
      const job = this.queue.shift()!;
      this.active.add(job.id);
      void this.process(job.id, job.force, job.depth).finally(() => {
        this.active.delete(job.id);
        this.progress.delete(job.id);
        if (!this.active.size && !this.queue.length) this.counters = { done: 0, failed: 0 };
        this.pump();
      });
    }
  }

  private async process(id: number, force: boolean, depth: AnalysisDepth): Promise<void> {
    const repo = await this.repos.findById(id);
    if (!repo) return;
    await this.repos.setStatus(id, 'running');
    const startedAt = new Date().toISOString();
    const stage = (s: IntrospectionStage, done: number | null = null, total: number | null = null) => {
      const prev = this.progress.get(id);
      this.progress.set(id, {
        repo: repo.name,
        depth,
        stage: s,
        done,
        total,
        startedAt,
        stageStartedAt: prev?.stage === s ? prev.stageStartedAt : new Date().toISOString(),
      });
    };
    stage('collecting');
    try {
      const s = await this.settings.require();
      const sha = await this.github.headSha(repo.owner, repo.name, repo.defaultBranch ?? 'main', s.token);
      // Reaproveita se não há commit novo e a análise salva já é tão profunda quanto a pedida.
      const savedDepth = repo.analysisDepth ?? 'medium';
      if (!force && (await this.repos.analyzedSha(id)) === sha && repo.facts && DEPTH_RANK[savedDepth] >= DEPTH_RANK[depth]) {
        // Sem commit novo: só reaproveita (e atualiza a nota com métricas novas).
        await this.refreshQuality(repo.owner, repo.name);
        await this.repos.setStatus(id, 'done');
        this.counters.done++;
        return;
      }

      const collected = await this.collector.collect({
        owner: repo.owner,
        name: repo.name,
        sha,
        branch: repo.defaultBranch ?? 'main',
        token: s.token,
        description: repo.description,
      });
      const f = collected.facts;
      const [vulns, fresh, runtime, proc] = await Promise.all([
        f.dependencies.length ? this.intel.vulnerabilities(f.dependencies).catch(() => null) : null,
        f.dependencies.length ? this.intel.freshness(f.dependencies).catch(() => null) : null,
        f.runtime ? this.intel.runtimeSupport(f.runtime.name, f.runtime.version).catch(() => null) : null,
        this.processCollector.collect(repo.owner, repo.name, repo.defaultBranch ?? 'main', s.token).catch(() => null),
      ]);
      if (proc) await this.repos.saveProcess(id, proc);
      await this.repos.saveActivity(id, await this.activityCollector.collect(repo.owner, repo.name, s.token));
      f.intel = { vulnerabilities: vulns?.affected ?? null, freshness: fresh, runtimeSupport: runtime };

      const graph = await this.graph.getGraph();
      const analyzerInput = {
        owner: repo.owner,
        name: repo.name,
        description: repo.description,
        collected,
        graph: { nodes: graph.nodes, paths: paths(graph.nodes) },
      };
      stage('analyzing');
      const analyzed = await this.analyzer.analyze(analyzerInput, depth);
      const { analysis } = analyzed;
      let proposal = analyzed.proposal;
      let llmError = analyzed.llmError;
      if (analyzed.llmError) analysis.notes.push(`Análise por LLM falhou (${analyzed.llmError}); usado o modo heurístico.`);
      if (depth === 'full' || depth === 'max') {
        // Completa: varre o código e liga cada chamada externa (com o trecho) ao destino no grafo.
        // Máxima: todo o código, blocos inteiros, interfaces usadas e o que cada módulo expõe.
        const deep = depth === 'max';
        stage('scanning');
        const scan = await this.scanner.scan(
          repo.owner,
          repo.name,
          sha,
          s.token,
          deep ? collected.allCodeFiles : collected.sourceFiles,
          (done, total) => stage('scanning', done, total),
          deep ? SCAN_MAX : SCAN_FULL,
        );
        stage('mapping');
        const mapped = await this.mapper.enrich(analyzerInput, proposal, scan, (done, total) => stage('mapping', done, total), deep);
        proposal = mapped.proposal;
        analysis.notes.push(
          `Varredura do código: ${scan.filesScanned} arquivo(s) lidos, ${scan.sites.length} chamada(s) externa(s) encontrada(s)${deep ? `, ${scan.surfaces.length} rota(s)/consumidor(es)/job(s) expostos` : ''}${scan.filesSkipped ? `, ${scan.filesSkipped} arquivo(s) fora do limite` : ''}.`,
        );
        llmError ??= mapped.llmError;
        if (mapped.llmError) analysis.notes.push(`Mapeamento das chamadas por LLM falhou (${mapped.llmError}); usado o modo heurístico.`);
      }

      stage('scoring');
      const metrics = await this.metrics.latest(repo.owner, repo.name);
      const quality = this.scorer.score({ facts: f, metrics, process: proc, repo: { description: repo.description, pushedAt: repo.pushedAt } });
      const doc = await this.documents.upsertData({
        path: docPath(repo.owner, repo.name),
        title: `${repo.name} (GitHub)`,
        content: repoMarkdown({ owner: repo.owner, name: repo.name, htmlUrl: repo.htmlUrl, sha, facts: f, analysis, quality, metrics }),
        source: 'api',
        folderId: null,
      });
      const warning = llmError ? `LLM falhou (${llmError.slice(0, 300)}); análise feita só pela heurística, com menos detalhe.` : null;
      await this.repos.saveOutcome(id, { sha, depth, facts: f, quality, analysis, proposal, documentId: doc.id, warning });
      await this.repos.addHistory(id, quality);
      // Repositório já representado por um nó do grafo: liga na hora (sem precisar aplicar).
      const matched = proposal.nodes.find((n) => n.key === 'self')?.existingId;
      if (matched != null && repo.nodeId == null) await this.repos.linkNode(id, matched);
      this.counters.done++;
    } catch (err) {
      await this.repos.setStatus(id, 'error', err instanceof Error ? err.message : String(err));
      this.counters.failed++;
    }
  }

  private async ownerOrNull(): Promise<string | null> {
    try {
      return (await this.settings.require()).owner;
    } catch {
      return null;
    }
  }
}

const docPath = (owner: string, name: string) => `github/${owner}/${name}.md`;

/** Caminho "A / B / C" de cada nó (mesmo formato da interface). */
function paths(nodes: GraphNode[]): Map<number, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<number, string>();
  const path = (n: GraphNode): string => {
    const hit = out.get(n.id);
    if (hit) return hit;
    const parent = n.parent_id != null ? byId.get(n.parent_id) : undefined;
    const p = parent ? `${path(parent)} / ${n.name}` : n.name;
    out.set(n.id, p);
    return p;
  };
  for (const n of nodes) path(n);
  return out;
}

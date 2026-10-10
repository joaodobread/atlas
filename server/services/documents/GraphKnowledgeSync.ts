import { KIND_LABEL } from '../../../shared/constants.ts';
import type { CallSite, Connection, GraphData, GraphNode } from '../../../shared/types.ts';
import type { IEventBus } from '../../core/events/EventBus.ts';
import type { IDocumentRepository } from '../../repositories/contracts/IDocumentRepository.ts';
import type { IGraphRepository } from '../../repositories/contracts/IGraphRepository.ts';
import type { IDocumentService, IGraphKnowledgeSync, IGraphService } from '../contracts/index.ts';

const DEBOUNCE_MS = 1500;
const MAX_CALL_SITES_PER_CONNECTION = 6;

/**
 * Mantém o modelo do grafo pesquisável: cada nó vira um documento (source = 'graph') com o que ele é,
 * onde fica, o que expõe, quem chama, por quem é chamado e onde no código. Entra na busca
 * (texto + embeddings) e no contexto do RAG como qualquer documento.
 */
export class GraphKnowledgeSync implements IGraphKnowledgeSync {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly graph: IGraphService,
    private readonly graphs: IGraphRepository,
    private readonly documents: IDocumentRepository,
    private readonly documentService: IDocumentService,
    private readonly events: IEventBus,
  ) {}

  async start(): Promise<void> {
    this.events.on('graph.changed', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.safeSync(), DEBOUNCE_MS);
    });
    await this.safeSync();
  }

  async sync(): Promise<{ created: number; updated: number; removed: number }> {
    const g = await this.graph.getGraph();
    const model = new GraphModel(g, new Map((await this.graphs.list()).map((x) => [x.id, x.name])));
    let created = 0;
    let updated = 0;
    for (const n of g.nodes) {
      const out = await this.documentService.upsertData({
        path: `graph/node/${n.id}`,
        title: model.path(n.id),
        content: model.describe(n),
        source: 'graph',
        folderId: null,
        nodeId: n.id,
      });
      if (out.status === 'created') created++;
      if (out.status === 'updated') updated++;
    }
    // Nós apagados somem em cascata; isto cobre documentos órfãos de versões antigas.
    const alive = new Set(g.nodes.map((n) => n.id));
    let removed = 0;
    for (const d of await this.documents.listGraphDocuments()) {
      if (d.node_id == null || !alive.has(d.node_id)) {
        await this.documentService.delete(d.id);
        removed++;
      }
    }
    return { created, updated, removed };
  }

  private async safeSync(): Promise<void> {
    try {
      const r = await this.sync();
      if (r.created || r.updated || r.removed) console.log(`[graph-sync] modelo indexado: +${r.created} ~${r.updated} -${r.removed}`);
    } catch (err) {
      console.error('[graph-sync] falha ao indexar o modelo do grafo:', err);
    }
  }
}

/** Consultas sobre o grafo para montar o texto de cada nó. */
class GraphModel {
  private readonly byId: Map<number, GraphNode>;
  private readonly ifaceName: Map<number, string>;
  private readonly sitesOf = new Map<number, CallSite[]>();

  constructor(
    private readonly g: GraphData,
    private readonly graphNames: Map<number, string>,
  ) {
    this.byId = new Map(g.nodes.map((n) => [n.id, n]));
    this.ifaceName = new Map(g.interfaces.map((i) => [i.id, i.name]));
    for (const s of g.callSites) this.sitesOf.set(s.connection_id, [...(this.sitesOf.get(s.connection_id) ?? []), s]);
  }

  path(id: number): string {
    const n = this.byId.get(id);
    if (!n) return '?';
    return n.parent_id != null && this.byId.has(n.parent_id) ? `${this.path(n.parent_id)} / ${n.name}` : n.name;
  }

  describe(n: GraphNode): string {
    const lines: string[] = [`# ${this.path(n.id)}`, ''];
    lines.push(
      `${n.name} é ${article(n.kind)} ${KIND_LABEL[n.kind].toLowerCase()}${n.tech ? ` (${n.tech})` : ''}. Grafo: ${this.graphNames.get(n.graph_id) ?? '?'}.`,
    );
    if (n.description) lines.push('', n.description);

    const parent = n.parent_id != null ? this.byId.get(n.parent_id) : undefined;
    const children = this.g.nodes.filter((c) => c.parent_id === n.id);
    if (parent || children.length) {
      lines.push('', '## Estrutura');
      if (parent) lines.push(`- Faz parte de: ${this.path(parent.id)}`);
      if (children.length) lines.push(`- Contém: ${children.map((c) => `${c.name} (${KIND_LABEL[c.kind].toLowerCase()})`).join(', ')}`);
    }

    const ifaces = this.g.interfaces.filter((i) => i.node_id === n.id);
    if (ifaces.length) {
      lines.push('', '## Interfaces expostas');
      for (const i of ifaces)
        lines.push(
          `- ${i.name}${i.type ? ` (${i.type})` : ''}${i.spec && i.spec !== i.name ? `: ${i.spec}` : ''}${i.description ? ` — ${i.description}` : ''}`,
        );
    }

    const outgoing = this.g.connections.filter((c) => c.source_id === n.id);
    if (outgoing.length) {
      lines.push('', `## ${n.name} chama (saídas)`);
      for (const c of outgoing) lines.push(...this.connectionLines(c, 'out'));
    }
    const incoming = this.g.connections.filter((c) => c.target_id === n.id);
    if (incoming.length) {
      lines.push('', `## ${n.name} é chamado por (entradas)`);
      for (const c of incoming) lines.push(...this.connectionLines(c, 'in'));
    }
    return lines.join('\n');
  }

  private connectionLines(c: Connection, dir: 'out' | 'in'): string[] {
    const other = this.path(dir === 'out' ? c.target_id : c.source_id);
    const iface = c.target_interface_id != null ? this.ifaceName.get(c.target_interface_id) : undefined;
    const parent = c.parent_connection_id != null ? this.g.connections.find((p) => p.id === c.parent_connection_id) : undefined;
    const head =
      `- ${dir === 'out' ? '→' : '←'} ${other}` +
      `${iface ? ` [${iface}]` : ''}${c.protocol ? ` via ${c.protocol}` : ''}${c.description ? ` — ${c.description}` : ''}` +
      `${parent ? ` (implementa ${this.path(parent.source_id)} → ${this.path(parent.target_id)})` : ''}`;
    const sites = (this.sitesOf.get(c.id) ?? []).slice(0, MAX_CALL_SITES_PER_CONNECTION);
    return [head, ...sites.map((s) => `  - código: ${s.file_path}${s.line != null ? `:${s.line}` : ''}${s.symbol ? ` (${s.symbol})` : ''}`)];
  }
}

function article(kind: GraphNode['kind']): string {
  return kind === 'infra' || kind === 'queue' ? 'uma' : 'um';
}

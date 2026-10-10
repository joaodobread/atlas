import { describe, expect, it } from 'vitest';
import type { GraphNode, NodeInterface } from '../../../shared/types.ts';
import { MentionDetector, normalizeKey } from './MentionDetector.ts';

let seq = 0;
const node = (name: string, kind: GraphNode['kind'] = 'service', id = ++seq): GraphNode => ({
  id,
  graph_id: 1,
  parent_id: null,
  name,
  kind,
  tech: null,
  icon: null,
  description: null,
  created_at: '',
  updated_at: '',
});
const iface = (nodeId: number, name: string): NodeInterface => ({ id: ++seq, node_id: nodeId, name, type: null, spec: null, description: null });

describe('normalizeKey', () => {
  it('remove acentos, caixa, espaços e pontuação', () => {
    expect(normalizeKey('Node API')).toBe('nodeapi');
    expect(normalizeKey('node-api')).toBe('nodeapi');
    expect(normalizeKey('Serviço Ação')).toBe('servicoacao');
  });
});

describe('MentionDetector', () => {
  it('casa nomes exatos sem diferenciar caixa e com fronteira de palavra', () => {
    const api = node('Node API');
    const d = new MentionDetector([api], []);
    expect(d.detect('chama a node api para tudo')).toEqual([{ nodeId: api.id, matched: 'node api', method: 'exact', confidence: 1 }]);
    expect(d.detect('xnode apix')).toEqual([]);
  });

  it('prefere o termo mais longo e não duplica nós', () => {
    const api = node('API', 'service');
    const nodeApi = node('Node API');
    const d = new MentionDetector([api, nodeApi], []);
    const found = d.detect('A Node API fala com a API');
    expect(found.find((m) => m.nodeId === nodeApi.id)?.matched).toBe('Node API');
    expect(found.find((m) => m.nodeId === api.id)?.matched).toBe('API');
  });

  it('reconhece interfaces específicas mas ignora nomes genéricos e nós desconhecidos', () => {
    const db = node('Banco Principal', 'database');
    const d = new MentionDetector([db], [iface(db.id, 'users'), iface(db.id, 'user_accounts'), iface(9999, 'orphan_table'), iface(db.id, 'user_accounts')]);
    expect(d.detect('lê a tabela user_accounts')).toEqual([{ nodeId: db.id, matched: 'user_accounts', method: 'exact', confidence: 1 }]);
    expect(d.detect('lê a tabela users')).toEqual([]);
    expect(d.detect('orphan_table')).toEqual([]);
  });

  it('um nó com vários termos encontrados aparece uma vez só (o termo mais longo)', () => {
    const db = node('Banco Central', 'database');
    const d = new MentionDetector([db], [iface(db.id, 'tb_contas')]);
    expect(d.detect('Banco Central grava em tb_contas')).toEqual([{ nodeId: db.id, matched: 'Banco Central', method: 'exact', confidence: 1 }]);
  });

  it('ignora módulos com nome de palavra comum, mas não marcas', () => {
    const vehicles = node('Vehicles', 'module');
    const payflow = node('PayFlow', 'external');
    const payHubModule = node('PayHub', 'module');
    const d = new MentionDetector([vehicles, payflow, payHubModule], []);
    expect(
      d
        .detect('Vehicles usa PayFlow e PayHub')
        .map((m) => m.nodeId)
        .sort((a, b) => a - b),
    ).toEqual([payflow.id, payHubModule.id].sort((a, b) => a - b));
  });

  it('ignora termos com menos de 3 caracteres', () => {
    const d = new MentionDetector([node('DB')], []);
    expect(d.detect('o DB caiu')).toEqual([]);
  });

  it('casa por aproximação erros de digitação e variações de grafia', () => {
    const api = node('Node API');
    const d = new MentionDetector([api], []);
    expect(d.detect('a NodApi respondeu')).toEqual([{ nodeId: api.id, matched: 'NodApi', method: 'fuzzy', confidence: 0.77 }]);
    expect(d.detect('o node-api respondeu')).toEqual([{ nodeId: api.id, matched: 'node-api', method: 'fuzzy', confidence: 0.95 }]);
    expect(d.detect('NodeAPI')).toEqual([{ nodeId: api.id, matched: 'NodeAPI', method: 'fuzzy', confidence: 0.95 }]);
  });

  it('não junta palavras curtas em janelas compostas', () => {
    const d = new MentionDetector([node('Node API')], []);
    expect(d.detect('node e api')).toEqual([]);
  });

  it('aceita até 2 edições para nomes longos', () => {
    const n = node('Pagamentos Core');
    const d = new MentionDetector([n], []);
    const [m] = d.detect('o pagamentoscroe caiu');
    expect(m).toMatchObject({ nodeId: n.id, method: 'fuzzy' });
    expect(m!.confidence).toBeCloseTo(0.77, 2);
    expect(d.detect('o pagamxntxscxre caiu')).toEqual([]);
  });

  it('rejeita candidatos curtos, com outra inicial ou tamanho muito diferente', () => {
    const d = new MentionDetector([node('Gateway')], []);
    expect(d.detect('gatew')).toEqual([]);
    expect(d.detect('hateway')).toEqual([]);
    expect(d.detect('gatewayzzz')).toEqual([]);
    expect(d.detect('gzzzzzz')).toEqual([]);
  });

  it('pula o aproximado quando nenhum nome é longo o bastante', () => {
    const d = new MentionDetector([node('Redis')], []);
    expect(d.detect('o Rediss caiu')).toEqual([]);
    expect(d.detect('o Redis caiu')).toHaveLength(1);
  });

  it('não procura aproximação para nós já encontrados exatamente', () => {
    const n = node('Gateway');
    const d = new MentionDetector([n], []);
    expect(d.detect('Gateway e gatewya')).toEqual([{ nodeId: n.id, matched: 'Gateway', method: 'exact', confidence: 1 }]);
  });
});

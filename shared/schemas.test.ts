import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import {
  applyProposalSchema,
  askSchema,
  changePasswordSchema,
  codeMappingSchema,
  createApiTokenSchema,
  createCallSiteSchema,
  createConnectionSchema,
  createGraphSchema,
  createInterfaceSchema,
  createNodeSchema,
  createUserSchema,
  exchangeCallSiteSchema,
  exchangeConnectionSchema,
  exchangeDocumentSchema,
  exchangeInterfaceSchema,
  exchangeNodeSchema,
  graphFromReposSchema,
  iconIdSchema,
  idParamSchema,
  importDocumentsSchema,
  ingestMetricsSchema,
  loginSchema,
  onboardingSchema,
  rawMetricsSchema,
  repoAnalysisSchema,
  repoKeySchema,
  runIntrospectionSchema,
  searchQuerySchema,
  setupSchema,
  storedGithubSettingsSchema,
  storedLlmSettingsSchema,
  updateCallSiteSchema,
  updateConnectionSchema,
  updateGithubSettingsSchema,
  updateGraphSchema,
  updateInterfaceSchema,
  updateLlmSettingsSchema,
  updateNodeSchema,
  updateUserSchema,
  upsertDocumentSchema,
  watchedFolderSchema,
} from './schemas.ts';

const ok = (schema: ZodTypeAny, value: unknown) => {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`esperava válido: ${JSON.stringify(r.error.issues)}`);
  return r.data as unknown;
};
const fail = (schema: ZodTypeAny, value: unknown) => {
  const r = schema.safeParse(value);
  expect(r.success).toBe(false);
  return r.success ? [] : r.error.issues;
};

describe('iconIdSchema / idParamSchema', () => {
  it('aceita ids de ícone si:/lu: e rejeita outros', () => {
    expect(ok(iconIdSchema, ' si:mysql ')).toBe('si:mysql');
    expect(ok(iconIdSchema, 'lu:hard-drive')).toBe('lu:hard-drive');
    expect(fail(iconIdSchema, 'fa:mysql')[0].message).toBe('Ícone inválido');
    fail(iconIdSchema, 'si:MySQL');
    fail(iconIdSchema, `lu:${'a'.repeat(60)}`);
  });

  it('converte o parâmetro de id e exige inteiro positivo', () => {
    expect(ok(idParamSchema, '42')).toBe(42);
    fail(idParamSchema, '0');
    fail(idParamSchema, '1.5');
    fail(idParamSchema, 'abc');
  });
});

describe('nós', () => {
  it('createNodeSchema aplica defaults e converte texto vazio em null', () => {
    expect(ok(createNodeSchema, { name: ' API ', graph_id: 1, tech: '  ', description: 'x' })).toEqual({
      name: 'API',
      graph_id: 1,
      parent_id: null,
      kind: 'project',
      icon: null,
      tech: null,
      description: 'x',
    });
  });

  it('createNodeSchema rejeita nome vazio, campos extras, tipo e ícone inválidos', () => {
    expect(fail(createNodeSchema, { name: '   ' })[0].message).toBe('Obrigatório');
    fail(createNodeSchema, { name: 'a', extra: 1 });
    fail(createNodeSchema, { name: 'a', kind: 'banana' });
    fail(createNodeSchema, { name: 'a', icon: 'x' });
    fail(createNodeSchema, { name: 'a', parent_id: -1 });
    fail(createNodeSchema, { name: 'a'.repeat(201) });
    fail(createNodeSchema, { name: 'a', tech: 'a'.repeat(201) });
  });

  it('updateNodeSchema é parcial e estrito', () => {
    expect(ok(updateNodeSchema, {})).toEqual({});
    expect(ok(updateNodeSchema, { tech: null, icon: null })).toEqual({ tech: null, icon: null });
    fail(updateNodeSchema, { graph_id: 1 });
  });
});

describe('interfaces', () => {
  it('createInterfaceSchema exige node_id e nome', () => {
    expect(ok(createInterfaceSchema, { node_id: 1, name: 'GET /x', type: '', spec: 'abc' })).toEqual({ node_id: 1, name: 'GET /x', type: null, spec: 'abc' });
    fail(createInterfaceSchema, { name: 'x' });
    fail(createInterfaceSchema, { node_id: 1, name: 'x', spec: 'a'.repeat(2001) });
  });

  it('updateInterfaceSchema não permite trocar o nó', () => {
    expect(ok(updateInterfaceSchema, { name: 'y' })).toEqual({ name: 'y' });
    fail(updateInterfaceSchema, { node_id: 2 });
  });
});

describe('conexões', () => {
  it('createConnectionSchema aplica defaults', () => {
    expect(ok(createConnectionSchema, { source_id: 1, target_id: 2, protocol: 'http' })).toEqual({
      source_id: 1,
      target_id: 2,
      protocol: 'http',
      target_interface_id: null,
      parent_connection_id: null,
    });
  });

  it('createConnectionSchema rejeita origem igual ao destino no campo target_id', () => {
    const issues = fail(createConnectionSchema, { source_id: 3, target_id: 3 });
    expect(issues[0]).toMatchObject({ path: ['target_id'], message: 'Origem e destino não podem ser o mesmo nó' });
    fail(createConnectionSchema, { source_id: 1, target_id: 2, foo: 1 });
  });

  it('updateConnectionSchema é parcial', () => {
    expect(ok(updateConnectionSchema, { description: '' })).toEqual({ description: null });
    fail(updateConnectionSchema, { source_id: 0 });
  });
});

describe('locais de chamada', () => {
  it('createCallSiteSchema aplica line=null e valida', () => {
    expect(ok(createCallSiteSchema, { connection_id: 1, file_path: 'src/a.ts' })).toEqual({ connection_id: 1, file_path: 'src/a.ts', line: null });
    fail(createCallSiteSchema, { connection_id: 1, file_path: '' });
    fail(createCallSiteSchema, { connection_id: 1, file_path: 'a', line: 0 });
  });

  it('updateCallSiteSchema não permite trocar a conexão', () => {
    expect(ok(updateCallSiteSchema, { line: 10, symbol: '' })).toEqual({ line: 10, symbol: null });
    fail(updateCallSiteSchema, { connection_id: 1 });
  });
});

describe('import / export', () => {
  it('exchangeDocumentSchema aplica defaults', () => {
    expect(ok(exchangeDocumentSchema, {})).toEqual({ mode: 'merge', nodes: [], connections: [] });
    fail(exchangeDocumentSchema, { mode: 'append' });
  });

  it('exchangeDocumentSchema valida nós, interfaces, conexões e locais', () => {
    const doc = ok(exchangeDocumentSchema, {
      mode: 'replace',
      nodes: [{ ref: 'A', name: 'A', kind: 'service', icon: 'si:redis', parent: null, interfaces: [{ name: 'GET /', type: 'http' }] }],
      connections: [{ from: 'A', to: 'B', interface: 'GET /', implements: 'x', callSites: [{ file_path: 'a.ts', line: 3 }] }],
    }) as { mode: string };
    expect(doc.mode).toBe('replace');
    fail(exchangeNodeSchema, { ref: 'A', name: 'A', parent: '' });
    fail(exchangeNodeSchema, { ref: '', name: 'A' });
    fail(exchangeNodeSchema, { ref: 'A', name: 'A', icon: 'nope' });
    fail(exchangeInterfaceSchema, { name: '' });
    fail(exchangeCallSiteSchema, { file_path: 'a', line: -1 });
    fail(exchangeConnectionSchema, { from: 'A', to: '' });
    fail(exchangeConnectionSchema, { from: 'A', to: 'B', interface: '' });
    // Campos extras são ignorados (não é estrito).
    expect(ok(exchangeConnectionSchema, { from: 'A', to: 'B', other: 1 })).toEqual({ from: 'A', to: 'B' });
  });
});

describe('configurações de LLM', () => {
  it('updateLlmSettingsSchema aceita provider none sem modelo', () => {
    expect(ok(updateLlmSettingsSchema, { provider: 'none', mentionsAuto: false })).toEqual({ provider: 'none', mentionsAuto: false });
  });

  it('updateLlmSettingsSchema exige modelo para anthropic e base url para openai-compatible', () => {
    expect(fail(updateLlmSettingsSchema, { provider: 'anthropic', mentionsAuto: true })).toEqual([
      expect.objectContaining({ path: ['model'], message: 'Informe o modelo' }),
    ]);
    const issues = fail(updateLlmSettingsSchema, { provider: 'openai-compatible', mentionsAuto: true });
    expect(issues.map((i) => i.path[0])).toEqual(['model', 'baseUrl']);
    expect(issues[1].message).toBe('Informe a URL base da API');
    expect(
      ok(updateLlmSettingsSchema, { provider: 'openai-compatible', model: 'm', baseUrl: 'http://localhost:11434/v1', apiKey: null, mentionsAuto: true }),
    ).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(fail(updateLlmSettingsSchema, { provider: 'anthropic', model: 'm', baseUrl: 'nope', mentionsAuto: true })[0].message).toBe('URL inválida');
    fail(updateLlmSettingsSchema, { provider: 'none', mentionsAuto: true, extra: 1 });
    fail(updateLlmSettingsSchema, { provider: 'none', mentionsAuto: true, apiKey: '' });
  });

  it('storedLlmSettingsSchema exige apiKey (string ou null) e aplica o superRefine', () => {
    expect(ok(storedLlmSettingsSchema, { provider: 'anthropic', model: 'claude', apiKey: 'k', mentionsAuto: true })).toMatchObject({ apiKey: 'k' });
    expect(ok(storedLlmSettingsSchema, { provider: 'none', apiKey: null, mentionsAuto: false })).toMatchObject({ apiKey: null });
    fail(storedLlmSettingsSchema, { provider: 'none', mentionsAuto: false });
    fail(storedLlmSettingsSchema, { provider: 'none', apiKey: '', mentionsAuto: false });
    expect(fail(storedLlmSettingsSchema, { provider: 'openai-compatible', model: 'x', apiKey: null, mentionsAuto: false })[0].path).toEqual(['baseUrl']);
  });
});

describe('documentos / RAG', () => {
  it('upsertDocumentSchema aplica source=api e limita o tamanho', () => {
    expect(ok(upsertDocumentSchema, { path: 'a.md', content: '# A' })).toEqual({ path: 'a.md', content: '# A', source: 'api' });
    expect(fail(upsertDocumentSchema, { path: 'a.md', content: 'x'.repeat(2_000_001) })[0].message).toBe('Documento grande demais');
    fail(upsertDocumentSchema, { path: 'a.md', content: '', source: 'folder' });
  });

  it('importDocumentsSchema exige ao menos um documento', () => {
    fail(importDocumentsSchema, { documents: [] });
    expect(ok(importDocumentsSchema, { documents: [{ path: 'a', content: '', source: 'upload' }] })).toEqual({
      documents: [{ path: 'a', content: '', source: 'upload' }],
    });
  });

  it('searchQuerySchema converte limit e aplica defaults', () => {
    expect(ok(searchQuerySchema, { q: ' redis ' })).toEqual({ q: 'redis', mode: 'hybrid', limit: 15 });
    expect(ok(searchQuerySchema, { q: 'x', mode: 'text', limit: '5' })).toEqual({ q: 'x', mode: 'text', limit: 5 });
    expect(fail(searchQuerySchema, { q: '  ' })[0].message).toBe('Digite algo para buscar');
    fail(searchQuerySchema, { q: 'x', limit: '51' });
  });

  it('askSchema valida a pergunta e aplica limit', () => {
    expect(ok(askSchema, { question: 'o que é X?' })).toEqual({ question: 'o que é X?', limit: 8 });
    expect(fail(askSchema, { question: 'oi' })[0].message).toBe('Pergunta muito curta');
    fail(askSchema, { question: 'abc', limit: 21 });
  });

  it('watchedFolderSchema exige caminho absoluto (Unix ou Windows)', () => {
    expect(ok(watchedFolderSchema, { path: ' /docs ' })).toEqual({ path: '/docs' });
    expect(ok(watchedFolderSchema, { path: 'C:\\docs' })).toEqual({ path: 'C:\\docs' });
    expect(ok(watchedFolderSchema, { path: 'd:/docs' })).toEqual({ path: 'd:/docs' });
    expect(fail(watchedFolderSchema, { path: 'docs/x' })[0].message).toBe('Use um caminho absoluto');
    fail(watchedFolderSchema, { path: '' });
  });
});

describe('usuários / autenticação', () => {
  it('setupSchema normaliza o e-mail e valida a senha', () => {
    expect(ok(setupSchema, { name: 'Ana', email: ' ANA@X.COM ', password: '12345678' })).toEqual({ name: 'Ana', email: 'ana@x.com', password: '12345678' });
    expect(fail(setupSchema, { name: 'Ana', email: 'x', password: '12345678' })[0].message).toBe('E-mail inválido');
    expect(fail(setupSchema, { name: 'Ana', email: 'a@b.co', password: '123' })[0].message).toBe('Mínimo de 8 caracteres');
  });

  it('loginSchema exige senha', () => {
    expect(ok(loginSchema, { email: 'a@b.co', password: 'x' })).toEqual({ email: 'a@b.co', password: 'x' });
    expect(fail(loginSchema, { email: 'a@b.co', password: '' })[0].message).toBe('Informe a senha');
  });

  it('createUserSchema / updateUserSchema validam o papel', () => {
    ok(createUserSchema, { name: 'A', email: 'a@b.co', role: 'editor', password: '12345678' });
    fail(createUserSchema, { name: 'A', email: 'a@b.co', role: 'root', password: '12345678' });
    expect(ok(updateUserSchema, { active: false })).toEqual({ active: false });
    fail(updateUserSchema, { id: 1 });
  });

  it('changePasswordSchema, onboardingSchema e createApiTokenSchema', () => {
    ok(changePasswordSchema, { currentPassword: 'a', newPassword: '12345678' });
    fail(changePasswordSchema, { currentPassword: '', newPassword: '12345678' });
    expect(ok(onboardingSchema, { done: true })).toEqual({ done: true });
    fail(onboardingSchema, { done: 'yes' });
    fail(onboardingSchema, { done: true, x: 1 });
    expect(ok(createApiTokenSchema, { name: ' ci ' })).toEqual({ name: 'ci' });
    fail(createApiTokenSchema, { name: '' });
  });
});

describe('GitHub / introspecção', () => {
  const base = { owner: 'acme-co', includeArchived: false, includeForks: true, pushedWithinMonths: null };

  it('updateGithubSettingsSchema valida o owner', () => {
    expect(ok(updateGithubSettingsSchema, base)).toEqual(base);
    ok(updateGithubSettingsSchema, { ...base, owner: 'A'.repeat(39) });
    fail(updateGithubSettingsSchema, { ...base, owner: 'A'.repeat(40) });
    expect(fail(updateGithubSettingsSchema, { ...base, owner: '-acme' })[0].message).toBe('Organização ou usuário do GitHub inválido');
    fail(updateGithubSettingsSchema, { ...base, owner: 'acme_co' });
  });

  it('updateGithubSettingsSchema valida token e período', () => {
    expect(ok(updateGithubSettingsSchema, { ...base, token: null, pushedWithinMonths: 12 })).toMatchObject({ token: null, pushedWithinMonths: 12 });
    expect(fail(updateGithubSettingsSchema, { ...base, token: 'short' })[0].message).toBe('Token inválido');
    fail(updateGithubSettingsSchema, { ...base, pushedWithinMonths: 0 });
    fail(updateGithubSettingsSchema, { ...base, pushedWithinMonths: 121 });
    fail(updateGithubSettingsSchema, { ...base, extra: true });
  });

  it('storedGithubSettingsSchema exige token (string ou null)', () => {
    expect(ok(storedGithubSettingsSchema, { ...base, token: 'ghp_1234567890' })).toMatchObject({ token: 'ghp_1234567890' });
    expect(fail(storedGithubSettingsSchema, base)[0]!.path).toEqual(['token']);
  });

  it('runIntrospectionSchema aplica defaults', () => {
    expect(ok(runIntrospectionSchema, {})).toEqual({ force: false, depth: 'medium' });
    expect(ok(runIntrospectionSchema, { repos: ['a'], force: true, depth: 'full' })).toEqual({ repos: ['a'], force: true, depth: 'full' });
    fail(runIntrospectionSchema, { repos: [''] });
    fail(runIntrospectionSchema, { depth: 'deep' });
  });
});

describe('métricas de CI', () => {
  const base = { owner: 'acme', repo: 'api', sha: 'ABCDEF1' };

  it('ingestMetricsSchema aplica defaults', () => {
    expect(ok(ingestMetricsSchema, base)).toEqual({ ...base, reports: [], metrics: {} });
  });

  it('ingestMetricsSchema valida sha, url, relatórios e métricas', () => {
    expect(fail(ingestMetricsSchema, { ...base, sha: 'xyz' })[0].message).toBe('SHA inválido');
    fail(ingestMetricsSchema, { ...base, sha: 'a'.repeat(41) });
    fail(ingestMetricsSchema, { ...base, runUrl: 'nope' });
    const full = ok(ingestMetricsSchema, {
      ...base,
      ref: 'main',
      runUrl: 'https://github.com/acme/api/actions/runs/1',
      reports: [{ type: 'sarif', category: 'sast', tool: 'semgrep', content: '{}' }],
      metrics: { coverageLines: 91.5, lintErrors: 0 },
    }) as { reports: unknown[] };
    expect(full.reports).toHaveLength(1);
    fail(ingestMetricsSchema, { ...base, reports: [{ type: 'xml', content: '' }] });
    fail(ingestMetricsSchema, { ...base, reports: [{ type: 'lcov', category: 'perf', content: '' }] });
    fail(ingestMetricsSchema, { ...base, reports: [{ type: 'lcov', content: '', extra: 1 }] });
    fail(ingestMetricsSchema, { ...base, metrics: { coverageLines: 101 } });
    fail(ingestMetricsSchema, { ...base, owner: '' });
  });

  it('rawMetricsSchema é parcial, estrito e exige inteiros nas contagens', () => {
    expect(ok(rawMetricsSchema, {})).toEqual({});
    fail(rawMetricsSchema, { lintWarnings: 1.5 });
    fail(rawMetricsSchema, { flakyRate: -1 });
    fail(rawMetricsSchema, { other: 1 });
  });
});

describe('grafos', () => {
  it('createGraphSchema / updateGraphSchema', () => {
    expect(ok(createGraphSchema, { name: 'Prod', description: '' })).toEqual({ name: 'Prod', description: null });
    fail(createGraphSchema, { name: '' });
    expect(ok(updateGraphSchema, {})).toEqual({});
    fail(updateGraphSchema, { id: 1 });
  });

  it('graphFromReposSchema aplica depth=medium e exige repositórios', () => {
    expect(ok(graphFromReposSchema, { name: 'G', repoIds: [1, 2] })).toEqual({ name: 'G', repoIds: [1, 2], depth: 'medium' });
    expect(fail(graphFromReposSchema, { name: 'G', repoIds: [] })[0].message).toBe('Selecione ao menos um repositório');
    fail(graphFromReposSchema, { name: 'G', repoIds: [0] });
    fail(graphFromReposSchema, { name: 'G', repoIds: [1], depth: 'x' });
  });

  it('applyProposalSchema e repoKeySchema', () => {
    expect(ok(applyProposalSchema, { graphId: 3 })).toEqual({ graphId: 3 });
    fail(applyProposalSchema, { graphId: '3' });
    expect(ok(repoKeySchema, { owner: ' a ', repo: 'b' })).toEqual({ owner: 'a', repo: 'b' });
    fail(repoKeySchema, { owner: 'a', repo: '' });
  });
});

describe('respostas do LLM', () => {
  const analysis = {
    purpose: 'API',
    stack: 'node',
    deploy: 'k8s',
    inbound: ['web'],
    outbound: ['redis'],
    data: [],
    notes: [],
    matchedNode: null,
    resources: [{ name: 'Redis', kind: 'database', tech: 'redis', description: '' }],
    connections: [{ direction: 'out', target: 'Redis', protocol: 'tcp', description: 'cache' }],
  };

  it('repoAnalysisSchema aceita a resposta completa', () => {
    expect(ok(repoAnalysisSchema, analysis)).toEqual(analysis);
    ok(repoAnalysisSchema, { ...analysis, matchedNode: 'Org / API' });
  });

  it('repoAnalysisSchema rejeita enums e limites inválidos', () => {
    expect(fail(repoAnalysisSchema, { ...analysis, connections: [{ ...analysis.connections[0], direction: 'both' }] })[0]!.path).toEqual([
      'connections',
      0,
      'direction',
    ]);
    fail(repoAnalysisSchema, { ...analysis, connections: [{ ...analysis.connections[0], protocol: 'smtp' }] });
    fail(repoAnalysisSchema, { ...analysis, resources: [{ ...analysis.resources[0], kind: 'x' }] });
    fail(repoAnalysisSchema, { ...analysis, resources: [{ ...analysis.resources[0], name: '' }] });
    fail(repoAnalysisSchema, { ...analysis, notes: Array.from({ length: 21 }, () => 'n') });
    fail(repoAnalysisSchema, { ...analysis, matchedNode: undefined });
  });

  it('codeMappingSchema valida módulos e chamadas', () => {
    const mapping = { modules: [{ name: 'auth', path: 'src/auth', description: '' }], calls: [{ site: 1, target: null, module: 'auth', protocol: 'http' }] };
    expect(ok(codeMappingSchema, mapping)).toEqual(mapping);
    fail(codeMappingSchema, { ...mapping, calls: [{ ...mapping.calls[0], site: 0 }] });
    fail(codeMappingSchema, { ...mapping, calls: [{ ...mapping.calls[0], protocol: 'x' }] });
    fail(codeMappingSchema, { ...mapping, modules: [{ name: '', path: '', description: '' }] });
    fail(codeMappingSchema, { modules: [] });
  });
});

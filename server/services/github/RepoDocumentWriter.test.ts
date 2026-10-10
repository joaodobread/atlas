import { describe, expect, it } from 'vitest';
import type { QualityReport, RepoAnalysis } from '../../../shared/types.ts';
import { makeFacts } from '../../../test/support/githubFakes.ts';
import { repoMarkdown } from './RepoDocumentWriter.ts';
import { summarize } from './QualityScorer.ts';

const analysis = (over: Partial<RepoAnalysis> = {}): RepoAnalysis => ({
  purpose: 'Gerencia pedidos',
  stack: 'Node',
  deploy: 'ECS',
  inbound: ['App mobile'],
  outbound: ['SQS pedidos'],
  data: [],
  notes: [],
  method: 'llm',
  ...over,
});

const quality: QualityReport = summarize([
  { id: 'readme', category: 'docs', impact: 'grade', status: 'pass', score: 10, detail: 'README ok', fix: null },
  { id: 'codeowners', category: 'guardrails', impact: 'grade', status: 'fail', score: 0, detail: 'Sem CODEOWNERS', fix: 'Defina donos.' },
  { id: 'x', category: 'ci', impact: 'grade', status: 'warn', score: 5, detail: 'meh', fix: null },
  { id: 'y', category: 'ci', impact: 'grade', status: 'na', score: null, detail: 'n/a', fix: null },
  { id: 'z', category: 'ci', impact: 'grade', status: 'unknown', score: null, detail: '?', fix: null },
]);

describe('repoMarkdown', () => {
  it('gera o documento completo com fatos, qualidade e métricas', () => {
    const md = repoMarkdown({
      owner: 'acme',
      name: 'orders',
      htmlUrl: 'https://github.com/acme/orders',
      sha: '0123456789abcdef',
      facts: makeFacts({
        languages: ['TypeScript'],
        frameworks: ['NestJS'],
        runtime: { name: 'node', version: '22' },
        deploy: ['Docker'],
        workflows: ['ci.yml'],
        resources: [{ type: 'sqs', name: 'q' }],
        hosts: ['api.x.com'],
        envVars: ['DB_URL'],
      }),
      analysis: analysis({ notes: ['Observação 1'] }),
      quality,
      metrics: {
        id: 1,
        owner: 'acme',
        repo: 'orders',
        sha: 'x',
        ref: null,
        runUrl: 'https://ci/run/1',
        receivedAt: '2026-01-01',
        reportKeys: [],
        coverage: null,
        tests: {},
        security: {},
        tools: [],
        mutationScore: null,
        flakyRate: null,
        lint: null,
        warnings: [],
      },
    });
    expect(md).toContain('# orders (repositório acme/orders)');
    expect(md).toContain('Fonte: https://github.com/acme/orders (commit 0123456). Análise feita com LLM.');
    expect(md).toContain('- App mobile');
    expect(md).toContain('## Dados\n\n- (nada identificado)');
    expect(md).toContain('## Observações\n\n- Observação 1');
    expect(md).toContain('- Runtime: node 22');
    expect(md).toContain('- Recursos AWS citados: sqs q');
    expect(md).toContain('- Hosts citados: api.x.com');
    expect(md).toContain('- Variáveis de ambiente: DB_URL');
    expect(md).toContain(`## Qualidade (${quality.score}/10, confiança ${Math.round(quality.confidence * 100)}%)`);
    expect(md).toContain('- falhou — codeowners: Sem CODEOWNERS Correção: Defina donos.');
    expect(md).toContain('- passou — readme: README ok');
    expect(md).toContain('- atenção — x: meh');
    expect(md).toContain('- n/a — y: n/a');
    expect(md).toContain('- desconhecido — z: ?');
    expect(md).toContain('### Testes: —');
    expect(md).toContain('Métricas do CI recebidas em 2026-01-01 (https://ci/run/1).');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('versão mínima: sem URL, heurística, sem fatos, sem nota e sem métricas', () => {
    const md = repoMarkdown({
      owner: 'acme',
      name: 'lib',
      htmlUrl: null,
      sha: 'abc',
      facts: makeFacts({ languages: [], frameworks: [], runtime: null, deploy: [], workflows: [] }),
      analysis: analysis({ method: 'heuristic', inbound: [], outbound: [] }),
      quality: summarize([]),
      metrics: null,
    });
    expect(md).toContain('Fonte: github.com/acme/lib (commit abc). Análise heurística (sem LLM).');
    expect(md).not.toContain('## Observações');
    expect(md).toContain('- Linguagens: ?');
    expect(md).toContain('- Runtime: ?');
    expect(md).toContain('- CI: nenhum workflow');
    expect(md).not.toContain('Recursos AWS');
    expect(md).not.toContain('Hosts citados');
    expect(md).not.toContain('Variáveis de ambiente');
    expect(md).toContain('## Qualidade (—/10, confiança 0%)');
    expect(md).not.toContain('Métricas do CI');
  });

  it('métricas sem link da execução', () => {
    const md = repoMarkdown({
      owner: 'a',
      name: 'b',
      htmlUrl: null,
      sha: 'c',
      facts: makeFacts(),
      analysis: analysis(),
      quality: summarize([]),
      metrics: {
        id: 1,
        owner: 'a',
        repo: 'b',
        sha: 'c',
        ref: null,
        runUrl: null,
        receivedAt: '2026-02-02',
        reportKeys: [],
        coverage: null,
        tests: {},
        security: {},
        tools: [],
        mutationScore: null,
        flakyRate: null,
        lint: null,
        warnings: [],
      },
    });
    expect(md).toContain('Métricas do CI recebidas em 2026-02-02.');
  });
});

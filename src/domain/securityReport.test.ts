import { describe, expect, it } from 'vitest';
import type { PortfolioPosture, SecurityPosture, SecurityReportRecord } from '../../shared/types.ts';
import { formatWhen, pctOf, radarPoints, riskRank, scoreBand, securityMarkdown } from './securityReport.ts';

const posture = (o: Partial<SecurityPosture> = {}): SecurityPosture => ({
  owner: 'acme',
  name: 'api',
  htmlUrl: null,
  analyzedAt: null,
  metricsAt: null,
  score: 62,
  risk: 'high',
  riskReasons: ['1 dependência(s) com vulnerabilidade conhecida'],
  maturity: { level: 2, label: 'Básico', next: { level: 3, label: 'Gerenciado', missing: ['SCA no pipeline'] } },
  axes: [
    {
      axis: 'vulnerabilities',
      label: 'Vulnerabilidades',
      score: 50,
      items: [{ id: 'x', label: 'Item', status: 'fail', score: 0, detail: 'detalhe', fix: 'corrija' }],
    },
    { axis: 'pipeline', label: 'Pipeline DevSecOps', score: null, items: [] },
  ],
  practices: [],
  findings: { bySource: {}, total: { critical: 0, high: 0, medium: 0, low: 0 }, vulnerableDependencies: 1, sonar: null, tools: [] },
  ...o,
});

const portfolio = (): PortfolioPosture => ({
  repos: 3,
  analyzed: 2,
  score: 70,
  axes: { vulnerabilities: 60, pipeline: null, supplyChain: 80, governance: 75 },
  byRisk: { critical: 0, high: 1, medium: 1, low: 0 },
  byLevel: [0, 0, 1, 1, 0],
  findings: { critical: 1, high: 2, medium: 3, low: 4 },
  vulnerableDependencies: 5,
  adoption: [
    { id: 'ci', label: 'CI configurado', adopted: 2, measured: 2 },
    { id: 'dast', label: 'DAST', adopted: 0, measured: 0 },
  ],
  rows: [
    {
      owner: 'acme',
      name: 'web',
      score: null,
      risk: 'high',
      level: 2,
      axes: { vulnerabilities: 50, pipeline: null, supplyChain: 80, governance: 70 },
      critical: 1,
      high: 2,
      vulnerableDependencies: null,
      reasons: [],
    },
  ],
});

const record = (o: Partial<SecurityReportRecord> = {}): SecurityReportRecord => ({
  id: 1,
  scope: 'acme/api',
  kind: 'report',
  focus: null,
  method: 'llm',
  model: 'claude-x',
  llmError: null,
  score: 62,
  risk: 'high',
  level: 2,
  narrative: {
    summary: 'Resumo.',
    highlights: ['Bom CI'],
    risks: [
      {
        title: 'Dep | vuln C:\\temp',
        severity: 'high',
        axis: 'vulnerabilities',
        evidence: 'lodash\r\nantigo',
        recommendation: 'Atualize',
        repos: ['acme/api'],
      },
    ],
    roadmap: [
      { horizon: 'now', action: 'Atualizar lodash', impact: 'Fecha CVE', effort: 'low', axis: 'vulnerabilities' },
      { horizon: 'later', action: 'DAST', impact: 'Cobre runtime', effort: 'high', axis: 'pipeline' },
    ],
  },
  tips: null,
  createdBy: 'Ana',
  createdAt: '2026-10-12T10:00:00Z',
  ...o,
});

describe('helpers', () => {
  it('scoreBand, pctOf, riskRank e formatWhen', () => {
    expect([null, 80, 75, 74, 50, 49].map(scoreBand)).toEqual(['none', 'good', 'good', 'mid', 'mid', 'bad']);
    expect([pctOf(1, 3), pctOf(1, 0)]).toEqual([33, 0]);
    expect(riskRank('critical')).toBeLessThan(riskRank('low'));
    expect(formatWhen('não é data')).toBe('não é data');
    expect(formatWhen('2026-10-12T10:00:00Z')).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('radarPoints: topo primeiro, sentido horário, limitado a 0–100', () => {
    expect(radarPoints([100, 100, 100, 100], 10, 50, 50)).toEqual([
      [50, 40],
      [60, 50],
      [50, 60],
      [40, 50],
    ]);
    expect(radarPoints([null, 200, -5, 50], 10, 0, 0)).toEqual([
      [0, 0],
      [10, 0],
      [0, 0],
      [-5, 0],
    ]);
  });
});

describe('securityMarkdown', () => {
  it('repositório: postura, eixos com itens, relatório e dicas', () => {
    const tips = record({
      id: 2,
      kind: 'tips',
      narrative: null,
      method: 'heuristic',
      model: null,
      createdBy: null,
      focus: 'ci',
      tips: [{ title: 'Fixe actions', axis: 'supplyChain', why: 'porque', how: 'use SHA', effort: 'low' }],
    });
    const md = securityMarkdown({ posture: posture(), portfolio: null, report: record(), tips });
    expect(md).toContain('# Relatório de segurança — acme/api');
    expect(md).toContain('- **Risco:** Alto — 1 dependência(s) com vulnerabilidade conhecida');
    expect(md).toContain('- **Para o nível 3:** SCA no pipeline');
    expect(md).toContain('| Pipeline DevSecOps | — |');
    expect(md).toContain('- [FALHA] Item: detalhe → corrija');
    expect(md).not.toContain('### Pipeline DevSecOps');
    expect(md).toContain('| Alto | Dep \\| vuln C:\\\\temp (acme/api) | Vulnerabilidades | lodash antigo | Atualize |');
    expect(md).toContain('### Agora');
    expect(md).not.toContain('### Próximo trimestre');
    expect(md).toContain('- **Atualizar lodash** — Fecha CVE (esforço baixo, Vulnerabilidades)');
    expect(md).toMatch(/_Gerado em .* por LLM \(claude-x\), a pedido de Ana\._/);
    expect(md).toContain('## Dicas (foco: ci)');
    expect(md).toMatch(/por heurística \(sem LLM\)\._/);
    expect(md.endsWith('\n')).toBe(true);
  });

  it('portfólio: totais, adoção e tabela; sem relatório nem dicas', () => {
    const md = securityMarkdown({ posture: null, portfolio: portfolio(), report: null, tips: null });
    expect(md).toContain('# Relatório de segurança — portfólio');
    expect(md).toContain('- **Repositórios analisados:** 2 de 3');
    expect(md).toContain('| CI configurado | 2/2 (100%) |');
    expect(md).toContain('| DAST | — |');
    expect(md).toContain('| acme/web | Alto | — | 2 | 1 | 2 |');
    expect(md).not.toContain('Resumo executivo');
  });

  it('relatório sem destaques, riscos nem plano; LLM sem modelo; postura sem próximo nível', () => {
    const md = securityMarkdown({
      posture: posture({ riskReasons: [], maturity: { level: 4, label: 'Avançado', next: null } }),
      portfolio: null,
      report: record({ model: null, narrative: { summary: 'S', highlights: [], risks: [], roadmap: [] } }),
      tips: record({ kind: 'tips', tips: [] }),
    });
    expect(md).toContain('- **Risco:** Alto\n');
    expect(md).not.toContain('Para o nível');
    expect(md).not.toContain('## Riscos');
    expect(md).not.toContain('## Dicas');
    expect(md).toMatch(/por LLM, a pedido/);
    expect(securityMarkdown({ posture: null, portfolio: null, report: null, tips: null })).toBe('\n');
  });
});

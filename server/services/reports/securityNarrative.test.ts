import { describe, expect, it } from 'vitest';
import { makeFacts } from '../../../test/support/githubFakes.ts';
import { exemplaryFacts, exemplaryMetrics, postureInput, sev } from '../../../test/support/securityFakes.ts';
import type { RepoAnalysis } from '../../../shared/types.ts';
import { SecurityPostureBuilder } from './SecurityPosture.ts';
import { gapsOf, heuristicNarrative, heuristicPortfolioNarrative, heuristicTips, portfolioPrompt, posturePrompt } from './securityNarrative.ts';

const builder = new SecurityPostureBuilder();
const good = () => builder.build(postureInput(exemplaryFacts(), exemplaryMetrics(), { name: 'good' }));
const weak = () => {
  const f = exemplaryFacts({ committedEnvFiles: ['.env'], hasCodeowners: false, updateAutomation: null });
  f.intel.vulnerabilities = [{ dependency: 'lodash', ids: ['GHSA-1', 'CVE-2', 'CVE-3', 'CVE-4'] }];
  return builder.build(postureInput(f, exemplaryMetrics({ security: { sast: sev(1, 0, 2), secrets: sev(0, 1) } }), { name: 'weak' }));
};
const bare = () => builder.build(postureInput(makeFacts(), null, { name: 'bare', process: null }));

describe('gapsOf', () => {
  it('ordena por severidade e depois por esforço', () => {
    const gaps = gapsOf(weak());
    expect(gaps[0]).toMatchObject({ id: 'env-committed', severity: 'critical' });
    expect(gaps.map((g) => g.id)).toEqual(
      expect.arrayContaining(['secrets-findings', 'sast-findings', 'sca-vulnerabilities', 'codeowners', 'update-automation']),
    );
    const sevOf = (id: string) => gaps.find((g) => g.id === id)?.severity;
    expect(sevOf('secrets-findings')).toBe('critical');
    expect(sevOf('sast-findings')).toBe('critical');
    expect(sevOf('sca-vulnerabilities')).toBe('medium');
    expect(sevOf('codeowners')).toBe('medium');
    expect(gapsOf(good())).toEqual([]);
  });

  it('alerta vira severidade um degrau abaixo', () => {
    const p = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics({ security: { sast: sev(0, 0, 3), sca: sev(), dast: sev() } })));
    expect(gapsOf(p).find((g) => g.id === 'sast-findings')).toMatchObject({ status: 'warn', severity: 'medium' });
    const secrets = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics({ security: { secrets: sev(0, 0, 1), sca: sev() } })));
    expect(gapsOf(secrets).find((g) => g.id === 'secrets-findings')).toMatchObject({ status: 'warn', severity: 'high' });
  });
});

describe('heuristicNarrative', () => {
  it('resume nota, risco, maturidade e eixo mais fraco; riscos e roadmap vêm das lacunas', () => {
    const n = heuristicNarrative(weak());
    expect(n.summary).toContain('acme/weak tem nota de segurança');
    expect(n.summary).toContain('risco crítico');
    expect(n.summary).toContain('Principais motivos: 1 achado(s) crítico(s) no CI');
    expect(n.summary).toMatch(/O eixo mais fraco é Vulnerabilidades/);
    expect(n.summary).toContain('Para chegar ao nível');
    expect(n.risks[0]).toMatchObject({ title: '.env fora do repositório', severity: 'critical', axis: 'vulnerabilities', repos: [] });
    expect(n.roadmap[0]).toMatchObject({ horizon: 'now', effort: 'medium', axis: 'vulnerabilities' });
    expect(n.roadmap.find((r) => r.impact.startsWith('CODEOWNERS'))).toMatchObject({ horizon: 'next', effort: 'low' });
    expect(n.highlights.length).toBeGreaterThan(0);
  });

  it('repositório exemplar: sem riscos nem roadmap', () => {
    const n = heuristicNarrative(good());
    expect(n.summary).toContain('Nenhum risco relevante');
    expect(n.summary).not.toContain('eixo mais fraco');
    expect(n.risks).toEqual([]);
    expect(n.roadmap).toEqual([]);
  });

  it('alerta sem risco alto vai para "depois"', () => {
    const p = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics({ coverage: { lines: 50, branches: null } })));
    expect(heuristicNarrative(p).roadmap).toEqual([]);
    const f = exemplaryFacts();
    f.intel.freshness = { averageLibyears: 1.5, measured: 4, outdated: 3 };
    const later = heuristicNarrative(builder.build(postureInput(f, exemplaryMetrics())));
    expect(later.risks.find((r) => r.title === 'Dependências em dia')).toMatchObject({ severity: 'low' });
  });

  it('item sem correção sugerida usa texto padrão', () => {
    const p = weak();
    p.axes[0]!.items.unshift({ id: 'x', label: 'X', status: 'fail', score: 0, detail: 'd', fix: null });
    expect(heuristicNarrative(p).risks.find((r) => r.title === 'X')?.recommendation).toBe('Revise este item.');
  });
});

describe('heuristicPortfolioNarrative', () => {
  it('destaca práticas bem adotadas, repositórios arriscados e lacunas de adoção', () => {
    const postures = [good(), weak(), bare()];
    const pp = builder.portfolio(postures, 4);
    const n = heuristicPortfolioNarrative(pp, postures);
    expect(n.summary).toContain('3 de 4 repositório(s) analisado(s)');
    expect(n.summary).toContain('1 crítico');
    expect(n.summary).toContain('A maioria está no nível');
    expect(n.risks[0]).toMatchObject({ title: 'acme/weak: risco crítico', severity: 'critical', repos: ['acme/weak'] });
    const lowAdoption = n.risks.filter((r) => r.title.startsWith('Baixa adoção'));
    expect(lowAdoption.length).toBeGreaterThan(0);
    expect(n.roadmap.every((r) => ['now', 'next', 'later'].includes(r.horizon))).toBe(true);
    expect(n.highlights.some((h) => h.startsWith('SAST no pipeline'))).toBe(false);
  });

  it('portfólio vazio', () => {
    const n = heuristicPortfolioNarrative(builder.portfolio([], 0), []);
    expect(n.summary).toContain('0 de 0');
    expect(n.summary).not.toContain('maioria');
    expect(n).toMatchObject({ highlights: [], risks: [], roadmap: [] });
  });

  it('baixa adoção de práticas básicas é alta e entra em "agora"; muitas faltando = esforço alto', () => {
    const many = Array.from({ length: 12 }, (_, i) => builder.build(postureInput(makeFacts(), null, { name: `r${i}`, process: null })));
    const pp = builder.portfolio(many, 12);
    const n = heuristicPortfolioNarrative(pp, many);
    expect(n.risks.find((r) => r.title === 'Baixa adoção: CI configurado')).toMatchObject({ severity: 'high', axis: 'pipeline' });
    expect(n.roadmap.find((r) => r.action.includes('ci configurado'))).toMatchObject({ horizon: 'now', effort: 'high' });
    expect(n.roadmap.find((r) => r.action.includes('política'))).toMatchObject({ horizon: 'later' });
  });
});

describe('heuristicTips', () => {
  it('usa o foco quando casa com algum item (sem acento) e cai em tudo quando não casa', () => {
    const tips = heuristicTips([weak()], 'segredos versionados');
    expect(tips.map((t) => t.title)).toEqual(expect.arrayContaining(['.env fora do repositório']));
    expect(tips.every((t) => t.title !== 'CODEOWNERS')).toBe(true);
    expect(heuristicTips([weak()], 'xyzw qualquer').length).toBe(heuristicTips([weak()], null).length);
    expect(heuristicTips([weak()], 'ab').length).toBe(heuristicTips([weak()], null).length);
  });

  it('no portfólio, deduplica e avisa que pode haver outros repositórios', () => {
    const tips = heuristicTips([weak(), weak()], null);
    expect(new Set(tips.map((t) => t.title)).size).toBe(tips.length);
    expect(tips[0]!.why).toContain('outros repositórios');
    expect(tips.length).toBeLessThanOrEqual(8);
  });
});

describe('prompts', () => {
  it('posturePrompt traz contexto, eixos, achados, Sonar, práticas e foco', () => {
    const f = exemplaryFacts({ frameworks: ['express'], deploy: ['Docker'] });
    f.intel.vulnerabilities = [{ dependency: 'lodash', ids: ['GHSA-1', 'CVE-2', 'CVE-3', 'CVE-4'] }];
    const m = exemplaryMetrics({
      sonar: {
        qualityGate: 'OK',
        bugs: 1,
        vulnerabilities: 0,
        hotspots: 0,
        codeSmells: 0,
        coverage: null,
        duplication: null,
        ncloc: null,
        ratings: { security: 'A', reliability: null, maintainability: null, hotspotsReviewed: null },
      },
    });
    const p = builder.build(postureInput(f, m));
    const text = posturePrompt(p, f, { purpose: 'API de pedidos' } as RepoAnalysis, 'pipeline');
    expect(text).toContain('Repositório: acme/api');
    expect(text).toContain('frameworks: express');
    expect(text).toContain('Runtime: node 22');
    expect(text).toContain('Deploy: Docker');
    expect(text).toContain('Propósito: API de pedidos');
    expect(text).toContain('## Vulnerabilidades');
    expect(text).toContain('lodash (GHSA-1, CVE-2, CVE-3)');
    expect(text).toContain('SonarQube: quality gate OK');
    expect(text).toContain('sast 0C/0A/0M/0B');
    expect(text).toContain('Foco pedido pelo usuário: pipeline');
    expect(text).toContain('Política de segurança: sim');
  });

  it('posturePrompt de repositório sem nada', () => {
    const p = bare();
    const text = posturePrompt(p, makeFacts({ languages: [] }), null, null);
    expect(text).toContain('linguagens: ?; frameworks: ?');
    expect(text).toContain('nenhum relatório');
    expect(text).toContain('não verificado');
    expect(text).toContain('não se aplica');
    expect(text).not.toContain('Foco');
    expect(text).not.toContain('Runtime: ');
  });

  it('portfolioPrompt traz totais, adoção, falhas comuns e os mais arriscados', () => {
    const postures = [good(), weak(), bare()];
    const text = portfolioPrompt(builder.portfolio(postures, 3), postures, 'governança');
    expect(text).toContain('3 na lista, 3 analisados');
    expect(text).toContain('## Adoção das práticas');
    expect(text).toContain('## Falhas mais comuns');
    expect(text).toContain('- acme/weak: risco Crítico');
    expect(text).toContain('Foco pedido pelo usuário: governança');
    expect(portfolioPrompt(builder.portfolio([], 0), [], null)).toContain('não verificado');
  });
});

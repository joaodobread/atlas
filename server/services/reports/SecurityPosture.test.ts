import { describe, expect, it } from 'vitest';
import type { QualityReport, SecurityPosture, SonarSummary } from '../../../shared/types.ts';
import { makeFacts } from '../../../test/support/githubFakes.ts';
import { exemplaryFacts, exemplaryMetrics, postureInput, sev } from '../../../test/support/securityFakes.ts';
import { describeSonar, maturityOf, SecurityPostureBuilder } from './SecurityPosture.ts';

const builder = new SecurityPostureBuilder();
const item = (p: SecurityPosture, id: string) => p.axes.flatMap((a) => a.items).find((i) => i.id === id);
const practice = (p: SecurityPosture, id: string) => p.practices.find((x) => x.id === id);

const sonar = (over: Partial<SonarSummary> = {}): SonarSummary => ({
  qualityGate: 'OK',
  bugs: 0,
  vulnerabilities: 0,
  hotspots: 0,
  codeSmells: 10,
  coverage: 80,
  duplication: 1,
  ncloc: 1000,
  ratings: { security: 'A', reliability: 'A', maintainability: 'A', hotspotsReviewed: 'A' },
  ...over,
});

describe('SecurityPostureBuilder.build', () => {
  it('repositório exemplar: eixos cheios, risco baixo e maturidade avançada', () => {
    const p = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics({ sonar: sonar() })));
    expect(p.axes.map((a) => [a.axis, a.score])).toEqual([
      ['vulnerabilities', 100],
      ['pipeline', 100],
      ['supplyChain', 100],
      ['governance', 100],
    ]);
    expect(p.score).toBe(100);
    expect(p.risk).toBe('low');
    expect(p.riskReasons).toEqual([]);
    expect(p.maturity).toEqual({ level: 4, label: 'Avançado', next: null });
    expect(p.practices.every((x) => x.adopted)).toBe(true);
    expect(p.findings).toMatchObject({ total: sev(), vulnerableDependencies: 0, tools: ['semgrep', 'zap'] });
    expect(item(p, 'sonar-security')).toMatchObject({ status: 'pass', score: 10, fix: null, label: 'Segurança no SonarQube' });
    expect(item(p, 'sonar-quality-gate')).toMatchObject({ status: 'pass', score: 10 });
    expect(item(p, 'sca-in-pipeline')).toMatchObject({ status: 'pass' });
    expect(p.metricsAt).toBe('2026-01-01T00:00:00Z');
  });

  it('repositório sem nada: nível 0, risco médio e lacunas de visibilidade', () => {
    const p = builder.build(postureInput(makeFacts(), null, { process: null }));
    expect(p.maturity.level).toBe(0);
    expect(p.maturity.next).toEqual({ level: 1, label: 'Inicial', missing: ['CI configurado'] });
    expect(p.risk).toBe('medium');
    expect(p.riskReasons).toContain('Maturidade DevSecOps ausente');
    expect(item(p, 'sca-in-pipeline')).toMatchObject({ status: 'na' });
    expect(practice(p, 'sca')).toEqual({ id: 'sca', label: 'SCA no pipeline', adopted: null, applicable: false });
    expect(practice(p, 'coverage')).toMatchObject({ adopted: null, applicable: true });
    expect(practice(p, 'dast')).toMatchObject({ adopted: null, applicable: true });
    expect(p.findings).toMatchObject({ total: sev(), vulnerableDependencies: null, sonar: null, tools: [] });
    expect(p.metricsAt).toBeNull();
  });

  it('risco crítico com .env versionado, achado crítico ou workflow perigoso', () => {
    const env = builder.build(postureInput(exemplaryFacts({ committedEnvFiles: ['.env'] }), exemplaryMetrics()));
    expect(env.risk).toBe('critical');
    expect(env.riskReasons).toContain('Arquivo .env versionado');
    const crit = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics({ security: { sast: sev(2, 1, 3), sca: sev(0, 1) } })));
    expect(crit.risk).toBe('critical');
    expect(crit.findings.total).toEqual(sev(2, 2, 3));
    expect(crit.riskReasons.slice(0, 2)).toEqual(['2 achado(s) crítico(s) no CI', '2 achado(s) alto(s) no CI']);
    const wf = exemplaryFacts();
    wf.workflowAudit.dangerousTriggers = ['pr.yml'];
    expect(builder.build(postureInput(wf, exemplaryMetrics())).riskReasons).toContain('Workflow do CI explorável (pull_request_target/write-all)');
  });

  it('risco alto com dependência vulnerável, runtime EOL ou SonarQube reprovado', () => {
    const vuln = exemplaryFacts();
    vuln.intel.vulnerabilities = [{ dependency: 'lodash', ids: ['GHSA-1'] }];
    expect(builder.build(postureInput(vuln, exemplaryMetrics()))).toMatchObject({ risk: 'high', findings: { vulnerableDependencies: 1 } });

    const eol = exemplaryFacts();
    eol.intel.runtimeSupport = { supported: false, eol: '2020-01-01', latest: '22' };
    expect(builder.build(postureInput(eol, exemplaryMetrics())).riskReasons).toContain('Runtime sem suporte (EOL)');

    const bad = builder.build(
      postureInput(
        exemplaryFacts(),
        exemplaryMetrics({
          sonar: sonar({ qualityGate: 'ERROR', ratings: { security: 'E', reliability: null, maintainability: null, hotspotsReviewed: null } }),
        }),
      ),
    );
    expect(bad.risk).toBe('high');
    expect(bad.riskReasons).toEqual(['Nota de segurança E no SonarQube', 'Quality gate do SonarQube reprovado']);
    expect(item(bad, 'sonar-security')).toMatchObject({ status: 'fail', score: 0 });
    expect(item(bad, 'sonar-quality-gate')).toMatchObject({ status: 'fail', score: 0 });
    expect(practice(bad, 'quality-gate')?.adopted).toBe(true);

    const warn = builder.build(
      postureInput(
        exemplaryFacts(),
        exemplaryMetrics({
          sonar: sonar({ qualityGate: 'WARN', ratings: { security: 'C', reliability: null, maintainability: null, hotspotsReviewed: null } }),
        }),
      ),
    );
    expect(item(warn, 'sonar-security')).toMatchObject({ status: 'warn', score: 5 });
    expect(item(warn, 'sonar-quality-gate')).toMatchObject({ status: 'warn', score: 6 });
  });

  it('SCA no pipeline: desconhecido sem métricas, falha quando o CI não publica', () => {
    expect(item(builder.build(postureInput(exemplaryFacts(), null)), 'sca-in-pipeline')).toMatchObject({ status: 'unknown', score: null });
    const p = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics({ security: { sast: sev() } })));
    expect(item(p, 'sca-in-pipeline')).toMatchObject({ status: 'fail', score: 0 });
    expect(practice(p, 'sca')?.adopted).toBe(false);
    expect(p.maturity.level).toBe(2);
    expect(p.maturity.next?.missing).toEqual(['SCA no pipeline']);
  });

  it('ignora checks informativos e os que não são de segurança; nota nula sem nada medido', () => {
    const quality: QualityReport = {
      version: 'x',
      score: null,
      confidence: 0,
      categories: [
        {
          category: 'docs',
          label: 'Docs',
          weight: 1,
          score: null,
          checks: [
            { id: 'repo-metadata', category: 'docs', impact: 'grade', status: 'pass', score: 10, detail: '', fix: null },
            { id: 'codeowners', category: 'guardrails', impact: 'signal', status: 'pass', score: 10, detail: '', fix: null },
          ],
        },
      ],
    };
    const p = builder.build({ ...postureInput(makeFacts({ appType: 'library' }), null), quality });
    expect(p.axes.flatMap((a) => a.items).map((i) => i.id)).toEqual(['sca-in-pipeline']);
    expect(p.score).toBeNull();
    expect(practice(p, 'ci')).toMatchObject({ adopted: null, applicable: false });
    expect(practice(p, 'hardening')).toMatchObject({ adopted: null, applicable: false });
    expect(practice(p, 'review')).toMatchObject({ adopted: null, applicable: false });
    expect(practice(p, 'dast')).toMatchObject({ applicable: false });
  });

  it('práticas compostas: hardening falha se um item falha; revisão vale com qualquer evidência', () => {
    const f = exemplaryFacts({ github: { topics: null, secretScanning: true, branchRules: null } });
    f.workflowAudit.unpinnedActions = ['actions/checkout@v4'];
    const p = builder.build(postureInput(f, exemplaryMetrics()));
    expect(practice(p, 'hardening')?.adopted).toBe(false);
    expect(practice(p, 'review')?.adopted).toBe(true);
    const unknownReview = builder.build(
      postureInput(exemplaryFacts({ github: { topics: null, secretScanning: true, branchRules: null } }), exemplaryMetrics(), { process: null }),
    );
    expect(practice(unknownReview, 'review')?.adopted).toBeNull();
    expect(unknownReview.maturity.next?.missing).toContain('Revisão obrigatória / branch protegido (não verificado)');
  });
});

describe('SecurityPostureBuilder.portfolio', () => {
  it('consolida notas, risco, maturidade, achados e adoção; ordena do mais arriscado', () => {
    const good = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics(), { name: 'good' }));
    const crit = builder.build(
      postureInput(exemplaryFacts({ committedEnvFiles: ['.env'] }), exemplaryMetrics({ security: { sast: sev(1, 2), sca: sev(), dast: sev() } }), {
        name: 'crit',
      }),
    );
    const bare = builder.build(postureInput(makeFacts(), null, { name: 'bare', process: null }));
    const pp = builder.portfolio([good, bare, crit], 5);
    expect(pp).toMatchObject({ repos: 5, analyzed: 3, findings: sev(1, 2), vulnerableDependencies: 0, byRisk: { critical: 1, high: 0, medium: 1, low: 1 } });
    expect(pp.byLevel).toEqual([1, 0, 0, 0, 2]);
    expect(pp.rows.map((r) => r.name)).toEqual(['crit', 'bare', 'good']);
    expect(pp.rows[0]).toMatchObject({
      critical: 1,
      high: 2,
      level: 4,
      reasons: ['1 achado(s) crítico(s) no CI', 'Arquivo .env versionado', '2 achado(s) alto(s) no CI'],
    });
    expect(pp.adoption.find((a) => a.id === 'ci')).toEqual({ id: 'ci', label: 'CI configurado', adopted: 2, measured: 3 });
    expect(pp.adoption.find((a) => a.id === 'sca')).toMatchObject({ adopted: 2, measured: 2 });
    expect(pp.score).toBe(Math.round(((good.score ?? 0) + (crit.score ?? 0) + (bare.score ?? 0)) / 3));
    expect(pp.axes.vulnerabilities).not.toBeNull();
  });

  it('vazio: sem notas', () => {
    const pp = builder.portfolio([], 0);
    expect(pp).toMatchObject({ analyzed: 0, score: null, rows: [], byLevel: [0, 0, 0, 0, 0] });
    expect(Object.values(pp.axes)).toEqual([null, null, null, null]);
  });

  it('empate de risco: menor nota primeiro, sem nota por último, depois nome', () => {
    const a = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics(), { name: 'b' }));
    const b = builder.build(postureInput(exemplaryFacts(), exemplaryMetrics(), { name: 'a' }));
    const c = { ...b, name: 'c', score: null };
    const d = { ...b, name: 'd', score: 10 };
    expect(builder.portfolio([c, a, b, d], 4).rows.map((r) => r.name)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('maturityOf e describeSonar', () => {
  it('nível só sobe com todos os requisitos anteriores', () => {
    const all = (adopted: boolean | null) =>
      ['ci', 'sast', 'secrets', 'deps-update', 'sca', 'coverage', 'review', 'dast', 'quality-gate', 'hardening', 'policy'].map((id) => ({
        id,
        label: id,
        adopted,
        applicable: true,
      }));
    const practices = all(true);
    practices.find((p) => p.id === 'sast')!.adopted = false;
    expect(maturityOf(practices)).toMatchObject({ level: 1, next: { level: 2, missing: ['sast'] } });
    expect(maturityOf(all(null)).next?.missing[0]).toBe('ci (não verificado)');
  });

  it('descreve só o que o Sonar mediu', () => {
    expect(describeSonar(sonar())).toBe(
      'quality gate OK, segurança A, confiabilidade A, manutenibilidade A, 0 vulnerabilidade(s), 0 hotspot(s), 0 bug(s), 10 code smell(s), cobertura 80%, duplicação 1%',
    );
    expect(
      describeSonar({
        qualityGate: null,
        bugs: null,
        vulnerabilities: null,
        hotspots: null,
        codeSmells: null,
        coverage: null,
        duplication: null,
        ncloc: null,
        ratings: { security: null, reliability: null, maintainability: null, hotspotsReviewed: null },
      }),
    ).toBe('');
  });
});

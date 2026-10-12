import { MATURITY_LABELS, RISK_LEVELS, SECURITY_AXES, SECURITY_AXIS_LABEL } from '../../../shared/constants.ts';
import type {
  DevSecOpsPractice,
  FindingSource,
  MaturityLevel,
  PortfolioPosture,
  PostureAxis,
  PostureItem,
  QualityCheck,
  QualityReport,
  RepoFacts,
  RepoMetricsSnapshot,
  RiskLevel,
  SecurityAxis,
  SecurityPosture,
  SeverityCounts,
  SonarRating,
  SonarSummary,
} from '../../../shared/types.ts';

export interface PostureInput {
  owner: string;
  name: string;
  htmlUrl: string | null;
  analyzedAt: string | null;
  facts: RepoFacts;
  quality: QualityReport;
  metrics: RepoMetricsSnapshot | null;
}

/** Em que eixo entra cada check do scorecard (os demais ficam fora do relatório de segurança). */
const AXIS_OF: Record<string, SecurityAxis> = {
  'sca-vulnerabilities': 'vulnerabilities',
  'sast-findings': 'vulnerabilities',
  'dast-findings': 'vulnerabilities',
  'secrets-findings': 'vulnerabilities',
  'sca-scanner': 'vulnerabilities',
  'env-committed': 'vulnerabilities',
  'runtime-eol': 'vulnerabilities',
  'pipeline-present': 'pipeline',
  'sast-in-pipeline': 'pipeline',
  'secret-scanning': 'pipeline',
  'metrics-reported': 'pipeline',
  'tests-passing': 'pipeline',
  'coverage-pct': 'pipeline',
  e2e: 'pipeline',
  'lint-clean': 'pipeline',
  'lockfile-present': 'supplyChain',
  'update-automation': 'supplyChain',
  'dependency-freshness': 'supplyChain',
  'pinned-actions': 'supplyChain',
  'token-permissions': 'supplyChain',
  'dangerous-workflow': 'supplyChain',
  'binary-artifacts': 'supplyChain',
  'branch-protection': 'governance',
  'review-coverage': 'governance',
  'direct-push-share': 'governance',
  codeowners: 'governance',
  'security-policy': 'governance',
  'bus-factor': 'governance',
  'pr-upkeep': 'governance',
};

export const ITEM_LABEL: Record<string, string> = {
  'sca-vulnerabilities': 'Vulnerabilidades conhecidas nas dependências',
  'sast-findings': 'Achados de SAST',
  'dast-findings': 'Achados de DAST',
  'secrets-findings': 'Segredos vazados',
  'sca-scanner': 'Achados do scanner de dependências',
  'env-committed': '.env fora do repositório',
  'runtime-eol': 'Runtime com suporte',
  'sonar-security': 'Segurança no SonarQube',
  'pipeline-present': 'CI configurado',
  'sast-in-pipeline': 'SAST no pipeline',
  'sca-in-pipeline': 'SCA no pipeline',
  'secret-scanning': 'Varredura de segredos',
  'metrics-reported': 'Métricas enviadas pelo CI',
  'tests-passing': 'Testes passando',
  'coverage-pct': 'Cobertura de testes',
  e2e: 'Testes ponta a ponta',
  'lint-clean': 'Lint sem erros no CI',
  'sonar-quality-gate': 'Quality gate do SonarQube',
  'lockfile-present': 'Dependências travadas (lockfile)',
  'update-automation': 'Atualização automática de dependências',
  'dependency-freshness': 'Dependências em dia',
  'pinned-actions': 'Actions fixadas por SHA',
  'token-permissions': 'Permissões mínimas do token do CI',
  'dangerous-workflow': 'Workflows sem padrões perigosos',
  'binary-artifacts': 'Sem binários versionados',
  'branch-protection': 'Proteção do branch padrão',
  'review-coverage': 'PRs revisados',
  'direct-push-share': 'Commits passando por PR',
  codeowners: 'CODEOWNERS',
  'security-policy': 'Política de segurança (SECURITY.md)',
  'bus-factor': 'Conhecimento distribuído',
  'pr-upkeep': 'PRs em dia',
};

/** Peso de cada eixo na nota geral. */
const AXIS_WEIGHT: Record<SecurityAxis, number> = { vulnerabilities: 3, pipeline: 3, supplyChain: 2, governance: 2 };

/** Práticas DevSecOps e o nível de maturidade a partir do qual cada uma é exigida. */
const PRACTICES: Array<{ id: string; label: string; level: Exclude<MaturityLevel, 0> }> = [
  { id: 'ci', label: 'CI configurado', level: 1 },
  { id: 'sast', label: 'SAST no pipeline', level: 2 },
  { id: 'secrets', label: 'Varredura de segredos', level: 2 },
  { id: 'deps-update', label: 'Atualização automática de dependências', level: 2 },
  { id: 'sca', label: 'SCA no pipeline', level: 3 },
  { id: 'coverage', label: 'Cobertura publicada pelo CI', level: 3 },
  { id: 'review', label: 'Revisão obrigatória / branch protegido', level: 3 },
  { id: 'dast', label: 'DAST', level: 4 },
  { id: 'quality-gate', label: 'Quality gate (Sonar ou lint no CI)', level: 4 },
  { id: 'hardening', label: 'Pipeline endurecido (SHA, permissões mínimas)', level: 4 },
  { id: 'policy', label: 'Política de segurança', level: 4 },
];

const ZERO: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
const RATING_SCORE: Record<SonarRating, number> = { A: 10, B: 8, C: 5, D: 2, E: 0 };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sumSeverity = (a: SeverityCounts, b: SeverityCounts): SeverityCounts => ({
  critical: a.critical + b.critical,
  high: a.high + b.high,
  medium: a.medium + b.medium,
  low: a.low + b.low,
});

/**
 * Relatório de segurança/DevSecOps em 4 eixos, calculado sem LLM a partir do scorecard (checks), dos fatos
 * do repositório e das métricas que o CI envia (SARIF de SAST/DAST/SCA/segredos, SonarQube).
 */
export class SecurityPostureBuilder {
  build({ owner, name, htmlUrl, analyzedAt, facts, quality, metrics: m }: PostureInput): SecurityPosture {
    const checks = new Map<string, QualityCheck>(quality.categories.flatMap((c) => c.checks.map((k) => [k.id, k] as const)));
    const items = new Map<SecurityAxis, PostureItem[]>(SECURITY_AXES.map((a) => [a, []]));
    const push = (axis: SecurityAxis, item: Omit<PostureItem, 'label'>) => items.get(axis)!.push({ ...item, label: ITEM_LABEL[item.id] ?? item.id });

    for (const c of checks.values()) {
      const axis = AXIS_OF[c.id];
      if (axis && c.impact === 'grade') push(axis, { id: c.id, status: c.status, score: c.score, detail: c.detail, fix: c.fix });
    }

    const sonar = m?.sonar ?? null;
    if (sonar?.ratings.security) {
      const r = sonar.ratings.security;
      push('vulnerabilities', {
        id: 'sonar-security',
        status: r === 'A' ? 'pass' : r === 'D' || r === 'E' ? 'fail' : 'warn',
        score: RATING_SCORE[r],
        detail: `Nota de segurança ${r}: ${sonar.vulnerabilities ?? '?'} vulnerabilidade(s), ${sonar.hotspots ?? '?'} hotspot(s)`,
        fix: r === 'A' ? null : 'Corrija as vulnerabilidades e revise os security hotspots apontados pelo SonarQube.',
      });
    }
    if (sonar?.qualityGate)
      push('pipeline', {
        id: 'sonar-quality-gate',
        status: sonar.qualityGate === 'OK' ? 'pass' : sonar.qualityGate === 'WARN' ? 'warn' : 'fail',
        score: sonar.qualityGate === 'OK' ? 10 : sonar.qualityGate === 'WARN' ? 6 : 0,
        detail: `Quality gate ${sonar.qualityGate}`,
        fix: sonar.qualityGate === 'OK' ? null : 'Resolva as condições do quality gate antes de mesclar (e exija-o como check do PR).',
      });

    const sca = m?.security.sca;
    if (!facts.dependencies.length && !facts.lockfiles.length)
      push('pipeline', { id: 'sca-in-pipeline', status: 'na', score: null, detail: 'Sem dependências', fix: null });
    else if (sca) push('pipeline', { id: 'sca-in-pipeline', status: 'pass', score: 10, detail: 'Scanner de dependências publicado pelo CI', fix: null });
    else if (!m) push('pipeline', { id: 'sca-in-pipeline', status: 'unknown', score: null, detail: 'O CI não envia métricas', fix: null });
    else
      push('pipeline', {
        id: 'sca-in-pipeline',
        status: 'fail',
        score: 0,
        detail: 'O CI não publica varredura de dependências',
        fix: 'Rode Trivy, Grype ou OSV-Scanner no CI e envie o SARIF (entrada sarif-sca da action).',
      });

    const axes: PostureAxis[] = SECURITY_AXES.map((axis) => {
      const list = items.get(axis)!;
      const s = mean(list.flatMap((i) => (i.score == null ? [] : [i.score])));
      return { axis, label: SECURITY_AXIS_LABEL[axis], score: s == null ? null : Math.round(s * 10), items: list };
    });
    const graded = axes.filter((a) => a.score != null);
    const weight = graded.reduce((a, x) => a + AXIS_WEIGHT[x.axis], 0);
    const score = weight ? Math.round(graded.reduce((a, x) => a + x.score! * AXIS_WEIGHT[x.axis], 0) / weight) : null;

    const practices = this.practices(checks, facts, m);
    const maturity = maturityOf(practices);

    const bySource: Partial<Record<FindingSource, SeverityCounts>> = { ...m?.security };
    const total = Object.values(bySource).reduce(sumSeverity, ZERO);
    const vulnerableDependencies = facts.intel.vulnerabilities ? facts.intel.vulnerabilities.length : null;

    const vulnAxis = axes.find((a) => a.axis === 'vulnerabilities')!.score;
    const failed = (id: string) => checks.get(id)?.status === 'fail';
    const reasons: Array<[RiskLevel, string]> = [];
    if (total.critical) reasons.push(['critical', `${total.critical} achado(s) crítico(s) no CI`]);
    if (failed('env-committed')) reasons.push(['critical', 'Arquivo .env versionado']);
    if (failed('dangerous-workflow')) reasons.push(['critical', 'Workflow do CI explorável (pull_request_target/write-all)']);
    if (total.high) reasons.push(['high', `${total.high} achado(s) alto(s) no CI`]);
    if (vulnerableDependencies) reasons.push(['high', `${vulnerableDependencies} dependência(s) com vulnerabilidade conhecida`]);
    if (failed('runtime-eol')) reasons.push(['high', 'Runtime sem suporte (EOL)']);
    if (sonar?.ratings.security === 'D' || sonar?.ratings.security === 'E') reasons.push(['high', `Nota de segurança ${sonar.ratings.security} no SonarQube`]);
    if (sonar?.qualityGate === 'ERROR') reasons.push(['high', 'Quality gate do SonarQube reprovado']);
    if (total.medium) reasons.push(['medium', `${total.medium} achado(s) médio(s) no CI`]);
    if (vulnAxis != null && vulnAxis < 70) reasons.push(['medium', `Eixo de vulnerabilidades com ${vulnAxis}/100`]);
    // Repositório só de documentação não tem pipeline a amadurecer.
    if (maturity.level < 2 && facts.appType !== 'docs') reasons.push(['medium', `Maturidade DevSecOps ${maturity.label.toLowerCase()}`]);
    const risk = RISK_LEVELS.find((l) => reasons.some(([r]) => r === l)) ?? 'low';

    return {
      owner,
      name,
      htmlUrl,
      analyzedAt,
      metricsAt: m?.receivedAt ?? null,
      score,
      risk,
      riskReasons: reasons.map(([, r]) => r),
      maturity,
      axes,
      practices,
      findings: { bySource, total, vulnerableDependencies, sonar, tools: m?.tools ?? [] },
    };
  }

  /** Consolida as posturas dos repositórios analisados. */
  portfolio(postures: SecurityPosture[], repos: number): PortfolioPosture {
    const axisMean = (axis: SecurityAxis) => {
      const v = mean(postures.flatMap((p) => p.axes.filter((a) => a.axis === axis && a.score != null).map((a) => a.score!)));
      return v == null ? null : Math.round(v);
    };
    const score = mean(postures.flatMap((p) => (p.score == null ? [] : [p.score])));
    const byRisk = Object.fromEntries(RISK_LEVELS.map((r) => [r, postures.filter((p) => p.risk === r).length])) as Record<RiskLevel, number>;
    const byLevel = MATURITY_LABELS.map((_, l) => postures.filter((p) => p.maturity.level === l).length);
    const adoption = PRACTICES.map(({ id, label }) => {
      const measured = postures.map((p) => p.practices.find((x) => x.id === id)!).filter((x) => x.applicable && x.adopted != null);
      return { id, label, adopted: measured.filter((x) => x.adopted).length, measured: measured.length };
    });
    const riskRank = (r: RiskLevel) => RISK_LEVELS.indexOf(r);
    const rows = postures
      .map((p) => ({
        owner: p.owner,
        name: p.name,
        score: p.score,
        risk: p.risk,
        level: p.maturity.level,
        axes: Object.fromEntries(p.axes.map((a) => [a.axis, a.score])) as Record<SecurityAxis, number | null>,
        critical: p.findings.total.critical,
        high: p.findings.total.high,
        vulnerableDependencies: p.findings.vulnerableDependencies,
        reasons: p.riskReasons.slice(0, 3),
      }))
      .toSorted((a, b) => riskRank(a.risk) - riskRank(b.risk) || (a.score ?? 101) - (b.score ?? 101) || a.name.localeCompare(b.name));
    return {
      repos,
      analyzed: postures.length,
      score: score == null ? null : Math.round(score),
      axes: Object.fromEntries(SECURITY_AXES.map((a) => [a, axisMean(a)])) as Record<SecurityAxis, number | null>,
      byRisk,
      byLevel,
      findings: postures.reduce((a, p) => sumSeverity(a, p.findings.total), ZERO),
      vulnerableDependencies: postures.reduce((a, p) => a + (p.findings.vulnerableDependencies ?? 0), 0),
      adoption,
      rows,
    };
  }

  private practices(checks: Map<string, QualityCheck>, facts: RepoFacts, m: RepoMetricsSnapshot | null): DevSecOpsPractice[] {
    /** pass → sim; fail/warn → não; desconhecido → null; n/a ou ausente → não se aplica. */
    const fromCheck = (id: string): Pick<DevSecOpsPractice, 'adopted' | 'applicable'> => {
      const c = checks.get(id);
      if (!c || c.status === 'na') return { adopted: null, applicable: false };
      return { adopted: c.status === 'unknown' ? null : c.status === 'pass', applicable: true };
    };
    const all = (...ids: string[]) => {
      const parts = ids.map(fromCheck).filter((p) => p.applicable);
      if (!parts.length) return { adopted: null, applicable: false };
      if (parts.some((p) => p.adopted === false)) return { adopted: false, applicable: true };
      return { adopted: parts.every((p) => p.adopted) ? true : null, applicable: true };
    };
    const any = (...ids: string[]) => {
      const parts = ids.map(fromCheck).filter((p) => p.applicable);
      if (!parts.length) return { adopted: null, applicable: false };
      if (parts.some((p) => p.adopted)) return { adopted: true, applicable: true };
      return { adopted: parts.some((p) => p.adopted === null) ? null : false, applicable: true };
    };
    const hasDeps = facts.dependencies.length > 0 || facts.lockfiles.length > 0;
    const runsCode = facts.appType !== 'docs' && facts.appType !== 'infra';
    const webApp = facts.appType === 'service' || facts.appType === 'frontend';
    const reported = (present: boolean) => (m ? present : null);
    const result: Record<string, Pick<DevSecOpsPractice, 'adopted' | 'applicable'>> = {
      ci: fromCheck('pipeline-present'),
      sast: fromCheck('sast-in-pipeline'),
      secrets: fromCheck('secret-scanning'),
      'deps-update': fromCheck('update-automation'),
      sca: hasDeps ? { adopted: reported(!!m?.security.sca), applicable: true } : { adopted: null, applicable: false },
      coverage: runsCode ? { adopted: reported(m?.coverage?.lines != null), applicable: true } : { adopted: null, applicable: false },
      review: any('branch-protection', 'review-coverage'),
      dast: webApp ? { adopted: reported(!!m?.security.dast), applicable: true } : { adopted: null, applicable: false },
      'quality-gate': runsCode ? { adopted: reported(!!m?.sonar?.qualityGate || !!m?.lint), applicable: true } : { adopted: null, applicable: false },
      hardening: all('pinned-actions', 'token-permissions', 'dangerous-workflow'),
      policy: fromCheck('security-policy'),
    };
    return PRACTICES.map(({ id, label }) => ({ id, label, ...result[id]! }));
  }
}

/** Nível = o maior em que todas as práticas exigidas (até ele) estão adotadas ou não se aplicam. */
export function maturityOf(practices: DevSecOpsPractice[]): SecurityPosture['maturity'] {
  const meets = (p: DevSecOpsPractice) => !p.applicable || p.adopted === true;
  let level: MaturityLevel = 0;
  for (const l of [1, 2, 3, 4] as const) {
    const required = PRACTICES.filter((x) => x.level === l).map((x) => practices.find((p) => p.id === x.id)!);
    if (!required.every(meets)) break;
    level = l;
  }
  const nextLevel = level < 4 ? ((level + 1) as MaturityLevel) : null;
  return {
    level,
    label: MATURITY_LABELS[level],
    next:
      nextLevel == null
        ? null
        : {
            level: nextLevel,
            label: MATURITY_LABELS[nextLevel],
            missing: PRACTICES.filter((x) => x.level <= nextLevel)
              .map((x) => practices.find((p) => p.id === x.id)!)
              .filter((p) => !meets(p))
              .map((p) => (p.adopted === null ? `${p.label} (não verificado)` : p.label)),
          },
  };
}

/** Resumo do Sonar para o prompt e o relatório. */
export function describeSonar(s: SonarSummary): string {
  const r = s.ratings;
  return [
    s.qualityGate ? `quality gate ${s.qualityGate}` : null,
    r.security ? `segurança ${r.security}` : null,
    r.reliability ? `confiabilidade ${r.reliability}` : null,
    r.maintainability ? `manutenibilidade ${r.maintainability}` : null,
    s.vulnerabilities != null ? `${s.vulnerabilities} vulnerabilidade(s)` : null,
    s.hotspots != null ? `${s.hotspots} hotspot(s)` : null,
    s.bugs != null ? `${s.bugs} bug(s)` : null,
    s.codeSmells != null ? `${s.codeSmells} code smell(s)` : null,
    s.coverage != null ? `cobertura ${s.coverage}%` : null,
    s.duplication != null ? `duplicação ${s.duplication}%` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

import type { QualityCategory, QualityCheck, QualityReport, RepoFacts, RepoMetricsSnapshot, RepoProcess, SeverityCounts } from '../../../shared/types.ts';

/** Muda quando as regras mudam: o histórico quebra a linha nas trocas de versão. */
export const QUALITY_VERSION = 'comm-graph-quality-v2';

export const CATEGORIES: Record<QualityCategory, { label: string; weight: number }> = {
  ci: { label: 'CI & relatório', weight: 2 },
  tests: { label: 'Testes', weight: 3 },
  security: { label: 'Segurança', weight: 3 },
  guardrails: { label: 'Guardrails', weight: 2 },
  process: { label: 'Processo', weight: 2 },
  docs: { label: 'Documentação', weight: 1 },
};

export interface ScoreInput {
  facts: RepoFacts;
  metrics: RepoMetricsSnapshot | null;
  process: RepoProcess | null;
  repo: { description: string | null; pushedAt: string | null };
}

const WORKFLOW_HINT = 'Envie as métricas pelo workflow do Comm Graph (integrations/github-action).';
const DAY = 24 * 3600 * 1000;

/**
 * Scorecard do repositório. Regras:
 * - "falhou" só com evidência; não medir algo que se aplica (ex.: CI não publica cobertura) vale 0;
 * - "desconhecido" (não deu para observar) não mexe na nota, só reduz a confiança;
 * - "n/a" só quando está provado que não se aplica (ex.: sem banco, não exige teste com banco real);
 * - checks "signal" aparecem mas não entram na nota.
 * Nota da categoria = média dos checks com nota; nota final = média ponderada das categorias com nota.
 * Confiança = fração ponderada dos checks aplicáveis que puderam ser medidos.
 */
export class QualityScorer {
  score({ facts: f, metrics: m, process: p, repo }: ScoreInput): QualityReport {
    const checks: QualityCheck[] = [];
    const add = (
      category: QualityCategory,
      id: string,
      status: QualityCheck['status'],
      score: number | null,
      detail: string,
      fix: string | null = null,
      impact: QualityCheck['impact'] = 'grade',
    ) =>
      checks.push({
        category,
        id,
        impact,
        status,
        score: status === 'unknown' || status === 'na' ? null : score == null ? null : clamp(round(score)),
        detail,
        fix,
      });
    const pass = (c: QualityCategory, id: string, detail: string) => add(c, id, 'pass', 10, detail);
    const fail = (c: QualityCategory, id: string, detail: string, fix: string | null) => add(c, id, 'fail', 0, detail, fix);
    const unknown = (c: QualityCategory, id: string, detail: string) => add(c, id, 'unknown', null, detail);
    const na = (c: QualityCategory, id: string, detail: string) => add(c, id, 'na', null, detail);

    const runsCode = f.appType !== 'docs' && f.appType !== 'infra';
    const isApp = ['service', 'frontend', 'mobile'].includes(f.appType);
    const wf = f.workflowAudit;
    const hasWorkflows = wf.files > 0;

    // ---------- CI ----------
    if (hasWorkflows || f.deploy.includes('Bitbucket Pipelines'))
      pass('ci', 'pipeline-present', `CI configurado: ${f.workflows.join(', ') || 'bitbucket-pipelines.yml'}`);
    else fail('ci', 'pipeline-present', 'Nenhum workflow em .github/workflows', 'Crie um workflow de CI (build, testes e lint).');

    if (!runsCode) na('ci', 'metrics-reported', 'Repositório sem código executável');
    else if (m) pass('ci', 'metrics-reported', `Métricas recebidas do CI em ${m.receivedAt} (commit ${m.sha.slice(0, 7)})`);
    else fail('ci', 'metrics-reported', wf.sendsMetrics ? 'O workflow envia métricas, mas nada chegou ainda' : 'Nenhuma métrica recebida do CI', WORKFLOW_HINT);

    if (!runsCode) na('ci', 'sast-in-pipeline', 'Repositório sem código executável');
    else if (wf.sastTools.length) pass('ci', 'sast-in-pipeline', `SAST no pipeline: ${wf.sastTools.join(', ')}`);
    else if (m?.security.sast) pass('ci', 'sast-in-pipeline', 'SAST publicado nas métricas do CI');
    else fail('ci', 'sast-in-pipeline', 'Nenhuma ferramenta de SAST nos workflows', 'Rode Semgrep, CodeQL ou similar no CI e publique o SARIF.');

    if (f.github.secretScanning || wf.secretScanTools.length)
      pass(
        'ci',
        'secret-scanning',
        f.github.secretScanning ? 'Secret scanning do GitHub ativo' : `Varredura de segredos no CI: ${wf.secretScanTools.join(', ')}`,
      );
    // Sem ver a configuração do GitHub (token sem acesso) não há evidência de que esteja desligado.
    else if (f.github.secretScanning === null)
      unknown('ci', 'secret-scanning', 'Não foi possível ver a configuração de secret scanning e nenhum workflow roda gitleaks/trufflehog');
    else
      fail(
        'ci',
        'secret-scanning',
        'Sem secret scanning no GitHub nem gitleaks/trufflehog no CI',
        'Ative o secret scanning (e push protection) ou rode gitleaks no CI.',
      );

    // ---------- Testes ----------
    if (!runsCode) na('tests', 'tests-present', 'Repositório sem código executável');
    else if (f.testFiles) add('tests', 'tests-present', 'pass', f.testFiles >= 20 ? 10 : f.testFiles >= 5 ? 8 : 6, `${f.testFiles} arquivo(s) de teste`);
    else fail('tests', 'tests-present', 'Nenhum arquivo de teste encontrado', 'Adicione testes automatizados (tests/, *.test.*, *_test.go…).');

    const unit = m?.tests.unit ?? m?.tests.integration;
    if (unit)
      add(
        'tests',
        'tests-passing',
        unit.failed ? 'fail' : 'pass',
        unit.total ? (unit.passed / Math.max(1, unit.total - unit.skipped)) * 10 : 0,
        `${unit.passed}/${unit.total} passando, ${unit.failed} falhando, ${unit.skipped} pulados`,
      );
    else if (runsCode) unknown('tests', 'tests-passing', 'Sem relatório JUnit no CI');

    // e2e: biblioteca não precisa; app sem classificação = desconhecido.
    const e2eRun = m?.tests.e2e;
    let e2eFailed = false;
    if (!runsCode || f.appType === 'library') na('tests', 'e2e', 'Biblioteca ou repositório sem aplicação');
    else if (e2eRun) add('tests', 'e2e', e2eRun.failed ? 'warn' : 'pass', e2eRun.failed ? 6 : 10, `E2E no CI: ${e2eRun.passed}/${e2eRun.total} passando`);
    else if (f.e2e) add('tests', 'e2e', 'warn', 6, 'Suíte e2e existe, mas o CI não publica o resultado', WORKFLOW_HINT);
    else if (isApp) {
      e2eFailed = true;
      fail('tests', 'e2e', 'Sem suíte ponta a ponta (Playwright, Cypress, Detox…)', 'Cubra os fluxos principais com testes e2e.');
    } else unknown('tests', 'e2e', 'Tipo de aplicação não identificado');

    const cov = m?.coverage?.lines;
    if (!runsCode) na('tests', 'coverage-pct', 'Repositório sem código executável');
    else if (cov != null) {
      // 80% = nota cheia. Sem e2e (comprovado), cobertura vale no máximo metade: mocks não provam comportamento.
      let s = Math.min(10, (cov / 80) * 10);
      if (e2eFailed) s = Math.min(s, 5);
      add(
        'tests',
        'coverage-pct',
        cov >= 60 ? 'pass' : 'warn',
        s,
        `Cobertura de linhas ${cov}%${m?.coverage?.branches != null ? `, branches ${m.coverage.branches}%` : ''}${e2eFailed ? ' (limitada a 5: sem e2e)' : ''}`,
      );
    } else fail('tests', 'coverage-pct', 'Cobertura não publicada — não medido vale 0', WORKFLOW_HINT);

    if (!f.dataStores.length) na('tests', 'real-dependency-harness', 'Sem dependência de banco ou cache');
    else if (f.realDependencyHarness)
      pass('tests', 'real-dependency-harness', `Testes com dependências reais via ${f.realDependencyHarness} (${f.dataStores.slice(0, 4).join(', ')})`);
    else
      fail(
        'tests',
        'real-dependency-harness',
        `Usa ${f.dataStores.slice(0, 4).join(', ')} mas não há testcontainers, docker compose nem services no CI`,
        'Teste contra o banco real (testcontainers ou services no workflow).',
      );

    if (m?.mutationScore != null) add('tests', 'mutation-score', 'pass', (m.mutationScore / 80) * 10, `Mutation score ${m.mutationScore}%`);
    if (m?.flakyRate != null) add('tests', 'flaky-rate', m.flakyRate > 2 ? 'warn' : 'pass', 10 - (m.flakyRate / 5) * 10, `Testes instáveis: ${m.flakyRate}%`);

    // ---------- Segurança ----------
    const rt = f.runtime;
    const sup = f.intel.runtimeSupport;
    if (!rt) (runsCode ? unknown : na)('security', 'runtime-eol', 'Runtime não identificado');
    else if (!sup) unknown('security', 'runtime-eol', `${rt.name} ${rt.version}: suporte não consultado`);
    else if (!sup.supported)
      fail(
        'security',
        'runtime-eol',
        `${rt.name} ${rt.version} fora de suporte desde ${sup.eol}`,
        `Atualize para uma versão suportada${sup.latest ? ` (mais recente ${sup.latest})` : ''}.`,
      );
    else {
      const soon = sup.eol != null && Date.parse(sup.eol) - Date.now() < 180 * DAY;
      add('security', 'runtime-eol', soon ? 'warn' : 'pass', soon ? 6 : 10, `${rt.name} ${rt.version} com suporte${sup.eol ? ` até ${sup.eol}` : ''}`);
    }

    const vulns = f.intel.vulnerabilities;
    if (!f.dependencies.length) na('security', 'sca-vulnerabilities', 'Sem dependências diretas analisáveis');
    else if (!vulns) unknown('security', 'sca-vulnerabilities', 'OSV não consultado');
    else {
      const ids = new Set(vulns.flatMap((v) => v.ids));
      add(
        'security',
        'sca-vulnerabilities',
        ids.size ? 'warn' : 'pass',
        10 - ids.size * 2,
        ids.size
          ? `${ids.size} vulnerabilidade(s) conhecida(s) em ${f.dependencies.length} dependências diretas (OSV): ${vulns
              .slice(0, 4)
              .map((v) => `${v.dependency} ${v.ids.slice(0, 2).join(', ')}`)
              .join('; ')}`
          : `Nenhuma vulnerabilidade conhecida em ${f.dependencies.length} dependências diretas (OSV)`,
        ids.size ? 'Atualize as dependências afetadas.' : null,
      );
    }

    const fresh = f.intel.freshness;
    if (!f.dependencies.length) na('security', 'dependency-freshness', 'Sem dependências diretas analisáveis');
    else if (!fresh?.measured) unknown('security', 'dependency-freshness', 'Datas das versões não consultadas');
    else {
      const y = fresh.averageLibyears;
      add(
        'security',
        'dependency-freshness',
        y <= 0.5 ? 'pass' : 'warn',
        ((3 - y) / 2.5) * 10,
        `Média de ${y.toFixed(1)} libyears atrás (${fresh.outdated}/${fresh.measured} desatualizadas; cheia até 0,5, zero a partir de 3)`,
      );
    }

    const sec = m?.security ?? {};
    const findings = (kind: 'sast' | 'dast' | 'secrets', label: string, required: boolean) => {
      const c = sec[kind];
      if (c)
        add(
          'security',
          `${kind}-findings`,
          c.critical || c.high ? 'fail' : c.medium ? 'warn' : 'pass',
          severityScore(c),
          `${label}: ${describe(c)}${m?.tools.length ? ` (${m.tools.join(', ')})` : ''}`,
          c.critical || c.high ? 'Corrija os achados críticos e altos.' : null,
        );
      else if (required) fail('security', `${kind}-findings`, `${label} não publicado — não medido vale 0`, WORKFLOW_HINT);
      else unknown('security', `${kind}-findings`, `Sem resultado de ${label}`);
    };
    if (runsCode) {
      findings('sast', 'SAST', true);
      if (f.appType === 'service' || f.appType === 'frontend') findings('dast', 'DAST', false);
      findings('secrets', 'Vazamento de segredos', false);
    }
    if (sec.sca) add('security', 'sca-scanner', severityScore(sec.sca) >= 8 ? 'pass' : 'warn', severityScore(sec.sca), `SCA do CI: ${describe(sec.sca)}`);
    if (f.committedEnvFiles.length)
      fail(
        'security',
        'env-committed',
        `Arquivo(s) .env versionado(s): ${f.committedEnvFiles.join(', ')}`,
        'Remova do repositório, rotacione os segredos e adicione ao .gitignore.',
      );
    else pass('security', 'env-committed', 'Nenhum .env versionado');
    if (f.binaryFiles.length)
      fail(
        'security',
        'binary-artifacts',
        `Binários versionados: ${f.binaryFiles.slice(0, 5).join(', ')}${f.binaryFiles.length > 5 ? '…' : ''}`,
        'Gere os binários no build em vez de versioná-los.',
      );
    else pass('security', 'binary-artifacts', 'Nenhum binário versionado');

    // ---------- Guardrails ----------
    if (!f.dependencies.length && !f.manifests.length) {
      na('guardrails', 'lockfile-present', 'Sem gerenciador de pacotes');
      na('guardrails', 'update-automation', 'Sem gerenciador de pacotes');
    } else {
      if (f.lockfiles.length) pass('guardrails', 'lockfile-present', `Dependências travadas (${f.lockfiles.join(', ')})`);
      else fail('guardrails', 'lockfile-present', 'Sem lockfile', 'Versione o lockfile do gerenciador de pacotes.');
      if (f.updateAutomation) pass('guardrails', 'update-automation', `Atualização automática: ${f.updateAutomation}`);
      else fail('guardrails', 'update-automation', 'Sem Renovate nem Dependabot', 'Adicione renovate.json ou .github/dependabot.yml.');
    }
    if (!runsCode) na('guardrails', 'lint-config', 'Repositório sem código executável');
    else if (f.lintConfig.length) pass('guardrails', 'lint-config', `Lint configurado: ${f.lintConfig.join(', ')}`);
    else fail('guardrails', 'lint-config', 'Sem configuração de lint/análise estática', 'Configure ESLint/Biome/golangci-lint e rode no CI.');
    if (m?.lint)
      add(
        'guardrails',
        'lint-clean',
        m.lint.errors ? 'fail' : 'pass',
        m.lint.errors ? 8 - Math.log10(m.lint.errors + 1) * 3 : 10,
        `Lint no CI: ${m.lint.errors} erro(s), ${m.lint.warnings} aviso(s)`,
      );
    if (f.hasCodeowners) pass('guardrails', 'codeowners', 'CODEOWNERS definido');
    else fail('guardrails', 'codeowners', 'Sem CODEOWNERS', 'Defina donos do código para revisão obrigatória.');

    const rules = f.github.branchRules;
    if (rules == null || !rules.length)
      unknown(
        'guardrails',
        'branch-protection',
        rules == null ? 'Regras do branch padrão não visíveis com o token' : 'Nenhum ruleset no branch padrão (proteção clássica não é visível pela API)',
      );
    else {
      const axes = ['pull_request', 'required_status_checks', 'non_fast_forward'];
      const ok = axes.filter((a) => rules.includes(a));
      add(
        'guardrails',
        'branch-protection',
        ok.length === axes.length ? 'pass' : 'warn',
        (ok.length / axes.length) * 10,
        `Branch padrão exige: ${ok.join(', ') || 'nada relevante'}${ok.length < axes.length ? ` (falta ${axes.filter((a) => !ok.includes(a)).join(', ')})` : ''}`,
        ok.length < axes.length ? 'Exija PR, checks de status e bloqueie force-push no ruleset do branch padrão.' : null,
      );
    }

    if (!hasWorkflows) {
      na('guardrails', 'dangerous-workflow', 'Sem workflows');
      na('guardrails', 'token-permissions', 'Sem workflows');
      na('guardrails', 'pinned-actions', 'Sem workflows');
    } else {
      const danger = [...wf.dangerousTriggers, ...wf.writeAll];
      if (danger.length)
        fail(
          'guardrails',
          'dangerous-workflow',
          `Workflow perigoso: ${[...wf.dangerousTriggers.map((w) => `${w} (pull_request_target com checkout do PR)`), ...wf.writeAll.map((w) => `${w} (write-all)`)].join('; ')}`,
          'Não faça checkout do código do PR em pull_request_target e não use permissions: write-all.',
        );
      else pass('guardrails', 'dangerous-workflow', 'Nenhum padrão perigoso nos workflows');
      if (wf.missingPermissions.length)
        add(
          'guardrails',
          'token-permissions',
          'fail',
          (1 - wf.missingPermissions.length / Math.max(1, Math.min(wf.files, 15))) * 10,
          `Sem bloco permissions: ${wf.missingPermissions.join(', ')}`,
          'Declare permissions mínimas no topo de cada workflow (ex.: contents: read).',
        );
      else pass('guardrails', 'token-permissions', 'Todos os workflows declaram permissions');
      if (wf.unpinnedActions.length)
        add(
          'guardrails',
          'pinned-actions',
          'warn',
          Math.max(0, 10 - wf.unpinnedActions.length),
          `${wf.unpinnedActions.length} action(s) de terceiros sem SHA: ${wf.unpinnedActions.slice(0, 4).join(', ')}`,
          'Fixe actions de terceiros pelo SHA completo do commit.',
        );
      else pass('guardrails', 'pinned-actions', 'Actions de terceiros fixadas por SHA');
    }

    // ---------- Processo ----------
    const pushedRecently = repo.pushedAt != null && Date.now() - Date.parse(repo.pushedAt) < 90 * DAY;
    add(
      'process',
      'recent-activity',
      pushedRecently ? 'pass' : 'warn',
      pushedRecently ? 10 : 0,
      repo.pushedAt ? `Último push em ${repo.pushedAt.slice(0, 10)}` : 'Sem push registrado',
      null,
      'signal',
    );
    if (!p) {
      unknown('process', 'review-coverage', 'Processo ainda não coletado');
    } else {
      const failed = (label: string) => p.errors.some((e) => e.startsWith(label));
      if (failed('PRs mesclados')) unknown('process', 'review-coverage', 'Não foi possível ler os PRs');
      else if (!p.mergedPrs) na('process', 'review-coverage', `Nenhum PR mesclado em ${p.windowDays} dias`);
      else {
        const share = p.reviewedPrs / p.mergedPrs;
        add(
          'process',
          'review-coverage',
          share >= 0.8 ? 'pass' : 'warn',
          share * 10,
          `${p.reviewedPrs}/${p.mergedPrs} PRs aprovados por outra pessoa (${p.windowDays} dias)`,
          share < 0.8 ? 'Exija aprovação de outra pessoa antes do merge.' : null,
        );
        const linked = p.linkedPrs / p.mergedPrs;
        add(
          'process',
          'issue-traceability',
          linked >= 0.6 ? 'pass' : 'warn',
          linked * 10,
          `${p.linkedPrs}/${p.mergedPrs} PRs citam uma issue/tarefa`,
          linked < 0.6 ? 'Referencie a issue no título ou descrição do PR.' : null,
        );
      }
      if (failed('commits')) unknown('process', 'direct-push-share', 'Não foi possível ler os commits');
      else if (!p.directPushes) na('process', 'direct-push-share', `Nenhum commit em ${p.windowDays} dias`);
      else {
        const { sampled, direct } = p.directPushes;
        add(
          'process',
          'direct-push-share',
          direct ? 'warn' : 'pass',
          (1 - direct / sampled) * 10,
          `${direct}/${sampled} commits recentes entraram sem PR`,
          direct ? 'Proíba push direto no branch padrão.' : null,
        );
      }
      if (p.topAuthorShare == null) na('process', 'bus-factor', 'Poucos commits na janela para medir');
      else
        add(
          'process',
          'bus-factor',
          p.topAuthorShare <= 0.5 ? 'pass' : 'warn',
          ((1 - p.topAuthorShare) / 0.5) * 10,
          `Autor mais ativo fez ${Math.round(p.topAuthorShare * 100)}% dos commits`,
          p.topAuthorShare > 0.7 ? 'Distribua o conhecimento: pares, revisão e documentação.' : null,
        );
      if (failed('PRs abertos')) unknown('process', 'pr-upkeep', 'Não foi possível ler os PRs abertos');
      else {
        const penalty = p.staleOpenPrs * 2.5 + p.unreviewedOldPrs * 1.5;
        add(
          'process',
          'pr-upkeep',
          penalty ? 'warn' : 'pass',
          10 - penalty,
          `${p.openPrs} PR(s) aberto(s): ${p.staleOpenPrs} há mais de 90 dias, ${p.unreviewedOldPrs} sem revisão há mais de 14 dias`,
          penalty ? 'Revise ou feche PRs parados.' : null,
        );
      }
    }

    // ---------- Documentação ----------
    if (f.readmeChars >= 800) pass('docs', 'readme', `README com ${f.readmeChars} caracteres`);
    else if (f.readmeChars)
      add('docs', 'readme', 'warn', 5, `README curto (${f.readmeChars} caracteres)`, 'Documente propósito, como rodar e como fazer deploy.');
    else fail('docs', 'readme', 'Sem README', 'Documente propósito, como rodar e como fazer deploy.');
    if (f.docFiles.security) pass('docs', 'security-policy', 'SECURITY.md presente');
    else fail('docs', 'security-policy', 'Sem SECURITY.md', 'Explique como reportar vulnerabilidades.');
    if (f.hasChangelog) pass('docs', 'changelog', 'CHANGELOG.md presente');
    else add('docs', 'changelog', 'warn', 4, 'Sem CHANGELOG.md');
    if (isApp && f.envVars.length) {
      if (f.docFiles.envExample) pass('docs', 'env-example', '.env.example documenta as variáveis');
      else
        fail(
          'docs',
          'env-example',
          `${f.envVars.length} variável(is) de ambiente sem .env.example`,
          'Liste as variáveis (sem valores reais) num .env.example.',
        );
    }
    add(
      'docs',
      'agents-md',
      f.docFiles.agents ? 'pass' : 'warn',
      f.docFiles.agents ? 10 : 0,
      f.docFiles.agents ? 'Instruções para agentes de código (AGENTS.md/CLAUDE.md)' : 'Sem AGENTS.md/CLAUDE.md',
      null,
      'signal',
    );
    const meta = f.github.topics;
    add(
      'docs',
      'repo-metadata',
      repo.description && meta?.length ? 'pass' : 'warn',
      repo.description && meta?.length ? 10 : 0,
      `${repo.description ? 'Com descrição' : 'Sem descrição'}, ${meta == null ? 'topics desconhecidos' : `${meta.length} topic(s)`}`,
      null,
      'signal',
    );

    return summarize(checks);
  }
}

/** Agrega checks em categorias, nota final e confiança. */
export function summarize(checks: QualityCheck[]): QualityReport {
  const graded = (c: QualityCheck) => c.impact === 'grade';
  const categories = (Object.keys(CATEGORIES) as QualityCategory[]).map((category) => {
    const list = checks.filter((c) => c.category === category);
    const scored = list.filter((c) => graded(c) && c.score != null);
    return {
      category,
      label: CATEGORIES[category].label,
      weight: CATEGORIES[category].weight,
      score: scored.length ? round(scored.reduce((a, c) => a + c.score!, 0) / scored.length) : null,
      checks: list,
    };
  });
  const evaluated = categories.filter((c) => c.score != null);
  const totalWeight = evaluated.reduce((a, c) => a + c.weight, 0);

  let measuredWeight = 0;
  let applicableWeight = 0;
  for (const c of categories) {
    const applicable = c.checks.filter((x) => graded(x) && x.status !== 'na');
    if (!applicable.length) continue;
    applicableWeight += c.weight;
    measuredWeight += c.weight * (applicable.filter((x) => x.status !== 'unknown').length / applicable.length);
  }
  return {
    version: QUALITY_VERSION,
    score: totalWeight ? round(evaluated.reduce((a, c) => a + c.score! * c.weight, 0) / totalWeight) : null,
    confidence: applicableWeight ? round(measuredWeight / applicableWeight, 2) : 0,
    categories,
  };
}

function severityScore(c: SeverityCounts): number {
  if (c.critical) return 0;
  if (c.high) return Math.max(1, 5 - c.high);
  if (c.medium) return Math.max(5, 9 - c.medium * 0.5);
  return c.low ? 9.5 : 10;
}

const describe = (c: SeverityCounts) => `${c.critical} crítico(s), ${c.high} alto(s), ${c.medium} médio(s), ${c.low} baixo(s)`;
const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
const clamp = (v: number) => Math.min(10, Math.max(0, v));

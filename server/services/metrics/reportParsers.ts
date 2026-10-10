import type { SeverityCounts, TestCounts } from '../../../shared/types.ts';

/** Interpretação dos relatórios que os workflows enviam. Funções puras: texto → números. */

export interface CoverageResult {
  lines: number | null;
  branches: number | null;
}

const pct = (covered: number, total: number) => (total > 0 ? Math.round((covered / total) * 10_000) / 100 : null);

/** coverage-summary.json do Istanbul/nyc/Jest/Vitest (reporter json-summary). */
export function parseIstanbulSummary(text: string): CoverageResult {
  const json = JSON.parse(text) as { total?: { lines?: { pct?: number }; branches?: { pct?: number } } };
  if (!json.total) throw new Error('coverage-summary sem "total"');
  return { lines: num(json.total.lines?.pct), branches: num(json.total.branches?.pct) };
}

/** lcov.info: soma LF/LH (linhas) e BRF/BRH (branches). */
export function parseLcov(text: string): CoverageResult {
  let lf = 0,
    lh = 0,
    brf = 0,
    brh = 0;
  for (const m of text.matchAll(/^(LF|LH|BRF|BRH):(\d+)/gm)) {
    const v = Number(m[2]);
    if (m[1] === 'LF') lf += v;
    else if (m[1] === 'LH') lh += v;
    else if (m[1] === 'BRF') brf += v;
    else brh += v;
  }
  if (!lf) throw new Error('lcov sem linhas (LF)');
  return { lines: pct(lh, lf), branches: pct(brh, brf) };
}

/** coverprofile do `go test -coverprofile`: cobertura por statements. */
export function parseGoCover(text: string): CoverageResult {
  let total = 0,
    covered = 0;
  for (const line of text.split('\n')) {
    const m = /^\S+:\d+\.\d+,\d+\.\d+ (\d+) (\d+)$/.exec(line.trim());
    if (!m) continue;
    total += Number(m[1]);
    if (Number(m[2]) > 0) covered += Number(m[1]);
  }
  if (!total) throw new Error('coverprofile vazio');
  return { lines: pct(covered, total), branches: null };
}

/** Cobertura (JaCoCo convertido, coverage.py, etc.): atributos line-rate/branch-rate na raiz. */
export function parseCobertura(text: string): CoverageResult {
  const root = /<coverage\b[^>]*>/.exec(text)?.[0];
  if (!root) throw new Error('XML Cobertura sem <coverage>');
  const attr = (name: string) => num(Number(new RegExp(`${name}="([\\d.]+)"`).exec(root)?.[1]));
  const line = attr('line-rate');
  const branch = attr('branch-rate');
  return { lines: line != null ? Math.round(line * 10_000) / 100 : null, branches: branch != null ? Math.round(branch * 10_000) / 100 : null };
}

/** JUnit XML (Jest, Vitest, go-junit-report, Surefire, pytest, Playwright…). */
export function parseJunit(text: string): TestCounts {
  let total = 0,
    failed = 0,
    skipped = 0;
  for (const m of text.matchAll(/<testcase\b[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    total++;
    const body = m[2] ?? '';
    if (/<(failure|error)\b/.test(body)) failed++;
    else if (/<skipped\b/.test(body)) skipped++;
  }
  if (!total) {
    // Alguns geradores só preenchem os atributos do <testsuite(s)>.
    const suite = /<testsuites?\b[^>]*>/.exec(text)?.[0] ?? '';
    const a = (n: string) => Number(new RegExp(`\\b${n}="(\\d+)"`).exec(suite)?.[1] ?? 0);
    total = a('tests');
    failed = a('failures') + a('errors');
    skipped = a('skipped') + a('disabled');
    if (!total) throw new Error('JUnit sem casos de teste');
  }
  return { total, passed: total - failed - skipped, failed, skipped };
}

export interface SarifResult {
  tools: string[];
  counts: SeverityCounts;
}

/**
 * SARIF 2.1 (CodeQL, Semgrep, Trivy, ZAP, gitleaks, Rainforest…).
 * Severidade: `security-severity` (CVSS) da regra/resultado quando existe; senão o `level` do resultado.
 */
export function parseSarif(text: string): SarifResult {
  const sarif = JSON.parse(text) as {
    runs?: Array<{
      tool?: { driver?: { name?: string; rules?: Array<{ id?: string; properties?: Record<string, unknown>; defaultConfiguration?: { level?: string } }> } };
      results?: Array<{ ruleId?: string; level?: string; properties?: Record<string, unknown>; suppressions?: unknown[] }>;
    }>;
  };
  if (!Array.isArray(sarif.runs)) throw new Error('SARIF sem "runs"');
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  const tools = new Set<string>();
  for (const run of sarif.runs) {
    if (run.tool?.driver?.name) tools.add(run.tool.driver.name);
    const rules = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
    for (const r of run.results ?? []) {
      if (r.suppressions?.length) continue;
      const rule = rules.get(r.ruleId);
      const cvss = Number(r.properties?.['security-severity'] ?? rule?.properties?.['security-severity']);
      const level = r.level ?? rule?.defaultConfiguration?.level ?? 'warning';
      if (Number.isFinite(cvss) && cvss > 0) {
        if (cvss >= 9) counts.critical++;
        else if (cvss >= 7) counts.high++;
        else if (cvss >= 4) counts.medium++;
        else counts.low++;
      } else if (level === 'error') counts.high++;
      else if (level === 'warning') counts.medium++;
      else if (level === 'note') counts.low++;
    }
  }
  return { tools: [...tools], counts };
}

function num(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

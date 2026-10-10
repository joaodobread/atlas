import type { Dependency, FreshnessResult, IPackageIntel, RuntimeSupport, VulnerabilityResult } from './IPackageIntel.ts';

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const MAX_FRESHNESS_DEPS = 40;

/** OSV.dev (vulnerabilidades), registry do npm / proxy do Go (datas de versão) e endoflife.date (suporte de runtime). */
export class PublicPackageIntel implements IPackageIntel {
  async vulnerabilities(deps: readonly Dependency[]): Promise<VulnerabilityResult> {
    const affected: VulnerabilityResult['affected'] = [];
    for (let i = 0; i < deps.length; i += 500) {
      const batch = deps.slice(i, i + 500);
      const res = await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: batch.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version })) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`OSV respondeu ${res.status}`);
      const body = (await res.json()) as { results: Array<{ vulns?: Array<{ id: string }> }> };
      body.results.forEach((r, j) => {
        if (r.vulns?.length) affected.push({ dependency: `${batch[j]!.name}@${batch[j]!.version}`, ids: r.vulns.map((v) => v.id) });
      });
    }
    return { affected };
  }

  async freshness(deps: readonly Dependency[]): Promise<FreshnessResult> {
    const sample = deps.slice(0, MAX_FRESHNESS_DEPS);
    const years: number[] = [];
    await pool(sample, 6, async (d) => {
      const y = await (d.ecosystem === 'npm' ? npmLibyears(d) : goLibyears(d)).catch(() => null);
      if (y != null) years.push(y);
    });
    return {
      averageLibyears: years.length ? years.reduce((a, b) => a + b, 0) / years.length : 0,
      measured: years.length,
      outdated: years.filter((y) => y > 0.01).length,
    };
  }

  async runtimeSupport(runtime: string, version: string): Promise<RuntimeSupport | null> {
    const product = { node: 'nodejs', go: 'go', java: 'java', python: 'python' }[runtime];
    if (!product) return null;
    const res = await fetch(`https://endoflife.date/api/${product}.json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const cycles = (await res.json()) as Array<{ cycle: string; eol: string | boolean; latest?: string }>;
    const [major, minor] = version.split('.');
    // Node/Java: ciclo = major; Go/Python: major.minor.
    const key = runtime === 'node' || runtime === 'java' ? major : `${major}.${minor ?? '0'}`;
    const cycle = cycles.find((c) => c.cycle === key);
    if (!cycle) return null;
    const eol = typeof cycle.eol === 'string' ? cycle.eol : null;
    const supported = cycle.eol === false || (eol != null && Date.parse(eol) > Date.now());
    return { supported, eol, latest: cycle.latest ?? null };
  }
}

async function npmLibyears(d: Dependency): Promise<number | null> {
  const res = await fetch(`https://registry.npmjs.org/${d.name.replace('/', '%2F')}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const doc = (await res.json()) as { time?: Record<string, string>; 'dist-tags'?: { latest?: string } };
  const latest = doc['dist-tags']?.latest;
  const used = doc.time?.[d.version];
  const newest = latest ? doc.time?.[latest] : undefined;
  if (!used || !newest) return null;
  return Math.max(0, (Date.parse(newest) - Date.parse(used)) / YEAR_MS);
}

async function goLibyears(d: Dependency): Promise<number | null> {
  // O proxy exige o caminho do módulo com maiúsculas escapadas ("!a").
  const mod = d.name.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
  const [used, latest] = await Promise.all(
    [`https://proxy.golang.org/${mod}/@v/${d.version}.info`, `https://proxy.golang.org/${mod}/@latest`].map((u) =>
      fetch(u, { signal: AbortSignal.timeout(20_000) }).then((r) => (r.ok ? (r.json() as Promise<{ Time: string }>) : null)),
    ),
  );
  if (!used || !latest) return null;
  return Math.max(0, (Date.parse(latest.Time) - Date.parse(used.Time)) / YEAR_MS);
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

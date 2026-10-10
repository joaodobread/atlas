import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dependency } from './IPackageIntel.ts';
import { PublicPackageIntel } from './PublicPackageIntel.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: Handler = () => json({}, 404);
const toUrl = (i: string | URL | Request) => (typeof i === 'string' ? i : i instanceof URL ? i.href : i.url);
const fetchMock = vi.fn<typeof fetch>(async (input, init) => handler(toUrl(input), init));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const intel = new PublicPackageIntel();
const npm = (name: string, version: string): Dependency => ({ name, version, ecosystem: 'npm' });
const go = (name: string, version: string): Dependency => ({ name, version, ecosystem: 'Go' });

describe('PublicPackageIntel.vulnerabilities', () => {
  it('consulta o OSV em lotes de 500 e devolve só as afetadas', async () => {
    const bodies: Array<{ queries: Array<{ package: { name: string; ecosystem: string }; version: string }> }> = [];
    handler = (url, init) => {
      expect(url).toBe('https://api.osv.dev/v1/querybatch');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string) as (typeof bodies)[number];
      bodies.push(body);
      return json({
        results: body.queries.map((q) =>
          q.package.name === 'lodash' || q.package.name === 'dep-599'
            ? { vulns: [{ id: 'GHSA-1' }, { id: 'CVE-2' }] }
            : q.package.name === 'empty'
              ? { vulns: [] }
              : {},
        ),
      });
    };
    const deps = [
      npm('lodash', '4.17.0'),
      go('github.com/x/y', 'v1.0.0'),
      npm('empty', '1.0.0'),
      ...Array.from({ length: 600 }, (_, i) => npm(`dep-${i}`, '1.0.0')),
    ];
    const res = await intel.vulnerabilities(deps);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.queries).toHaveLength(500);
    expect(bodies[0]!.queries[1]).toEqual({ package: { name: 'github.com/x/y', ecosystem: 'Go' }, version: 'v1.0.0' });
    expect(res.affected).toEqual([
      { dependency: 'lodash@4.17.0', ids: ['GHSA-1', 'CVE-2'] },
      { dependency: 'dep-599@1.0.0', ids: ['GHSA-1', 'CVE-2'] },
    ]);
  });

  it('sem dependências não chama a rede', async () => {
    expect(await intel.vulnerabilities([])).toEqual({ affected: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro do OSV lança', async () => {
    handler = () => json({}, 503);
    await expect(intel.vulnerabilities([npm('a', '1.0.0')])).rejects.toThrow('OSV respondeu 503');
  });
});

describe('PublicPackageIntel.freshness', () => {
  it('mede libyears no npm e no proxy do Go, ignorando falhas', async () => {
    handler = (url) => {
      if (url === 'https://registry.npmjs.org/@scope%2Fpkg')
        return json({ 'dist-tags': { latest: '2.0.0' }, time: { '1.0.0': '2024-01-01T00:00:00Z', '2.0.0': '2026-01-01T00:00:00Z' } });
      if (url === 'https://registry.npmjs.org/fresh') return json({ 'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': '2025-01-01T00:00:00Z' } });
      if (url === 'https://registry.npmjs.org/no-latest') return json({ time: {} });
      if (url === 'https://registry.npmjs.org/no-time') return json({ 'dist-tags': { latest: '1.0.0' } });
      if (url === 'https://registry.npmjs.org/down') return json({}, 500);
      if (url === 'https://registry.npmjs.org/throws') throw new Error('rede');
      if (url === 'https://proxy.golang.org/github.com/!azure/sdk/@v/v1.0.0.info') return json({ Time: '2025-01-01T00:00:00Z' });
      if (url === 'https://proxy.golang.org/github.com/!azure/sdk/@latest') return json({ Time: '2026-01-01T00:00:00Z' });
      if (url.startsWith('https://proxy.golang.org/github.com/missing/')) return json({}, 404);
      return json({}, 404);
    };
    const res = await intel.freshness([
      npm('@scope/pkg', '1.0.0'),
      npm('fresh', '1.0.0'),
      npm('no-latest', '1.0.0'),
      npm('no-time', '1.0.0'),
      npm('down', '1.0.0'),
      npm('throws', '1.0.0'),
      go('github.com/Azure/sdk', 'v1.0.0'),
      go('github.com/missing/x', 'v1.0.0'),
    ]);
    expect(res.measured).toBe(3);
    expect(res.outdated).toBe(2);
    // ~2 anos + 0 + ~1 ano → média ~1
    expect(res.averageLibyears).toBeCloseTo((730 / 365.25 + 0 + 365 / 365.25) / 3, 2);
  });

  it('sem medições: média 0', async () => {
    expect(await intel.freshness([])).toEqual({ averageLibyears: 0, measured: 0, outdated: 0 });
  });

  it('amostra no máximo 40 dependências', async () => {
    handler = () => json({}, 404);
    await intel.freshness(Array.from({ length: 50 }, (_, i) => npm(`p${i}`, '1.0.0')));
    expect(fetchMock).toHaveBeenCalledTimes(40);
  });
});

describe('PublicPackageIntel.runtimeSupport', () => {
  const cycles = {
    nodejs: [
      { cycle: '22', eol: '2027-04-30', latest: '22.5.0' },
      { cycle: '16', eol: '2023-09-11', latest: '16.20.2' },
    ],
    go: [
      { cycle: '1.22', eol: false, latest: '1.22.5' },
      { cycle: '2.0', eol: false },
    ],
    java: [{ cycle: '21', eol: true }],
    python: [{ cycle: '3.12', eol: '2028-10-31', latest: '3.12.4' }],
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    handler = (url) => {
      const product = /api\/(\w+)\.json$/.exec(url)?.[1] as keyof typeof cycles;
      return json(cycles[product]);
    };
  });

  it('Node: ciclo = major; suportado e fora de suporte', async () => {
    expect(await intel.runtimeSupport('node', '22.3.0')).toEqual({ supported: true, eol: '2027-04-30', latest: '22.5.0' });
    expect(await intel.runtimeSupport('node', '16')).toEqual({ supported: false, eol: '2023-09-11', latest: '16.20.2' });
    expect(toUrl(fetchMock.mock.calls[0]![0])).toBe('https://endoflife.date/api/nodejs.json');
  });

  it('Go: ciclo = major.minor, eol=false é suportado; versão só com major vira x.0', async () => {
    expect(await intel.runtimeSupport('go', '1.22.1')).toEqual({ supported: true, eol: null, latest: '1.22.5' });
    expect(await intel.runtimeSupport('go', '2')).toEqual({ supported: true, eol: null, latest: null });
  });

  it('Java com eol=true não é suportado; Python por major.minor', async () => {
    expect(await intel.runtimeSupport('java', '21')).toEqual({ supported: false, eol: null, latest: null });
    expect(await intel.runtimeSupport('python', '3.12')).toEqual({ supported: true, eol: '2028-10-31', latest: '3.12.4' });
  });

  it('ciclo desconhecido, runtime desconhecido e falha da API = null', async () => {
    expect(await intel.runtimeSupport('node', '99')).toBeNull();
    expect(await intel.runtimeSupport('ruby', '3.3')).toBeNull();
    handler = () => json({}, 500);
    expect(await intel.runtimeSupport('node', '22')).toBeNull();
  });
});

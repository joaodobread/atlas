export interface Dependency {
  name: string;
  version: string;
  ecosystem: 'npm' | 'Go';
}

export interface VulnerabilityResult {
  /** Ids dos avisos (GHSA/CVE/GO-…) por dependência afetada. */
  affected: Array<{ dependency: string; ids: string[] }>;
}

export interface FreshnessResult {
  /** Média de "libyears" (distância até a versão mais nova) das dependências medidas. */
  averageLibyears: number;
  measured: number;
  outdated: number;
}

export interface RuntimeSupport {
  supported: boolean;
  /** Data de fim de suporte do ciclo (ISO), se conhecida. */
  eol: string | null;
  latest: string | null;
}

/** Fontes públicas sobre pacotes e runtimes (OSV, registries, endoflife.date). */
export interface IPackageIntel {
  vulnerabilities(deps: readonly Dependency[]): Promise<VulnerabilityResult>;
  freshness(deps: readonly Dependency[]): Promise<FreshnessResult>;
  runtimeSupport(runtime: string, version: string): Promise<RuntimeSupport | null>;
}

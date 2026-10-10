export interface ILoginThrottle {
  /** true se a chave (e-mail/IP) está temporariamente bloqueada. */
  isBlocked(key: string): boolean;
  fail(key: string): void;
  reset(key: string): void;
}

/** Bloqueia após N falhas dentro da janela (em memória; suficiente para uma instância self-hosted). */
export class LoginThrottle implements ILoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  isBlocked(key: string): boolean {
    return this.recent(key).length >= this.maxFailures;
  }

  fail(key: string): void {
    this.failures.set(key, [...this.recent(key), Date.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = Date.now() - this.windowMs;
    return (this.failures.get(key) ?? []).filter((t) => t > cutoff);
  }
}

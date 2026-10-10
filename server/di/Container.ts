import type { Token } from './Token.ts';

export interface IContainer {
  resolve<T>(token: Token<T>): T;
}

export type Factory<T> = (container: IContainer) => T;

type Lifetime = 'singleton' | 'transient';

interface Provider<T> {
  factory: Factory<T>;
  lifetime: Lifetime;
  instance?: T;
  resolved: boolean;
}

/**
 * Container de injeção de dependência simples e tipado.
 * - `singleton`: uma instância por container (criada na primeira resolução).
 * - `transient`: nova instância a cada resolução.
 */
export class Container implements IContainer {
  private readonly providers = new Map<Token<unknown>, Provider<unknown>>();
  private readonly resolving: Token<unknown>[] = [];

  singleton<T>(token: Token<T>, factory: Factory<T>): this {
    return this.register(token, factory, 'singleton');
  }

  transient<T>(token: Token<T>, factory: Factory<T>): this {
    return this.register(token, factory, 'transient');
  }

  /** Registra uma instância já construída. */
  value<T>(token: Token<T>, instance: T): this {
    this.providers.set(token, { factory: () => instance, lifetime: 'singleton', instance, resolved: true });
    return this;
  }

  resolve<T>(token: Token<T>): T {
    const provider = this.providers.get(token) as Provider<T> | undefined;
    if (!provider) throw new Error(`Dependência não registrada: ${token.name}`);
    if (provider.lifetime === 'singleton' && provider.resolved) return provider.instance as T;

    if (this.resolving.includes(token)) {
      const chain = [...this.resolving, token].map((t) => t.name).join(' -> ');
      throw new Error(`Dependência circular: ${chain}`);
    }

    this.resolving.push(token);
    try {
      const instance = provider.factory(this);
      if (provider.lifetime === 'singleton') {
        provider.instance = instance;
        provider.resolved = true;
      }
      return instance;
    } finally {
      this.resolving.pop();
    }
  }

  private register<T>(token: Token<T>, factory: Factory<T>, lifetime: Lifetime): this {
    if (this.providers.has(token)) throw new Error(`Dependência já registrada: ${token.name}`);
    this.providers.set(token, { factory, lifetime, resolved: false });
    return this;
  }
}

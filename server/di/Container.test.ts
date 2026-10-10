import { describe, expect, it, vi } from 'vitest';
import { Container } from './Container.ts';
import { Token } from './Token.ts';

describe('Token', () => {
  it('guarda o nome e se descreve no toString', () => {
    const t = new Token<number>('Numero');
    expect(t.name).toBe('Numero');
    expect(t.toString()).toBe('Token(Numero)');
  });
});

describe('Container', () => {
  it('singleton cria uma única instância, preguiçosamente', () => {
    const T = new Token<{ n: number }>('S');
    const factory = vi.fn<() => { n: number }>(() => ({ n: Math.random() }));
    const c = new Container().singleton(T, factory);
    expect(factory).not.toHaveBeenCalled();
    const a = c.resolve(T);
    expect(c.resolve(T)).toBe(a);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('transient cria uma instância nova a cada resolução', () => {
    const T = new Token<object>('T');
    const c = new Container().transient(T, () => ({}));
    expect(c.resolve(T)).not.toBe(c.resolve(T));
  });

  it('value registra uma instância pronta', () => {
    const T = new Token<string[]>('V');
    const v = ['x'];
    expect(new Container().value(T, v).resolve(T)).toBe(v);
  });

  it('o provider de value já nasce resolvido e sua factory devolve a mesma instância', () => {
    const T = new Token<object>('V2');
    const v = {};
    const c = new Container().value(T, v);
    // A factory nunca é chamada por resolve() (o provider já está resolvido); verifica o contrato interno.
    const provider = (c as unknown as { providers: Map<Token<unknown>, { factory: (ct: Container) => unknown; resolved: boolean }> }).providers.get(T)!;
    expect(provider.resolved).toBe(true);
    expect(provider.factory(c)).toBe(v);
  });

  it('a factory recebe o container para resolver dependências', () => {
    const A = new Token<number>('A');
    const B = new Token<number>('B');
    const c = new Container().value(A, 2).singleton(B, (ct) => ct.resolve(A) * 10);
    expect(c.resolve(B)).toBe(20);
  });

  it('falha ao resolver dependência não registrada', () => {
    expect(() => new Container().resolve(new Token('Faltando'))).toThrow('Dependência não registrada: Faltando');
  });

  it('falha ao registrar o mesmo token duas vezes', () => {
    const T = new Token<number>('Dup');
    const c = new Container().singleton(T, () => 1);
    expect(() => c.singleton(T, () => 2)).toThrow('Dependência já registrada: Dup');
    expect(() => c.transient(T, () => 2)).toThrow('Dependência já registrada: Dup');
  });

  it('detecta dependência circular e mostra a cadeia', () => {
    const A = new Token<number>('A');
    const B = new Token<number>('B');
    const c = new Container();
    c.singleton(A, (ct) => ct.resolve(B));
    c.singleton(B, (ct) => ct.resolve(A));
    expect(() => c.resolve(A)).toThrow('Dependência circular: A -> B -> A');
  });

  it('depois de uma falha na factory o token pode ser resolvido de novo (pilha limpa)', () => {
    const T = new Token<number>('Instavel');
    let calls = 0;
    const c = new Container().singleton(T, () => {
      calls++;
      if (calls === 1) throw new Error('primeira falha');
      return 42;
    });
    expect(() => c.resolve(T)).toThrow('primeira falha');
    expect(c.resolve(T)).toBe(42);
    expect(c.resolve(T)).toBe(42);
    expect(calls).toBe(2);
  });

  it('singleton que resolve para undefined continua sendo cacheado', () => {
    const T = new Token<undefined>('Indef');
    const factory = vi.fn<() => undefined>(() => undefined);
    const c = new Container().singleton(T, factory);
    expect(c.resolve(T)).toBeUndefined();
    expect(c.resolve(T)).toBeUndefined();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

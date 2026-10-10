/** Identificador tipado de uma dependência no container. */
export class Token<T> {
  /** Apenas para inferência de tipo; nunca é atribuído. */
  declare readonly __type?: T;

  constructor(readonly name: string) {}

  toString(): string {
    return `Token(${this.name})`;
  }
}
